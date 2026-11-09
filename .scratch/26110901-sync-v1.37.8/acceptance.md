# 验收清单 · sync v1.37.8

格式：`编号 · 入口 · 输入 · 期望`。来源：方案「怎么验证」V0–V6，合并 sub-fable / claude-g4a 的 Checks 并按 review 决定（R-A…R-E）改过。是测试的起点，不是上限。

## V0–V2 全量
- V0 · `npm test`（dev，合并前） · — · 失败用例名写进 `baseline-dev.txt`
- V1 · `npm run typecheck`、`npm run lint`（合并后） · — · 都 exit 0（server tsconfig 含测试文件）
- V2 · `npm test`、`npm run test:client` · — · 后端失败名 ⊆ baseline-dev.txt；前端除 `authTokenRefreshRemount` 外全绿

## V3 现有测试改写
- V3.1 · `claude-side-question-hold.test.ts` superseded run 用例 · 第二次 `queryClaudeSDK` 带 `interruptBackground: true` · 旧进程 `released()`，旧 run 的 stopped 通知不碰新进程
- V3.2 · `provider-capabilities.service.test.ts` · `Record` 补 `antigravity: false` · typecheck 过；opencode `supportsSideQuestions === true`，antigravity `false`
- V3.3 · `backgroundSendDialog.test.tsx` 取上游 · 点 Cancel / Queue / Send anyway · `[['cancel'], ['queue'], ['send']]`
- V3.4 · `composerSendMenu.test.tsx`、`composerSendMenuSteer.test.tsx`、`chatComposerSendMenu.test.tsx` · `state="background"` 渲染菜单 · 行为 `['Send', 'Queue', 'Side question', 'Send anyway']`（旁问按能力显示）
- V3.5 · `composerSendOverBackgroundWork.test.ts` · 后台状态 `handleSubmit` · 不弹框；旧的 "asks first" / `'interrupt'` 用例改写为新语义
- V3.6 · `composerSideQuestionRouting.test.ts`、`composerQueuedFollowUps.test.ts` · 原用例 · 按新 choice / `waitFor` 语义通过
- V3.7 · `claude-anchors.test.ts` · 含 attachment 行 · 该行无 anchor

## V4 后端
- V4.1 · `queryClaudeSDK` + steer + 假 query · A hold → B 推入 → B 回合内 steer → B 的 result · B 仍 pending；echo + 第二个 result 后 resolve，恰一条 `complete`
- V4.2 · 原生 `askSideQuestion` 挂起 + 不 hold 的 result · 再发新 send · `heldTurns` 无登记；新 send 走新 `createQuery`；旧进程 released；旁问 fork 重问一次
- V4.3 · R-E · tracker 空、`heldTurns` 有登记、指纹不符 · 发 `background_work_not_kept`，不 `releaseInput`
- V4.4 · `runDetachedChatTurn` · runtime 发拒绝 error · 返回 `refused: true`；`interruptBackground: true` 入参出现在 runtime options 顶层
- V4.5 · 排队存储 · POST `waitFor: 'turn'`、合并 `'turn'`+`'background'`、`restoreQueuedMessage(..., { waitFor: 'background' })` · 读出值分别为 `'turn'` / `'background'` / `'background'`
- V4.6 · `dispatchQueuedMessages` · 空闲回合、有后台任务、`'turn'`、第一次 run 拒绝 · 第一轮 run 1 次且库里改 `'background'`；第二轮 run 0 次
- V4.7 · `dispatchDueScheduledMessages` · `'interrupt'`，第一次拒绝 · run 2 次，第 2 次带 `interruptBackground`；再失败 → `status='failed'`
- V4.8 · 同上 · `'wait'`：回合在跑 / 后台任务且第一次拒绝 / 后台结束 · 不认领、条目 pending；认领后被拒→退回 pending 且后续轮询不再推；后台结束后认领发出
- V4.9 · 旁问副本 · 自定义 baseUrl/apiKey 模型 · `createQuery` 的 `options.env` 含 `ANTHROPIC_BASE_URL` / `ANTHROPIC_API_KEY` 且有 `PATH`；内置模型不含前两者
- V4.10 · elicitation 解决 · `resolveToolApproval` · `notifyPermissionResolved` 收到 userId 与 sessionName

## V5 前端
- V5.1 · `handleSubmit` 后台状态无 preset · 输入 "hello" · `backgroundSendPrompt === null`；一条 `chat.send`，无 `interruptBackground`
- V5.2 · `handleSendMenuChoice('sendKeep')` · 同上 · 同 V5.1
- V5.3 · `handleSendMenuChoice('send')` · 同上 · `chat.send` 带 `interruptBackground: true`
- V5.4 · `notifyBackgroundWorkRefused(当前会话)` · V5.1 发送后 · 弹框；选 send → 第二条帧带 `interruptBackground`、气泡不增加；编辑消息被拒 → 重发帧为 `chat.edit-send`；选 cancel → 字回输入框、`inputValueRef` 同步、乐观气泡删除
- V5.5 · `notifyBackgroundWorkRefused(其他会话)` · 发送后切走 · 不弹框；字写进被拒会话的草稿，当前输入框不变
- V5.6 · 排队 · 回合中 Enter / 后台状态菜单「排队」 · 请求体 `waitFor` 为 `'turn'` / `'background'`；`'turn'` 卡片不显示"等后台任务"
- V5.7 · 定时开关 · 选「等待」后定时 · `scheduleMessage` 的 options 含 `onBusy: 'wait'`；默认 `'interrupt'`

## V6 手工烟测（用户）
- V6.1 真实后台任务下 Enter / 菜单「发送」：任务不停，回复到达，不弹框
- V6.2 Send anyway：任务被停，回复到达
- V6.3 改模型后发送：错误行 + 上游对话框
- V6.4 回合中 Enter 排队，回合结束只剩后台任务：30 秒内推进，任务不停
- V6.5 定时「立即」回合中到点：回合中止、消息发出；「等待」：横幅保留，忙完后发出
- V6.6 插话、旁问各一次
- V6.7 Wide 宽度：插话卡片与输入框对齐；旁问气泡跟随字号
- V6.8 中文界面：发送菜单、对话框、插话、旁问、MCP 表单、定时开关无英文
- V6.9 R-B：已打开会话的页面能否实时看到后台代发的回复（实现时已实测，烟测复核）
