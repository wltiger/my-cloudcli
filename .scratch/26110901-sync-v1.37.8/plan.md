# sync v1.37.8

路线：S（方案 = 冲突解决表，见对话 + research-*.md）
当前阶段：完成（遗留：用户烟测，见 smoke-checklist.md；收工记录 wrap-up.md）

## 起点
- dev = cbf3832d，upstream/main = 2053f3d7（v1.37.8），merge base = v1.37.7（13e9ef64，已同步过，无需 record-only）
- 预览：16 个冲突文件（package-lock 19 处，claude-runtime 7 处，其余 1–2 处），见 merge-tree.txt / conflict-hunks.txt

## 前置决定（2026-11-09，用户全部接受）
- 分支 sync/v1.37.8 从 dev 切；分支上可随时 commit；落 dev / main、push 每次另问
- docs/agents/backlog.md 的未提交改动原样留着
- 执行者：主会话

## 执行（第 6 步确认，2026-11-09）
- 分支 `sync/v1.37.8`，固定点 = cbf3832d（dev HEAD）；commit 授权：是（分支上验收通过即 commit）；落 dev / main、push 另问
- 自动跑；阶段清理已做（g4a CLI 会话、review 导出文件、临时文件）
- 验收清单：`acceptance.md`
- 计划表（执行者都 = 主会话 · 可写 · 红线：只改 sync/v1.37.8，不动 dev / main，不 push；npm install 前查 3001，不用 npm ci；backlog.md 只追加 R-D、不 commit）
  - 单 1 合并上游（方案 1–6 + 决定 2；对话框暂照上游）· 验证 V0 V1 V3.1–3.3 · 状态：✅ 26374691（新 Windows 基线：cursor 取消测试 .cmd 卡死 → npm test 要加 --test-skip-pattern="cursor: a cancelled run"；chat-side-question 路径大小写；agent route POSIX 路径）
  - 单 2 运行时小修（R-E、决定 4 6 9）· 依赖 1 · 验证 V3.7 V4.3 V4.9 V4.10 · 状态：✅ 678f21b8（R-E 让 claude-turn-compatibility 8 个"需新进程"用例改为"被拒"；model 是热切换不改指纹）
  - 单 3 后台状态发送（方案 10–12）· 依赖 1 · 验证 V3.4–3.6 V5.1–5.5 · 状态：✅ cc984597（被拒气泡删除未做：需穿 4 个上游文件；edit-send 补转发 interruptBackground）
  - 单 4 排队和定时（方案 13–18 + R-B 实测）· 依赖 1 3 · 验证 V4.4–4.8 V5.6–5.7 · 状态：✅ 7edd9ef6（R-B 实测属实已修：新 run 继承旧 run 的连接；dispatcher 判断后台也看注册表）
  - 单 5 阅读设置 / 中文 / 文档（方案 19–21）· 依赖 1–4 · 状态：✅ 435e359b（zh-CN 另补对话框任务列表 5 条；backlog 加 R-D + 被拒气泡，未提交）
- 第 8 步整体测试：typecheck ✓ lint ✓；后端失败 ⊆ 基线 + Windows 新增 3 类（cursor 取消 .cmd 卡死需 --test-skip-pattern、chat-side-question 路径大小写、agent route POSIX 路径）+ 负载偶发（chat-edit-send、opencode-side-question、slashCommandArguments，单跑 3/3 过）；前端只剩 authTokenRefreshRemount
- 固定点 cbf3832d..435e359b = review 范围

## STEM
- 2611091023-claudecodeui-research-claude · 调查 Claude 运行时 Steer / 旁问 vs #29 #30 #31（前后端） · sub-opus
- 2611091023-claudecodeui-research-other · 调查其余冲突 + 自动合并文件语义 · sub-opus
- 2611091254-claudecodeui-review-plan · 方案 review（Self + Reality 合一份）· sub-fable、claude-g4a；收口 = 主会话
- 2611091537-claudecodeui-review · code review 2+1（cbf3832d..435e359b；材料 merge-resolution.diff + fork-commits.diff）· standards sub-opus、spec sub-opus、收口 sub-fable 双轴合一

## 调查结果
- 两家都完成：research-claude.md、research-other.md（已抽查 3 条关键结论属实）
- 两家都发现：provider-capabilities 自动合并把 opencode 的两字段贴到 antigravity 下
- 决定 1–10 已定（grill）；方案 review 已完成，验收清单 acceptance.md

