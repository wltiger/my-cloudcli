# sync/v1.37.4 · 06 grill 决策记录

日期：2026-10-11。由 `/grill-with-docs` 逐题确认，用户逐条拍板。本文件是执行阶段的**唯一权威**，
与 05-research-consensus.md（研究共识）冲突时以本文件为准。

**修订 v2（2026-10-11）**：经 spec review 第一轮（4 家同题同卷，见 `07-spec-review-round1.md`）
后修订。13 条 must-fix 全部并入本文件（以 `V<n>` 标注来源）。**7 项决策本体未变**，
修订集中在执行细节：
- D1：补全退役调用点（7 处 + import）、补 `addSession`/`removeSession` 接线、
  明确 claim 块为 `:924`→`:942` 且不引入 `releaseHeldSession`、**新增 stopped 早释放守卫**（V16）
- D2：`schema.ts` 建表取并集、迁移加守卫、widen 重建清单改写、补读写链退役
- D3：**补两个前端文件**（`useChatMessages.ts` / `MessageComponent.tsx`，否则双行照旧）、
  修正"两 system 分支"为 system + user 分支
- D4：补 `80dd5c29` 上游测试的处置（`scheduled-messages.test.ts:126`）
- G3：明确恒假守卫写法 + 验收方式（mock `window.confirm`）

**修订 v3（2026-10-12）**：经 spec review 第二轮（4 家 resume 复核，见 `08-spec-review-round2.md`）
后修订。17 条核验成立（以 `W<n>` 标注）。**7 项决策本体仍未变**，改动要点：
- **D2 迁移顺序改正（W1，重要）**：v2 的 `addColumns → widen → UPDATE → DROP` 是**错序**
  （widen 重建靠旧表 `effort_levels` 搬数据，先 widen 会丢数据）。
  改为 `addColumns → **UPDATE** → widen → DROP`；DROP 加 PRAGMA 守卫；
  删 `migrations.ts:529` 的加列行（W10）；**两列必须排最后**（W9）
- **D1 守卫判据定案（W2/W11）**：用户决定**造覆盖两条路径的判据**，不用 `followUpPromptPending`
- **W8**：`session_crons` 结构性收不到（上游 tracker 的 `task_id` 守卫）→ 用户决定保留快照源
- **W7/W12/W13/W14**：`:1133` 改清零标志、`finally` 形态写死、补 `sessionHistoryCache` import
- **W15/W6/W16/W12**：测试逐条处置、验收补场景、`buildCustomModelEffort` 签名改动

**修订 v4（2026-10-12）**：经 spec review 第三轮（4 家 resume 收尾复核，见 `08-spec-review-round2.md`
第三轮节）后修订。19 条核验成立（以 `X<n>` 标注）。**7 项决策本体仍未变**，改动要点：
- **X4/X14 · 退役清单重切**（3 家共识）：`claude-background-work.ts` **不整文件退役** ——
  保留 `recordSnapshot` 整段（两个列表都读）、`buildHooks`、`:953` hook 注册、`:27`/`:801`；
  只删 task 判定三件套。**决策总表 D1-d 行同步改**（原文"整支退役"与保留决定相杀）
- **X3/X13 · 三源 OR 写全**（2 家共识）：汇合点**不止 `holdForTurn`** —— 早释放 hunk 的
  `!hasOutstanding`、notify 门也要并入快照源；`holdForTurn` 须写成**真 OR**（cron 进两个分支）
- **X16 · 守卫判据改用可实现形式**：v3 写的"CLI 推 turn 处打标记"**物理上做不到**
  （`heldPrompt.push` 全仓仅 `:1143` 一处，CLI 侧无代码点）→ 改用消息循环里的 `turnInFlight` 位
- **X10 · 删除 W3「待释放标记」机制**：fork `:1262-1276` 的 else 分支本就释放（冗余），
  异常路径到不了 result（无效），且"标记 + tracker 空"不含 cron → 与 W8 **相杀**
- **X1 · 补 repository 层 5 处**（三轮首报）：`repositories/provider-models.ts:16/21/39/109/144`
- **X11 · 补 `context.createQuery` 缝移植**：否则 W15 的 6 条测试**没有一条能驱动 runtime**
- **X12 · G3 写法钉死**：`false && …` 过不了本项目 lint → 用具名常量
- **X15 · W12 前提修正**：`record.provider` 就地可用，不必造传参通道
- **X5 · 补新校验调用点**：`:75` 替换为上游 `assertEffortLevelsSupported`
- **X6 · 失败路径定案**（用户决定）：claim 指纹不匹配时**也保留旧进程到 ceiling，不释放**
- 其他：X7 重试分支保留、X8 验收③降级观察项、X9 后缀 `.ts`、X17 测试 cron 用例挑出保留、
  X18 知情项、X19 D1-a 不覆盖 #31 信号层

**修订 v5（2026-10-12）**：经**终审**（单家 `claude-opus` CLI 独立会话）后修订。
终审判定"还不能开工，缺 5 处（全在 D1）"，其中 **1 处是四轮都漏掉的真 bug**。改动：
- **⚠️ 终审 ③ · 过期快照 → stop-task 永不释放**（**四轮全漏，单测测不出**）：
  保留快照源后，`cronOutstanding` 读的是**过期快照**（被 stop 的任务不再触发 Stop hook，
  快照 `Deliberately kept across turns`）→ 恒真 → **早释放永不触发，进程挂到 ceiling**。
  这正是 `557109a2` 要修的 bug 被带回来。**处置：用户决定选项 (b)** ——
  快照按 `task_id` 存集合，收到 `stopped` 通知时剔除（`BackgroundTaskSummary` 带 `task_id`）
- **⚠️ 终审 ④ · X6 最终定案（用户决定：选项 3 = 接受现状）**：
  终审 ④ 列出的 4 个未定点（`clear` 跳不跳、`supersededInstances`、共用 key、孤儿进程）
  **全部作废** —— 因为 X6 从"保留旧进程"**退回"按原路径释放"**。
  理由：指纹不匹配 = 用户改了配置，语义上该开新进程；且"保住的旧进程"是**孤儿**
  （G4 停不掉、abort 不了）。**`:942` 不改，不碰 supersede。**
- **终审 ⑤ · `tryAccept` 须加 `turnInFlight = true`**：06:192 假设的 "claim 推送产生 user echo 行"
  不成立（fork 全仓 `replayUserMessages` 零命中）→ 默认无 echo，守卫要等第一条 assistant 消息，
  中间几秒可被 stop 杀掉（V16 复发）
- **终审 ①/② · 两处自相矛盾修正**：退役清单首条（旧 v2 条目未删，与保留相反）；
  `:128` 的 `hasSnapshot()` 写法与 `:316` 相反；且**须新增 accessor**
  （`snapshotOutstanding` 是闭包私有，删 `outstandingReason` 后读不到）
- **其他**：`createQuery` 移植勿顺带取 `releasePromptStream` 行 · X6 判据别写宽 ·
  迁移落点（自动合并是错序）· §6-2 补 15 个未提到的文件的处置指引

**修订 v6（2026-10-12）· 终审复核后 · 本版为施工终稿**：
终审复核判定"**补完 N1、N2 两句就可以开工**"，两句均为文字修正。改动：
- **N1**：X-cbc 的 `cronOutstanding` 旧定义**标注为 (b) 之前的旧形**；(b) 下新定义为
  `snapshot !== null && (taskIds.size > 0 || cronCount > 0)`（建议按 A4 改名 `snapshotOutstanding()`）
- **N2**：集合 key 用 **`summary.id`**（`sdk.d.ts:138-139`），**不是 `task_id`**
  （那是 `task_notification` 的字段，`sdk.d.ts:3719`）；两者是否相等 SDK 未承诺 → smoke 打日志对一下
- **A1**：须新留消息入口（`observeMessage` 被 X4 删了），**放在早释放判定之前**
- **A2/A5/A6**：三条知情项（已停任务被加回 · 改 effort 会连带释放 · CLI 回报的窄窗）
- **A3**：清理 6 处与新决定相反的旧文（"机制一个字不改"、echo 行、W4 重复、"待决"、
  X6 判据、§2 V9 与 §6-2 原位补齐）
- **A-advice**：`sdk.d.ts:3710` 的 `background_tasks_changed` 是 **level signal**（发全量集合），
  可从根上解掉过期问题 → **记为后续优化**

## 决策总表

