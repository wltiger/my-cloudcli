# sync/v1.37.4 · 08 spec review 第二轮 · v2 复核核验

日期：2026-10-11。STEM `2610112258-claudecodeui-review`（4 家 resume）。
审对象：`06-grill-decisions.md` **v2**（第一轮修订后的版本）。主会话逐条核验。

## 已核验条目

### W1 · V9 迁移顺序写反了 —— **成立（严重：数据丢失级）**

- sub-fable 原话（大意）："'未 widen 的老库'必丢数据：widen 重建清单若已按 V9 改写为两新列，
  重建时 `INSERT ... SELECT` 无源列可读…正确顺序必须是
  `addColumns → UPDATE（先搬）→ widen → DROP COLUMN`，即 UPDATE 必须在 widen 之前。
  方案 V9 第 3 点写成 `addProviderModelEffortColumns → widen → UPDATE → DROP` 是错序。"
- 核验：`sed -n '560,595p' server/modules/database/migrations.ts`
  - 重建语句：`INSERT INTO provider_models__new (id, …, base_url, api_key, effort_levels, context_window)
    SELECT id, …, base_url, api_key, effort_levels, context_window FROM provider_models`
  - **数据是"旧表 → 新表"逐列搬运，靠的就是旧表里还有 `effort_levels`**
- **结论**：06 v2 §2 V9 第 3 点「`addProviderModelEffortColumns` → `widen` → **UPDATE** → `DROP COLUMN`」**错序**。
  按此执行：widen 重建时若清单已无 `effort_levels` → 旧数据在重建瞬间丢失 → 之后 UPDATE 无源可读
  → **自定义模型 effort 数据全丢**。
- **正确顺序**：`addColumns` → **`UPDATE`（先搬，趁 `effort_levels` 还在）** → `widen`（重建，清单含两新列）
  → `DROP COLUMN`。
- **另**：DROP 也须加 `PRAGMA table_info` 守卫（06 只给 UPDATE 加了）——全新库无该列，DROP 会崩。

### W2 · V16 守卫判据空洞，且最可能被误用的判据是错的 —— **成立**

- sub-fable 原话（大意）："方案没给出判据，实现者最可能顺手用 `followUpPromptPending`
  （`claude-runtime.provider.js:810` 声明、`:1134` 置 true、`:1216-1217` 消费清零），而它是错的…
  claim 的用户 turn 在飞时它恒为 true，守卫恒不成立，早释放永不触发；反之无 claim 时为 false，释放正常。
  结果是'该放时不放'：用户 stop 最后一个任务后进程被 idle ceiling 拖住，`stop-task` 卡住不回。"
- 核验：`grep -n followUpPromptPending claude-runtime.provider.js` → `:810`/`:1134`/`:1216`/`:1217`，
  确认它**只在旧 run 的消息循环内**语义成立。
- **结论**：V16 必须**点名判据**。候选信号里 `followUpPromptPending` 是**错误选择**（恒 true）。
  可能在于：判断"是否有用户 turn 已经 claim 了这个 held run"——须指向 claim 路径的真实状态
  （`heldTurn` 的 claim 结果 / `:924` 之后的状态），而非循环内布尔。

### W3 · V16 × `finally` 联动 = 进程泄漏 —— **成立**

- sub-fable 原话（大意）："V16 只修了早释放分支，没修 finally 的 `heldForBackgroundWork` 项——
  两处须同修…合起来是进程泄漏。"
- 核验：`sed -n '1360,1370p' claude-runtime.provider.js` →
  `if (!inputReleased && (heldForBackgroundWork || backgroundWork.hasOutstandingWork()))`
- **结论**：V16 守卫挡住早释放后，`heldForBackgroundWork` 会保持 true 到用户 turn 的 result。
  若那正是最后一个任务被 stop 的场景，tracker 已空但该项仍 true → finally 继续 hold → **白占进程到 idle ceiling**。
  **06 §1 必须补**：早释放被守卫挡下时置"待释放"标记，用户 turn result 后检查该标记 + tracker 空即释放。

### W4 · `releasePromptStream` 内含 `forgetHeldTurn` —— **成立（比 fable 描述更重）**

- 核验：`sed -n '1070,1085p'` → `releasePromptStream` 定义：
  ```js
  inputReleased = true;
  if (sessionKey()) { forgetHeldTurn(sessionKey(), heldTurn); }
  heldPrompt.release();
  ```
- **结论**：早释放一旦触发会**顺带丢掉 held turn 句柄**（`forgetHeldTurn`），
  下一次 claim 必然失败。与 V16 的守卫必要性互相印证。

### W5 · D3 两套逻辑共存：判据正交，但有排序陷阱 —— **成立（好消息：不打架）**

- sub-fable 原话（大意）："上游 fold 入口是 `msg.compact`（`if (!msg.compact) return false`），
  fork OC/agy 的 boundary 行带 `kind:'compact_boundary'` 但不带 `compact` 字段…
  好消息是'不打架'（各走各），坏消息是方案没说 switch 内 fork case 与上游 `compact` 分支的优先级。"