## 决定（2026-11-09，grill）
- 原则：尽量对齐上游的设计
- 决定 1 · 后台状态发送：
  - Enter = 直接正常发送（#29 推进 held 进程，不打断），不弹框
  - 后台状态有输入时，发送按钮照上游换成 ∧ 菜单，第一行加「发送」（不打断）→ 顺序：发送 / 排队 / 旁问 / Send anyway
  - 上游 `'send'`（Send anyway = 停掉后台任务）保持原意；fork 的 `'interrupt'` 退役，由它代替
  - 对话框完全用上游原样（取消 / 排队 / 旁问 / Send anyway），只在服务端拒绝（background_work_not_kept）时弹出，选完按选择重发；聊天里的原因错误行保留；被拒时已切到别的会话 → 只把字放回输入框，不弹框
  - #31 文档"composer stays a send button throughout"要改
- 决定 2 · 旁问等待中推迟关闭：推迟时立刻 forgetHeldTurn（= 上游行为：新消息开新进程，旁问在只读副本上重问）
- 决定 3 · 排队消息：能发就发
  - 回合中排的（Enter / 菜单排队 / 被拒的插话）：回合一结束就推进 held 进程，不打断后台任务
  - 后台状态下主动选「排队」的：照样等后台任务结束
  - 排队消息要记"在等什么"（存在现有草稿字段里，不改表结构）；dispatcher 要改
  - 3a：dispatcher 推不进 → 继续排着，等后台任务结束再用新进程发（用户回"3a"，按 (a) 理解）
  - 3b：定时消息加「立即 / 等待」两种方式（顺带修 backlog 2026-10-18 静默丢弃 bug；做完删 backlog 条目 + 更新 memory project-scheduled-msg-background-drop）
    - 两种都先尝试推进进程，能推就发
    - 立即（默认，= 上游）：回合在跑 → 中止回合再发；推不进 → 停掉后台任务再发
    - 等待：等回合 / 后台任务结束，不限时；横幅里可删可改
    - 设置存进 options JSON，不改表；开关放 fork 自己的新组件，上游 ScheduleMessagePopover 只加一行引用
- 决定 4 · 插话行不打 Fork 锚点：claude-anchors / sessions 打标跳过 `raw.type === 'attachment'`（= 上游）
- 决定 5 · 锁文件：整份用上游 + 正常 `npm install`（腾讯镜像），不替换地址
- 决定 6 · MCP elicitation 审批 metadata 补 `_userId` / `_sessionName`（#16 清推送）
- 决定 7 · McpElicitationPanel 不加全屏 / 多行，只在 #11 / #32 文档记一笔
- 决定 8 · #3 阅读设置：SteeredMessageCard 改用 `widthClasses.column`（照 QueuedMessageCard）；旁问气泡也跟随字号（useChatProseClassName）和间距（spacingClasses）
- 决定 9 · 旁问副本路径（askClaudeSideQuestion）带上 `resolveClaudeCustomModelEnv` 的 env（#25）
- 决定 10 · zh-CN：chat.json 上游新增 46 条全补；对话框说明 en / zh-CN 都改回上游原意（自动合并取了 fork 旧说明）；fork 新文字（菜单「发送」行、定时立即 / 等待）写 en + zh-CN


## 方案 review 决定（2026-11-09，用户"全按推荐"）
详见 `review-plan-summary.md`
- R-A 排队靠 30 秒轮询：照上游接受，V6 写"30 秒内"
- R-B 后台代发 run 没挂浏览器连接：实现时实测，已打开的页面看不到实时回复就修（开新 run 时带上同会话上一个 run 的连接）
- R-C 定时「等待」留在定时列表里等（不转排队）
- R-D 热切设置失败丢登记：记 backlog，这次不修
- R-E 拒绝判断也看"该会话还登记着 held 进程"：这次修

## 方案（S）

前提：分支 `sync/v1.37.8` 从 dev（cbf3832d）切，`git merge upstream/main`（2053f3d7）。下称 RC = `research-claude.md`，RO = `research-other.md`，RV = `review-plan-summary.md`。

### 改哪些地方 · 做法