| # | 议题 | 决策 | 备注 |
|---|---|---|---|
| D1-a | 上游 held-run 三提交（`208c7156`/`b9d3d129`/`557109a2`） | **全取上游** | 用户 2026-10-11 决定：完全用上游信号与实现 |
| D1-b | fork #29 `heldTurn` claim（新 turn 推进同一进程） | **keep** | 唯一保留的行为差异；替代上游 stop |
| D1-c | 上游 `b9d3d129` 的 stop-before-takeover | **不取** | 它是"杀后台"的实现，正是 fork 要消灭的行为 |
| D1-d | fork `BACKGROUND_WORK_TOOLS`(`=== true`) + hook 快照 ledger | **task 判定支退役；快照源保留**（X4 修订） | 上游 `startsBackgroundWork`(`!== false`) 覆盖 task 判定；快照源作第三信号源（跨轮 cron 上游结构性收不到） |
| D2 | effort 列：上游 `effort_values`+`effort_default` vs fork `effort_levels` | **adapt（以上游为底）** | 见下详述 |
| D3 | compaction：上游 `compact?` 字段 vs fork `compact_boundary` kind | **顺序 B（上游分支在前）** | Claude 走上游；OC/agy 保留 fork kind |
| D4-a | 上游 `3cc73ede` CLI liveness | **取上游（共存）** | 写的是 session 活动层，非 chatRunRegistry busy |
| D4-b | 上游 `80dd5c29` dispatcher bg-work=busy | **不取** | 保 fork #31 "scheduler gate 只读 turn-in-flight" |
| D5 | `opencode.supportsMessageEditing` | **仍为 false → #27 keep** | 已自验 |

## §1 D1 重做方案（基于用户决定："把保住后台任务在上游代码上重做"）

> 本节经 spec review 第一轮修订（见 `07-spec-review-round1.md`）。V 编号对应那份的核验条目。

### 取上游
- `createBackgroundWorkTracker()`（`Map<taskId, BackgroundTaskSummary>`，`apply/hasOutstanding/has/clear/list`）
- 双源判定：task 事件流（`task_started`/`task_notification`/`task_updated`）为主，
  `startsBackgroundWork()` 为兜底
- `startsBackgroundWork`（上游 `claude-runtime.provider.js:598` 起）：白名单
  `DEFERRED_WORK_TOOLS = ['Monitor','ScheduleWakeup','CronCreate','TaskCreate','Workflow']`
  + `Bash` 特判（`:626`，`run_in_background === true`）+ `Agent` 特判（`:632-633`，`!== false`）
- 前端 per-task UI：`BackgroundTasksStrip.tsx`、`src/modules/chat/utils/backgroundTasks.ts`、
  **WebSocket 协议消息 `chat.stop-task`**（`chat-websocket.service.ts:444/687`，**不是 HTTP 路由** —— V18）、
  `chat-stop-task.test.ts`、`backgroundTasksStrip.test.tsx`（G4 本次即做）
- `claude-runtime-hold.test.ts` 中与 hold 相关的断言 —— **W15 · 该文件上游共 6 条 test，逐条处置**：
  - **保留** `:134` `'stopping the last outstanding task releases the held process'`
    ← **这条正是 V16 场景（stop 最后一个任务 → 释放），是 V16 守卫的验收依据**
  - **保留** `:161`（completed 保持 hold）/ `:182`（前台 agent 不 hold）/ `:299`（不发 task 事件的工具靠静态规则 hold）
  - **删或改写** `:200` `'a new turn stops the tasks the held process still has going before letting it go'`
    ← stop-before-takeover，方案决定**不取** → 必须删/改写，否则 `npm test` 必红
  - **删或改写** `:251` `'a held process is still let go when stopping its tasks throws'` ← 同上
- **V12 · 必须同步取 `addSession`/`removeSession` 的接线**：
  `backgroundWork.clear(sessionId)` + `sessionHistoryCache.invalidate(sessionId)`
  （fork 的 `addSession` 在 `claude-runtime.provider.js:384-418` 是带 supersede-interrupt 的定制版，
  `removeSession` 在 `:420`）。**只取判定不取 clear → 被 supersede 的旧进程任务永不清，
  `hasOutstanding` 恒真 → 后台任务照样被杀。**
  - **W14 · 还须在文件顶部补 import `sessionHistoryCache`** —— fork 现无此 import
    （`grep sessionHistoryCache claude-runtime.provider.js` 零命中），只写"调用"会 `ReferenceError`。
    来源：`@/modules/providers/services/session-history-cache.service.js`
- **V7 · 覆盖面差异（务必写明）**：上游白名单与 fork `BACKGROUND_WORK_TOOLS`(`['Bash','Agent','Task']`)
  **语义相反**（白名单 vs 黑名单+`run_in_background`）。上游**多覆盖**
  `Monitor`/`ScheduleWakeup`/`CronCreate`/`TaskCreate`/`Workflow`（fork 完全不认）；
  fork 多覆盖名为 `Task` 的工具。**不是等价替换。**

### 退役（fork 侧）
- ~~`claude-background-work.ts` 的 `snapshotOutstanding` boolean ledger + `hasSnapshot`/`outstandingReason`~~
  ← **终审 ①：此条已作废，勿照做**（与下方 X4/X14 的"保留"直接相反）
- `BACKGROUND_WORK_TOOLS` 集合与 `=== true` 判定
- `claude-background-work.test.ts` 的 fork 479 行版本（改取上游 + 上游新增）
- **V2（X4/X14 修订）· `claude-background-work.ts` 不整文件退役**：
  **X14 · 保留 `recordSnapshot` 整段（两个列表都读）** —— 它读 `background_tasks` + `session_crons`
  **合成一个布尔**（`:107-116`），**不存在独立"cron 支"**。且 crons-only 切法**比 fork 现状更窄**：
  Monitor/ScheduleWakeup 等无 task 事件的工具跨轮存活时，claim turn 的 result 上 tracker 空 +
  `startsBackgroundWork` 假 → 三源全 false → 释放 → **工具死**（正是 W16 用例点名的场景）。
  **机制只多不少，对 fork 零倒退。**（**终审 A3：措辞已改** —— (b) 下 `recordSnapshot`
  要从"压成一个布尔"改为"存集合 + cron 计数"，不是"一个字不改"，见下方终审 N1）
  → **保留**：`recordSnapshot`（`:106-124`）、`buildHooks`（`:134-137` 的 Stop/SubagentStop 注册）、
  `snapshotOutstanding` 变量、`hasSnapshot`
  → **只删 task 判定三件套**：`BACKGROUND_WORK_TOOLS`（`:43`）、`startsBackgroundWork`（`:45-55`）、
  `observeMessage`/`resetFallbackSignal` 的 task 语义（`observeMessage` 由上游 `apply` 取代）
  → **文件可改名/改义为"cron + 快照源"单一职责**（agy 建议）
- **V2 · 调用点清单（`backgroundWork.` 共 7 处 + import，X4 修订后）**：
  - `:27` `import { createBackgroundWorkLedger }` —— **保留**（cron 快照仍需要它）
  - `:801` `const backgroundWork = createBackgroundWorkLedger()` —— **保留**
  - `:953` `...backgroundWork.buildHooks()` —— **保留**（X4：删了它 cron 快照永无数据）
  - `:1133` `backgroundWork.resetFallbackSignal()`（在 `heldTurn.tryAccept` 路径上）
    —— **须改写**：清零两个每-turn 标志 `backgroundWorkPending = false; sawTaskEventThisTurn = false;`
    （上游在 result 分支就是这么清的；**切勿**改成 `clear(sessionKey())` ——
    那会在用户消息 claim 进去的瞬间把 tracker 清空，后台任务立刻被判"没活儿"）
    - **X4 附注**：保留快照支后 `resetFallbackSignal`（`:143-146`）仍是可调的 fork API，
      但它清的是 **task 判定** 的 fallback 信号；快照（(b) 下为集合 + cron 计数，见终审 N1）
      存于闭包，**不受影响**。
  - `:1208` `backgroundWork.observeMessage(message)` ← **替换为上游 `backgroundWork.apply(sessionKey(), message)`**
  - `:1225` `outstandingReason()` / `:1227` `hasSnapshot()` / `:1228` `resetFallbackSignal()`
    —— **按 X4 重切**：`outstandingReason` 的 task 部分退役，cron 快照经 `hasSnapshot`/`snapshotOutstanding` 保留
    - **第四轮 fable 补强 · 须给表达式（否则三源 OR 名存实亡）**：
      `recordSnapshot` 把 task 与 cron **合成同一个布尔**，`outstandingReason()`（`:128-131`）
      在 task 与 cron 都为 true 时都返回 `'snapshot'` → task-fallback 信号会走快照通道，
      与上游 `backgroundWorkPending` **分家**。
      → **改写为**：`:1225-1228` 用 **cron 专用布尔** +
      上游 **`backgroundWorkPending`（task-fallback 专用）**，**`outstandingReason` 整函数删**
      （否则 task/cron 两信号混在同一布尔，cron 与 task 无法分别验证，W6 验收也分不清）
      - **终审 ②· `snapshotOutstanding` 是闭包私有（`claude-background-work.ts:100`），
        对外只经 `hasSnapshot`/`outstandingReason`/`hasOutstandingWork`（`:133-150`）暴露。
        删 `outstandingReason` 后 runtime 读不到它 → 必须新增 accessor**，
        建议导出 `cronOutstanding(): boolean`（实现见下 X-cbc 的定义）。
      - **~~用 `hasSnapshot()`~~ 是错的**（见下 X-cbc）—— 别照这半句写
  - `:1366` `hasOutstandingWork()`（注意与上游 `hasOutstanding(sessionKey)` **签名不同**，混用即 TypeError）
  - `:1088-1090` 重试分支 —— **X7 · 保留**（hook 注册失败 → cron 快照与 tracker 均不可用 → 退化为上游语义），
    注释改为"无 hooks 则 cron 快照与 tracker 均不可用，退化为上游语义"

