# v1.37.7 前端合并调研 (sub-sonnet)

结论先行:
- 前端真冲突只有 3 类: `AskUserQuestionPanel.tsx`(5 个冲突块)、`chat.json`(en/es/fr/ko/zh-CN 各 1 块,只是相邻插入)、`types.ts`(1 块,两边各加一个可选字段)。全部是「两边都留」。
- 没有任何 fork 条目可以退役(无 redundant)。#1683 与条目 #28、#1602 与条目 #32 都是 coexists,不是行为冲突。
- 机械合并后会留下 2 处语义缺口(见第 3 节): fork 的全屏标题回退文案仍写死 "Claude needs your input";fork 拆出的 `footer` 常量里没有 Dismiss 文案。

证据来源: `git merge-tree <base> HEAD upstream/main`(只读)的文本输出 + `git diff c17c2f6d {HEAD|upstream/main} -- <path>`。「原文」均摘自这些输出或 `docs/fork-customizations.md`。

---

## 1. 逐文件冲突

### 1.1 `src/modules/chat/tools/InteractiveRenderers/AskUserQuestionPanel.tsx` (条目 #11 + #32 vs 上游 #1698)

两边的改动:
- fork (HEAD): 全屏 (`FullscreenSurface`、`isFullscreen` 状态、`footer`/`panel` 拆分、`fontClasses`)、"Other" 改多行 textarea (`OTHER_FIELD_MAX_HEIGHT_PX`, 文件:17)、`keyHint` Ctrl+Enter、`handleSubmit`/`handleSkip` 里先 `setIsFullscreen(false)` (文件:122, 127)。
- 上游: OpenCode 问题支持 —— `wantsLabelLists()`、`agentLabel` 属性、`buildLabelLists()`、`handleSubmit/handleSkip` 的 label-lists 分支、`q.custom !== false` 守卫("Other" 按钮、textarea、`0` 键)、头部文案改成 `t('chat:agentPrompts.needsInput')`、Skip 按钮在 label-lists 下显示 Dismiss。

merge-tree 里的 5 个冲突块与处理(**全部 keep both**):

| # | 位置 (HEAD 行号) | fork 侧 | 上游侧 | 处理 |
|---|---|---|---|---|
| 1 | 常量区 (:17) | `OTHER_FIELD_MAX_HEIGHT_PX` | `wantsLabelLists` | 两个都留,上下排 |
| 2 | 组件体 (:30-34) | `const fontClasses = useChatFontClasses()` | `const answersAsLabelLists = wantsLabelLists(request.context)` | 两行都留;解构参数里已自动并入 `agentLabel` + `sessionTitle` |
| 3 | `handleSubmit` (:122) | 开头 `setIsFullscreen(false)` | `buildLabelLists` + label-lists 分支 | 先 `setIsFullscreen(false)`,再走上游的分支,最后落到原有的 `onDecision(...answers: buildAnswers())`;依赖数组用上游的 |
| 4 | `handleSkip` (:127) | `setIsFullscreen(false)` | label-lists 分支 `onDecision(..., {allow:false})` | 同上: 先退全屏,再分支。两个路径都要退全屏 |
| 5 | "Other" 按钮 + 输入区 (:~395-434) 以及末尾 `{!isFullscreen && footer}` (:465) | fork 版按钮(含 `isFullscreen`/`fontClasses` 三元)+ textarea;`footer` 常量 | 上游版按钮(旧 class,包 `q.custom !== false`)+ 旧的内联 footer | **取 fork 的内容,套上上游的守卫**: 按钮外包 `{q.custom !== false && (...)}`,textarea 条件改 `q.custom !== false && isOtherOn`。**丢掉上游那段内联 footer**(fork 已把它拆成 `footer` 常量并用 `{!isFullscreen && footer}` 渲染) |

自动合并但需要手工补的地方(见第 3 节):
- 头部 "Claude needs your input" (:280)。上游改成 `t('chat:agentPrompts.needsInput', { agent: agentLabel || 'Claude', ... })`,这一块合并是干净的,会生效。
- `e.key === '0'` (:151) 上游加 `&& q.custom !== false`,干净合并。

原文摘录:
- fork 条目 #32: "Enter is a plain line break; Ctrl+Enter (Cmd+Enter on macOS) is the explicit advance/submit gesture"
- 上游: "Such a request is also dismissed rather than skipped."

### 1.2 `src/shared/types.ts` (条目 #11 的 `sessionTitle`; 条目 #33 的 `LLMProvider`)

