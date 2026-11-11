# AskUserQuestion 选项补充说明（notes）

路线：S（方案 → 方案 review → 一单实现）
当前阶段：完成（收工记录 wrap-up.md；合回 dev 后 push 另问）

## 起点
- dev = 1f9d618c
- 头脑风暴：跳过（grill 已把要定的都定了）

## 调查结论（2026-11-11，主会话自查）
- Claude CLI（SDK 0.3.322 自带 claude.exe）原生支持 `annotations[问题].notes`，发给模型的格式：`"问题"="选项" notes: 补充`；只有补充没选项时：`"问题"=(no option selected) notes: 补充`；工具返回的 data（= `toolUseResult`）含 `annotations`
- 终端只有带 preview 的问题能按 `n` 加 notes；网页版现在不发 `annotations`、不显示
- `claude-runtime.provider.ts:1748` 原样透传 `decision.updatedInput`，后端不用改发送路径
- OpenCode（本机 opencode.exe）：答案 = 每题字符串数组，`join(", ")` 后给模型，不校验是不是选项
- 实时面板只有 Claude 和 OpenCode 会弹；Antigravity / Codex 只在历史里
- 实时 Claude 消息不经过 `unifyAskCall`（`claude-runtime.provider.ts:2020` 直发），但带结构化结果：`claude-sessions.provider.ts:1449-1456` 读 `raw.tool_use_result`；历史从 JSONL 的 `toolUseResult` 读；前端 `toolConfigs.ts:668,684` 已有 `toolResult.toolUseResult` 兜底

## 决定（2026-11-11，grill，用户全部确认）
1. A：独立补充框，Claude 走 `annotations.notes`
2. B2：OpenCode 在该题答案末尾多放一项 `notes: 补充`
3. C2：Other 下面一行 `[n] + 补充说明`，点或按 `n` 展开
4. D1：聊天记录卡片显示「补充：……」，实时和刷新后都显示；OpenCode 的 `notes:` 项也显示成补充
5. 只做 CloudCLI 网页版；终端不管，不改全局 CLAUDE.md
6. F1：`custom: false` 的题也给补充入口
- 默认：补充框 Enter 换行、Ctrl+Enter 下一题/提交；和 Other 互不影响；写过补充的题回来自动展开；只写补充也能提交；按钮文字加 en + zh-CN

## 方案 review 决定（2026-11-11，用户：全部按推荐）
- R1 删掉确认句解析：Claude 只读结构化 `toolUseResult.annotations`，不改 `message-unification.ts`
- R2 OpenCode 只拆数组最后一项且以 `notes: ` 开头的；Other 文字本身以 `notes: ` 开头会被误判 → 接受，写进 fork-customizations
- R3 验证「模型用到补充」改为「tool_result 文本含 `notes: x`」+ 用户肉眼看回复
- R4 既有问题不修，记 backlog：容器 Enter 不看 Submit 是否 disabled；OpenCode 多选选项名含 `, ` 被拆成多个 chip
- 直接修进方案：ToolRenderer 传参；Submit 判断算上所有题的补充；只写补充算已答；全屏焦点；keyHint；notes 非空才显示

## 方案

### 0. 先实测前提（实现第一步）
- dev server + 真 Claude：选项 + 补充提交，看实时 WebSocket 帧的 tool_result `toolUseResult` 是否含 `annotations`。**不含 → 停下问用户**（不自己加解析）

### 1. 面板（提交）
- 新建 fork 文件 `src/modules/chat/tools/InteractiveRenderers/AskQuestionNotesField.tsx`：`[n] + 补充说明` 按钮 + 多行输入框（Enter 换行、Ctrl+Enter 下一题/提交，同 Other 框）
- `AskUserQuestionPanel.tsx`（上游）只加接入：
  - 每题 `notesTexts` / `notesOpen` 两个 Map；容器按 `n` 展开当前题并聚焦；写过补充的题回来自动展开
  - 聚焦：`:64-68` 的「抢回容器焦点」在补充框打开时也不抢（同 Other 的处理），切全屏后补充框重新聚焦
  - `keyHint`：焦点在补充框时也显示 `Ctrl+Enter`
  - 能否提交：`hasCurrentSelection` 算上当前题补充；Submit 的 disabled 判断把「任何一题有补充」也算进去
  - Claude：`updatedInput` 多带 `annotations: { [问题]: { notes } }`（trim 后非空才放），一题都没写就不带这个字段
  - OpenCode（label-lists）：该题数组末尾 push `notes: 补充`；`custom: false` 也 push
  - `custom: false` 也显示入口

### 2. OpenCode 后端拆分
- `opencode-sessions.provider.ts`（上游）`toAskUserQuestionCall`（实时 `:741`、历史 `:984` 共用）：每题数组**最后一项**以 `notes: ` 开头 → 拿出来放进 `toolInput.annotations[问题].notes`，不再拼进 answers；只有补充、没有答案时也要写入 toolInput
- Claude 后端不改（R1）