### 保留（fork 侧）
- **Y1 · ledger 必须改名（四轮首报，防遮蔽）**：上游 `:46` 是**模块级**
  `const backgroundWork = createBackgroundWorkTracker();`，fork `:801` 是 `queryClaudeSDK` 内**局部**
  `const backgroundWork = createBackgroundWorkLedger();`。**局部遮蔽模块级** →
  `:1366` 写 `backgroundWork.hasOutstanding(sessionKey())` 会解析到 **ledger**（无此方法）
  → **异常退出路径 TypeError**。
  → 执行：**ledger 改名**（如 `snapshotSource`），与上游 tracker 区分开。
- **`heldTurn` claim 块：`:924`（claim 调用）→ `:942`（claim 失败后 `getSession(sessionKey())?.releaseInput?.()`）**
  —— **claim 在 `:942` 之前**（V19 纠正 05 的锚点表述）。
  新 turn 到达时 push 进同一进程，**不停旧 task**
- **V3/V13/V19 · 不引入 `releaseHeldSession`**：`releaseHeldSession` 是**上游 `b9d3d129` 新增的函数**
  （上游 `:375` 定义、`:953` 调用），**fork 全仓零命中**。
  `b9d3d129` 的 hunk 就是把 fork `:942` 的单行**替换**成 `releaseHeldSession(sessionKey())`。
  → 执行动作：**逐行保留 `:919-942` 整块，`:942` 维持 `releaseInput` 直调，不引入 `releaseHeldSession`。**
  若整取上游 hunk → stop 悄悄回来 + claim 被覆盖。
  （上游 tracker 的 `outstanding()` accessor 在此方案下成死代码，无害可留）
- **`finally` 的 `inputReleased`（`:1366`）必须保留**（V-advice / W13）：fork 的
  `if (!inputReleased && (heldForBackgroundWork || backgroundWork.hasOutstandingWork()))`
  是**上游从来没有的**保护 —— 覆盖"SDK 报错/连接断开时的 teardown"。全取上游时**不要**把
  `finally` 一并换成上游版（它只按 `heldForBackgroundWork` 判断），否则异常路径下后台任务被立刻 kill，
  而验收脚本只跑正常路径**测不出来**。
  - **W13 · 目标形态写死（避免只做半边）**：
    ```js
    if (!inputReleased && (heldForBackgroundWork || backgroundWork.hasOutstanding(sessionKey())))
    ```
    即：保留 `!inputReleased` 短路 + `heldForBackgroundWork` 两项 fork 增益，
    **只把第三个条件** `hasOutstandingWork()` 换成上游签名 `hasOutstanding(sessionKey())`。
    按字面执行易只换调用名而丢 `!inputReleased`，或整行换成上游版 → 失效。

### V16 · "stopped 早释放" 与 claim 冲突 —— 必须加守卫（cbc 第一轮独家发现）

上游 `557109a2` 有段逻辑：
```
heldForBackgroundWork && message.subtype === 'task_notification'
  && message.status === 'stopped' && !backgroundWork.hasOutstanding(sessionKey())
  → heldForBackgroundWork = false; releasePromptStream();
```
**它没有检查"有没有 turn 在飞"。** 上游安全（上游无 claim，turn 到达即停）。
**fork 保留 claim → 新 bug**：用户发消息被 claim 后，最后一个后台任务被 stop（用户点 G4 的 stop，
或 CLI 自停 —— `stopClaudeSDKTask` docstring 自证"emits a task_notification with status stopped"）
→ stdin 关闭 → **用户消息半途被杀**。

**处置（用户 2026-10-11 决定：加守卫）**：该早释放分支加**"当前无 turn 在飞"**判定后才释放。

**W2/W11 · 守卫判据 —— 用户 2026-10-12 决定：选项 1（造覆盖两条路径的判据）**

- **不能用 `followUpPromptPending`**（`claude-runtime.provider.js:810`/`:1134`/`:1216-1217`）——
  sub-fable / sub-opus 两家独立指出它**两头都不对**：
  - app 侧 claim 的 turn 在飞时**恒 true** → 守卫恒不成立 → **该放不放**，进程被 idle ceiling 拖 30 分钟，
    `stop-task` 卡住不回
  - **CLI 自主回报的 turn**（后台任务自己回来报告，CLI 直接往 `heldPrompt` 推 turn）
    那条路上没人置 true（唯一写入点 `:1134` 的 `tryAccept`）→ **恒 false** → 守卫形同虚设，消息照样被杀
- **决定（2026-10-12，X16 修正 v3 的不可实现写法）**：**不能用** v3 原写的"在 CLI 推 turn 处打标记"
  —— 实测 `heldPrompt.push` **全仓只有 `:1143` 一处**（在 claim 内），CLI 自主回报的 turn 是
  **直接写 stdin 的，runtime 侧没有代码点**（sub-opus 证明）。
  **可行形式（cbc）**：在消息循环里维护 `turnInFlight` 位 ——
  **无 `parent_tool_use_id` 的 `user`/`assistant` 消息即 turn 开始**（置 true），每个 `result` 清零。
  - claim 推送产生 **user** 行、CLI 回报 turn 产生 **assistant** 行 → **两条路径都覆盖**
    —— **⚠️ 终审 N5 修正：claim 路径默认不产生 user echo 行**
    （fork 全仓 `replayUserMessages` 零命中，SDK 只在 replay 模式回发 `SDKUserMessageReplay`），
    所以 claim 路径**要在 `tryAccept` 里手动置 `turnInFlight = true`**（见下方终审 ⑤）。
    CLI 回报路径靠第一条 assistant 消息置位（那条仍成立）。
  - parked + stop 最后任务（上游 `:134` 测试场景）中间无主线程消息 → false → 早释放照常（测试仍绿）
  - 后台 subagent 行**带** parent id → 不误置（否则 parked-stop 被误挡成 30 分钟 —— 正是 W2 警告的失效模式）
  - **X16 · 落点须精确到 SDK 原始消息（第四轮 fable 补强）**：
    `parent_tool_use_id` 在 fork 循环里**有两个名字** —— SDK 原始 `message.parent_tool_use_id`
    （`:448`/`:539`）与归一化后 `msg.parentToolUseId`（`:1187`）。
    **须读前者（SDK 层）**。置位要写在 `transformedMessage` 层
    （`backgroundWork.apply` 同一行附近，`:1208` 区），**不在** `for (const msg of normalized)` 循环内
    （`:1183-1191`）—— 否则归一化后的 compact 合成行、permission 回显行也会误置 true
    → parked 状态下守卫恒真 → 早释放永不触发（W2 失效模式重演）。
    重置点"每个 `result` 清零"（`:1210` 区同一循环）正确。
  - **fable 附**：`turnInFlight` 作为 `queryClaudeSDK` 内**函数局部变量**（声明在 `:810` 附近），
    随 query 闭包生命周期重置，避免跨请求状态污染。
- **实施要求（用户 2026-10-12 补充）**：**实施与测试阶段留意找最优雅的方案** ——
  若两条路径难以统一判断，执行时回到用户确认，不硬凑。
