# sync/v1.37.4 · 07 spec review 第一轮 · must-fix 证据核验

日期：2026-10-11。STEM `2610112258-claudecodeui-review`。4 家同题同卷审
`06-grill-decisions.md`。本文件记**主会话亲自核验过**的 must-fix（my-spec-review 第 3 步）：
打开的 file:line、结论（成立 / 不成立 / 需修正）。未核验的初报不入本文件。

## 已核验条目

### V1 · 上游 schema 与 fork schema 是两套，合并要取并集 —— **成立（但 sub-opus 的归因错了）**

- sub-opus 原话（大意）："D2「base_url/api_key/context_window 上游零触碰」的前提与代码不符
  —— 上游 schema 已删掉这三列"。
- 核验命令：`MSYS_NO_PATHCONV=1 git show upstream/main:server/modules/database/schema.ts | grep -n ...`
- 实测：
  - upstream `schema.ts:192-193` = `effort_values TEXT DEFAULT NULL` / `effort_default TEXT DEFAULT NULL`
    —— **只有这两列**，没有 `base_url`/`api_key`/`context_window`。
  - fork `schema.ts:204-213` = `base_url TEXT` / `api_key TEXT` / `effort_levels TEXT` / `context_window INTEGER`
    —— 有那三列，没有上游两列。
- **归因纠正**：那三列**不是上游删的，是 fork 自己加的**（`fabd8cd1` 加 base_url/api_key，
  `bbe0283b` 加 context_window，`46b03f8d` 加 effort_levels）。上游从来就没有过这三列。
  sub-opus 把"fork 独有"误读成"上游删除"。
- **但 finding 成立且是真缺口**：合并时 `schema.ts` 的 `provider_models` 建表语句必须
  **取并集**（上游 `effort_values`+`effort_default` + fork `base_url`/`api_key`/`context_window`，
  删 `effort_levels`）。06 §2 只写了"三列不动"，**没写建表 SQL 要合并** → 需补进方案。

### V2 · D1 退役清单漏调用点 —— **成立，且比 sub-opus 报的更严重（漏 5 处，非 1 处）**

- sub-opus 原话（大意）："D1 退役清单漏了 `:950-953` 这个唯一调用点"。
- 核验命令：`grep -n "backgroundWork\." server/modules/providers/list/claude/claude-runtime.provider.js`
- 实测共 **7 处**：
  - `:953` `...backgroundWork.buildHooks()` —— 漏（漏了它 = hook 根本不注册，ledger 全废）
  - `:1133` `backgroundWork.resetFallbackSignal()` —— 漏
  - `:1208` `backgroundWork.observeMessage(message)` —— 漏
  - `:1225` `backgroundWork.outstandingReason()` —— 06 已点名（在 :1225-1270 区间）
  - `:1227` `backgroundWork.hasSnapshot()` —— 06 未单独点名
  - `:1228` `backgroundWork.resetFallbackSignal()` —— 06 未单独点名
  - `:1366` `backgroundWork.hasOutstandingWork()` —— 06 已点名
- 06 §1 写的调用点是 `:804`（实为变量声明 `let heldForBackgroundWork`，**不是调用点**）、
  `:1225-1270`、`:1366`。
- **结论**：漏 `:953`/`:1133`/`:1208`/`:1227`/`:1228` 共 5 处调用点；
  另 `:804` 归类错误。方案须补全清单，否则运行时 `backgroundWork` 未定义或残留调用。

### V3 · `releaseHeldSession` —— **成立（方案措辞错误，需改写）**

- sub-fable 原话（大意）："`releaseHeldSession` 点名了不存在的函数"。
- 核验：
  - fork 侧：`grep -rn releaseHeldSession server/modules/providers/list/claude/` → **零命中**
  - 上游侧：`git show upstream/main:...claude-runtime.provider.js` → `:375` 定义、`:953` 调用
- **结论**：`releaseHeldSession` 是**上游 v1.37.4 的新函数，fork 里不存在**。
  06 §1「`releaseHeldSession` 保持 fork 的 boolean 签名（不接 taskId）」**措辞错误** —— 会误导执行者
  去找一个不存在的 fork 函数。真实意图应为：「上游 `:953` 的 `releaseHeldSession(sessionKey())`
  调用点 fork 不取（属 `b9d3d129` stop-before-takeover 一部分）」。**必须改写这一句。**