- 核验：`opencode-sessions.provider.ts:598-606`（无 `compact`）、
  `antigravity-sessions.provider.ts:361`（`kind:'compact_boundary'`，无 `compact`）
- **结论**：判据正交 → **共存安全**。但**必须写明**：
  `appendCompactionRow` 保持在 `switch` **之前**、fork 的 `case 'compact_boundary'` 保持只认无 `compact` 的行。
  否则实现者挪动位置 → Claude 行被渲染两次。

### W6 · 诉求 1 的验收测不出 V16 修的 bug —— **成立（验收空洞）**

- sub-fable 原话（大意）："V16 场景要求'claim 命中 + 用户经 G4 stop 掉最后一个任务 + 用户 turn 在飞'
  三条件叠加，普通'发消息'用例根本进不了早释放分支。须加专用验收。"
- **结论**：06 §1 验收标准须**加一条**：后台 Agent 运行中 → 发消息被 claim →
  点 stop-task 停掉该任务 → 用户 turn 必须正常完成（不断流、不半截 complete），进程在 turn 结束后释放。

### W7 · V2 的"补 reset"表述会误导引已删函数 —— **成立**

- sub-fable 原话（大意）："'补 reset'字面读法是'保留对 `backgroundWork.resetFallbackSignal()` 的调用'
  ——而该函数随文件退役而消失…正确补法是'tryAccept 成功后置 `sawTaskEventThisTurn=false'。"
- **结论**：06 v2 §1 的 `:1133` 那条须改写为：
  "`tryAccept` 成功后清零 `sawTaskEventThisTurn`（上游 result 分支同款清零），**不是**调用已退役的 reset。"

### W8 · `session_crons` 的答案现在就能定，不用"待实测" —— **成立（sub-opus，决定性）**

- sub-opus 原话（大意）："§1「待实测」把 `session_crons` 交给'合并时读上游代码确认' —— **这个答案现在就能从代码定出来**：
  `session_crons` 没有 `task_id`，上游 tracker 结构上收不到 cron；cron 只在上游 `startsBackgroundWork`
  白名单里被兜住「本轮启动了 cron」这一种，**跨轮才触发的 cron（上一轮建好、这一轮中途响）在两条通路里都没有信号**
  → `holdForTurn` 判 false → 进程释放 → cron 随进程死。这正是 D1-d 退役 hook 快照
  （`recordSnapshot` 里 `crons.length > 0` 那一支，`claude-background-work.ts:108/115-116`）唯一不可替代的能力。"
- 核验：`MSYS_NO_PATHCONV=1 git show upstream/main:...claude-runtime.provider.js | grep -n -A3 "typeof message.task_id"`
  → `:715-717` `if (message?.type !== 'system' || typeof message.task_id !== 'string') { return; }`
- **结论**：**cron 事件没有 `task_id` → 被上游 tracker 的守卫过滤掉，结构上收不到。**
  跨轮 cron 在 tracker 与 `startsBackgroundWork` 两条通路里**都没有信号** → 进程被释放 → cron 死。
  这是**已定结论，不是"待实测"**。06 §1 须改写为：
  - 事实：上游 tracker 不认 cron（结构性）
  - **取舍（需用户定）**：接受 cron 回归 / 保留 `session_crons` 那一支 hook 快照

### W9 · 上游 db 测试按列位置断言，两列必须排最后 —— **成立（sub-opus）**

- sub-opus 原话（大意）："上游 `provider-models.db.integration.test.ts:220`
  `assert.deepEqual(columnNames.slice(-2), ['effort_values','effort_default'])`，
  上游用**列位置**断言 effort 两列在最后。fork 建表语句并集怎么排没规定。排成 effort 两列在中间
  → 这条测试直接红，而它属于 §6 要跑的 `npm test` 门禁。"
- 核验：`git show upstream/main:server/modules/database/tests/provider-models.db.integration.test.ts | sed -n '213,224p'`
  → `:220` 确认上述断言。
- **结论**：**建表语句与 widen 重建语句里，`effort_values`/`effort_default` 必须是最后两列。**
  06 §2（V1 建表取并集处）须写死这个顺序约束。

### W10 · `:529` 每次启动都加 `effort_levels` 列 —— **成立（sub-opus）**

- sub-opus 原话（大意）："`migrations.ts:523-531` `addProviderModelCustomEndpointColumns` 里
  `:529` `addColumnToTableIfNotExists(db, 'provider_models', columnNames, 'effort_levels', 'TEXT')`
  —— 这条迁移每次启动都跑。方案只说删列没说删这一行 → DROP COLUMN 之后下一次启动又把它加回来，
  形成 add/drop 往复。"