- 验收依据：上游 `claude-runtime-hold.test.ts:134`
  `'stopping the last outstanding task releases the held process'`（**保留**）
- **X11 · 必须先移植 `context.createQuery` 缝**：上游 `:1110`
  `const createQuery = context.createQuery ?? query;`（`:1114`/`:1127` 使用），**fork 零命中**。
  不移植 → `claude-runtime-hold.test.ts` 6 条测试**没有一条能驱动 runtime**（注入被无视，走真 SDK），
  W15 整份测试处置空转。**两处调用点改 `createQuery(...)`。**

**~~W3 · 待释放标记~~ —— X10 撤销：该机制删除（cbc 推翻 W3）**：
原担心"守卫挡下早释放 → `heldForBackgroundWork` 保持 true → finally 多 hold 30 分钟"。
实测 fork `:1262-1276` 的 **else 分支本来就释放**
（`heldForBackgroundWork = false; releasePromptStream();`），且 `holdForTurn` 在 tracker 空时必为 false
→ **正常路径由 else 分支覆盖，标记机制冗余**；
异常路径到不了 result（标记检查点就在 result）→ **无效**。
**更糟**：若按 W3 写"标记 + tracker 空即释放"，**cron 不在判定里** → cron 存活时 stop 最后任务
→ 释放 → **cron 死**，与 W8 决定**直接相杀**。
→ **06 不再包含"待释放标记"机制。**

**W4 · 顺带注意**：`releasePromptStream`（`:1077-1084`）内部会调 `forgetHeldTurn(sessionKey(), heldTurn)`
—— 早释放一旦触发会**顺带丢掉 held turn 句柄**，下一次 claim 必然失败。这加重了守卫的必要性。

**W15 · 上游对该场景有现成测试**：`claude-runtime-hold.test.ts:134`
`'stopping the last outstanding task releases the held process'` —— **保留并作为 V16 的验收依据**。

### 验收标准（合并后必测，不可分割）
后台任务运行中 → 向主 agent 发消息 → ①消息立刻发出 ②后台任务不被中断、继续跑到完成。
（典型场景：dispatch-agent 跑外部 claude CLI 时给主 agent 发话）

**W6 · 须加一条专用验收（否则 V16 修的 bug 测不出来）**：
后台 Agent 运行中 → 发消息**被 claim** → 点 stop-task **停掉该任务** →
用户 turn 必须正常完成（不断流、不半截 complete），进程在 turn 结束后释放。
（V16 三条件叠加：claim 命中 + stop 掉最后一个任务 + turn 在飞；普通"发消息"用例进不了早释放分支，
守卫加错——恒真或恒假——都测不出来。）

**W16 · 须加"不发 task 事件的工具"用例**：Monitor/CronCreate 等不发 task 事件流的工具运行中发消息
—— 这类工具在新 turn 到达 result 时最易被上游 `holdForTurn` 误判为无任务而杀掉。

- **X6 · 失败路径最终定案（用户 2026-10-12 决定，终审 ④ 后修订为 A）**：
  - **原决定"指纹不匹配也保留旧进程到 ceiling"（选项 1）经终审 ④ 后撤销** ——
    它会产生**孤儿进程**：tracker 按 sessionKey 记账而新旧两进程共用一个 key，
    `stopClaudeSDKTask`/abort 只能找到 `getSession(key).instance`（新实例）
    → **旧进程的任务 G4 停不掉、旧进程也 abort 不了，只能等 ceiling**。
    且 supersede 分支（`addSession:396-404`）照样 `interrupt` + `releaseInput`，
    "保留"只保留几毫秒。
  - **✅ 最终决定（选项 3）**：**指纹不匹配 = 接受现状，按原路径释放旧进程**。
    理由：指纹不匹配意味着**用户改了配置**（`effort`/`base_url`/`api_key`/`contextWindow`），
    语义上确实该开新进程跑；且"保住的旧进程"反而不可控（停不掉、abort 不了）。
  - **`write-back` 前提**：不改 `:942`；不需"跳过 supersede"的 4 个未定点（终审 ④ 列的那 4 条**全部作废**）。
  - **验收**：指纹不匹配场景**不作为诉求 1 的验收项**（诉求 1 覆盖的是"指纹匹配 + claim 命中"的正常路径）。

### W8 · `session_crons` 的答案已定（不再是"待实测"）

sub-opus 读上游 `apply()` 的守卫：
```js
if (message?.type !== 'system' || typeof message.task_id !== 'string') { return; }
```
**cron 事件没有 `task_id` → 被结构性过滤 → 上游 tracker 收不到 cron。**
且 cron 只在上游 `startsBackgroundWork` 白名单里被兜住"本轮启动了 cron"这一种；
**跨轮才触发的 cron（上一轮建好、这一轮中途响）在两条通路里都没有信号**
→ `holdForTurn` 判 false → 进程释放 → **cron 随进程死**。

这正是 D1-d 退役 hook 快照（`claude-background-work.ts:108`/`:115-116` 的 `crons.length > 0` 那一支）
**唯一不可替代的能力**。

**取舍（用户 2026-10-12 决定：选项 (b)）**：
- (a) 接受 cron 回归 —— 完全对齐上游，cron 跨轮场景丢失保护
- **(b) ✅ 保留快照源**（X14 修订切法）—— 作为**第三信号源** OR 进 hold 判定。
  理由：它**只可能让 hold 更保守**（宁可多 hold 不误杀），**零倒退风险**；
  多 hold 的代价只是进程多留一会儿（有 idle ceiling 兜底），少 hold 的代价是**活儿直接死掉** —— 两者不对称。
  执行：**保留 `recordSnapshot` 整段**（见 §1 退役清单的 X14 修订），
  与上游 tracker + `startsBackgroundWork` 三源 OR。

### X3/X13 · 三源 OR 的**完整表达式与全部汇合点**（两家都报）

**汇合点不止一处** —— 上游 outstanding 的消费点共 **4 处**，快照源必须**全部并入**，
只 OR 进 `holdForTurn` 会让 cron 死在"自己的盲区"：

1. **`holdForTurn`**（result 分支）—— 须写**真 OR**（cron 同时进两个分支）：
   ```js
   holdForTurn = sawTaskEventThisTurn
     ? (stillOutstanding || cronOutstanding)
     : (backgroundWorkPending || stillOutstanding || cronOutstanding)
   ```
   **不写明**，实现者可能只 OR 进 fallback 分支 → `saw=true` 的 turn（最常见的 Agent 后台场景）
   **cron 被忽略** → task 完成后 tracker 空、cron 仍在却被释放 → cron 死。
2. **task_notification 早释放 hunk 的 `!hasOutstanding`** —— cron 存活时 stop 最后一个 tracked task
   → 早释放照发 → **cron 死**。须改为"无活"判定包含快照源。
   - **第四轮 fable 补 · 写表达式**：`!hasOutstanding(sessionKey()) && !cronOutstanding()`
     （**`cronOutstanding()` 是 accessor，不是 `hasSnapshot()`** —— 见下 X-cbc）
   - **⚠️ 终审 ③ · 此处有一个四轮都漏掉的 bug（过期快照），见下「终审 ③」节 —— 先读那节再写这里**
3. **notify 门 `heldForBackgroundWork && !stillOutstanding`** —— 同理会提前报"工作完成"。
   - **注意 fork 与上游不同形**：fork 的 notify 门（`:1244`）读的是
     `heldForBackgroundWork && !answersFollowUpPrompt && !abortPending && !holdForBackgroundWork`
     —— **不含 `stillOutstanding`**，与上游 `:1229` 不同形。
     须用"hold 评估含 cron 后的**同一布尔**"。cbc 给的写法：`!stillOutstanding && !cronOutstanding`。
4. **`finally`**（`:1366`）—— W13 已含（快照驱动的 hold 必先置 `heldForBackgroundWork`，经它传递覆盖）。

**X-cbc · `cronOutstanding` 的定义必须写死（cbc 独家，否则 30 分钟级故障）**：
> ⚠️ **终审 N1：以下定义是 (b) 之前的旧形（`snapshotOutstanding` 曾是布尔）。
> 选了 (b) 之后它不再适用 —— (b) 下用下面「终审 N1」节的新定义。**