**一、冲突与自动合并**
1. `package.json` 取上游 `^0.3.311`；`package-lock.json` 取上游整份后增量 `npm install`（先查 3001 端口，不用 `npm ci`，不替换镜像地址）（RO §2）
2. `provider-capabilities.service.ts`：opencode 补 `supportsSideQuestions: true, supportsSteering: false`；antigravity 两项都 `false`；`provider-capabilities.service.test.ts` 的 `Record<LLMProvider, boolean>` 补 `antigravity: false`（RO §3，RC Q6）
3. `opencode-session-synchronizer.provider.ts`：两组方法都留，中间补一个 `}`（RO §2）
4. `useFileTreeOperations.ts`：留 fork 的 `copyPathToClipboard` 与相对路径；`downloadBlob` 并进已有的 `@/shared/utils` import 行；删 `triggerBrowserDownload`（RO §2）
5. `claude-runtime.provider.ts`（RC 草图 A–F）：
   - `createHeldPromptStream` 合一：`push(messages[]) → boolean`、`release()`、`isOpen()`；`pushPromptMessage = (m) => heldPrompt.push([m])`，与 `releasePromptStream` 一样走 closure，重试路径不重新赋值
   - hunk @1361：删回合开头的 `releaseHeldSession`（base 旧代码，v1.37.5 已删），保留上游 `maybeReleasePromptStream`
   - 上游 `settleTurnResult` 的函数体换成 fork 的：三信号 hold、`answersFollowUpPrompt`、complete / `notifyBackgroundWorkCompleted`、`registerHeldTurn`、`settleFollowUpTurn()`；`result` 分支只留上游的 steer 分流（`pendingSteerIds > 0` → `awaitSteerFollowUp()`）
   - `finally`：取上游 steer 计时器清理，不取它无条件的 `releasePromptStream()`
   - 决定 2：`maybeReleasePromptStream` 因旁问推迟时立刻 `forgetHeldTurn`（`settleTurnResult` 不 hold 分支 + stopped 提前释放分支）
   - 决定 6：MCP elicitation 的 `waitForToolApproval` metadata 补 `_userId`、`_sessionName`
   - R-E：claim 失败时，除了 `backgroundWork.outstanding(...)` 非空，**该会话在 `heldTurns` 里还有登记**也拒绝（发 `background_work_not_kept`），不再直接 `releaseInput`
   - `background_work_not_kept` 的错误文案只写原因，不提按钮名
6. 其余冲突（`providers/index.ts`、`provider.routes.ts`、`ChatComposer.tsx` import、`useChatProviderState.ts`、`useChatRealtimeHandlers.ts` import、`MessageComponent.tsx`）：两边都留（RC §2 表）
7. 决定 4：`claude-anchors.ts` 的 `buildClaudeAnchorIndex` 两个循环都跳过 `row.type === 'attachment'` 的行（`claude-sessions.provider.ts` 因此不再给它打 `anchor`）
8. 决定 9：runtime 里调 `askClaudeSideQuestion` 的两处（原生取消后重试、直接走副本），用 `context.getProviderModels()` 的模型表 + `resolveClaudeCustomModelEnv` 算 env，以 `buildClaudeSdkEnv()` 为底合并后经 deps 传入；`claude-side-question.provider.ts` 只把 deps 里的 env 放进 query options

**二、后台状态发送（决定 1）**
9. 取上游：`BackgroundSendDialog.tsx` 整份；`BackgroundSendChoice = 'send' | 'queue' | 'sideQuestion' | 'cancel'`（`'send'` = 停掉后台任务再发）；en/chat.json 对话框的 key 和说明都取上游，删 fork 的 `send` / `interruptAndSend`
10. `useChatComposerState.ts` 的 `handleSubmit` 后台分支：
    - `SubmitOptions.presetBackgroundChoice` 类型扩成 `'send' | 'queue' | 'sideQuestion'`
    - 有 preset → `'send'` 发 `chat.send` 带 `interruptBackground: true`；`'queue'` 排队（`waitFor: 'background'`）；`'sideQuestion'` → `askSideQuestionAndClear`
    - 没有 preset（Enter、菜单「发送」）→ 不弹框，普通 `chat.send`（服务端 claim-and-push）
11. 新 choice `'sendKeep'`：`ComposerSendMenu.tsx`（上游文件）后台状态第一行「发送 · 现在发，后台任务继续跑」；`ChatComposer.tsx` 的 `onSendMenuChoice` 类型和 `useChatComposerState.ts` 的 `handleSendMenuChoice` 签名同步加；它调不带 preset 的 `handleSubmit`
12. 被拒处理（RV M1，替换原写法）：
    - 发送时记一条被拒记录：会话 id、帧类型（`chat.send` / `chat.edit-send`）、`anchorId`、内容、附件、已上传附件描述、乐观气泡的 id；该会话下一次未被拒的 `complete` 到达时清空
    - 收到本记录对应会话的拒绝：被拒会话 = 当前打开的会话 → 弹上游对话框；不是 → 字写回**被拒会话**的草稿（`writeDraftText(sessionId, …)`），不弹框
    - 对话框的选择直接执行，不再走 `handleSubmit`：Send anyway → 用记录里的帧类型原样重发并带 `interruptBackground: true`，不再加气泡；排队 → `queueMessage`（`waitFor: 'background'`）；旁问 → `askSideQuestion`；取消 → 字放回输入框（同步 `inputValueRef`）。后三种删掉那条没送达的乐观气泡