- fork: `PermissionPanelProps` 加 `sessionTitle?: string` (HEAD :965)。另外 fork 在别处加了 `'antigravity'` 等,不在冲突块里。
- 上游: `PermissionPanelProps` 加 `agentLabel?: string`;`Question` 加 `custom?: boolean`(这一处干净合并)。
- 冲突只有 `PermissionPanelProps` 一块(同一位置各加一行)。**Keep both**: 保留 `sessionTitle?: string` 和 `agentLabel?: string` 两个字段。上游把该类型的 doc 注释改成含 "the name of the agent asking" —— 取上游注释即可,fork 的 `sessionTitle` 行自带注释,保留。
- `PendingPermissionRequest.context?: unknown` 两边都已有 (types.ts:502),无需处理。

原文摘录: 上游 "export type PermissionPanelProps = { request: PendingPermissionRequest; agentLabel?: string;"

### 1.3 `src/modules/i18n/locales/{en,es,fr,ko,zh-CN}/chat.json`

冲突原因: 两边都在 `"json": {...},` 与 `"permissions": {` 之间插入新的顶层块,位置相同。
- fork 加的键 (整块): `antigravityPermissions.{title, allowAndRerun, allowing, allowed, ruleUnknown, grantFailed}`(en :116-123)。此外 fork 还自 base 起新增 `fullscreen.*`、`compact.*`、`fork.*`、`clear.*`、`backgroundHold.*` 等,这些不与上游相邻,不冲突。
- 上游加的键 (整块): `agentPrompts.{needsInput, dismiss, alwaysAllow, alwaysAllowCovers}`。
- **键名不冲突**: fork 的 HEAD `chat.json` 里没有 `agentPrompts`(grep 无结果),上游没有 `antigravityPermissions`。唯一同名的字符串 `"dismiss"` 在 en :383 是 fork/上游已有的另一个嵌套键 ("Dismiss failure notice"),与 `agentPrompts.dismiss` 在不同对象下,不碰撞。
- 处理: 5 个文件都 keep both —— 两个块都留,注意中间补逗号(`antigravityPermissions` 结尾 `}` 后要有 `,`,再接 `agentPrompts`)。
- 其余 locale (cs, de, he, id, it, ja, pt-BR, ru, tr, zh-TW): merge-tree 显示 "changed in both" 但无冲突标记,自动合并通过。这些语言 HEAD 里没有 `antigravityPermissions`,所以无相邻插入。合并后跑一次 JSON 解析 / i18n 键对齐检查即可。
- 另: `locales/en/settings.json` 上游加了 7 个 `browser...input*` 键 (`inputPlaceholder` 等),merge-tree 无冲突标记。

---

## 2. 逐个上游 commit

| commit | 判定 | 说明 |
|---|---|---|
| `a3a51d90` #1571 浏览器面板点击/输入 | **coexists** | 改 `BrowserUsePanel.tsx`、`api.ts`(+`sendInput`)、`browser-use.routes.ts`、`browser-use.service.ts`、`settings.json`。fork 条目 #14 只改 `browser-use.service.ts` 的 `installRuntime()`/`getPlaywright()`/`runCommand()`(HEAD service :145, :254, :323)。上游 service diff 的 hunk 在 `-73`、`-380`、`-594` 区(新增 input 与会话串行化),**没碰** `installRuntime`/`getPlaywright`/`runCommand`(对上游 diff grep 这三个名字为空)。merge-tree 里 service 是 "changed in both" 但干净合并。`BrowserUsePanel.tsx` fork 没改过。 |
| `154b3b14` #1677 `CLAUDE_CODE_ENTRYPOINT: 'claudecodeui'` | **coexists** | 只在 `buildClaudeSdkEnv()` 加一行 (上游 `claude-runtime.provider.ts:293`, HEAD :350-356)。fork 的 `docs/fork-customizations.md` 对 `CLAUDE_CODE_ENTRYPOINT`、`buildClaudeSdkEnv` 都无记录;自动合并干净。注意 `...hostEnv` 在它后面,所以宿主环境变量仍可覆盖(上游测试也这么断言)。 |
| `3491cf9f` #1597 移动端选项面板加 Fork | **coexists** | 改 `SidebarSessionItem.tsx`: 加 `GitBranch` 图标、`useSessionForkingProviders()` 和 `canFork` 守卫、移动端 sheet 里的 "Fork session" 按钮。fork 条目 #23 的前端入口是**输入框命令菜单(Clear)和消息上的 fork 控件**,并明确 "not a sidebar action";`SidebarSessionItem.tsx` 在 fork 自 base 起无改动 (`git log c17c2f6d..HEAD` 仅有两个 sync merge commit)。条目 #1(紧凑移动侧栏)改的是 `SidebarFooter/Header/Content`,不碰 session sheet。`canFork` 规则 (`onFork && forkable.has(provider) && !isProcessing`) 与桌面 `SessionOptions.tsx:72-73` 完全一致。 |
| `a11e469a` #1602 软键盘 Enter 换行 | **coexists**(见下详述) | |
| `383e4f1a` #1683 token 数不换行 | **coexists**(见下详述) | |
| `fc2de9ff` #1693 双击标题重命名 | **coexists** | 同在 `SidebarSessionItem.tsx`: 标题 `onDoubleClick` → `onStartEditingSession(...)`,并在行 `onClick` 里 `if (event.detail > 1) return;`。fork 没改过该文件,无冲突。与条目 #1 的 "tap the mobile header title" 无关(那是顶部标题,不是会话行)。 |
| #1698 前端部分 | **coexists**,但 AskUserQuestionPanel 需手工合并 | `PermissionRequestsBanner.tsx`: 干净合并 (fork 只加了 `sessionTitle` 4 行);`ChatComposer.tsx` 加 `providerLabel={providerLabel}` —— HEAD 已有 `providerLabel: string` prop (ChatComposer.tsx:67),且与 fork 的 `sessionTitle={sessionTitle}` 相邻行,merge-tree 里是干净的 hunk。`useChatComposerState.ts` 的变化其实来自 #1602 (见下),不是 #1698。 |

