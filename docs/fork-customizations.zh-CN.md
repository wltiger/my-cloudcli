# Fork 自定义清单

**本 fork：** [`wltiger/my-cloudcli`](https://github.com/wltiger/my-cloudcli)（`origin` 远端）。**官方上游：** [`siteboon/claudecodeui`](https://github.com/siteboon/claudecodeui)（`upstream` 远端）。`main` 分支跟踪 `upstream/main`，保持干净镜像；本 fork 的所有工作——包括下面列的全部内容——都在 `dev` 分支上。完整的远端/分支/同步配置见 `docs/agents/issue-tracker.md`；具体的同步操作步骤见 `docs/upstream-sync.md`。

记录本 fork（`wltiger/my-cloudcli`）相对官方上游（`siteboon/claudecodeui`）的所有故意偏离点。以后同步 `upstream/main` 时，如果合并冲突（或者发现某处行为莫名变了）撞到下面列的文件，先查对应条目，再决定：保留自己的版本、在官方新代码上重新套一遍自己的改动，还是官方已经原生解决了这个问题、直接放弃这条自定义。

这不是待办清单——未完成的后续工作看仓库的 issue tracker（`docs/agents/issue-tracker.md`）。这份文件只负责记录"这里有个偏离点，以及为什么"。

## 1. 移动端紧凑侧边栏

**涉及文件：** `src/constants/config.ts`、`src/components/sidebar/view/subcomponents/SidebarFooter.tsx`、`SidebarHeader.tsx`、`SidebarContent.tsx`

**为什么改：** 隐藏移动端的 Report Issue/Discord 链接，标题改为点击直接打开 Settings，给项目列表腾空间。

**同步官方时怎么办：** 保留我的。通过 `VITE_COMPACT_MOBILE_SIDEBAR` 开关控制（默认关闭），改动是在现有代码外面包一层条件判断，不是替换，冲突面小。冲突了就在官方改动过的代码外面重新套一遍条件分支。

## 2. 侧边栏收藏过滤

**涉及文件：** `src/components/sidebar/utils/utils.ts`、`hooks/useSidebarController.ts`、`view/Sidebar.tsx`、`view/subcomponents/SidebarContent.tsx`、`SidebarHeader.tsx`、`src/components/settings/hooks/useSettingsController.ts`

**为什么改：** 自动发现的项目一多，侧边栏就很乱，加个星标图标开关，只看收藏过的项目，选择记住不用重复开。

**同步官方时怎么办：** 保留我的。附带提一句：里面对 `useSettingsController.ts` 的修改顺便修了一个真实 bug（保存设置会覆盖整个 `claude-settings` 对象，把不属于这个面板的字段静默清空）——这个修复是通用的正确性修复，不是个人偏好，方便的话可以考虑单独提给官方。

## 3. 聊天阅读外观设置（间距 / 字号 / 宽度）

**涉及文件：** `src/components/chat/utils/chatSpacing.ts`、`chatTypography.ts`、`hooks/useChatSpacing.ts`、`useChatTypography.ts`、`view/subcomponents/ChatMessagesPane.tsx`、`MessageComponent.tsx`、`ToolGroupContainer.tsx`、`Markdown.tsx`、`ChatComposer.tsx`、`QueuedMessageCard.tsx`、`chat/tools/components/PlanDisplay.tsx`、`ToolErrorDisplay.tsx`、`ContentRenderers/MarkdownContent.tsx`、`QuestionAnswerContent.tsx`、`InteractiveRenderers/AskUserQuestionPanel.tsx`、`src/components/settings/hooks/useSettingsController.ts`、`settings/view/Settings.tsx`、`settings/view/tabs/AppearanceSettingsTab.tsx`、`src/components/quick-settings-panel/view/QuickSettingsContent.tsx`、`ForkQuickSettings.tsx`、`QuickSettingsChatSpacingRow.tsx`、`QuickSettingsChatFontRow.tsx`、`QuickSettingsChatWidthRow.tsx`、`src/i18n/locales/{en,zh-CN}/settings.json`

**为什么改：** 三个管"聊天读起来舒不舒服"的旋钮，共用同一套存储+事件机制、同一对入口（Settings 的 Appearance 标签页 + Quick Settings 面板）。三个默认值都等于官方现状，所以装上不动任何设置，界面和官方一模一样。

- **消息间距**（宽松/紧凑/无，只影响移动端）：手机屏幕小，聊天气泡左右固定的留白很浪费空间。因为这个设置在 `sm:` 断点以上是空操作，Quick Settings 那一行下面留了一句小字说明"只影响窄屏"——而不是在桌面端直接隐藏，隐藏会让人以为设置被删了。
- **阅读字号**（Small/Medium/Large/X-Large → `prose-sm`/`prose-base`/`prose-lg`/`prose-xl`，默认 Small = 官方的 14px）：官方正文在大显示器上偏小，AskUserQuestion 更糟——它内嵌模式的选项**说明**只有 11px。档位只管**阅读文字**：Markdown 正文（消息、Plan、工具错误、工具返回的 markdown）和 AskUserQuestion 的问题/选项/说明。代码块、diff、工具卡片摘要行、时间戳和徽章一律不动——代码编辑器本来就有自己的 `codeEditorFontSize`。AskUserQuestion 已有的全屏尺寸（19/18/15px）保持固定不受档位影响，且每一档内嵌值都严格小于它，内嵌永远不会反超全屏。
- **内容宽度**（标准/宽/更宽/撞满，默认标准 = 官方的 `max-w-[54.25rem]`）：侧边栏固定占 288px，868px 的内容列在 2560 屏上只用了 38%，3440 屏上只用了 28%。用户气泡最上面那个上限（`xl:max-w-xl`）也跟着档位走，免得 3000px 的列里孤零零一个 576px 气泡。只动最上面这一档：`xl` 以下列宽还没顶到自己的上限，`sm:max-w-[85%] md:max-w-md lg:max-w-lg` 这套阶梯比百分比更贴切——一刀切成 `max-w-[66%]` 反而会让 `md` 断点下的气泡**变窄**（那里列宽只有 448px，气泡本来是能占满的）。每一档的值约等于该档列宽的 66%，而这正是标准档下 `xl:max-w-xl` 算出来的比例，所以标准档和改动前一模一样。

两个值得记住的设计点：`Markdown.tsx` 是 prose 档位的唯一入口（调用点只需删掉自己的 `prose-sm`，显式传入的尺寸——比如全屏那处的 `prose-lg`——仍然优先）；缩放机制没有用 CSS `zoom`，因为 `useComposerMenuAnchor.ts` 靠 `getBoundingClientRect()` + `window.innerWidth` 算 fixed 菜单坐标，祖先带 `zoom` 会把这套算法弄错。历次迭代都并进这一条。对应 issue：[#17](https://github.com/wltiger/my-cloudcli/issues/17)。

**同步官方时怎么办：** 保留我的。纯 opt-in 设置项，加法改动。`QuickSettingsContent.tsx` 里 fork 的全部痕迹只有两行——一行 `ForkQuickSettings` 的 import，一行贴在面板 body 最末尾的 `<ForkQuickSettings />`。fork 自己加的快捷设置全部放在 `ForkQuickSettings.tsx`（官方没有这个文件）里，所以冲突后只要把那两行放回去就行，别再把新设置塞进官方自己的分组里。内容列的 `max-w` 在 `ChatMessagesPane.tsx`、`ChatComposer.tsx`（三处）、`QueuedMessageCard.tsx` 里是重复的——官方改了其中一处的话，几处必须一起同步，否则输入框会和消息列对不齐。

⚠️ **i18n 策略在这里变了。** 这一条原来写的是：所有文案用 `t(key, '英文兜底')`、不动 `src/i18n/locales/**`，让翻译文件保持零冲突面。现在不再成立：`en` 和 `zh-CN` 的 `settings.json` 已经带上了 `appearanceSettings.chatSpacing` / `chatFontSize` / `chatWidth` 这些键，中文界面因此是完整的。曾经考虑过用"fork 专属 namespace"来保持零冲突，最后否决了——`src/i18n/config.js` 把每个 namespace 的 import、`resources` 条目、`ns` 条目全部写死，新增 namespace 的冲突面**比**直接加 JSON 键**更大**。这两个文件冲突时，两边的键都保留；其余九种语言仍然一行没动，走内联英文兜底。

## 4. 模型名智能提炼 + 选择器加宽

**涉及文件：** `src/components/chat/view/subcomponents/ComposerModelMenu.tsx`、`chat/utils/modelLabel.ts`（含测试）

**为什么改：** 通过 Claude Code CLI 直接设置的模型（不是通过 CloudCLI 自己的切换器）会显示原始的、有时被截断的内部模型 ID，看不出是什么模型。

**同步官方时怎么办：** 保留我的，但如果官方在这块也上了功能，先重新读一遍 `docs/adr/0001-strict-model-label-fallback.md`——这条 ADR 明确记录了为什么拒绝用模糊/子串匹配，改用"严格匹配已知格式，匹配不上就老实显示原文"。对比一下思路，不要想当然认为自己的还是更优的。

## 5. 离线可用的 App 壳（Service Worker 缓存策略反转）⚠️ 优先重新评估，不要无脑保留

**涉及文件：** `public/sw.js`、`src/components/settings/view/tabs/AboutTab.tsx`

**为什么改：** CloudCLI 本来就有 PWA 基础设施，但实际上并不能离线用——Service Worker 故意不缓存 HTML/JS 页面壳，服务端也显式给 HTML 加了 `no-cache`，注释写的是"防止 service worker 出问题"。这个 fork 推翻了这个决定：改成缓存优先的页面壳 + 手动"刷新离线缓存"按钮，不做自动过期检测。

**同步官方时怎么办：** **这份清单里优先级最高、必须重新评估的一条。** 这条直接推翻了官方一个刻意做出的设计决定。如果官方以后动了 `public/sw.js` 或者 `server/index.ts` 里的 `Cache-Control` 响应头，先重新读一遍 `docs/adr/0002-cache-first-app-shell-manual-refresh.md` 再决定要不要重新套用自己的改动——官方有可能刚好解决了当年他们不敢缓存的那个问题，这样的话取舍结论会变。

## 6. PWA / 标题名字统一改成 "CloudCLI"

**涉及文件：** `index.html`、`public/manifest.json`、`src/utils/pageTitleNotification.ts`、`src/components/sidebar/view/subcomponents/SidebarProjectList.tsx`

**为什么改：** 之前 App 名字有三个不一致的写法（manifest/标题写的是"CloudCLI UI"，iOS 专用的 meta 标签写的是更旧的"Claude UI"），统一成产品现在的名字"CloudCLI"。

**同步官方时怎么办：** 保留我的，但先查一下——如果官方以后也把名字统一了，这条自定义可能就完全多余了，直接删掉即可。

## 7. 记住上次打开的 session（仅限已安装的 PWA）

**涉及文件：** `src/hooks/useDeviceSettings.ts`、`src/hooks/useProjectsState.ts`

**为什么改：** 已安装的 PWA 每次打开都会走 `manifest.json` 里的 `start_url`("/")，永远回到空白的"选项目"页面，而不是上次在看的地方。

**同步官方时怎么办：** 保留我的。通过检测 `display-mode: standalone` 做成 opt-in，普通浏览器标签页不受影响。

## 8. 版本号显示 git SHA + 构建时间

**涉及文件：** `vite.config.js`、`src/vite-env.d.ts`、`src/components/settings/view/tabs/AboutTab.tsx`、`server/index.ts`

**为什么改：** 有了第 5 条那个"缓存优先离线可用"之后，很难分清现在跑的是刚构建的新版本还是缓存住的旧版本。在版本号旁边加上这次构建的 git SHA + 时间戳，前后端都有。

**同步官方时怎么办：** 保留我的。设计上刻意不碰 `package.json` 的 `version` 字段（这个字段继续完全跟官方保持一致，由官方拥有），本来就是为了把冲突面降到接近零。

## 9. `.claude/` 目录选择性纳入 Git（CLAUDE.md + skills/）

**涉及文件：** `.gitignore`

**为什么改：** 官方把整个 `.claude/` 目录都忽略掉了。这个 fork 专门开了两个例外：`.claude/CLAUDE.md`（本仓库给 Claude Code 用的项目说明，为什么放在这个位置而不是根目录的 `CLAUDE.md`——因为官方 `.gitignore` 里根目录的 `CLAUDE.md` 也被忽略了——见这份文件开头的说明）和 `.claude/skills/`（项目级 Claude Code 技能，比如 `sync-upstream` 这个）。这两个例外让它们能跟着 fork 走，而不是只存在于本地。`.claude/` 下面别的东西（`settings.local.json` 等）继续忽略——那些是真正的个人本地状态。

**同步官方时怎么办：** 保留我的。如果官方在同一个 `# AI specific` 区块里加了新的忽略规则，要把那两行"取消忽略"规则（`!.claude/CLAUDE.md`、`!.claude/skills/` + `!.claude/skills/**`）重新放到**所有**可能匹配到这两个路径的规则**后面**——gitignore 的"取消忽略"规则只有排在更前面的规则之后才会生效，现有的那条裸 `CLAUDE.md` 规则如果排在取消忽略规则前面，也会把 `.claude/CLAUDE.md` 重新忽略掉。

## 10. Web Push 的 VAPID subject 改成 APNs 能接受的值

**涉及文件：** `server/modules/notifications/vapid-keys.service.ts`

**为什么改：** 官方把 VAPID 的 `sub` 声明硬编码成了 `mailto:noreply@claudecodeui.local`。`.local` 是保留 TLD，而 APNs 会校验这个声明，于是每一条推送都被以 `403 BadJwtToken` 拒绝——**iOS 设备从来没收到过任何一条通知**。在真实环境上验证过（真机已"添加到主屏幕"并订阅成功）：同一条订阅、同一套密钥，只改 subject——`.local` → 403，`https://cloudcli.ai` → 201，换成真实的 `mailto:` → 201。Chrome 的 FCM 和 Mozilla 的 Autopush 都不校验这个域名，所以这个问题只在 iOS 上暴露，官方一直没发现。

**同步官方时怎么办：** 如果官方自己修了，就用官方的——任何可路由的 `mailto:`/`https:` 值都行，具体填什么字符串不重要。官方没修就保留我的、重新应用一遍。这条属于纯 bug 修复，不是 fork 的偏好，值得单独给官方提个 PR；官方一旦修了，这条就可以从清单里删掉。

## 11. 聊天消息和 AskUserQuestion 的全屏阅读

**涉及文件：** `src/shared/view/ui/FullscreenSurface.tsx`（新增）、`src/shared/view/ui/index.ts`、`src/components/chat/view/subcomponents/MessageFullscreenControl.tsx`（新增）、`src/components/chat/view/subcomponents/MessageComponent.tsx`、`src/components/chat/tools/components/InteractiveRenderers/AskUserQuestionPanel.tsx`、`src/i18n/locales/*/chat.json`

**为什么改：** 手机上聊天区太窄，长回复读起来费劲；AskUserQuestion 的选项标题和说明被挤到根本分不出哪个是哪个——而在外面用手机回答这类提问，恰恰是这个面板最主要的使用场景。两处共用一个 `FullscreenSurface`（portal 到 body 的 `inset-0` 面板，Esc 关闭，锁 body 滚动，带安全区内边距）：消息复制按钮旁边加一个全屏按钮，AskUserQuestion 头部加一个（进全屏时同时放开选项列表的 `max-h-48` 并放大字号）。桌面端也显示，同一套代码，不做断点分支。答完自动退出全屏，状态不持久化。全屏容器还带了：标题栏里的复制按钮、下滑关闭手势（只在内容滚到顶部时才生效，不会跟滚动打架）、以及 `max-w-3xl` 的最大宽度，避免宽屏桌面上一行拉太长读不动。AskUserQuestion 还额外把 Skip/Back/Submit 那条操作栏固定在视口底部（走全屏容器的 `footer` 插槽——用 `sticky` 会被卡片自己的 `overflow-hidden` 困住不生效），并且标题栏显示会话名，通过 `PermissionPanelProps` 上新增的可选字段 `sessionTitle` 一路传下来。

**同步官方时怎么办：** 保留我的。`FullscreenSurface` 是全新文件，官方没有对应物；`MessageComponent.tsx`（一行 import + 控件行里一项）和 `AskUserQuestionPanel.tsx`（state、头部按钮、底部的 `panel` 变量和包装、几处 `isFullscreen ?` 三元 class）改动都很小，官方就算重写了这两个文件也容易重新应用。

## 12. 触屏能打开的文件树菜单 + 复制相对路径

**涉及文件：** `src/components/file-tree/view/FileContextMenu.tsx`、`FileTreeNode.tsx`、`FileTreeList.tsx`、`FileTreeBody.tsx`、`FileTree.tsx`、`src/components/file-tree/hooks/useFileTreeOperations.ts`、`utils/fileTreeUtils.ts`、`src/i18n/locales/*/common.json`

**为什么改：** 官方的文件树菜单只挂在 `onContextMenu` 上，触屏设备等于**整个菜单都打不开**——重命名、删除、下载、新建文件/文件夹、复制路径全没了。这里故意做了两个入口，方便真机上比一比再决定要不要砍掉一个：长按 500ms（手指移动超过 10px 就放弃，不影响滚动），以及每行末尾一个只在 `md:` 以下渲染的 `⋮` 按钮。两者共用同一份菜单状态；`FileContextMenu` 因此多支持了函数式 children，让每一行能自己渲染触发按钮而不用接管菜单状态。detailed 视图里手机上 `⋮` 占掉权限列——那一列本来就窄到放不下 `rw-rw-rw-` 加一个按钮。另外在官方的绝对路径"复制路径"旁边加了"复制相对路径"（两个平级菜单项，不做二级菜单），并且两个都改走项目自己的 `copyTextToClipboard`——官方直接调 `navigator.clipboard`，成功提示还是同步弹的，复制失败时会同时看到"复制路径失败"和"路径已复制到剪贴板"。

**同步官方时怎么办：** 保留我的，但先看一眼入口：官方要是自己加了触屏入口，就用官方的，把重复的那个删掉。剪贴板兜底和重复 toast 属于纯 bug 修复、不是 fork 偏好，值得给官方提 PR。注意这条**动了** `src/i18n/locales/*/common.json`（在官方已有的 `fileTree.context` 块里加了两个 key），和第 3 条刻意只用 `t(key, '英文兜底')` 的做法不一样——那个块是官方的，这里大概率会冲突，重新把两个 key 加回去即可。

## 13. 从聊天标题进入的跨项目会话快切

**涉及文件：** `src/lib/commandPaletteEvents.ts`、`src/components/command-palette/ForkRecentSessions.tsx`、`CommandPalette.tsx`、`src/components/main-content/view/subcomponents/MainContentTitle.tsx`、`src/utils/api.js`、`server/modules/providers/provider.routes.ts`、`services/sessions.service.ts`、`server/modules/database/repositories/sessions.db.ts`

**为什么改：** 官方的命令面板本来就能切会话，但唯一的触发方式是 Cmd/Ctrl+K——sidebar 里那个看着像按钮的东西其实是 `pointer-events-none` 的 `<kbd>` 徽章，而且 `md:` 以下根本不显示。于是手机上面板完全打不开，切会话只能开 sidebar。现在点聊天标题会直接把面板开在 Sessions 页，顺带也让面板的文件/commit/分支搜索在触屏上能用了。官方的 Sessions 分组只列当前项目（和 sidebar 是同一批），所以另加了一个 fork 自有的「Recent sessions (all projects)」分组来回答「我刚才在哪」，并且会和官方已经列出的行去重。切换本身就是 `navigate('/session/:id')`——已有的会话解析逻辑会自己找到所属项目，所以跨项目不需要额外的切项目代码。后端加了 `getRecentSessions(limit)`（`getAllSessions` 既没排序也没上限）和 `GET /api/providers/sessions/recent`；`sessions/running` 用不上，它是故意做成只返回状态的。

**同步官方时怎么办：** 保留我的。上游改动刻意只有三处：`CommandPalette.tsx` 里一个监听 fork 自定义 `cloudcli:open-command-palette` window 事件的 `useEffect`、官方 Sessions 分组后面一个 `<ForkRecentSessions />`、以及 `MainContentTitle.tsx` 里标题变成按钮。列表、hook、事件全部在 fork 自有文件里，冲突后把这三处放回去即可。用 window 事件就是为了让面板不需要多一个 prop 或 context 句柄；官方以后要是自己做了外部打开的机制，就把监听删掉改调官方的。文案用 `t(key, '英文兜底')`，没动 `src/i18n/locales/**`（和第 3 条一致）。会话没有存名字时行标题会退化成 session id——那是 #9 记录的命名问题，不是这条引入的。

## 14. Browser 运行时装到自己管理的目录

**涉及文件：** `server/modules/browser-use/browser-use.service.ts`

**为什么改：** 官方的 `installRuntime()` 用 `cwd: process.cwd()` 跑 `npm install --no-save --no-package-lock playwright`，但 `getPlaywright()` 是从模块自身所在位置去 `require('playwright')`。全局安装的 CloudCLI 下这是两棵完全不同的树：包会装到用户当时启动 CLI 的那个目录（多半是用户主目录），而从 `<npm root -g>/@cloudcli-ai/cloudcli/dist-server/server/modules/browser-use/` 往上找 `node_modules` 永远走不到那里。结果就是装其实成功了，设置页却一直显示 `Playwright: missing`，"Install Runtime" 按钮点多少次都像没反应——每次只是往同一个够不着的地方重装一遍。现在固定装到 `~/.cloudcli/browser-use/runtime`（和已有的 `profiles/` 并列），并先写一个私有 `package.json`，免得 npm 往上找项目根、把上层目录当成自己的工程；`getPlaywright()` 则先按模块自身位置解析，找不到再从这个目录解析。`runCommand()` 为此多了一个 `cwd` 参数。manifest 既然是自己的，去掉 `--no-save --no-package-lock` 就没有副作用，留着 lockfile 重装还更快。

**同步官方时怎么办：** 这属于纯 bug 修复而不是 fork 偏好，值得给官方提 PR，官方收了就把这条删掉。在那之前保留我的，但要把 `installRuntime()` 和 `getPlaywright()` 当成一对看：两边必须配套才成立，官方要是改了其中一个，就两半一起重新应用，别只合一边留另一边。如果官方改成把 playwright 作为正式依赖发布，那这条整条丢掉即可——第一级解析本来就覆盖那种情况。

## 15. 移动端把标签切换栏收成一个菜单

**涉及文件：** `src/components/main-content/view/subcomponents/MainContentTabMenu.tsx`、`MainContentTabSwitcher.tsx`、`MainContentHeader.tsx`、`src/shared/view/ui/ActionMenu.tsx`

**为什么改：** 官方把标题和标签 pill 放在同一行。`lg:` 以下 pill 本来就只剩图标，但数量不固定——4 个内置，加可选的 Browser 和 Tasks，再加每个已启用插件一个——所以 375px 的手机上这排要占 148–220px，标题只剩不到 150px（6 个标签时实测 51px）。官方自己的缓解手段是给这排加横向滚动和左右渐变遮罩，能挡住溢出，但一点宽度都没还给标题。这在本 fork 里比在官方那边更亏，因为第 13 条把聊天标题变成了跨项目会话快切入口，挤窄标题等于同时挤掉一个导航入口。现在 768px 以下——用的就是 header 已经在给汉堡按钮用的那个 `isMobile`——整排收成一个约 48px 的 pill，里面是当前标签的图标加一个箭头；点开是下拉菜单，按原顺序列出全部标签，插件组前面加分隔线，当前项高亮并标 `aria-current`。标题实测宽度从 51px 变成 217px。桌面端一点没动，滚动和渐变遮罩都原样保留。

**同步官方时怎么办：** 保留我的。上游足迹刻意做得极小且全是新增：`MainContentTabSwitcher.tsx` 里一个 prop 加一个提前 `return`、`MainContentHeader.tsx` 里一行 prop 透传、以及 `ActionMenu` 上四个可选 prop（`triggerIcon`、`showChevron`、菜单项的 `iconNode` 和 `isActive`）——它原有的两处调用一个都没用到。菜单代码全在 fork 自有的 `MainContentTabMenu.tsx` 里，冲突后把那几处放回去即可。那个提前 `return` 是**故意**放在标签列表构造完之后的：两种渲染共用同一份列表，官方以后加内置标签，移动端菜单自动就有了——重新应用时别改这个位置。下拉用的是 `ActionMenu` 的 `portal` 模式，也是故意的：header 那个标签槽是 `overflow-hidden`，绝对定位的菜单会被裁掉；官方要是重构了那个容器，先确认裁剪问题再考虑换掉 portal。文案用 `t(key, { defaultValue })`，没动 `src/i18n/locales/**`（和第 3、13 条一致）。官方哪天自己做了移动端标签方案，就用官方的，把这条删掉。

## 16. 推送通知按 session 收敛成一条，打开会话时清掉

**涉及文件：** `server/modules/notifications/services/notification-orchestrator.service.js`、`public/sw.js`、`src/components/app/AppContent.tsx`

**为什么改：** 官方给每条推送打的 tag 是 `provider:sessionId:code`，所以一个 session 只要依次触发权限请求、stop、error 三种事件，手机通知中心就会永久堆着三条通知——包括你已经在 APP 里处理过的那些，谁都不会自动消失。这个 fork 在有 `sessionId` 时把 `code` 从 tag 里去掉（变成 `provider:sessionId`），这样系统原生的同 tag 替换机制（`renotify: true` 本来就开着）就会让新推送到达时自动顶掉同一 session 的旧通知，永远只留最新一条。在 APP 里打开该 session 时，另外会给 Service Worker 发一条 `{ type: 'CLEAR_SESSION_NOTIFICATIONS', sessionId }` 消息，把所有 `data.sessionId` 匹配的已显示通知关掉——这是给 tag 替换机制失效场景（比如推送到达时 SW 处于休眠状态、又赶上 tag 方案变更）兜底的。没有 session 的事件（比如 `push.enabled`）保留 `provider:global:code` 这种 tag，避免互相顶掉。

**同步官方时怎么办：** 保留我的。改动很小很独立：orchestrator 里一处 tag 表达式、`sw.js` 里一个新的 `message` 分支（挨着已有的 `REFRESH_CACHE` 处理）、`AppContent.tsx` 里一个按路由 `sessionId` 触发的 `useEffect`。如果官方重做了推送 payload 或 tag 方案，保留"每个 session 只留一条通知、打开即清"这个行为，照着官方的新结构重新推导 tag/清理逻辑，别把这个功能整个丢掉。

## 17. Codex 模型列表改成实时拉取，不再读一份不会刷新的快照

**涉及文件：** `server/modules/providers/list/codex/codex-models.provider.ts`、`server/modules/providers/services/provider-models.service.ts`

**为什么改：** 官方的 `getSupportedModels()` 只读 `~/.codex/models_cache.json`——这是个不会自己刷新的时间点快照。如果用户把 Codex 走自定义 `model_provider`/中转站（通过 `~/.codex/config.toml` 里的 `model_catalog_json1` 声明），或者干脆缓存本来就旧了，就永远看不到官方新发布的模型——实测验证过：GPT-5.6 Sol/Terra/Luna 是 2026-07-09 正式发布的官方模型，而一份 2026-06-21 抓的缓存里完全没有。`@openai/codex-sdk` 的 JS API 没有对应方法能拿到这个，等价能力只存在于随包分发的 `codex` 二进制自己的 `debug models` 子命令里。这个 fork 现在会去起这个子命令的子进程（复用 `codex-runtime.provider.js` 已经在用的同一个 `@openai/codex` 二进制，通过它 `package.json` 的 `bin` 字段解析路径，保证两边版本一致），解析它的 JSON 输出；失败就退回旧的读缓存文件逻辑，再失败就退回写死的 `CODEX_FALLBACK_MODELS` 列表。同时把 `codex` 加进了 `provider-models.service.ts` 的 `UNCACHED_PROVIDERS`——不然外层那层 3 天磁盘持久化缓存会一直挡住这次刚拿到的新鲜结果，因为一次成功的缓存会被记住远超一个新模型发布的时间跨度。

**同步官方时怎么办：** 这是个纯粹的功能缺口修复，不是 fork 偏好——值得往官方提 PR，官方要是上了等价方案就把这条删掉，最好是官方自己在 SDK 里加一个正经方法，而不是像这个 fork 一样调一个没有文档的 `debug` 子命令（已知风险：未来 `@openai/codex` 版本可能不打招呼就改名或删掉这个子命令）。在那之前保留我的。如果官方因为别的原因（比如他们自己升级 SDK 版本）改了 `codex-models.provider.ts`，把 `fetchLiveCodexModels()` 这段子进程逻辑重新套上去，`UNCACHED_PROVIDERS` 里的 `codex` 也留着。

## 18. Claude 模型列表改成走 SDK 实时拉取，不再是写死的列表

**涉及文件：** `server/modules/providers/list/claude/claude-models.provider.ts`

**为什么改：** `getSupportedModels()` 里本来就写好了一段真正调 SDK 的代码，但被注释掉了：调 `query()` 拿到的 `Query` 实例会往 `~/.claude/projects/` 下面落一份会话 jsonl，然后被侧边栏自己的项目发现机制捡到，变成一个多余的工作区。`@anthropic-ai/claude-agent-sdk`（装的已经是最新的 0.3.227）后来加了个 `persistSession: false`，官方文档写的就是给"不需要保留历史的临时/自动化调用"用的。实测验证了两次——先测原始 SDK 调用，再测真正的 `ClaudeProviderModels` 类——每次都对比 `~/.claude/projects/` 改动前后的目录列表：两次都没多出新会话，耗时大概 2.4–3.3 秒。实时拿到的列表跟写死的兜底列表不只是新旧的区别，内容也真不一样：少了旧列表里单独的 "Opus" 和 "Sonnet[1m]"，多了 `resolvedModel` 字段和更细的 effort 档位。

**同步官方时怎么办：** 同样是把之前写好但被禁用的代码修好，不是 fork 偏好——值得往官方提 PR，官方修了就把这条删掉。在那之前保留我的。`CLAUDE_FALLBACK_MODELS` 还留着当最后一道兜底（没登录/调用出错的情况），官方如果改这份列表的内容，跟实时拉取这条逻辑互不相关，正常合并就行。

## 19. New Session 选择器只列出已连接的 provider

**涉及文件：** `src/components/chat/view/subcomponents/ProviderSelectionEmptyState.tsx`

**为什么改：** 官方的 New Session 模型选择器不管 claude/cursor/codex/opencode 这四个 provider 有没有真正安装/登录，一律全部列出来——选了个没连接的，只会在真正跑会话的时候才报错。这个 fork 接入了已有的 `useProviderAuthStatus` hook（Settings → Agents 页面已经在用），把选择器过滤成只显示 `/auth/status` 返回 `authenticated` 的 provider。检查还没跑完之前先四个都显示，避免"先显示四个、突然收窄成两个"这种闪烁感。

**同步官方时怎么办：** 保留我的——这是个实打实的体验偏好，不是修 bug（官方可能就是故意让未连接的 provider 也可见/可发现，比如方便引导新用户）。如果官方重写了这个文件，把 `useProviderAuthStatus()` 调用、挂载时触发 `refreshProviderAuthStatuses()` 的那个 `useEffect`，还有喂给 `visibleProviderGroups` 的 `connectedProviders`/`isCheckingConnections` 过滤逻辑重新套回去。