**三、排队消息（决定 3 / 3a）**
13. `waitFor: 'turn' | 'background'`（旧数据缺省 = `'background'`），要改的存储链路（RV R1）：
    - 类型：`server/shared/types.ts` 的 `QueuedChatMessage`、前端 `src/shared/chatDrafts.ts` 的 `StoredQueuedMessage`
    - 透传：`user.service.ts` 的 `readQueuedMessageInput`、`server/shared/utils.ts` 的 `readQueuedChatMessage`
    - 合并：`session-drafts.db.ts` 的 `mergeQueuedMessages`，任一方 `'background'` → `'background'`
    - 恢复：`restoreQueuedMessage` 加可选参数改 `waitFor`（无新排队时也写新 JSON，不写回 `claimToken` 原串）
    - 取值：回合中排的（Enter、菜单「排队」、被拒的插话）= `'turn'`；后台状态排的 = `'background'`
    - `ChatComposer.tsx` 传给 `QueuedMessageCard` 的"等后台任务"只在 `waitFor === 'background'` 时为真
14. 后台发送要知道自己被拒（RV R3、R9）：
    - registry 的 `decorateAndRecordEvent` 看到 `code: 'background_work_not_kept'` 的 error 就在 run 上记 `refused`；`dispatchRun` / `runDetachedChatTurn` 返回值带出（不包 writer）
    - `runDetachedChatTurn` 加 `interruptBackground?: boolean` 入参，作为 `extraRuntimeOptions` 传给 `dispatchRun`（同 `handleChatSend` 的约定）
15. `dispatchQueuedMessages`：`isProcessing` → 跳过；有后台任务且 `'background'` → 跳过；有后台任务且 `'turn'` → 认领后 `runDetachedChatTurn`；`refused` → `restoreQueuedMessage(..., { waitFor: 'background' })`，之后不再推。轮询间隔照上游 30 秒（R-A）。改掉提到 "Interrupt and send" 的注释
16. R-B：实现后实测"已打开该会话的页面能不能实时看到后台代发的回复"；看不到 → `chatRunRegistry.startRun` 开新 run 时把同会话上一个 run 的连接带过去

**四、定时消息（决定 3b + R-C）**
17. 开关：定时消息 options 加 `onBusy: 'interrupt' | 'wait'`，默认 `'interrupt'`。开关是 fork 新组件（如 `ScheduleBusyModeToggle.tsx`），放进上游 `ScheduleMessagePopover.tsx`；`onSchedule(scheduledFor)` 签名加第二个参数，经 `ChatComposer.tsx` 的 `onScheduleMessage` 传到 `ChatInterface.tsx` 的 `handleScheduleMessage` 写进 options（RV R10）
18. 派发：`scheduled-messages.db.ts`（上游）加只读的 `listDue(now)` 和按 id 认领的 `claimOne(id)`；`dispatchDueScheduledMessages` 先列出到期条目，逐条判断：
    - `'interrupt'`（默认）：认领 → 照上游 `interruptActiveRun: true` 发；`refused` → 再发一次带 `interruptBackground: true`；还失败 → `recordFailure`（修掉静默丢弃）
    - `'wait'`：回合在跑 → 不认领，留待下次轮询；只剩后台任务且本条还没被拒过 → 认领后推，`refused` → 把这条退回待发送（加 `releaseClaim(id)`），记进 dispatcher 内存里的"已被拒"集合（重启后最多再推一次）；已被拒过 → 等到没有后台任务再认领发送；空闲 → 认领发送
    - 等待期间条目留在定时横幅里，可删可改

**五、阅读设置、文案、文档**
19. 决定 8：`SteeredMessageCard.tsx` 用 `widthClasses.column`（照 `QueuedMessageCard.tsx:28-31`）；`MessageComponent.tsx` 旁问气泡改用 `useChatProseClassName` 与 `spacingClasses`，替换写死的 `prose-sm` 和 `px-3 sm:px-0`
20. 决定 10：zh-CN/chat.json 补上游新增 46 条；对话框说明 en / zh-CN 改回上游原意；新文字（菜单「发送」行、定时开关）写 en + zh-CN
21. 文档：`docs/fork-customizations.md` + `.zh-CN.md` 更新 #3 #11 #12 #16 #23 #25 #29 #30 #31 #32 #33 #34 #39（RC §7、RO §6 + 决定 1 / 3 / 3b）；backlog 删"定时消息静默丢弃"，加 R-D；memory `project-scheduled-msg-background-drop` 更新