### V4 · D5 自相矛盾 —— **不成立（假阳性）**

- sub-fable 原话（大意）："D5 自相矛盾"。
- 核验：`MSYS_NO_PATHCONV=1 git show upstream/main:server/modules/providers/services/
  provider-capabilities.service.ts | sed -n '95,135p'`
  - `:99` `supportsMessageEditing: true` —— 属 **codex** 块（配注释讲 Codex `thread/fork`）
  - opencode 块（`:102` 起）末行 `supportsMessageEditing: false`
- **结论**：上游 opencode 仍为 `false`，06 的 D5「#27 keep」**正确**。
  假阳性的来源很可能是第一条 `grep -A8 opencode` 抓到了 codex 块的 `:99`（区间跨界）。
  该 finding 丢弃。

### V5 · D3「两个 system 分支」描述错误 —— **成立（agy）**

- agy 原话（大意）："方案描述的『两 system 分支相对顺序』在代码中不存在"。
- 核验：`grep -n "raw.type === 'system'\|role === 'user'\|isCompactSummary"
  server/modules/providers/list/claude/claude-sessions.provider.ts`
  - `:742` `raw.type === 'system' && raw.subtype === 'compact_boundary'` —— **唯一一处 system 分支**
  - `:760` `raw.message?.role === 'user' && ...` —— user 分支（`:860` 的 `isCompactSummary` 在其中）
- **结论**：06 §3「语义盯点：`normalizeMessage` 两 `system` 分支相对顺序」是**错误描述**。
  真实冲突是 `:742` 的 system/boundary 分支 vs `:760` 的 user 分支（`:860` 在内）。
  上游 `d450ed85` 把 boundary 归到 assistant 行上，不存在"两个 system 分支"。
  该描述会误导执行者寻找不存在的分支 → **必须改写。**

### V6 · `80dd5c29` 的上游测试未处置 —— **成立（agy / 两家独立提到）**

- agy 原话（大意）："上游随 `80dd5c29` 引入的新增测试用例处置方案未指明，直接合入会导致 npm test 失败"。
- 核验：`git show upstream/main:server/modules/scheduled-messages/tests/scheduled-messages.test.ts | grep -n`
  - `:126` `test('a queued message waits for background work its session\'s last turn left running', ...)`
  - `:142` `assert.equal(chatRunRegistry.isProcessing(SESSION_ID), false)`
  - `:146` runtime 的 `isProcessing` 回调注入 `backgroundWork` 布尔
- **结论**：该测试**断言 `80dd5c29` 的行为**（排队消息等后台任务）。06 §4 决定「不取
  `80dd5c29`」→ 这个测试必然失败。06 **完全没提它的处置**。
  执行时须：删掉/改写该测试为 fork 断言（"排队消息不被后台任务阻塞"）。**必须补进方案。**

### V7 · 上游 `DEFERRED_WORK_TOOLS` 与 fork `BACKGROUND_WORK_TOOLS` 语义相反 —— **事实成立，但 agy 的"漏判"归因不成立**

- 核验：`git show upstream/main:...claude-runtime.provider.js | sed -n '596,640p'`
  - 上游 `:598` `const DEFERRED_WORK_TOOLS = new Set(['Monitor','ScheduleWakeup','CronCreate','TaskCreate','Workflow'])`
    —— **白名单**（在名单内才算后台），且 `:635` `return DEFERRED_WORK_TOOLS.has(block.name)` **不检查 `run_in_background`**
  - 上游 `:626` `Bash` **单独特判**：`block.input?.run_in_background === true`
  - 上游 `:632-633` `Agent` 特判：`block.input?.run_in_background !== false`
  - fork `claude-background-work.ts:43` `BACKGROUND_WORK_TOOLS = new Set(['Bash','Agent','Task'])` + `:54` `run_in_background === true`