- 核验：`sed -n '520,535p' server/modules/database/migrations.ts` → `:529` 确认。
- **结论**：06 §2 退役清单**须含 `migrations.ts:529` 这一行的删除**，否则 add/drop 往复。

### W11 · `followUpPromptPending` 覆盖不到 CLI 自主回报的 turn —— **成立（sub-opus，比 fable 更进一步）**

- sub-opus 原话（大意）："`followUpPromptPending` 只覆盖 app 侧 claim 进来的 turn。后台任务自己回来报告时，
  CLI 是直接往 `heldPrompt` 里推自己的 turn 的，那条路上没有任何代码把它置 true（唯一写入点是 `:1134` 的 `tryAccept`）。
  于是在 **CLI 自主回报的 turn 在飞时**它恒为 false，守卫等于没加。"
- **结论**：W2 之外新增一层 —— 即使选 `followUpPromptPending` 也有覆盖空洞。
  **06 §1 的守卫判据必须指向能覆盖两条路径的状态**，或明确接受"只保 app 侧 claim"。
  这条与用户诉求 1 直接相关，**须用户定取舍**。

### W12 · `buildCustomModelEffort` 签名要改，调用方拿不到 provider —— **成立（sub-opus）**

- sub-opus 原话（大意）："方案说'规范序从写死 5 级换成 provider 的 `effortLevels`'，
  但没说 `buildCustomModelEffort` **要不要收一个新入参**——现在签名是 `(effortLevels: string[] | null)`，
  `:62-64` 在函数体里读全局常量。调用方 `provider-models.service.ts:54` 只有 `record`，拿不到 provider。"
- **结论**：06 §2 须点名**两处**改动：`buildCustomModelEffort` 签名加参 + 调用方传 provider 的 `effortLevels`。

### W13 · `finally` 那行的最终形态两处各说一半 —— **成立（sub-opus）**

- sub-opus 原话（大意）："正确形态是
  `if (!inputReleased && (heldForBackgroundWork || backgroundWork.hasOutstanding(sessionKey())))`
  （保留 `inputReleased` 与 `heldForBackgroundWork` 两个 fork 增益，第三个条件换成上游签名）。"
- **结论**：06 §1 须把这行**写成完整形态**，避免只做半边（丢 `!inputReleased` 短路或整行换成上游版）。

### W14 · `sessionHistoryCache` 没 import —— **成立（agy 独家）**

- agy 原话（大意）："fork 当前的 `claude-runtime.provider.js` 顶部根本没有 import `sessionHistoryCache`；
  方案只要求在函数体内调用接线，未声明补齐顶部模块导入，执行后会直接报
  `ReferenceError: sessionHistoryCache is not defined`。"
- 核验：`grep -n "sessionHistoryCache\|session-history-cache" claude-runtime.provider.js` → **零命中**
- **结论**：06 §1 V12 须补一句"**顶部补 import `sessionHistoryCache`**"（`from
  '@/modules/providers/services/session-history-cache.service.js'`）。
  上游 `557109a2` 的 hunk 自带这个 import —— 写 V12 时漏了。

### W15 · 上游 hold 测试含 stop 断言，不取 stop 则 test 必红 —— **成立（agy）**

- agy 原话（大意）："上游 `b9d3d129` 在该测试文件中新增了两个专门验证 stop-before-takeover 的用例
  （`a new turn stops the tasks...` 与 `a held process is still let go...`）；方案既已决定不取
  stop-before-takeover，若不明确反向重写或删除这两个测试，`npm test` 必然全红。"
- 核验：`git show upstream/main:...claude-runtime-hold.test.ts | grep -n "^test"`
  实测该文件有 **6 条** test：
  - `:134` `'stopping the last outstanding task releases the held process'`
    ← **这条正是 V16 场景（stop 最后一个任务 → 释放），是上游对 V16 的测试 —— 应保留**
  - `:161` `'a task that reported completed keeps the hold for the turn that relays its result'`
  - `:182` `'an agent that ran in the foreground and settled before the result does not hold the process'`
  - `:200` `'a new turn stops the tasks the held process still has going before letting it go'`
    ← **stop-before-takeover，不取 → 须删/改写**
  - `:251` `'a held process is still let go when stopping its tasks throws'` ← 同上（`stopTask: () => { throw }`）
  - `:299` `'a turn whose tool emits no task events still holds on the static rule'`
- **结论**：06 §1 须写明这 6 条的逐条处置：
  **保留** `:134`（正是 V16 的验收依据）/ `:161` / `:182` / `:299`；
  **删或改写** `:200` / `:251`（stop-before-takeover，方案决定不取）。

### W16 · 验收遗漏两条场景 —— **成立（agy）**

- agy 原话（大意）："①方案验收仅聚焦 Agent 类后台任务，遗漏了'不发 task 事件流的工具
  （Monitor/CronCreate 等）运行中向主 agent 发消息'的必测用例；②D3 验收仅包含活跃会话实时触发 compact，
  完全遗漏了'刷新页面重新加载历史会话时的单行折叠验证' —— 历史反向加载（boundary 先到、summary 后到）时
  双行表现尤为严重。"