### #1683 vs 条目 #28 (重点)

- 上游实际改动**只有** `TokenUsageSummary.tsx`: 活动图标 `grid` → `hidden ... sm:grid`(小屏隐藏),并把 `formatTokenCount` 阈值移到进位点 (`999_500`, `9_950`) + `WorkflowPanel.tsx` 同理 + 新测试。`ChatComposer.tsx` 里**没有** #1683 的改动 (上游对 `ChatComposer.tsx` 的唯一改动是 `providerLabel` 一行,属 #1698)。
- 条目 #28 改的是 `ChatComposer.tsx:535` 的**右侧簇** (`flex min-w-0 flex-1 ... justify-end`) 和 `ComposerModelMenu.tsx:94` 的模型按钮 (`min-w-0`)。`TokenUsageSummary` 在**左侧工具簇**里 (`ChatComposer.tsx:500`,在 `PromptInputTools` 内),fork 从未改过它 (`git diff c17c2f6d HEAD -- TokenUsageSummary.tsx` 为空)。
- 因此两者作用在不同容器、互不覆盖。#1683 让左簇在手机上少占约一个图标宽度和一两个字符;#28 让右簇不能换行、模型胶囊让位。二者叠加只会让手机上更不容易挤。**#28 不能退役**: 上游 commit message 说它没改 wrap 行为 ("without touching the wrap behaviour usePermissionNameFit relies on"),而右簇的 `flex-1 min-w-0` 防换行逻辑仍然只有 fork 有。
- 判定: **coexists**,无行为冲突。

### #1602 vs 条目 #32 (重点)

- #1602 改 `useChatComposerState.ts` 的**主输入框** keydown: 在 `!sendByCtrlEnter` 的「纯 Enter 提交」分支加 `&& !isSoftKeyboardEnvironment()` (`matchMedia('(pointer: coarse)')`)。HEAD 对应处在 `useChatComposerState.ts:1427` 附近;fork 在该函数的 Enter 逻辑上**无改动** (对 fork diff 过滤 Enter/sendByCtrlEnter 无结果),merge-tree 里两个 hunk (`@@ -203` 新增函数、`@@ -1424` 条件) 都是干净的。
- #32 改的是**问题面板 "Other" 输入框**自己的 `onKeyDown`,并 `stopPropagation()` (`AskUserQuestionPanel.tsx` textarea 的 onKeyDown)。它与主输入框是不同的 DOM 元素、不同的处理器,不会出现「两个 Enter 处理器」同时触发。
- 行为关系: 两边的方向一致 —— 都把「纯 Enter」让给换行。一个值得知道的差异: #32 在 Other 框里推进/提交要用 Ctrl/Cmd+Enter,而触屏软键盘打不出 Ctrl+Enter,所以触屏用户只能点 Next/Submit 按钮 (按钮提示文案仍显示 `Ctrl+Enter`)。这是 fork 条目 #32 既有的取舍,不是 #1602 引入的。
- 判定: **coexists**,无行为冲突。

---

## 3. 自动合并但可能语义有误的地方