- **结论**：
  - agy 说"上游名单不含 `Task` 会漏判"→ **归因不成立**：上游用 `Agent` 覆盖了 subagent 场景，
    `Task` 是 fork 自己加的工具名；上游另有 `TaskCreate`。降级 advice。
  - **但事实本身要紧**：两套名单语义相反（白名单 vs 三工具+`run_in_background`）。
    06 §1 只说"退役 `BACKGROUND_WORK_TOOLS`"，**没说明上游名单覆盖面不同**：
    上游多覆盖 `Monitor`/`ScheduleWakeup`/`CronCreate`/`TaskCreate`/`Workflow`（这些 fork 完全不认），
    fork 多覆盖 `Task`。需在方案里写明覆盖面差异，避免执行者以为等价替换。

### V8 · D3 双行修不好：06 §3 漏了客户端两个文件 —— **成立（3 家独立报：opus / fable / agy）**

- opus 原话（大意）："§3 的全部落点都在后端与 i18n，没有任何前端『收起/展开』的改动，验收②按方案执行后不成立"。
- 核验：`git show d450ed85 --stat` → 该提交共 **8 个文件**：
  - `claude-sessions.provider.ts` +76、`claude-compaction.test.ts` +101（新）
  - `server/shared/types.ts` +20、`src/shared/types.ts` +22
  - **`src/modules/chat/hooks/useChatMessages.ts` +121**（fold / 去重）
  - **`src/modules/chat/transcript/MessageComponent.tsx` +30**（compact 行渲染）
  - `compactionRows.test.ts` +149（新）、`en/chat.json` +2
- **结论**：06 §3 只提了后端 + i18n，**完全没提 `useChatMessages.ts` / `MessageComponent.tsx`**。
  而用户要的"一次压缩只有一行、摘要默认收起"**恰恰由客户端 fold 实现**。
  只改服务端 → 上游 `compact` 行与 `:860` 的 `isCompactSummary` 行**继续双行**，验收①② 失败。
  **06 §3 必须补这两个客户端文件的落点。**

### V9 · `widenProviderModelsProviderCheck` 三重坑 —— **成立（opus 最详）**

- opus 原话（大意）："重建的 CREATE TABLE 与 INSERT ... SELECT 都是写死的列清单…widen 根本不会跑，
  删 effort_levels 必须另写一条 ALTER TABLE … DROP COLUMN，方案没给"。
- 核验：`sed -n '547,600p' server/modules/database/migrations.ts`
  - `:555` 早退：`if (!tableSql || tableSql.sql.includes("'antigravity'")) return;`
    —— **已含 antigravity 的库、以及全新安装（schema.ts 直接建表）widen 根本不跑**
  - `:564-589` 重建的 `CREATE TABLE provider_models__new` 与 `INSERT ... SELECT`
    **硬编码列清单，其中仍有 `effort_levels`，没有 `effort_values`/`effort_default`**
- **结论（三个后果）**：
  1. 顺序结论（新迁移放 widen 之后）对，但**只覆盖一半** —— 全新库/已 widen 库不跑 widen，
     删 `effort_levels` **必须另写 `ALTER TABLE provider_models DROP COLUMN effort_levels`**，方案没给
  2. 若把 `effort_levels` 从重建清单删掉，**尚未重建的库会在重建时连列带数据一起丢**，
     之后那条 UPDATE 没有源列 → 数据丢失
  3. 真正必须先于 widen 的其实还有那条 UPDATE 本身的位置
- **06 §2 必须补**：DROP COLUMN 迁移 + widen 重建清单改写为两新列 + 顺序约束扩到 UPDATE

### V10 · D2 迁移 SQL 在全新库必崩 —— **成立（fable 报）**

- fable 原话（大意）："迁移若与 schema 同步删列，则 schema.ts 新建表无此列，而 runMigrations
  对全库无条件跑该 UPDATE；方案无 PRAGMA table_info 守卫" → 全新安装建库即失败。
- 核验：`sed -n '740,760p' server/modules/database/migrations.ts` —— `runMigrations` 无条件执行
  各迁移函数（`addProviderModelCustomEndpointColumns` → `widenProviderModelsProviderCheck` → …）。
  `schema.ts` 合并后 `provider_models` 建表**将不含 `effort_levels`**。
- **结论**：`UPDATE provider_models SET effort_values = effort_levels WHERE effort_levels IS NOT NULL`
  在全新库上 → `no such column: effort_levels` → **全新安装失败**。
  **06 §2 必须补**：`PRAGMA table_info(provider_models)` 守卫，列不存在则跳过。