- **结论**：06 §1 验收须加"不发 task 事件的工具运行中发消息"用例；
  §3 验收须加"刷新页面重载历史会话"用例。

### W17 · `composerSendOverBackgroundWork.test.tsx` 后缀写错 —— **成立（agy，与第一轮同）**

- 核验：`ls src/modules/chat/tests/` 实际为 **`.test.ts`**（非 `.tsx`）。
- **结论**：06 §5 的路径须改正。

## 第三轮（v3 复核）核验

日期：2026-10-12。4 家 resume 复核 v3。sub-fable / sub-opus 已核；agy 结果待读；cbc 空跑。

### X1 · repository 层漏了 `effort_levels` —— **成立（sub-opus，三轮首报）**

- sub-opus 原话（大意）："`server/modules/database/repositories/provider-models.ts:21`/`:109`/`:144`
  仍硬编码 `effort_levels`，DROP COLUMN 之后新建/编辑任何自定义模型当场抛异常。V11 只列了 service 层。"
- 核验：`grep -n effort_levels server/modules/database/repositories/provider-models.ts` → **5 处**：
  - `:16` 行类型 `effort_levels: string | null`
  - `:21` SELECT 列清单
  - `:39` `effortLevels: parseEffortLevels(row.effort_levels)`
  - `:109` INSERT 列名
  - `:144` UPDATE SET
- **结论**：**V11 的退役清单漏了 repository 层**。DROP COLUMN 后，INSERT/UPDATE 会立刻
  `no such column: effort_levels` → **新建/编辑任何自定义模型全崩**。
  06 §2 须补这 5 处。

### X2 · `heldPrompt.push` 只有一处，v3 的守卫写法不可实现 —— **成立（sub-opus，推翻 v3）**

- sub-opus 原话（大意）："v3 说'在 CLI 推 turn 处打标记'，但 `heldPrompt.push` 全仓只有 `:1143` 一个
  调用点（claim 内），CLI 自主回报的 turn 是直接写 stdin，runtime 侧没有代码点 —— 那条路不可实现；
  W3 的'待释放标记'才是覆盖两条路径的。"
- 核验：`grep -n "heldPrompt" claude-runtime.provider.js` → push 仅 `:1143`（在 claim 内）
- **结论**：v3「造一个覆盖两条路径的 turn 在飞判据」**物理上不可实现**（CLI 侧无代码点）。
  **改用 W3 的"待释放标记"**：不判"turn 在飞"，而是早释放被挡下时记标记，
  用户 turn 的 result 后检查"标记 + tracker 空"即释放。**此方案绕开两路径统一判断的难题。**
- **06 §1 须改写**：守卫实现改为"待释放标记"，而非"turn 在飞判据"。
- 附：sub-fable 另给一个候选 `!turnCompleteSent`（`:798`/`:1131`/`:1235`）——
  两条路径的 result 都经过它，语义为"本进程有未完成的 turn"。**可作为备选**，
  但 X2 的"待释放标记"更直接。

### X3 · 三源 OR 必须写成真 OR（cron 要进两个分支）—— **成立（两家都报）**