```js
// 旧形（仅 (a)/(c) 适用）：
cronOutstanding = hasSnapshot() && snapshotOutstanding === true
```
- **不能只写 `hasSnapshot()`** —— 它只答"**有没有读到过**快照"
  （`claude-background-work.ts:126` `snapshotOutstanding !== null`），
  **不答"快照说没说有活"**。误用 → **任何到过快照的 run 恒 hold、早释放恒不发** → 进程卡到 ceiling。
- 正确取值 = `outstandingReason()` 的快照臂（`:128-131`）的布尔形式。

### ⚠️ 终审 N1/N2 · (b) 下必须补的两句（否则静默失效、单测测不出）

**N1 · accessor 的定义要跟着 (b) 改**：
(b) 下 `snapshotOutstanding` 已改为 **`Map` + cron 计数**，不再是布尔 →
照抄旧定义 `Map === true` **恒 false** → **整个快照源失效**
（跨轮 cron 与 Monitor 类工具又会被释放杀掉，**W8 白做，且无任何报错**）。
- **(b) 下的定义**：
  ```js
  snapshotOutstanding() = snapshot !== null && (taskIds.size > 0 || cronCount > 0)
  ```
- 建议按终审 A4 改名 **`snapshotOutstanding()`**（(b) 下它同时含 task 与 cron，
  叫 `cronOutstanding` 会误导；名字不影响正确性）

**N2 · 集合 key 用 `summary.id`，不是 `task_id`**（终审自我纠错）：
- 实测 `sdk.d.ts:138-139`：`BackgroundTaskSummary = { id: string; … }` —— 字段名是 **`id`**
- `task_id` 是 **`task_notification`** 的字段（`sdk.d.ts:3719`）
- 用 `summary.task_id` 建集合 → 全是 `undefined` → **stopped 通知永远剔不掉** → 退回 (c)：
  stop 之后进程挂到 ceiling（方向偏保守，不会杀任务，但等于 ③ 没修）
- **补**：集合 key 用 **`summary.id`**，与 `task_notification.task_id` 比对。
  SDK 文档**没写这两个值一定相等** → **smoke 时打一行日志对一下**；
  就算不相等也只是退回 (c)，不会误杀。

**终审 A1 · 消息入口要新留一个**：X4 删了 ledger 唯一的消息入口 `observeMessage`（06:130-131），
但 (b) 要求收到 `stopped` 通知时剔除 id → 须新留入口（如 `snapshotSource.observe(message)`），
**且必须放在早释放判定之前**，位置同上游 `apply`（`preview-step2:8252-8265`）。
放后面 → 当轮读到的还是旧 id → 退回 (c)。

**终审 A2 · 已停任务可能被加回**（知情）：SubagentStop 快照会把**正在停止的 subagent 自己**算进去
（`claude-background-work.ts:84-91`）；若它在 `stopped` 通知**之后**触发，id 会被放回集合
→ 之后 stop 最后一个任务时不释放。**方向偏保守、概率低** → 可选加"本次 run 内的 stopped 黑名单"，
或记为知情项。

**终审 A5 · 选项 3 的知情项**：指纹含 `effort`（06:247）→ **后台任务跑着时，只要在 composer 里
改了 effort 档位再发消息，旧进程会连同后台任务一起被释放**。
dispatch-agent 场景下改 effort 很常见 → **写进 smoke 备注，免得被当成回归**。

**终审 A6 · 剩余窄窗（知情）**：⑤ 只堵住了 app claim 这条路。CLI 自己发起的回报 turn，
在第一条 assistant 消息到来前 `turnInFlight` 仍是 false；此时用户 stop 了**最后一个**任务，
早释放会截断这次回报。**runtime 侧无代码点可堵**（X16 已证）→ 记为知情项。

**终审 A-advice · SDK 有更好的信号（可选优化）**：`sdk.d.ts:3710` 的
**`background_tasks_changed`** 是 **"a level signal"** —— 每次成员变化就发**全量集合**，
注释明说"consumers... should replace their set with each payload rather than pairing edges,
so a missed bookend cannot wedge a stale running indicator"。
**这从根上解掉 N1/过期的整类问题**（不必自己维护增删）。本次可先按 (b) 做，
把这条记为后续优化。

**cbc 核对通过**：三源四处汇合点**无遗漏**（其余 tracker 使用处
`stopClaudeSDKTask` 的 `has`、`listClaudeSDKBackgroundWork`、`addSession`/`removeSession` 的 `clear`
均非"无活"判定，不需快照源）· `turnInFlight` 落点确切 · 删 W3 收尾成立 · X1/X11 成立。

### ⚠️ 终审 ③ · 过期快照 · stop-task 永不释放（**四轮都漏掉，单测测不出**）

**问题**：保留快照源后，早释放的 `!cronOutstanding()` 判定读的是**过期快照**：
- 上游注释（`preview-step2:8254-8256`）明写：**被 stop 的任务不会再触发 Stop hook**，
  只有一条 `stopped` 通知
- `recordSnapshot` 把 `background_tasks` + `session_crons` **合成一个布尔**（`:115-116`），
  且注释说 "Deliberately kept across turns"（`:96-97`）—— 快照不会因任务消失而归零
- → 凡进入过 hold 的进程，`snapshotOutstanding` 停在**过期的 `true`**
- → 用户 stop 掉最后一个任务后，`cronOutstanding()` 仍为真 → **早释放永不触发 → 进程挂到 ceiling**

**这正是 `557109a2` 要修的 bug，被带回来了。** 且**单测测不出**：上游 hold 测试的 mock 不调
`options.hooks`（`preview-step2:11783-11808`），快照恒 null → `:134` 照样绿；
W6 验收也覆盖不到（走的是 claimed turn 的 result，有新鲜快照）。

**处置（用户 2026-10-12 决定：选项 (b)）**：
- (a) 早释放只读 tracker + **crons-only** 子布尔（`recordSnapshot` 另记 `crons.length > 0`）
- **(b) ✅ 快照按 `task_id` 存成集合，收到 `stopped` 通知时剔除对应 id**
  —— `BackgroundTaskSummary` 带 `task_id`（`sdk.d.ts:9637`）。
  **cron 的保护与 Monitor 这类工具的覆盖都不丢，stop 也能释放。**
  实现要点：
  - `claude-background-work.ts` 里的 `snapshotOutstanding: boolean | null` 改为
    **`Map<taskId, ...>`（或等价集合）+ cron 计数**，`recordSnapshot` 不再压成一个布尔
  - **`stopped` 通知到达时从集合里剔除该 `task_id`**（这是关键 —— 快照不会自己归零）
  - 导出新的 accessor `cronOutstanding(): boolean`（实现见下 X-cbc 的定义），
    供 runtime 的三源 OR 使用
  - `hasSnapshot()`/`hasOutstandingWork()` 语义随之调整；`outstandingReason` 退役
- (c) 接受 stop 后进程挂到 ceiling

### ⚠️ 终审 ④ · X6 vs supersede 要给确切写法

06:263-264 只写了方向（"跳过 supersede 的 interrupt/release（或新 query 复用旧 heldPrompt 通道）"），
**两个选项都落不了地**：
- "复用通道"走不通 —— 复用本质就是 claim，而 claim 正是因为指纹不匹配才失败
- "跳过 supersede" 留下 4 个未定点：
  1. 上游加在 supersede 分支里的 `backgroundWork.clear(sessionId)`（`preview-step2:7903`）跳不跳？
  2. `supersededInstances.add` 跳不跳？
  3. tracker 是模块级、按 sessionKey 记账，新旧两进程**共用一个 key** →
     新 run 的 `hasOutstanding` 会被旧进程的任务拖住；新 run 结束时 `removeSession`
     又会把旧进程还活着的任务清掉
  4. `stopClaudeSDKTask`/abort 只能找到 `getSession(key).instance`（新实例）→
     旧进程的任务 G4 停不掉、旧进程也 abort 不了，只能等 ceiling

     **已作废** —— 用户最终选选项 3（接受现状释放），不碰 supersede；
     这一整段列出的 4 个未定点与下方"须拍板"**均不再适用**。

### 终审其他已核事项

- **终审 ⑤ · `tryAccept` 缺一行 `turnInFlight = true`**（第四轮 opus advice 升级为 must-fix）：
  06:192 假设"claim 推送产生 user echo 行"，但 **fork 全仓 `replayUserMessages` 零命中**，
  SDK 只在 replay 模式下回发 `SDKUserMessageReplay`（`sdk.d.ts:6381-6452`）
  → **默认很可能没有 echo**，`turnInFlight` 要等第一条 `assistant` 消息才置位。
  中间几秒到几十秒，用户点 stop 最后一个任务 → 消息被半途杀掉（**V16 原样复发**）。
  → **在 `tryAccept`（`:1133` 附近）加 `turnInFlight = true`。**