### V11 · D2 退役清单漏读写链 —— **成立（fable 报）**

- fable 原话（大意）："漏了真正的读写链 `provider-models.service.ts:54`（`effort: buildCustomModelEffort(record.effortLevels)`）、`:75`、`:83` 与 `custom-model-endpoint.ts:30-68`"。
- **结论**：06 §2 只列了 `CUSTOM_MODEL_EFFORT_LEVELS`/`assertValidEffortLevels`/`KNOWN_EFFORT_LEVELS`/checkbox，
  **没列数据读写链**。删列不断线 → 读端继续读 `record.effortLevels` → 自定义模型 effort 全丢（undefined）。
  **06 §2 必须补这四处。**

### V12 · D1 必须同步取 `addSession`/`removeSession` 的 clear+invalidate —— **成立（fable 报）**

- fable 原话（大意）："'全取上游'必须同步拿下 `addSession`/`removeSession` 的
  `backgroundWork.clear(sessionId)` + `sessionHistoryCache.invalidate(sessionId)`，否则 tracker 泄漏致永久 busy"。
- **结论**：上游 `557109a2` 在 `addSession`/`removeSession` 各加了 clear + invalidate。
  fork 的 `addSession`（`claude-runtime.provider.js:384-418`）是带 supersede-interrupt 的定制版。
  只取判定不取 clear → 被 supersede 的旧进程任务永不清 → `hasOutstanding` 恒真。
  **06 §1 必须补这两个函数的接线。**

### V13 · `:942` 是 fork 与上游的同一行，须逐行保 —— **成立（fable 报）**

- fable 原话（大意）："`:942 getSession(sessionKey())?.releaseInput?.()` 与 `b9d3d129` 的
  `releaseHeldSession(sessionKey())` 是同一行的两种写法，方案没点名这一行"。
- **结论**：`b9d3d129` 的 diff 就是把这行**单行替换**。合并时若整取上游 hunk →
  stop **悄悄回来**（含 `outstanding()` 引入）+ claim 逻辑被覆盖。
  **06 §1 必须写明：逐行保留 `:919-942` 的 claim 块，不引入 `releaseHeldSession`。**

### V14 · fable 说「D5 自相矛盾：`provider-capabilities.service.ts:158` 现为 `true`」—— **丢弃（假阳性，二次确认）**

- fable 原话："证据：`provider-capabilities.service.ts:158` 现为 `true`（#27 翻转），upstream/main
  同文件 opencode 为 `false`…'仍为 false'等于退役 #27"。
- 核验：fork 当前文件 `:158` 附近 —— 该行**属于哪个 provider 块**需确认；
  但**上游 opencode 块内 `supportsMessageEditing: false`** 已由 V4 用
  `sed -n '95,135p'` 精确核实（codex 块的 `true` 在 `:99`，opencode 块的 `false` 在块末）。
- **结论**：fable 的 `:158` 若指 fork 文件里 **opencode 块**，则 fork 确实是 `true`（这正是 #27 的改动），
  而 06 说的是**上游**仍 `false` → 06 表述正确，`#27 keep` 成立。
  fable 把 fork 的 `true` 与上游的 `false` 混为"自相矛盾"。**该 finding 丢弃**（措辞可能引起误解，
  但结论正确：06 该句可加"（上游）"二字消歧，属 advice 而非 must-fix）。

### V15 · fable 说「G3『接在 fork 真实状态上使其永不触发』定不出行为 / 只能是死代码」—— **降级 advice**

- fable 原话："fork 真实状态（`useBackgroundWorkSessionIds`）在 bg-work 运行时为真，
  不存在'接上它就恒为假'的写法…只能写 `false && …` 死代码或干脆不取"。
- **结论**：用户已明确决定"**代码引入但屏蔽**"，即**接受死条件写法**（`false && …` 或等价守卫）。
  fable 指出的"语义相同但验收无法判定"是**有效提醒** → 06 §5 应写明验收方式
  （断言"`window.confirm` 未被调用"，mock `window.confirm`）。
  **降级为 advice**，落点：06 §5 补一句验收方式。

### V16 · `558*/557109a2` 的 "stopped" 早释放 hunk × 保留 claim = 用户消息被杀 —— **成立（cbc 独家，最严重）**