### 3. 聊天记录卡片
- `toolConfigs.ts`（上游）`AskUserQuestion`：`getContentProps` 多传 `annotations`（`input.annotations` → `toolResult.toolUseResult.annotations`）；`title` 的已答计数把「有补充」算上
- `ToolRenderer.tsx`（上游）`question-answer` 分支把 `annotations` 传给 `QuestionAnswerContent`
- `QuestionAnswerContent.tsx`（上游）：答案下面加一行「补充：……」，收起 / 展开都显示；`notes` 为非空字符串才显示；有补充的题不算 skipped，`hasAnyAnswer` 也算上
- 显示用的 i18n：组件若新加 `useTranslation`，对应测试要能渲染（看现有测试是否 mock react-i18next）

### 4. 翻译和文档
- `chat` 命名空间加按钮和「补充」的 en + zh-CN 文字
- `docs/fork-customizations.md` + `.zh-CN.md` 加一条（含 R2 的歧义说明）

## 验证
验收清单：`acceptance.md`（V1–V5）
- 前端单测：`askUserQuestionPanel.test.tsx`（选项+补充 → annotations、不写补充时无 annotations 键；多题 Q1 只补充 + Q2 空 → Submit 可点；`n` 展开并聚焦、Other 框里按 n 不展开；label-lists 末尾 `notes:`；custom:false 有入口且 push；补充框打开后切全屏焦点仍在补充框）、`QuestionAnswerContent.test.tsx`（显示补充；只补充的题不显示 Skipped；空 notes 不显示）
- 后端单测：`opencode-sessions.test.ts`（最后一项 notes 拆出，实时 `normalizeLiveEvent` 和历史 `fetchHistory` 两条路径；只有补充时也写入；中间项以 notes: 开头不拆）
- `npm run typecheck`、`npm run lint`、上述测试文件
- 实测（dev server + 真 Claude，`DATABASE_PATH=.local/test-auth.db`）：选项+补充提交 → tool_result 文本含 `notes: x`、实时卡片显示补充、刷新后仍显示、JSONL 里 `toolUseResult.annotations[Q].notes === 'x'`；用户肉眼看模型回复

## 执行（第 6 步确认，2026-11-11）
- 分支 `feat/ask-question-notes`（从 dev 切），固定点 = 1f9d618c；commit 授权：是（分支上验收通过即 commit）；push、合回 dev 另问
- 阶段清理已做（g38f CLI 会话、scratchpad 扫描脚本）；派遣目录保留
- 验收清单：`acceptance.md`
- 计划表
  - 单 1 补充说明功能（方案 0–4）· 执行者 = 主会话 · 可写 · 依赖无 · 验证 V1–V5 · 红线：只改 feat/ask-question-notes，不动 dev / main，不 push；碰 node_modules 前查 3001，不用 npm ci；实测只用 `.local/test-auth.db`；backlog.md 不 commit · 状态：✅ 4e739dc2（V5.0 前提 SDK 实测成立；V1–V5 全过；实测发现切全屏后光标跑到开头，补充框已修成放末尾——Other 框同样问题是上游既有，未动；OpenCode 历史路径与实时共用 toAskUserQuestionCall，只测了实时 + splitQuestionNotes 单测，没复制 100 行 DB fixture 测 fetchHistory）
- 第 8 步整体测试：✅ typecheck ✓ lint ✓；前端 1283/1284（composerQueuedFollowUps 并行负载偶发，单跑 3/3 过）；后端 1416 过 / 37 败，失败文件在 HEAD 单跑 29 个稳定失败，与固定点 1f9d618c 同文件对比无新增（固定点多 1 个偶发）→ 全是既有 Windows 基线
- 固定点 1f9d618c..4e739dc2 = code review 范围
- 第 9 步 code review 第一轮：✅ 方式 2+1 变体（claude-g38f 两轴各一 + 新 sub-opus 双轴合一）；汇总 = 主会话（summary.md）；用户「全部按推荐」
- 第 10 步迭代：修复 ✅ b711504d（两个焦点 bug；状态和焦点逻辑搬进 fork hook useAskQuestionNotes，上游面板 diff 约 101→63 行；高度随内容重算；冒号进译文；state/组件注释；后端常量同名不 export；opencode 保留原三元式；#40 注明有意偏离 module-standards）；复查 = 续跑 sub-opus ✅：两个焦点 bug 修好、无新问题（jsdom + StrictMode 实测）、effect 顺序假设成立、决定与 hard 全落实；剩 1 条注释 judgement → 645ee181
- 第 11 步验收走查：用户选不走查
- 第 12 步收尾：✅ wrap-up.md（可收工）

## STEM
- 2611111049-claudecodeui-review-plan · 方案 review（Self + Reality 合一份）· claude-g38f、sub-opus；收口 = 主会话；汇总 summary.md
- 2611111208-claudecodeui-review · code review 第一轮（1f9d618c..4e739dc2）· standards claude-g38f、spec claude-g38f、双轴合一 sub-opus（新开）
