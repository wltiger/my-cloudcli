# OpenCode 定制迁移调研（sub-sonnet）

仓根 `D:/code/opensource/claudecodeui` 存在。分支 `sync/v1.37.6`，对比 `upstream/main`(13e9ef64)，merge base `c17c2f6d`。只读。
范围说明：`git merge-tree --write-tree` 会往 .git 写临时对象（无工作区改动）；SDK `@opencode-ai/sdk` 在本机 `node_modules` 里不存在，所以 SDK 的方法名/路由我**无法判断**，已标出。

## 先说结论

1. **Compact (#22 OpenCode 部分)：port**。上游新 runtime 没有 compact，`/compact` 会被当普通文字发给模型。建议接在 `runOpenCodeTurn` 的 `promptAsync` 前（改走 summarize），不再起第二个短命 server。
   原文：`parts: [{ type: 'text', text: promptWithAttachments }]`
2. **Fork (#23 OpenCode 部分)：port，但改动在 fork 自有文件**。上游 OpenCode 没有 `forkSession`，`supportsSessionForking` 仍为 false。真正的活是把 `opencode-serve.ts` 对已删 `.js` 的两个 import 搬走。
   原文：`} from './opencode-runtime.provider.js';`（`opencode-serve.ts:9`）
3. **#27 Edit (revert-then-resume)：port（基本保持原样）**。上游没有 OpenCode 的 `rewindSession`/`resolveEditAnchor`，`supportsMessageEditing` 仍是 false；该特性在 sessions 文件和 fork 自有文件里，不碰 runtime。
   原文：`supportsMessageEditing: false,`（上游 `provider-capabilities.service.ts` diff 上下文）
4. **#31 chat-websocket：keep both（手工合）**。上游只把 `completeRun` 改成 `completeRunIfCurrent(run,…)`；fork 加了 hold-only 分支，`run` 可能是 undefined，要加 `if (run)`。
   原文：`chatRunRegistry.completeRunIfCurrent(run, {`（上游）
5. **#39 同步器 prune：不用动**。上游 v1.37.7 没改 `opencode-session-synchronizer.provider.ts`（`git diff --stat c17c2f6d upstream/main` 对该文件为空）。
   原文：`synchronizeFile()` (the watcher path) does not prune（fork-customizations.md #39）
6. **前提纠正**：任务说明里的 "long-lived `opencode serve` client" 与上游代码不符，上游是**每个 turn 一个私有 server**。
   原文：`Every turn gets its own `opencode serve``（上游 runtime.ts:7）
7. **额外冲突**：除了列出的文件，`src/shared/types.ts` 和 `src/modules/chat/tools/InteractiveRenderers/AskUserQuestionPanel.tsx` 也有内容冲突（不属于 OpenCode runtime，但会卡合并）。
   原文：`CONFLICT (content): Merge conflict in src/shared/types.ts`（merge-tree 输出）

## 上游新 runtime 概览（所有行号为 `upstream/main:server/modules/providers/list/opencode/opencode-runtime.provider.ts`）

- 每 turn 一个 server：`startOpenCodeServer` :651 → SDK `createOpencodeServer`，随机 Basic-auth 密码；`createOpencodeClient` 在 runOpenCodeTurn 内（约 :1215–1225）。
- 入口 `runOpenCodeTurn` :785；`command.trim()` 就是 prompt（:1162）；模型 `context.resolveResumeModel` :1170；无 session 时 `client.session.create` :1257；发送 `client.session.promptAsync` :1267。
- turn 结束靠事件：`session.status` busy→idle（:1135–1141）；finally 里关 server、发 `complete`、通知（:1296–1356）。
- 中止：`abortOpenCodeSession` :1359，只认私有 `activeTurns` map（:190，未导出）。
- 导出：`opencodeRuntime = { run, abort, permissions }` :1440；`isOpenCodeSessionActive` :1431；`reapOrphanedOpenCodeServers` :569（仅 Linux，且只杀带 `CLOUDCLI_OPENCODE_OWNER_PID` 的 server，所以不会误杀 fork 的短命 server）。
- 全文 grep `summariz|compact|/fork|/revert|rewind|resumeSessionAt` 无命中（Compact/Fork/Revert 都不存在）。
- 测试夹具 `fake-opencode-serve.ts` 只实现了 /event、/session、/session/:id(GET,PATCH)、prompt_async、abort、permission/question（:270–344），没有 summarize/fork/revert 路由。

---

## #22 Compact（OpenCode 部分）— **port**

1. fork 现状：`opencode-runtime.provider.js`（HEAD）`isOpenCodeCompactCommand` :145、`splitOpenCodeModelId` :155、`killOpenCodeProcessTree` :186、`startOpenCodeServeProcess` :245、`runOpenCodeCompactSideChannel` :308，`spawnOpenCode` :444–447 的提前 return；用 `withOpenCodeServe`（`opencode-serve.ts:55`）起短命 server，POST `/session/{id}/summarize`，body 必须是 JSON `true`。sessions 侧 `partType === 'compaction'` 分支在 `opencode-sessions.provider.ts:821`。`supportsCompact: true` 在 `provider-capabilities.service.ts:160`。
   原文：`the positional message reaches the model as plain text`（fork 的 .js 注释，可截 "the model as plain text"）
2. 上游：没有 compact。`/compact` 经 :1162 → :1267 作为普通文本发出。sessions 的 `compaction` 分支和 capabilities 的 `supportsCompact` 都合并干净（无冲突）。
   原文：`const promptText = typeof command === 'string' ? command.trim() : '';`
3. 建议：
   - **推荐 B（接进 turn）**：在 `runOpenCodeTurn` 里 `client` 建好、事件已订阅之后（约 :1253 之后）、`promptAsync`（:1267）之前加分支：`/compact` 且已有 `turn.providerSessionId` 时，调 SDK 的 summarize（用已有的 `parseOpenCodeModel` :262 拆 providerID/modelID，等于 `splitOpenCodeModelId` 的替代，可删掉它）；完成后 `turnDone()`。好处：Stop 自动可用（`activeTurns`+`session.abort`），`complete`/通知/token budget 沿用 turn 的 finally，Windows `taskkill` 那套对 Compact 不再需要；不必再起第二个 server。
   - **"没有会话可压缩"必须在 `session.create`（:1257）之前拦截**，否则空会话会被新建。旧版对应：`runOpenCodeCompactSideChannel` 里 `Nothing to compact yet` 的提前返回。
   - SDK 方法名、路由是否是旧的无前缀 `/session/{id}/summarize`、返回值是否仍是 `true`、compact 期间是否产生 busy→idle 事件（否则 turn 要自己 `turnDone()`）：**无法判断**（SDK 未安装，没有可读材料）。#21 里发现 `/api/session/{id}/...` 会返回 200+HTML，新 SDK 走哪条路径需要实机验证。
   - 备选 A（保底）：保留旧 side channel，搬进 fork 自有文件，在 `runOpenCodeTurn` 头部加一个提前 return。缺点：Stop 够不着（`activeTurns` 未导出，要改上游文件导出），还要保留 taskkill。不推荐。
   原文：`A server per turn, rather than one shared server, is deliberate`（上游 runtime.ts 头注释）
4. 规模/风险：B 在 runtime.ts 加约 25–35 行（上游文件，之后每次同步都可能冲突）；删旧 .js 约 320 行。风险中：SDK 行为未验证、compact 的 turn 结束判定。要迁的测试（`opencode-runtime.provider.test.js` 882 行里）：`splitOpenCodeModelId` :407、`isOpenCodeCompactCommand` :423、"runs /compact through the summarize side channel" :433、"non-boolean summarize response" :539、"nothing to compact yet" :624、"gives up cleanly when server never becomes reachable" :647 → 改写成 fork 自有 `server/modules/providers/tests/opencode-compact.test.ts`，复用上游 `fake-opencode-serve.ts`（需给夹具加 summarize 路由——夹具是上游文件，建议在 fork 自有测试里包一层或另放夹具，避免冲突）。`splitOpenCodeModelId` 测试若删函数则一并删。
   原文：`Nothing to compact yet — start a conversation first.`（旧 .js :`sendError`）

## #23 Fork（OpenCode 部分）— **port（只改 fork 自有文件）**

1. fork 现状：`opencode-serve.ts` `forkOpenCodeSession` :88（POST `/session/{id}/fork`，再 PATCH 改标题）、`withOpenCodeServe` :55；`opencode-sessions.provider.ts` `forkSession` :848、`push` 闭包 stamp `anchor` :673；`opencode-anchors.ts`（`buildOpenCodeAnchorIndex`、`OPENCODE_SESSION_END_ANCHOR`）。capabilities `supportsFork: true` :161。
   原文：`export function forkOpenCodeSession(`（`opencode-serve.ts:88`）
2. 上游：OpenCode 没有任何 fork（sessions 文件 grep `forkSession` 无命中；capabilities 里 `supportsSessionForking: false` 未动）。Fork 无需 runtime，所以新 runtime 不影响功能本身。
   原文：`supportsSessionForking: false,`（合并后 capabilities，OpenCode 段）
3. 建议：fork 不在 turn 内触发（由 REST 路由调用），没有 turn server 可借，所以 `withOpenCodeServe` 这个"短命 server"仍然需要。**adapt 的点**：`opencode-serve.ts:5–9` 从已删的 `.js` 引 `killOpenCodeProcessTree`/`startOpenCodeServeProcess`，必须改——最小做法是把这两个函数（含常量 `OPENCODE_SERVE_READY_TIMEOUT_MS`、`OPENCODE_KILL_ESCALATE_MS`、`OPENCODE_SERVE_LISTENING_PATTERN`、`spawnFunction=crossSpawn`）原样搬进 `opencode-serve.ts`（旧 .js :145–305 中的 :186–305，约 120 行），这样不用碰上游的新 runtime 文件。上游 `startOpenCodeServer` 未导出且带 Basic-auth，复用它要改上游文件，不推荐。也不要把 fork/revert 改成 SDK 调用（方法/路径未验证，且是同一类"文档与实际不符"陷阱）。
   原文：`this file only borrows them through`（`opencode-serve.ts` 注释）
4. 规模：搬运约 120 行（纯移动，低风险），改 import 2 处，改 `opencode-anchors.ts:9` 的注释（引用已删文件）。要迁的测试：`withOpenCodeServe shuts the ephemeral server down…` :709、`forkOpenCodeSession forks through the ephemeral server…` :775（连同文件里的 `createFakeOpenCodeServeExecutable` 夹具，约 100 行，旧 test.js 约 :72–170）→ 新建 fork 自有 `server/modules/providers/tests/opencode-serve.test.ts`。
   原文：`shuts the ephemeral server down on both success and throw`（旧测试名）

## #27 Edit（revert-then-resume）— **port（不改）**

1. fork 现状：`opencode-sessions.provider.ts` `resolveEditAnchor` :872、`rewindSession` :915、`readOpenCodeActiveRows` :128、`readOpenCodeRevertedMessageId` :81、`push` 里 stamp `transcriptAnchorId` :673 起；fork 自有 `opencode-rewind.ts`（`buildOpenCodeRewindAnchorIndex`、`filterOpenCodeRevertedRows`）、`opencode-serve.ts` `revertOpenCodeSession` :141。capabilities `supportsMessageEditing: true` :172、`rewindRestoresFiles: true` :163。runtime 已不参与（"the runtime never sees an anchor"）。
   原文：`so the runtime never sees an anchor`（fork-customizations.md #23 的 runtime bullet）
2. 上游：无对应实现，capabilities 里 `supportsMessageEditing: false`，合并后 fork 一侧的 true 保留（该行上游没改，见 merge-tree 结果）。
   原文：`supportsMessageEditing: true,`（合并后 capabilities OpenCode 段）
3. 建议 port：除上述 `revertOpenCodeSession` 依赖的 `withOpenCodeServe` 要先修好外，不需要新代码。**需实机验证一点**：旧文档说 "`opencode run` commits an outstanding revert the moment it appends its own user message"；新 runtime 用 `session.promptAsync` 发消息，是否同样清掉 revert 列：**无法判断**（服务端行为，代码里看不出）。若不清，`filterOpenCodeRevertedRows` 会继续按旧 revert 过滤，Edit 后的新消息可能被隐藏。
   原文：`commits an outstanding revert the moment it appends`（fork-customizations.md #23）
4. 规模：0 行新代码；风险在上面这个验证项。测试：`chat-edit-send.test.ts` 等不动；OpenCode 的 revert 在旧 test.js 里没有专门测试（grep 未见）。

## #31（OpenCode 角度：只与 chat-websocket.service.ts 相关）— **keep both**

1. fork 现状：`chat-websocket.service.ts`（HEAD）`handleChatAbort` :466–488，hold-only 时 `run` 可能是 undefined，provider 从 session 行取，成功才 `setBackgroundWorkOutstanding(sessionId,false)`，最后 `completeRun(sessionId,…)` :483。OpenCode 本身不产生 background-work hold（只有 Claude 的 `watchHeldTurns`）。
   原文：`const provider = run?.provider ?? (sessionsDb.getSessionById`（HEAD :~460）
2. 上游：`handleChatAbort` 改为 `completeRunIfCurrent(run, …)`（上游 :441）；`runDetachedChatTurn` 同样改为 `completeRunIfCurrent(activeRun, …)`（上游 :647，合并后无冲突，合并树 :703）。新 `chat-abort-opencode.test.ts` 要求只出一个终态 `complete`。
   原文：`Scoped to the run that was stopped: a stop can take a round trip`（上游注释）
3. 建议：冲突 hunk 取 HEAD 的前半（provider 解析 + `success` + `setBackgroundWorkOutstanding`），把最后的 `completeRun(sessionId, {…})` 换成 `if (run) { chatRunRegistry.completeRunIfCurrent(run, { exitCode: success ? 0 : 1, aborted: true }); }`，并保留上游那句注释。`completeRunIfCurrent`（`chat-run-registry.service.ts:386`）本来就在 `run.status !== 'running'` 时直接返回，所以 hold-only 场景行为等同旧的 no-op。
   原文：`A no-op when only background work was outstanding`（fork 注释，可保留）
4. 规模：约 5 行手工合并，低风险；合并后跑 `chat-abort-opencode.test.ts` 与 `chat-background-work-state.test.ts`。

## #39 OpenCode 外部删除 prune — **无需改动**

1. fork 现状：`opencode-session-synchronizer.provider.ts` `pruneDeletedSessions` :137，`pruneRows` :196，`synchronize()` 末尾调用 :51；跳过有 run 的行（`chatRunRegistry.getRun` :207）。
   原文：`if (!providerSessionId || chatRunRegistry.getRun(row.session_id)) {`
2. 上游：该文件在 v1.37.7 无改动（`git diff --stat` 空）。新 runtime 一创建 session 就调用 `registerProviderSession` → `writer.setSessionId?.()`（上游 :~870），即 provider id 更早绑定，比旧 CLI 流程更不容易被误删。
   原文：`writer.setSessionId?.(providerSessionId);`
3. 建议：保持。不属于冲突文件。
4. 规模 0；测试 `opencode-synchronizer.test.ts` 不动。

## 其他条目触碰冲突文件

- #11 / #32（AskUserQuestion 全屏、Other 多行）→ `AskUserQuestionPanel.tsx` 与 `src/shared/types.ts` 的 `PermissionPanelProps` 冲突：fork 加了 `sessionTitle?`，上游加了 `agentLabel?`，两者独立，**两个字段都留**。
  原文：`agentLabel?: string;` / `sessionTitle?: string;`
- #22 前端 `compact_boundary`、#23 `anchor` 等 `server/shared/types.ts`：本次未被上游改动，未见冲突。

---

## 3 个内容冲突文件

### `server/modules/providers/list/opencode/opencode-sessions.provider.ts`（合并树里 1 个冲突块，:756–776）
- HEAD：把 error 消息的 `normalized.push(` 改成 fork 的 `push(`（锚点 stamp 闭包）。
- 上游：包一层 `if (!isStoppedTurnError(messageInfo.error))`，仍用 `normalized.push(`。
- 解决：**两边都留**：`if (!isStoppedTurnError(messageInfo.error)) { push(createNormalizedMessage({...})); }`。合并树里其余 `push(` 改名已自动完成，只有这一处会漏。合并后 grep `normalized.push(` 应只剩闭包内那一处（:742）。
  原文：`if (!isStoppedTurnError(messageInfo.error)) {`

### `server/modules/providers/tests/opencode-sessions.test.ts`（3 个冲突块，约 :583、:630、:706）
- 双方都在文件末尾追加不同的测试：HEAD 是 compaction 边界/auto 触发两个测试；上游是 `QUESTION_TOOL_STATE`、live question card、"history hides the error of a stopped turn"。冲突只是 git 把两段交织在一起。
- 解决：**两边都留**，把它们拆成各自完整的测试，保证每个 `test(…)` 的 try/finally 与 `tempRoot` 清理都闭合；合并后跑该文件。
  原文：`test('OpenCode sessions provider renders a compaction boundary and its summary`

### `server/modules/websocket/services/chat-websocket.service.ts`（1 个冲突块，:466–489）
- 见 #31：**take ours + 把 `completeRun` 换成 `if (run) completeRunIfCurrent(run, …)`**。
  原文：`chatRunRegistry.completeRunIfCurrent(run, {`

### 修改/删除冲突
- `opencode-runtime.provider.js`：**接受删除**（`git rm`），在 TS 里重做 Compact（见 #22）并把两个 helper 搬进 `opencode-serve.ts`（见 #23）。
- `opencode-runtime.provider.test.js`：**接受删除**，fork 的 8 个测试（:407–882）按上面迁到新 fork 自有测试文件；`:192–405` 属上游旧测试，已被 `opencode-runtime.test.ts` 取代，直接丢。
  原文：`CONFLICT (modify/delete): server/modules/providers/list/opencode/opencode-runtime.provider.js deleted in upstream/main`

---

## Risks after auto-merge

1. **`opencode-serve.ts:5–9` 引用已删文件**：不搬就会 typecheck/运行时报错；`withOpenCodeServe` 被 Fork、Edit、Compact 三条路用，影响面最大。
   原文：`} from './opencode-runtime.provider.js';`
2. **依赖**：`package.json` 新增 `"@opencode-ai/sdk": "^1.19.5"`，本机 `node_modules/@opencode-ai` 不存在。按 CLAUDE.md，装之前先 `Get-NetTCPConnection -LocalPort 3001`；运行中只能增量 `npm install`，不能 `npm ci`。
   原文：`"@opencode-ai/sdk": "^1.19.5",`
3. **`provider-capabilities.service.ts`**：自动合并结果正确（从合并树读过）：上游改了注释和 `supportsPermissionRequests: true`，fork 的 `supportsCompact/Fork/Clear/rewindRestoresFiles/supportsMessageEditing` 都在，无重复字段。
   原文：`supportsPermissionRequests: true,`
4. **`server/shared/utils.ts`**：上游新增 `stripJsonComments`/`stripTrailingCommas`（合并树 :1108、:1166），fork 新增 `UNTITLED_SESSION_NAME`（:991）和 Windows 路径大小写折叠，互不重叠，无重复定义。`flattenPromptForWindowsShell`、`stripAnsiSequences` 未被删，antigravity/cursor 仍在用。
   原文：`export function stripJsonComments(content: string): string {`
5. **`providers/index.ts`**：合并树里同时有上游的 `reapOrphanedOpenCodeServers` 导出和 fork 的 `watchHeldTurns` 导出，不重复。`reapOrphanedOpenCodeServers` 仅 Linux，不影响本机。
   原文：`export { reapOrphanedOpenCodeServers } from`
6. **`src/shared/types.ts`**：不是"干净自动合并"，有 1 个冲突（`PermissionPanelProps`，见上），需手工合。
7. **上游 OpenCode 现在支持权限请求/问题卡**（`supportsPermissionRequests: true`），而旧 side channel 与 Fork/Edit 都不经过这条路；Compact 若接进 turn，要确认 compact 期间不会触发权限弹窗（理论上不会，未验证）。
   原文：`supportsPermissionRequests: true,`
8. **文档**：`docs/fork-customizations.md` #22/#23/#27 里关于 `opencode-runtime.provider.js` 的描述会过期，合并后需按 CLAUDE.md 要求同步改（含 zh-CN 版）。

## Open questions for the maintainer

1. Compact 走 B（接进 turn 用 SDK summarize）还是 A（保留旧 side channel）？B 需要先实机验证 SDK 方法/路径/返回值。（SDK 未安装，我无法判断。）
2. 同意把 `startOpenCodeServeProcess`/`killOpenCodeProcessTree` 搬进 `opencode-serve.ts`（而不是改上游文件导出 `startOpenCodeServer`）吗？
3. Edit 后新 runtime 的 `promptAsync` 是否会像 `opencode run` 一样清掉 outstanding revert？需要在真实 OpenCode 上测一次（#27）。
4. 上游 `fake-opencode-serve.ts` 缺 summarize/fork/revert 路由：fork 的测试是自带夹具，还是扩上游夹具（后者会增加以后的冲突面）？
5. `src/shared/types.ts` 与 `AskUserQuestionPanel.tsx` 的冲突超出本次调研范围，是否另派人？