### 怎么验证
- V0 合并前在 dev 上跑一次 `npm test`，记下失败用例名单（`baseline-dev.txt`）
- V1 `npm run typecheck`、`npm run lint` 全过
- V2 `npm test` 失败名单 ⊆ V0 名单；`npm run test:client` 全过（`authTokenRefreshRemount` 偶发除外）
- V3 现有测试按新行为改：`claude-side-question-hold.test.ts`（superseded run 用例带 `interruptBackground: true`）、`provider-capabilities.service.test.ts`（补 antigravity）、`backgroundSendDialog.test.tsx`（回到上游版本）、`composerSendOverBackgroundWork.test.ts`、`composerSendMenu.test.tsx`、`composerSendMenuSteer.test.tsx`、`chatComposerSendMenu.test.tsx`（后台菜单 4 行）、`composerSideQuestionRouting.test.ts`、`composerQueuedFollowUps.test.ts`、`claude-anchors.test.ts`
- V4 后端新测试：claim 来的 follow-up 留有未读 steer 时 `settled` 等到后续 result；旁问推迟 release 时 handle 已撤销、新 send 不推进；R-E 只有登记没有任务时也拒绝；`runDetachedChatTurn` 被拒返回 `refused`、`interruptBackground` 入参生效；排队 `waitFor` 透传 / 合并 / 恢复；`'turn'` 在只剩后台任务时被推送、`refused` 后改 `'background'` 不再推；定时 `'interrupt'` 被拒后带 `interruptBackground` 重发、再失败记 failed；定时 `'wait'` 回合中不认领、被拒后退回待发送且不再推、后台结束后发出；anchor 跳过 attachment 行；旁问副本带自定义 env 且保留 `PATH`；elicitation 解决后 `notifyPermissionResolved` 带 userId
- V5 前端新测试：后台状态 Enter 不弹框、发普通 `chat.send`；菜单「发送」同上；Send anyway 带 `interruptBackground: true`；被拒 → 当前会话弹框、选择直接执行（重发不加气泡、编辑按 `chat.edit-send` 重发、取消字回输入框）、非当前会话写回其草稿不弹框；排队草稿 `waitFor` 取值；定时开关写进 options
- V6 手工烟测（用户做，`DATABASE_PATH=.local/test-auth.db`）：真实后台任务下 Enter / 菜单「发送」不停任务；Send anyway 停任务；改模型后发送 → 弹框；回合中 Enter 排队，回合结束只剩后台任务 → 30 秒内推进；定时立即 / 等待各一次（等待期间横幅还在）；插话、旁问；Wide 宽度下插话卡片对齐；中文界面没有英文残留；R-B 实测结论

## code review 决定（2026-11-09，用户"全按推荐"）
详见 `review-code-summary.md`
- 直接改：S1 多余依赖、S2 不可达分支、S3 类型注释、S5 测试挪 websocket、S6/S11 去重、S12 readBusyMode、P1 补 V4.1/V4.2、P8 #31 Files、P9 定时开关每次复位
- C-1 R-B 补全：注册表按会话记住在看的页面（订阅时记录），新 run 全部接上
- C-2 R-E 漏洞：认领到了但推不进（含 adopt 失败）也拒绝
- C-3 跨标签页拒绝误认：不修，记 backlog
- C-4 被拒的编辑：取消 / 排队都恢复编辑状态，排队时提示「编辑不能排队」
- C-5 挪出上游文件：被拒处理 → fork 的 `useRefusedSend.ts`；定时等待模式 → scheduled-messages 里 fork 的新文件
- C-6 定时认领：保持 claimDue + releaseClaim，记为与方案的偏离
- 第 10 步迭代：第 1 轮修复 ✅ e684faf7（C-1 注册表按会话记观众；C-2 认领到推不进也拒；C-4 被拒编辑保持编辑状态、不能排队；C-5 移到 useRefusedSend.ts + busy-session-sends.service.ts，dispatcher 对上游只剩 4 处调用；V4.1/V4.2 测试 + 变异验证；S1–S3 S5 S6 S11 S12 P8 P9）。全量：typecheck ✓ lint ✓ 前端 1265/1265 ✓；后端失败 ⊆ 基线 + Windows 3 类 + 负载偶发（provider-cli、chat-edit-send、opencode-side-question 单跑 11 次失败 1 次）