- cbc 原话（大意）："'全取上游'×'保留 heldTurn claim'：557109a2 早释放 hunk
  （`heldForBackgroundWork && task_notification && status==='stopped' && !hasOutstanding → releasePromptStream()`，
  **无 turn-in-flight 检查**）× `claude-runtime.provider.js:1131-1134`（tryAccept 不重置 heldForBackgroundWork）
  × `stopClaudeSDKTask` docstring 自证"emits a task_notification with status stopped"
  → claim 的用户 turn 在飞时，经 G4 stop 掉最后一个任务（或 CLI 自停）→ stdin 被关 → 用户消息半途被杀；
  上游无 claim 所以此 hunk 安全，全取上游时必须裁剪或加'无 turn 在飞'守卫"。
- **结论**：这是**"全取上游"与"保留 claim"组合产生的新 bug**，四家仅 cbc 抓到。
  上游该 hunk 的前提是"没有 claim"（新 turn 到达即停），fork 保留 claim 后前提不成立。
  **06 §1 必须补**：该早释放分支需加"当前无 turn 在飞"守卫，或在 fork 下裁剪。
  这与 §1 验收标准（后台任务中发消息不被杀）**直接相关** —— 不加守卫，验收②仍会失败。

### V17 · 执行范围基数自相矛盾（37+2+18=57≠40）—— **成立（cbc 独家）**

- cbc 原话（大意）："'40 真冲突文件（37 定制 + 4 add/add 中的 2 个需手工 + 59 抽查中的 18 真冲突）'
  括号内加和 = 57≠40，且 05 §5 明说'18 个〔真冲突〕（含 4 add/add）'，2 个手工测试被双重计数"。
- **结论**：06 §6 第 1 条的数字表述**自相矛盾**，执行阶段无法判定"解完"的判据。
  需重述为：真冲突 40 个文件（含 4 add/add），其中 2 个已决议、2 个手工合；
  59 非定制文件的 18 个真冲突是 40 的子集（08 待核）。

### V18 · `/chat/stop-task` 是 WebSocket 协议消息，非 HTTP 路由 —— **成立（cbc）**

- cbc 原话："实为 WebSocket 协议消息 `chat.stop-task`（`chat-websocket.service.ts:444/687`），非 HTTP 路由；
  按'路由'去 express 注册表找会扑空"。
- **结论**：06 §1/§6 措辞为"路由"会误导执行者找错地方。**降级 advice**，改写措辞即可。

### V19 · claim 块与 `:942` 的锚点方向 —— **成立（cbc，纠正 05 的表述）**

- cbc 原话："`claude-runtime.provider.js:924`（claim 调用）与 `:942`（claim 失败后的 releaseInput 行），
  claim 块在 `:942` **之前**；锚点反了…解冲突时把 claim 摆到 release 之后 →
  `heldPrompt.isOpen()` 恒 false → claim 恒返 null，#29 静默失效"。
- **结论**：05 原文"`:942`（claim 块之后）"说的是**上游 stop 的落点**，但措辞易被读成"claim 在 :942 之后"。
  实测 claim 调用在 `:924`、releaseInput 在 `:942` —— **claim 在前**。
  06 §1 必须写明确切行号，避免执行者摆错顺序。

## 核验汇总

**成立 13 条**（V1/V2/V3/V5/V6/V7事实/V8/V9/V10/V11/V12/V13/V16/V17/V19，其中 V7 归因降级）、
**丢弃 1 条**（V4）、**降级 advice 4 条**（V7 归因、V14、V15、V18）。

四家**没有一家否定方案的 7 项决策本体** —— 全部 findings 都指向"落地细节"。
共识度最高的三条（4 家中有 3 家独立报）：
1. **D1 退役清单漏调用点**（opus / fable / agy / cbc —— 4/4 全报）
2. **D3 只改服务端修不好双行**（opus / fable / cbc —— 3/4）
3. **D2 全新库迁移必崩**（fable / cbc —— 2/4）

## 待核验（其余三家回来后补）

- D3 顺序 B 是否真能达到「一次压缩只有一行」的验收（sub-opus 说达不到）
- D2 迁移的可执行性（CHECK 重建丢列、SQLite 版本判断）
- 转义/类型/边界类 finding