- **`createQuery` 缝移植时勿顺带取 `releasePromptStream` 行**：`preview-step2:8230-8235`
  上游 `.their` 侧带 `releasePromptStream = heldPrompt.release;` ——
  它会**绕过 fork 的 `inputReleased = true` 和 `forgetHeldTurn`**（`:1072-1078`）
  → `finally` 的 `!inputReleased` 判断失效。**只取 `createQuery`，不取这一行。**
- **X6 判据别写宽**：`:256` 的示例 `!carriesResumeAnchor(options) && reusableTurn === null` 有问题 ——
  `claimHeldTurn` 在"没有 handle"和"指纹不匹配"**两种情况下都返回 null**（`claude-turn-reuse.ts:348`）
  → 照此写，"没有 held run"的场景也会跳过释放。**应 peek handle 是否存在且指纹不同。**
- **迁移落点（终审 advice）**：上游把 `addProviderModelEffortColumns(db)` 插在**建 index 之后**
  （即 widen 之后，`preview-step2:5219-5222`）→ **自动合并的结果是错序，必须手工上移**。
  另：顺序 `widen → addColumns → UPDATE → DROP` **也安全**（widen 保持原清单，
  新列天然排最后，W9 自动满足，改动更少）—— 可考虑。
- **§6-2 覆盖面（终审 advice）**：`real-conflicts.txt` 里约 **15 个文件 06 没提到**
  （`agent.routes.ts`、`provider.routes.ts`、`SidebarHeader.tsx`、`AppearanceSettingsTab.tsx`、
  `Markdown.tsx`、`useSlashCommands.ts`、`api.ts`、`package-lock.json` 等）→
  §6 应补一句"**其余按 `docs/fork-customizations.md` 对应条目解**"。

### 其他待办
- 不可复用 takeover 场景的双写窗口（原 G1 的 tracker TODO 已由"全取上游"消解）

## §2 D2 处置细则

> 本节经 spec review 第一轮修订。V 编号见 `07-spec-review-round1.md`。

- 取上游：`effort_values` + `effort_default` 两列、三态 PATCH（缺席保留 / `null` 清空）、
  `assertEffortLevelsSupported` 对照 provider 能力矩阵、`ModelLibraryPanel` 的 `<fieldset>` UI
- **V1 · `schema.ts` 建表取并集**：上游 `schema.ts:182-194` 的 `provider_models` **只有**
  `effort_values`/`effort_default`（无 `base_url`/`api_key`/`context_window` —— 这三列是 **fork 自己加的**，
  `fabd8cd1`/`bbe0283b`，**不是上游删的**）。合并后建表 SQL = 上游两列 + fork 三列（去掉 `effort_levels`）。
  **06 旧文"三列不动"会漏掉把上游两列加进 fork 建表语句 → 全新安装少两列。**
- 退役 fork：`effort_levels` 列（**删列**，用户决定）、`CUSTOM_MODEL_EFFORT_LEVELS`、
  `assertValidEffortLevels`、`KNOWN_EFFORT_LEVELS`、`ClaudeCustomEndpointFields.tsx` 的 checkbox 组
- **V11 + X1 · 退役还须含数据读写链（含 repository 层）**（06 旧文遗漏）：
  - **X1 · repository 层 5 处**（三轮首报，**最要命**）：`server/modules/database/repositories/provider-models.ts`
    的 `:16`（行类型 `effort_levels: string | null`）、`:21`（SELECT 列清单）、
    `:39`（`effortLevels: parseEffortLevels(row.effort_levels)`）、`:109`（INSERT 列名）、`:144`（UPDATE SET）。
    **DROP COLUMN 后 INSERT/UPDATE 立刻 `no such column: effort_levels` →
    新建/编辑任何自定义模型全崩。**
    - **第四轮 fable 附 · 勿碰 `sessions.effort`**：`migrations.ts:457` 区的
      `addSessionEffortColumn` 操作的是 **`sessions.effort`（会话级）**，与本次**全无关**。
      `parseEffortLevels`/`serializeEffortLevels`（`:23-27`）的 JSON serde 可复用（列名解耦，改名与否无所谓）。
      **实现者 grep `effort` 时易误改，只动 `provider_models` 相关。**
  - service 层：`provider-models.service.ts:54`（`effort: buildCustomModelEffort(record.effortLevels)`）、`:75`、`:83`，
    以及 `custom-model-endpoint.ts:30-68`（`CUSTOM_MODEL_EFFORT_LEVELS` / `assertValidEffortLevels`）。
    **删列不断线 → 读端仍读 `record.effortLevels` → 自定义模型 effort 全丢（undefined）。**
- **X5 · 删旧校验的同时必须接上新的**：fork 调用方 `provider-models.service.ts:75` 删掉
  `assertValidEffortLevels` 后，**须替换为上游 `assertEffortLevelsSupported(provider, input.effort)`**。
  **只删不加 → 自定义模型可写入矩阵外级别，运行时静默丢弃** —— 与 D2"adapt 以上游为底"相悖。
- **V-advice · antigravity 的 `effortLevels` 是整字段替换**（不是"补一个字段"）：
  fork 的能力字段是 `supportsEffort: boolean`（`provider-capabilities.service.ts:27/85-177`），
  上游换成 `effortLevels: string[]`。**整字段替换**，否则 `buildCustomModelEffort` 拿不到"规范序"。
  上游矩阵**无 antigravity 条目**（只有 4 个 provider），fork 的 agy 条目（`:161-186`）须补 `effortLevels: []`。
- **保留并改造**：`buildCustomModelEffort`（medium 优先规则，`#38` 依赖）——
  规范序从写死 5 级换成 provider 的 `effortLevels`；上游新建模型不写 `effort_default`，
  靠此函数派生兜底，否则 composer 的 `'default'` sentinel 对自定义模型静默失效
  - **W12 + X15 · 两处改动（X15 修正前提）**：现签名 `buildCustomModelEffort(effortLevels: string[] | null)`
    （`custom-model-endpoint.ts:55-70`），函数体 `:62-64` 读**全局常量** `CUSTOM_MODEL_EFFORT_LEVELS`。
    - **X15**：v3 写的"调用方拿不到 provider"是**错的** —— `CustomProviderModelRecord` **自带 `provider`**
      （`repositories/provider-models.ts:10` 类型字段、`:33` `provider: row.provider`），
      服务层 `:45-56` 手里的 `record.provider` **就地可用**。
    - 处方（仍成立）：(1) 函数加参 `effortLevels` (2) 调用方用 **`record.provider`** 查能力矩阵取
      `effortLevels` 传入。**不要去造不存在的传参通道。**
- `base_url`/`api_key`/`context_window` 整链保留（**注意：上游本次是"没有"这三列，不是"零触碰"** —— V1）
- `#38` 一行不改（sentinel 来自 composer `DEFAULT_EFFORT_VALUE`，与上游表单通路正交）
- **V-advice · 数据语义变更须说明**：fork 列是纯 JSON 数组、无 default 概念；
  迁移后凡声明含 `medium` 的模型默认变 `medium`（派生规则），无论用户原先用哪档。**属行为变更。**