- sub-fable 原话（大意）："上游表达式是二源 `holdForTurn = sawTaskEventThisTurn ? stillOutstanding
  : backgroundWorkPending || stillOutstanding`，cron 快照是第三个布尔，必须明确写进表达式；
  不写明，实现者可能把 cron 只 OR 进 fallback 分支，则 sawTaskEventThisTurn=true 的 turn
  （最常见的 Agent 后台场景）cron 被忽略。"
- **结论**：正确形态：
  ```js
  holdForTurn = sawTaskEventThisTurn
    ? (stillOutstanding || cronOutstanding)
    : (backgroundWorkPending || stillOutstanding || cronOutstanding)
  ```
  **06 §1 须写全表达式**（cron 同时进两个分支）。

### X4 · 退役清单与"保留 cron 支"打架 —— **成立（两家都报，Q2 预判命中）**

- sub-fable 原话（大意）："cron 支与 ledger 是同一函数体的同一快照变量：
  `claude-background-work.ts:108` `recordSnapshot` 同时读 `input?.background_tasks` 与
  `input?.session_crons`，写同一个 `snapshotOutstanding`（`:115-116`）。只留 cron 支 =
  保留 `recordSnapshot` + `buildHooks` 的 Stop/SubagentStop 注册（`:134-137`）+ `snapshotOutstanding`。
  v3 退役清单仍写'`snapshotOutstanding` ledger 退役'与'`:953 buildHooks` 删'
  ——照字面执行会把 cron 支的 hook 注册一起删掉。"
- sub-opus 原话（大意）："v3 定了保留 cron 快照支，但唯一能注册它的 `:953` hooks 被整条列进退役清单，
  决策总表 D1-d 那行也还写着'hook 快照 ledger 退役'。照做则 cron 第三信号源根本不存在。"
- **结论**：06 须改写：
  - **决策总表 D1-d 行**：改为"hook ledger 的 **task 判定支**退役；**cron 快照支保留**"
  - **§1 退役清单**：`claude-background-work.ts` **不整文件退役** —— 保留 `recordSnapshot`、
    `buildHooks`、`snapshotOutstanding`、以及 `:953` 的 hook 注册；只删
    `BACKGROUND_WORK_TOOLS` / `observeMessage` / `resetFallbackSignal` 等 task 判定三件套
  - `claude-background-work.test.ts`：**cron 用例保留**，task 用例改取上游语义

### X5 · `buildCustomModelEffort` 加参与新校验未配对 —— **成立（sub-fable）**

- 原话（大意）："fork 调用方 `provider-models.service.ts:75` 删旧校验后，新校验
  （`assertEffortLevelsSupported`）的调用点方案未点名。若只删不加，自定义模型可写入矩阵外级别，
  运行时静默丢弃 —— 与 D2'adapt 以上游为底'相悖。"
- **结论**：06 §2 须补"`:75` 替换为上游 `assertEffortLevelsSupported(provider, input.effort)`"。

### X6 · 失败路径三轮未决 —— **成立（sub-opus）**

- 原话（大意）："v3 把'不能留成未定'抄进方案却仍未给行为。"
- **结论**：claim 指纹不匹配路径（落到 `:942` 释放旧进程，~90s 双写）**必须给期望行为或明确排除**。
  **须用户定。**

### X7 · `delete sdkOptions.hooks` 重试分支语义变化 —— **成立（sub-fable，advice）**

- 结论：保留 cron 快照后，hook 注册失败 → 无 cron 快照 → cron 退化为上游行为。
  **重试分支须保留**，注释改写为"无 hooks 则 cron 快照与 tracker 均不可用，退化为上游语义"。

### X8 · 验收③ 与"没给落点"同页并存 —— **成立（sub-fable，advice）**

- 结论：③"压缩前历史可直接看到"**降级为观察项**（fold 本就不解决翻山越岭，属新功能非回归）。

### X9 · `W17` 后缀未改 —— **成立（sub-fable，搭车项）**

- v3 `:370` 仍写 `composerSendOverBackgroundWork.test.tsx`，应为 `.ts`。

### 核对通过（无需再动）

W1 迁移顺序（三家推演三种库均不丢数据）、W9 列位置、W10、W12、W14、W5、W3/W4 写法明确。

### X10 · W3「待释放标记」应删除（cbc 推翻 W3）—— **成立**

- cbc 原话（大意）："正常路径无泄漏 —— 用户 turn 的 result 到达时 `holdForTurn` 在 tracker 空时必为 false，
  **else 分支本来就释放**（fork `:1267-1272`）；finally 只兜异常退出…标记机制在正常路径冗余、
  在异常路径无效（检查点在 result，异常路径到不了 result）。更糟：照抄'标记 + tracker 空即释放'
  而快照源（cron）不在判定里 → cron 存活时 claim turn 中 stop 最后任务 → 释放 → **cron 死** ——
  W3 与 W8 直接相杀。处置：从 v3 删掉 W3 机制。"
- 核验：`sed -n '1262,1276p' claude-runtime.provider.js` → else 分支确认
  `heldForBackgroundWork = false; releasePromptStream();`
- **结论**：**W3 的"待释放标记"从 06 删除**。normal 路径由 `holdForTurn` 的 else 分支覆盖，
  异常路径的保留是 fork #30 明文接受的代价。

### X11 · `context.createQuery` 缝未移植，W15 测试处置空转 —— **成立（cbc）**

- cbc 原话（大意）："上游测试的驱动缝是 `context.createQuery`（`claude-runtime-hold.test.ts:20` 注释明说）；
  fork `claude-runtime.provider.js:1080`/`:1094` 直调 `query()`、无 `const createQuery = context.createQuery ?? query`
  —— 测试文件落仓后 6 条没有一条能驱动 runtime。执行时必须把 557109a2 的 `createQuery` 缝一并取进 runtime。"
- 核验：上游 `:1110` `const createQuery = context.createQuery ?? query;`（`:1114`/`:1127` 使用）；
  fork `grep createQuery` → **零命中**
- **结论**：06 §1 须补 **`createQuery` 缝的移植**（两处调用点改 `createQuery(...)`），
  否则 `claude-runtime-hold.test.ts` 整份测试处置无法执行。

### X12 · `false && …` 过不了本项目 lint —— **成立（cbc 实测）**

- cbc 原话（大意）："本仓 oxlint（`.oxlintrc.json:18` `correctness: "error"`）对 `if (false && x?.b)`
  报**两条 error**（`no-constant-condition` + `no-constant-binary-expression`），`npm run lint` 与
  pre-commit 双红；命名 false 常量与具名谓词两形态实测零告警。"
- 核验：`.oxlintrc.json:18` `"categories": { "correctness": "error" }` 确认
- **结论**：06 §5 G3 须**钉死为命名常量或具名谓词形态**（如
  `const PROMPT_BEFORE_SEND_OVER_BACKGROUND_WORK = false as const;`），**不能写 `false && …`**。

### X13 · 三源 OR 的汇合点不止一处（cbc 修正 X3）—— **成立**

- cbc 原话（大意）："上游 outstanding 的消费点共 4 处：`holdForTurn`、**task_notification 早释放 hunk 的
  `!hasOutstanding`**、notify 门 `heldForBackgroundWork && !stillOutstanding`、finally（W13 已含）。
  只 OR 进 holdForTurn → 早释放仍只查 tracker：cron 存活时 stop 最后一个 tracked task → 早释放照发 →
  **cron 死在 W8 自己的盲区**；notify 门同理提前报'工作完成'。"
- **结论**：06 §1 须写明**快照源同样并入早释放与 notify 门的"无活"判定**（不只是 `holdForTurn`）。

### X14 · 快照支应整段保留，不是"只留 cron 一支" —— **成立（cbc 修正 W8 的切法）**

- cbc 原话（大意）："`recordSnapshot` 读 `background_tasks`+`session_crons` **合成一个布尔**，
  不存在独立'cron 支'；且 crons-only 切法**比 fork 现状更窄** —— Monitor/ScheduleWakeup 等
  无 task 事件工具跨轮存活时，claim turn 的 result 上 tracker 空 + `startsBackgroundWork` 假 →
  三源全 false → 释放 → 工具死，恰是 W16 用例自己点名的场景。建议**保留 `recordSnapshot` 整段**。"
- **结论**：06 §1 的保留范围改为**保留 `recordSnapshot` 整段（两个列表都读）**，
  机制不改、只多不少，对 fork 零倒退。

### X15 · `toCustomProviderModelOption` 拿得到 provider —— **成立（cbc 修正 W12 的前提）**

- cbc 原话（大意）："`CustomProviderModelRecord` 自带 `provider`（`provider-models.ts:10` 类型字段、
  `:33` `provider: row.provider`）；服务层 `:45-56` 手里的 `record.provider` 就地可用。
  按 v3 原文'拿不到 provider'会去找不存在的传参通道。"
- **结论**：W12 的**处方（加参）成立，但前提写错**。06 §2 改为：
  "用 `record.provider` 查能力矩阵取 `effortLevels` 传入"（`record` 自带 provider）。

### X16 · CLI 侧标注点的可实现形式（cbc 给出）—— **成立（替代 X2 的"做不到"）**

- cbc 原话（大意）："**无现成状态位可覆盖两条路径。** 能落地的候选：在消息循环新维护一个 `turnInFlight` 位
  —— **无 `parent_tool_use_id` 的 `user`/`assistant` 消息置 true**（claim 推送产生 user echo 行、
  CLI 回报 turn 产生 assistant 行），每个 `result` 清零。覆盖两条路径；parked + stop 最后任务
  （上游 `:134` 测试场景）中间无主线程消息 → false → 早释放照常（测试仍绿）；
  后台 subagent 行带 parent id 不误置。"
- **结论**：06 §1 的守卫判据改为 **"消息循环里观察：无 `parent_tool_use_id` 的 user/assistant 消息即 turn 开始"**
  的 `turnInFlight` 位 —— 这是 CLI 侧唯一可观察面（fork 无代码点，见 X2）。
- 附 sub-fable 的 `!turnCompleteSent` 作备选（覆盖两条路径但语义粗糙）。

### X17 · fork 测试的 cron 用例要挑出保留 —— **成立（cbc）**

- cbc 原话（大意）："fork 测试含快照支专属用例（`claude-background-work.test.ts:266` `session_crons` 场景、
  `:242`/`:254`/`:279`/`:294` `fireHook` 快照系列）—— 保留支的测试随 479 行版本整体退役会失去唯一覆盖。"
- **结论**：06 §2/§1 须补"fork 版本中快照支的用例挑出保留，其余取上游"。

### X18 · "任务中途完成"（非 stop）的对称窗口 —— **成立（cbc，知情项）**

- cbc 原话（大意）："任务在 claimed turn 中途**完成**（非 stop）时，该 turn 的 result 时 tracker 空 +
  无新 tool_use → `holdForTurn=false` → 释放 → CLI 待发的 work-report turn 被截…
  三源 OR 对此无解（tracker 空是真实状态）；验收②字面通过但回报丢失。"
- **结论**：**非 v3 引入**（fork `:1225-1228` 现状同型），smoke 加"follow-up 回答中途任务完成"用例
  并把预期写明（**知情即可，不必修**）。

### X19 · D1-a 不覆盖 #31 信号层 —— **成立（cbc，advice）**

- 结论：06 §4 补一行"D1-a 不覆盖 #31 信号层（registry / SessionProtection / realtime handlers /
  ActivityIndicator），按 05 §1.6 执行"，避免执行者把"上游信号"读成"替换 #31 信号"。

## cbc Q4 结论

**还不能开工，缺 5 处文字级补丁**（不动 7 项决策本体）：
① D1 退役清单按"保留快照支"重切（`:27`/`:801`/`:953`/`:1133` 四处与 W8 相反指令）；
② 三源 OR 汇合点列全（早释放 hunk + notify 门并入快照源）；
③ 删除 W3"待释放标记"机制；
④ 补 `context.createQuery` 缝移植；
⑤ G3 恒假守卫钉死为命名常量/谓词形态。
其余 advice 不阻塞。

## 第三轮汇总

**4 家结论**：sub-opus「还不能，缺 4 项」· sub-fable「还不能，缺 3 项」·
cbc「还不能，缺 5 项」· agy「可以开工」（但漏 X1，且对 X2 给了不可实现的方案）。
**3:1 判定不能开工。**

**共识 ≥2 家的（最硬）**：
- **X4/X1 退役清单与"保留 cron 支"打架**（fable + opus + cbc —— 3 家）
- **X3/X13 三源 OR 表达式要写全**（fable + cbc）
- **X2/X16 守卫判据**（opus 证明"CLI 推 turn 处"无代码点 + cbc 给出 `turnInFlight` 可实现形式）

**单家独家**：
- X1 repository 层漏 5 处（opus，三轮首报）
- X10 删 W3 机制（cbc）、X11 `createQuery` 缝（cbc）、X12 lint（cbc）
- X5 新校验调用点（fable）、X7 重试分支（fable）、X8 验收③降级（fable）

**核对通过**：W1 迁移四步顺序（三家推演三种库均不丢数据）· W9 列位置 · W10 · W12 处方 ·
W14 · W5 · W7/W12 `:1133` 清零 · W15 六条测试名单本身

**待用户决策**：X6 claim 指纹不匹配的失败路径（三轮未决）→ **已决（2026-10-12：选项 1，不释放到 ceiling）**

## 第四轮（v4 复核）核验

日期：2026-10-12。sub-opus 已回（**结论：还不能，缺 2 处文字级补丁**，并明说"补上后达到可开工标准"）。
其余三家待回。

### Y1 · `backgroundWork` 命名冲突 —— **成立（sub-opus，四轮首报）**

- sub-opus 原话（大意）："上游的 tracker 是模块级同名变量，fork 保留的 ledger 是
  `claude-runtime.provider.js:801` 的每轮局部量，会遮蔽它。v4 保留 `:801` 又把 `:1366` 改成
  `hasOutstanding(sessionKey())`，解析到的是 ledger，**每次异常退出都 TypeError**。解法很小：ledger 改名。"
- 核验：
  - 上游 `:46` `const backgroundWork = createBackgroundWorkTracker();` —— **模块级**
  - fork `:801` `const backgroundWork = createBackgroundWorkLedger();` —— **`queryClaudeSDK` 内局部**
- **结论**：**局部遮蔽模块级**。v4 的 `:1366` 写 `backgroundWork.hasOutstanding(sessionKey())`
  会解析到 ledger → ledger 无该方法 → **异常退出路径 TypeError**。
  → **06 §1 须写明：ledger 改名**（如 `snapshotSource`），避免与上游 tracker 同名。

### Y2 · X6 处方无效（`:942` 服务三情形 + supersede 也释放）—— **成立（sub-opus）**

- sub-opus 原话（大意）："改 `:942` 不释放，**改不掉 `addSession:396-404` 的 supersede**
  （interrupt + releaseInput）。而且 `:942` 服务三个情形（编辑/rewind、指纹不匹配、tryAccept 返回 null），
  X6 只该覆盖第二个。"
- 核验：`sed -n '915,950p'` → `if (sessionKey())` 块内：
  - `carriesResumeAnchor(options) ? null : claimHeldTurn(...)` → 情形 1（编辑/rewind）
  - `claimHeldTurn` 返回 null → 情形 2（指纹不匹配）← **X6 只该覆盖这个**
  - `tryAccept` 返回 null → 情形 3
  - 末尾 `getSession(sessionKey())?.releaseInput?.();` —— **三种情形共用这一行**
  `sed -n '390,410p'` → supersede 分支 `:402` `existing.releaseInput?.()` —— **另一处释放点**
- **结论**：X6 的处方须改写为：
  - 只对**情形 2（指纹不匹配）**改为"不释放"
  - 须能区分三种情形之一的判据
  - **且须处理 supersede 路径**（`addSession:396-404`）—— 否则新进程起来时旧进程仍被 interrupt+release
- **这是处方落点错误，不是决策错误** —— X6 的决定（不杀后台）不变，只改实现位置。

### sub-opus 核对通过项

X4/X14 退役重切干净 · X3/X13 四处汇合全对 · X16 `turnInFlight` 在 `:1208`/`:1210` 有落点且
天然避开 W2 的恒真失效 · X10 删 W3 论证成立 ·
X1/X5/X11/X12/X15/X7/X9/X17/X18/X19 均已并入。

### sub-opus 附 3 条 advice

1. `tryAccept` 补一行 `turnInFlight = true` 堵窄窗
2. 删 `observeMessage` 时清 `backgroundWorkStarted` 的死分支
3. §4 的 X19 段落**插错位置**，把一句话劈成两半

### sub-opus Q4 结论

"**补上那两处后我认为方案达到可开工标准。**"

## 第四轮汇总

**4 家结论**：
- `sub-opus`：**还不能，缺 2 处文字级补丁**（Y1 命名遮蔽 + Y2 X6 落点），
  并明说"**补上那两处后我认为方案达到可开工标准**"
- `sub-fable`：**可以开工，0 must-fix，7 advice**（X6-supersede 联动置顶）
- `agy-g38f`：**可以开工，附 2 advice**
- `cbc-glm53`：**可以开工，附 2 advice** —— 重试后成功。**独立复现 Y1**
  （与 opus 同一条，两家印证），并**独家报了一条**：
  **`cronOutstanding` 不能写成 `hasSnapshot()`** —— `hasSnapshot()` 只答"有没有读到过快照"
  （`claude-background-work.ts:126` `snapshotOutstanding !== null`），
  不答"快照说没说有活"；误用 → **任何到过快照的 run 恒 hold、早释放恒不发 → 30 分钟级故障**。
  正确：`cronOutstanding = hasSnapshot() && snapshotOutstanding === true`。**已并入 06。**

**cbc 另外核对通过**：三源四处汇合点**无遗漏**（其余 tracker 使用处 ——
`stopClaudeSDKTask` 的 `has`、`listClaudeSDKBackgroundWork`、`addSession`/`removeSession` 的 `clear`
均非"无活"判定）· `turnInFlight` 落点确切（`:1208` 之后、`:1210` 之前；fork 是 **if 链不是 switch**）·
删 W3 收尾成立 · X1/X11 成立。

**Y1/Y2 已由主会话应用进 06 v4**（opus 报告后立即改）：
- **Y1**：ledger 改名（`claude-runtime.provider.js:801` 的局部 `backgroundWork`
  遮蔽上游 `:46` 模块级同名变量 → `:1366` 的 `hasOutstanding(sessionKey())` 解析到 ledger → TypeError）
- **Y2**：X6 处方修正（`:942` 服务三种情形，只该覆盖"指纹不匹配"；
  且须处理 `addSession:396-404` 的 supersede 释放 —— fable 独立复现同一条）

**fable 的 7 条 advice 已并入 06**：
1. `:1225-1228` 须用 `hasSnapshot()`（cron）+ 上游 `backgroundWorkPending`（task），
   **`outstandingReason` 整函数删**（否则 task/cron 混在一个布尔，三源 OR 名存实亡）
2. 三源 OR 第 2/3 处须写表达式（早释放 `!hasOutstanding && !hasSnapshot`；
   notify 门 fork 与上游不同形，读 `holdForBackgroundWork` 不是 `stillOutstanding`）
3. `turnInFlight` 落点须在 SDK 原始 `message.parent_tool_use_id`（`:448`/`:539`）层，
   **不在** normalized 循环内（`:1183-1191`），否则守卫恒真
4. X6 × supersede 联动（**必须同修**，单修 X6 不充分）
5. W3 删后"守卫挡下 + 用户 turn 卡住永不 result"（permission pending / abort）→ 进程留到 ceiling，
   **属预期，知情即可**
6. X6 双写窗口从 ~90s 扩到 ~30min；后台回报可能显示在新 run 下 → **smoke 备注不查归属**
7. `sessions.effort`（`migrations.ts:457`）与本次全无关，**grep `effort` 时勿误改**

## 终审判定

**可以开工。** 依据：
- 四轮 review 共 50+ 条发现，**无一项否定 7 条决策本体** —— 全部是落地细节
- must-fix 收敛曲线：**13 → 17 → 19 → 2 → 0**（第四轮那 2 条已修）
- 三家明确表态：fable「可以开工，无 must-fix」· agy「可以开工」·
  opus「补上那两处后达到可开工标准」（两处已补）
- 唯一反调（agy 对 X6 的判断）已被 opus + fable **两家独立证据**推翻

**执行时须盯的三条**（第四轮遗留，已写进 06）：
1. **Y1 改名**：ledger 与上游 tracker 同名会静默 TypeError
2. **Y2 X6 + supersede 同修**：只改 `:942` = "只保留几毫秒"
3. **X16 落点**：须在 SDK 原始消息层判断 `parent_tool_use_id`
