# 验收清单 · AskUserQuestion 补充说明

来源：方案 review Self 轴（claude-g38f + sub-opus 合并去重），按定稿后的 plan.md「验证」逐行。格式：入口 · 输入 · 预期。只是测试起点，不是上限。

## V1 前端单测 · 面板（`src/modules/chat/tests/askUserQuestionPanel.test.tsx`，入口 `renderPanel` / `onDecision` vi.fn）
- V1.1 · 单题，按 `1`、按 `n`、补充输入 `x, "y"`、Ctrl+Enter · `updatedInput = { questions, answers: { Q: 'React' }, annotations: { Q: { notes: 'x, "y"' } } }`
- V1.2 · 同上但不写补充 · `updatedInput` 没有 `annotations` 键
- V1.3 · 两题，Q1 只写补充，Next 到 Q2 什么都不选 · Submit 可点；提交后 `answers = {}`，`annotations` 只含 Q1
- V1.4 · 容器 keyDown `n` · 出现补充 textarea 且获得焦点；在 Other 框里按 `n` 不展开补充
- V1.5 · request 带 `context: { answerFormat: 'label-lists' }`，按 `1`、`n`、输入 `x`、提交 · `updatedInput = { answers: [['React', 'notes: x']] }`
- V1.6 · 问题带 `custom: false` · 没有「Other...」，有补充入口；label-lists 下补充照样 push
- V1.7 · 补充框打开并输入后切全屏 · 焦点仍在补充框（数字键不切选项）
- V1.8 · 焦点在补充框 · Next / Submit 的按键提示是 `Ctrl+Enter`
- V1.9 · 写过补充的题，Next 后再 Back · 补充框自动展开、内容还在

## V2 前端单测 · 卡片（`src/modules/chat/tests/QuestionAnswerContent.test.tsx`，及 ToolRenderer 传参）
- V2.1 · answers `{Q:'A'}`、annotations `{Q:{notes:'x'}}` · 收起和展开都显示「补充」+ `x`
- V2.2 · answers `{}`、annotations `{Q:{notes:'x'}}`（单题） · 不显示 Skipped / No answer provided；显示补充
- V2.3 · annotations `{Q:{preview:'…'}}` 或 `{Q:{notes:''}}` · 不显示补充行
- V2.4 · `toolConfigs` AskUserQuestion：`getContentProps` 从 `input.annotations` 或 `toolResult.toolUseResult.annotations` 取到值；title 已答计数算上只有补充的题
- V2.5 · ToolRenderer `question-answer` 分支 · `annotations` 传到 `QuestionAnswerContent`

## V3 后端单测 · OpenCode（`server/modules/providers/tests/opencode-sessions.test.ts`）
- V3.1 · `metadata.answers = [['Red','notes: x'], ['Small']]`，实时 `normalizeLiveEvent` · `toolInput.answers = { 'Which color?': 'Red', 'Which sizes?': 'Small' }`，`toolInput.annotations = { 'Which color?': { notes: 'x' } }`
- V3.2 · 同上走 `fetchHistory` · 结果同 V3.1
- V3.3 · `[['notes: x']]`（只有补充） · answers 无该题，annotations 有，toolInput 被写入
- V3.4 · `[['notes: a', 'Red']]`（notes: 不在最后一项） · 不拆，answers = `'notes: a, Red'`

## V4 静态检查
- V4.1 · `npm run typecheck` · 退出码 0
- V4.2 · `npm run lint` · 无 error
- V4.3 · 上述 3 个测试文件单跑 · 全过

## V5 实测（dev server + 真 Claude，`DATABASE_PATH=.local/test-auth.db`）
- V5.0（先做）· 选项 + 补充 `x` 提交 · 实时 WebSocket 帧 tool_result 的 `toolUseResult.annotations[Q].notes === 'x'`；不是 → 停下问用户
- V5.1 · 同上 · tool_result 文本含 `"<Q>"="<选项>" notes: x`
- V5.2 · 同上 · 实时卡片显示「补充：x」
- V5.3 · 刷新页面 · 卡片仍显示「补充：x」
- V5.4 · 会话 JSONL · 该 tool_result 行 `toolUseResult.annotations[Q].notes === 'x'`
- V5.5 · 用户肉眼看模型回复是否用到补充