- **数据迁移**（V10 修订）：
  ```sql
  -- 必须先守卫：全新库没有 effort_levels 列
  -- 用 PRAGMA table_info(provider_models) 判断列存在，不存在则跳过整段
  UPDATE provider_models SET effort_values = effort_levels
   WHERE effort_levels IS NOT NULL AND effort_values IS NULL;
  ```
  `effort_default` 留 NULL 走派生。
  **V10 · 不加守卫 → 全新库首启 `no such column: effort_levels` → 服务器起不来。**
  **V-advice · 不加 `AND effort_values IS NULL`** → 低版本"留死列"分支下，用户 PATCH null 清空后
  重启会被旧值回填（破坏三态语义）。
  **V-advice · SQLite 版本判断是死分支**：本仓 `better-sqlite3@12.x` 内嵌 SQLite ≥3.4x，
  `DROP COLUMN` 恒可用 → **删掉 `<3.35 降级"留死列"的整段**（不可达，只会添噪音）。
- **V9 · 迁移顺序（v3 修正：v2 写反了，会丢数据）**：
  `widenProviderModelsProviderCheck`（`migrations.ts:547-599`）三重事实：
  1. `:555` 早退 `if (!tableSql || tableSql.sql.includes("'antigravity'")) return;`
     → **已含 antigravity 的库、全新安装都不跑 widen**
  2. `:564-589` 重建的 `CREATE TABLE` 与 `INSERT ... SELECT` **硬编码列清单**，
     数据是"旧表 → 新表"逐列搬运，**靠的就是旧表里还有 `effort_levels`**
  3. **正确顺序（W1，sub-fable + sub-opus 独立确认）**：
     ```
     addProviderModelEffortColumns   -- 加 effort_values / effort_default 两列
       → UPDATE（先搬！趁 effort_levels 还在）
       → widen（重建，清单含两新列）
       → DROP COLUMN effort_levels（带 PRAGMA 守卫）
     ```
     **v2 写的 `addColumns → widen → UPDATE → DROP` 是错序**：widen 重建时清单若已无 `effort_levels`，
     旧数据在重建瞬间丢失，之后 UPDATE 无源可读 → **自定义模型 effort 数据全丢**。
- **W9 · 列位置约束**：上游 `provider-models.db.integration.test.ts:220`
  - **终审 advice · 迁移调用须手工上移**：上游把 `addProviderModelEffortColumns(db)` 插在
    **建 index 之后**（即 widen 之后，`preview-step2:5219-5222`）→
    **自动合并的结果是错序，必须手工上移**到 widen 之前（或改用下方等价顺序）。
  - **等价顺序（终审建议，改动更少）**：`widen → addColumns → UPDATE → DROP` **也安全** ——
    widen 保持原清单（含 `effort_levels`，数据随行搬过去），新列由 `addColumns` 追加、
    天然排在最后，**W9 自动满足**，且不必改 widen 重建清单。
  `assert.deepEqual(columnNames.slice(-2), ['effort_values','effort_default'])`
  —— 用**列位置**断言。**建表语句与 widen 重建语句里，两列必须是最后两列**，否则 `npm test` 红。
- **W10 · 删掉 `migrations.ts:529` 的加列**：`addProviderModelCustomEndpointColumns` **每次启动都跑**
  `addColumnToTableIfNotExists(..., 'effort_levels', 'TEXT')`。不删这行 → DROP 后下次启动又加回来，
  **add/drop 往复**。
- **必做**：`runMigrations` 调用点 `migrations.ts:747` —— D2 的顺序结论应对着这里核，不是 `schema.ts`

## §3 D3 处置细则

> 本节经 spec review 第一轮修订。**核心修正：06 旧文只改后端，改完双行仍在（3 家独立报）。**

- Claude 的 boundary 改走上游分支：**删 fork `claude-sessions.provider.ts:742-758`（V5 确切断点：
  `:742` 是唯一一处 `raw.type === 'system'` 分支，`:757` 即 `return`），插上游块
  （`7c3049fe:1267-1305`，认 `compact_boundary` + `status`）**
- fork 的 `compact_boundary` kind + 字段 + `useChatMessages.ts:344` case + `MessageComponent.tsx:196`
  分支 + `chat.json` 的 `compact.*` i18n **全留**（OpenCode #21 + Antigravity #33 唯一实现）
- **V8 · 必须一并取上游两个前端文件（否则双行照旧）**：
  - `src/modules/chat/hooks/useChatMessages.ts`（上游 +121：三行折叠为 `compact`+`compactSummary`）
  - `src/modules/chat/transcript/MessageComponent.tsx`（上游 +30：`compact` 行渲染 + `<details>` 展开 UI）
  - 上游 `d450ed85` 共 8 文件：`claude-sessions.provider.ts` +76、`claude-compaction.test.ts` +101（新）、
    `server/shared/types.ts` +20、`src/shared/types.ts` +22、上述两个前端、`compactionRows.test.ts` +149（新）、
    `en/chat.json` +2
  - **V-advice · `server/shared/types.ts` + `src/shared/types.ts` 的 `CompactionInfo` 类型 + `compact` 字段
    必须同步**，否则前后端 typecheck 红
- **W5 · 两套逻辑不打架，但插入点必须点名（否则双行原样回来）**：
  - 判据正交：上游 `appendCompactionRow` **只在 `msg.compact` 或 `msg.isCompactSummary` 时接管**
    （否则 `return false`）；这两个字段**只有 Claude 产出**（`isCompactSummary` 全仓唯一产出点
    `claude-sessions.provider.ts:869`；`compact` 只在上游新增的 Claude 分支）
  - OpenCode / Antigravity 只发 `kind: 'compact_boundary'`
    （`opencode-sessions.provider.ts:598`、`antigravity-sessions.provider.ts:361`）
    → 两个条件都不命中 → 落回 `switch` 的 `case 'compact_boundary'`（`useChatMessages.ts:344`）**原路不动**
  - 渲染层同理：上游 `) : message.compact ? (` 与 fork `:196` 的 `message.isCompactBoundary ?`
    两个 prop 互斥
  - **必须写明：`appendCompactionRow` 调用要插在 `switch (msg.kind)`（`useChatMessages.ts:201`）
    **之前**`（上游 hunk 的接缝就在 `:187` `sharedMetadata` 与 `:201` 之间）。
    插到 `switch` 之后或 case 之内 → `isCompactSummary` 行先被 `case 'text'` 渲染成整段正文
    → **双行原样回来，且从后端与类型上都看不出来**。
  - 同理 `MessageComponent.tsx` 须并置为互斥三元分支
    （`message.compact ? … : message.isCompactBoundary ? …`），否则 OC/agy 的压缩行被静默吞掉。
- **`compact.button`/`compact.description` 属于 #20，退役时勿误删**
- 误读纠正：`findLastCompactBoundaryIndex`（`claude-anchors.ts:65-72`）扫**原始 transcript 行**，
  退役渲染层对它零影响
- 测试改断言：`claude-sessions.test.ts:598,633` 改 `.compact`
- **V5 · 删掉"两 `system` 分支"这个错误描述**：实测 `raw.type === 'system'` **只有一处**（`:742`）。
  `:860` 的 `isCompactSummary` 嵌在 `:760` 的 `raw.message?.role === 'user'` 分支**内部**，
  不是第二个 system 分支。真实落点：`fork 分支 = :742-758` / `user 分支 = :760` / `isCompactSummary = :860-872`。
- **W-advice · 搜索视图不受 fold 影响**：`session-conversations-search.service.ts:439`/`:483`/`:958`
  同样按 `isCompactSummary` 铺摘要正文，上游 fold 只作用于 `normalizedToChatMessages` 这条投影
  → 会话搜索里摘要仍是整段。验收②不覆盖它（可接受，但要知道）。

### 用户痛点（本次必须修好 — 合并后第一优先 smoke test）
**现状 bug（V-advice · 归因纠正）**：一次 compaction 渲染**两行** —— 成因不是"位置相隔 100+ 行且非 else-if"，
而是 **transcript 里两条独立行各带自己的 uuid，各被渲染一次**：
路径 1 = `claude-sessions.provider.ts:742`（fork 的 boundary 行）；
路径 2 = `:860` 的 `isCompactSummary` 合成 user 行（把摘要正文整段铺在界面）。
用户原话："显示了两次压缩内容，非常占用界面，我要找压缩之前的记录要翻山越岭"。

**修法（用户 2026-10-11 决定：完整取上游前端 fold）**：后端走上游 + 取上游
`useChatMessages.ts` 折叠逻辑 + `MessageComponent.tsx` 渲染。**只改后端等于白改。**

**验收标准**：①一次 `/compact` 界面**只有一行** ②摘要默认**收起**，点击才展开
③压缩前历史**可直接看到**，无需跨大段文本。

- **W16 · 验收须加"刷新页面重载历史会话"用例**：双行 bug 在**历史反向加载**
  （boundary 先到、summary 后到）时表现尤为严重。只测活跃会话实时触发，无法证明彻底修复。
- **W-advice · 验收①的口径要定义**：上游 fold 把 summary 折进 `<details>`，DOM 仍是多节点。
  应定义为"`normalizedToChatMessages` 输出长度为 1"（即折叠后只有一行 compact 条目），
  并复用上游 `compactionRows.test.ts`（149 行）的用例形状断言 —— 否则"只有一行"只能靠肉眼数。
- **W-advice · 验收③的落点未定**：折叠摘要解决的是"占屏"，**不解决"翻山越岭"**。
  ③要靠渲染层把 compaction 后的内容锚到下一段，或折叠 compaction **之前**的历史。
  方案没给③的落点 → smoke 时这一条判不了，**须补落点或降级为"观察项"**。

## §4 D4 处置细则

- `3cc73ede`（`claude-cli-liveness.service.ts` + `sessions.service.ts` +32）：取上游，与 #31 共存
  （liveness 写 session 活动态，不是 chatRunRegistry 的 busy；fork 架构里两层本就分离）
  - **V-advice · 须明确接线位置**：liveness 读 `~/.claude/sessions/<pid>.json`，
    fork `listRunningSessions`（`sessions.service.ts:148-175`）走 registry + `external_running_at`。
    两处"running"如何合并（取并集 / 串联）须写明，否则可能只加文件不接线，liveness 永不被读。
- `80dd5c29`（dispatcher bg-work 视为 busy）：**不取**，保 fork 的
  `server/modules/scheduled-messages/services/scheduled-message-dispatcher.service.ts`
  中 `dispatchQueuedMessages` 的判定（`:95` 只查 `chatRunRegistry.isProcessing`，**故意不查 background work**）
  - **X19 · D1-a 不覆盖 #31 的信号层**：`chat-run-registry.service.ts`、`SessionProtectionContext.tsx`、
    `useChatRealtimeHandlers.ts`、`ActivityIndicator.tsx` 均在 40 冲突清单内，
    fork #31 的 `backgroundWorkSessions`/bridge/`session_background_work` 帧与上游 `useSessionProtection`
    活动层是**两套并行的"两态"信号**（05 §1.6 有共识）。
    执行者若把 D1-a 读成"上游信号替换 #31 信号"，解 registry 冲突时会**丢掉 fork 集合** →
    held 态 Stop/指示灯消失。**按 05 §1.6 执行，不是替换。**
  - **V6 · 必须处置它带来的上游测试**：`server/modules/scheduled-messages/tests/scheduled-messages.test.ts:126`
    `test('a queued message waits for background work its session\'s last turn left running')`
    —— 该测试**断言 `80dd5c29` 的行为**（`:142` `assert.equal(chatRunRegistry.isProcessing(...), false)`）。
    **不取该特性 → 此测试必红。** 执行时：改写为 fork 断言（"排队消息不被后台任务阻塞"）。
  - **V-advice · 真正成对的不是"§4 前两行"**：`3cc73ede` 取 × `80dd5c29` 不取是并行的两件事；
    真正成对的是 **`80dd5c29` 不取 × `b9d3d129` 不取**（dispatcher 才敢放行，因为运行时不杀后台）。
- 上游自证：`b9d3d129` 的 commit message 明确说"composer 已经告诉用户'新 turn 会停掉正在跑的工作'"
  —— 上游把这个行为当特性，fork 当 bug（dispatch-agent 场景后台全灭）
- 合并后必查：grep 确认 `claude-runtime.provider.js` 无上游 stop 调用残留

## §5 G3 · 上游 composer 确认弹窗

- 上游 `b9d3d129` 附带：bg-work 运行时发消息 → 弹"新 turn 会停掉正在跑的工作"
  （`useChatComposerState.ts:868-884` 的 `window.confirm`，i18n key `claudeStatus.backgroundTask.sendAnyway`）
- fork 下这句是**假话**（fork 不停）→ **代码引入但触发条件恒不成立**（用户决定）
- **落法（用户 2026-10-11 决定 + V15 修订 + X12 钉死写法）**：条件写成**恒假守卫**，
  使弹窗永不触发。**不可**"接在 fork 真实状态上" —— fork 的真实状态（`hasBackgroundWorkOutstanding`）
  在 D1 场景下**恒为真**，接上去弹窗恰好在你要保住的那个场景弹出。
- **X12 · 写法钉死（cbc 实测）**：**不能写 `false && …`** —— 本仓 oxlint
    （`.oxlintrc.json:18` `correctness: "error"`）对 `if (false && x?.b)` 报**两条 error**
    （`no-constant-condition` + `no-constant-binary-expression`），`npm run lint` 与 pre-commit 双红
    → **过不了方案自己的 §6 lint 门**。
  - **钦定形态**：具名常量或具名谓词，如
    ```ts
    // 上游在此弹窗里承诺"新 turn 会停掉正在跑的工作"；本 fork 保留后台任务，这句话不成立。
    const PROMPT_BEFORE_SEND_OVER_BACKGROUND_WORK = false as const;
    ...
    if (PROMPT_BEFORE_SEND_OVER_BACKGROUND_WORK && hasBackgroundWork) { window.confirm(...) }
    ```
    （实测：命名 false 常量与具名谓词两形态**零告警**）
- i18n key 保留 both sides（`claudeStatus.backgroundTask.sendAnyway`）
- **V15 · 验收方式**：mock `window.confirm`，断言 bg-work 运行时发送**未被调用**
- 注：上游 `composerSendOverBackgroundWork.test.**ts**`（106 行，**X9/W17：是 `.ts` 不是 `.tsx`**）
  断言相反，需改为 fork 断言（补进 prompt 时注意：该测试属 `557109a2`，非 `b9d3d129`）

## §6 待办清单（执行阶段）

1. **新基线一次 merge**（V17 修订范围基数）：
   - **真冲突 40 个文件**（`real-conflicts.txt`）—— 4 家 spec review 已核过其中 P0 全部
   - 其中 **4 个 add/add**：`MarkdownImage.tsx`、`modelLabel.ts` + 2 测试
     （`claude-background-work.test.ts` 由 §1 决定；`provider-capabilities.service.test.ts` 纯追加拼接）
   - 59 非定制文件里的 18 个真冲突 = **40 的子集**（不是额外叠加）
2. 逐项按本文件解冲突（§1 D1 → §2 D2 → §3 D3 → §4 D4 → §5 G3）；
   **其余文件按 `docs/fork-customizations.md` 对应条目解**（终审 A3：`real-conflicts.txt` 里约 15 个
   文件本文件未点名 —— `agent.routes.ts`、`provider.routes.ts`、`SidebarHeader.tsx`、
   `AppearanceSettingsTab.tsx`、`Markdown.tsx`、`useSlashCommands.ts`、`api.ts`、`package-lock.json` 等）
3. **V-advice · 补全 add/add 文件路径**：`MarkdownImage.tsx` / `modelLabel.ts` 全路径须先定位
4. 全局必查：vite 双 `define` / 路由表 duplicate / fork-owned 复活（`scheduled-triggers`、
   `ComposerScheduleMenu`、`supportsRewind`/`rewindAnchor`）/ express 大版本 / i18n both-sides
5. typecheck + lint + npm test（对基线：Windows ~11 + 本机已知）
6. smoke test 三层：
   - **第一优先**：D3 compaction 双行修复（§3 验收标准）—— 含压缩前历史可直达
   - **不可分割**：D1"后台任务中发消息不杀"（§1 验收标准，含 stopped 早释放守卫）+ D4 dispatcher
   - 上游新功能 × 定制共存：quick-settings tabs × ForkQuickSettings、rename × agy title、
     model 标签 × #11、permission 只读显示 × adopt、per-task UI × 后台任务
     （**V-advice：这两对无 D1-D5/G3-G4 判据，smoke 前须先定判据**）
7. **V-advice · 补测 fork 独有测试**：`claude-subagent-survival.test.ts`、
   `claude-background-work-signal.test.ts`（断言 `hasBackgroundWorkOutstanding`）——
   ledger 退役后是否仍成立，§1/§6 未列
   - **X17 · 另须挑出 cron 用例保留**：fork `claude-background-work.test.ts`
     含快照支专属用例（`:266` `session_crons` 场景、`:242`/`:254`/`:279`/`:294` `fireHook` 快照系列）
     —— **随 479 行版本整体退役会失去唯一覆盖**，须挑出保留，其余取上游
8. **X18 · smoke 加"follow-up 回答中途任务完成"用例**（知情项，**不必修**）：
   任务在 claimed turn 中途**完成**（非 stop）时，result 时 tracker 空 + 无新 tool_use →
   `holdForTurn=false` → 释放 → CLI 待发的 work-report turn 被截。
   **非 v3 引入**（fork `:1225-1228` 现状同型），三源 OR 对此无解（tracker 空是真实状态）。
   验收②字面通过但回报丢失 → **把预期写明即可**。
9. dev 快进 + 两次 push 确认
10. 教训落盘：upstream-sync 中英 + 项目 CLAUDE.md（禁搬运、单父检查、record-only 流程、40 vs 287）