1. **全屏标题回退文案写死** — `AskUserQuestionPanel.tsx:476`: `title={sessionTitle || 'Claude needs your input'}`。上游把头部文案参数化为 `{{agent}} needs your input`,OpenCode 提问时头部显示 "OpenCode needs your input",但会话无标题时全屏标题仍写 "Claude"。建议改成同一个 `t('chat:agentPrompts.needsInput', { agent: agentLabel || 'Claude', defaultValue: ... })`。(这是 fork 自己的行,不在冲突块内,合并工具不会提醒。)
2. **Dismiss 文案要加在 fork 的 `footer` 常量里** — 上游把 Skip 按钮文案改成 `answersAsLabelLists ? t('chat:agentPrompts.dismiss') : isSingle ? skipOne : skipAll`,但这在**上游的内联 footer** 里,冲突块 5 里我们丢掉了那段。fork 的 `footer` (`AskUserQuestionPanel.tsx:204`) 仍是 `{isSingle ? t('chat:misc.skipOne') : t('chat:misc.skipAll')}`。需手工把 Dismiss 三元套进去,否则上游测试 `opencodePermissionPrompts.test.tsx` (`getByText('Dismiss')`、`queryByText('Skip all') === null`) 会失败。全屏和内联都共用这个 `footer`,一处改两处生效。
3. **Next/Submit 提示 `keyHint`** — fork 的 `keyHint = isOtherOn ? 'Ctrl+Enter' : 'Enter'` (:184)。上游问题用 `q.custom === false` 时 `isOtherOn` 为 false,不受影响;但要确保 `toggleOther` / `isOtherOn` 在 `custom:false` 时不会被置 true(上游已给 `0` 键和按钮加守卫,这两处是干净合并的)。
4. **上游测试对 fork 面板的假设** — `opencodePermissionPrompts.test.tsx` 期望 "OpenCode needs your input"、`Next`/`Submit` 文本、无 `Other...`。fork 面板的 `Next`/`Submit` 按钮文本不变 (footer :234, :245 前的文本),满足;"Other..." 需要块 5 的守卫才满足。
5. **`handleSubmit`/`handleSkip` 里的 `setIsFullscreen(false)`** — 手工合并块 3/4 时容易只留一边。上游 label-lists 分支有提前 `return`,如果 `setIsFullscreen(false)` 放在分支之后,OpenCode 提问提交后全屏不会关。必须放在最前面。
6. **`PermissionRequestsBanner.tsx`** — 自动合并后 `t` 已由 `useTranslation()` 提供 (:41),上游新增的 `t('chat:agentPrompts.alwaysAllow')` 可用。fork 只加了 `sessionTitle`,与 `agentLabel={providerLabel}` 在同一个 `<CustomPanel>` 上并列,不冲突。
7. **fork 测试 `askUserQuestionPanel.test.tsx`** — 它只覆盖 "Other" 多行 / Ctrl+Enter,未断言头部文案或 Skip 文案,所以上述改动不会让它失败;但它渲染面板时没传 `agentLabel`,头部默认回退 "Claude" (`agentLabel || 'Claude'`),行为不变。
8. **locale 键对齐** — 上游只给所有 locale 加了 `agentPrompts`;fork 的 `antigravityPermissions` 只在 en/es/fr/ko/zh-CN 存在 (其他 locale 的 HEAD 里为 0,grep 确认)。这是 fork 既有状态,不是本次合并带来的新缺口。

---

## 4. 给维护者的开放问题

1. 全屏标题回退文案 (第 3 节第 1 项) 是否顺手改成走 `agentPrompts.needsInput`? 这会让 fork 条目 #11 多一行说明;不改则 OpenCode 提问在无标题会话的全屏里仍写 "Claude"。
2. 条目 #11 / #32 的 "On upstream conflict" 现在可以补一句: 上游 #1698 在同一文件加了 `agentLabel`、`custom`、label-lists,合并时 "Other" 按钮和 textarea 要保留 fork 版样式并套上 `q.custom !== false`。是否同步更新条目 (项目约定要求同一任务内更新)?
3. 「无法判断」: 本次没跑任何测试 / typecheck (任务限定只读),所以第 3 节里「干净合并」的结论只来自 merge-tree 文本,没有编译验证;合并后应跑 `npm run typecheck` 和 `npx vitest run src/modules/chat/tests/`。
4. 无法判断: `BrowserUsePanel.tsx` 上游改动 +149 行是否与 fork 的 browser-use 文档 `docs/browser-use.md`(未跟踪文件)描述一致 —— 该文档未纳入本次材料范围。
