# Fork 自定义清单

**本 fork：** [`wltiger/my-cloudcli`](https://github.com/wltiger/my-cloudcli)（`origin` 远端）。**官方上游：** [`siteboon/claudecodeui`](https://github.com/siteboon/claudecodeui)（`upstream` 远端）。`main` 分支跟踪 `upstream/main`，保持干净镜像；本 fork 的所有工作——包括下面列的全部内容——都在 `dev` 分支上。完整的远端/分支/同步配置见 `docs/agents/issue-tracker.md`；具体的同步操作步骤见 `docs/upstream-sync.md`。

记录本 fork（`wltiger/my-cloudcli`）相对官方上游（`siteboon/claudecodeui`）的所有故意偏离点。以后同步 `upstream/main` 时，如果合并冲突（或者发现某处行为莫名变了）撞到下面列的文件，先查对应条目，再决定：保留自己的版本、在官方新代码上重新套一遍自己的改动，还是官方已经原生解决了这个问题、直接放弃这条自定义。

这不是待办清单——未完成的后续工作看仓库的 issue tracker（`docs/agents/issue-tracker.md`）。这份文件只负责记录"这里有个偏离点，以及为什么"。

标了 ❌ 已废弃 的条目，代码里已经没有了。条目本身保留、编号也不重排，是为了让以后的人知道曾经有过这个偏离、以及它为什么消失——通常是官方自己解决了同一个问题。想把某条捡回来之前，先读它的废弃说明。

## 1. 移动端紧凑侧边栏

**涉及文件：** `src/shared/utils.ts`、`src/components/sidebar/view/subcomponents/SidebarFooter.tsx`、`SidebarHeader.tsx`、`SidebarContent.tsx`

**为什么改：** 隐藏移动端的 Report Issue/Discord 链接，标题改为点击直接打开 Settings，给项目列表腾空间。

**同步官方时怎么办：** 保留我的。通过 `VITE_COMPACT_MOBILE_SIDEBAR` 开关控制（默认关闭），改动是在现有代码外面包一层条件判断，不是替换，冲突面小。冲突了就在官方改动过的代码外面重新套一遍条件分支。这个开关现在和官方自己的 `IS_PLATFORM` 放在同一个文件 `src/shared/utils.ts` 里（v1.37.2 删掉了 `src/constants/config.ts`，把内容挪了过去），所以官方以后再挪这个环境开关模块，这个 flag 跟着一起走就行。

## 2. 侧边栏收藏过滤

**涉及文件：** `src/components/sidebar/utils/utils.ts`、`hooks/useSidebarController.ts`、`view/Sidebar.tsx`、`view/subcomponents/SidebarContent.tsx`、`SidebarHeader.tsx`、`src/components/settings/hooks/useSettingsController.ts`

**为什么改：** 自动发现的项目一多，侧边栏就很乱，加个星标图标开关，只看收藏过的项目，选择记住不用重复开。

**同步官方时怎么办：** 保留我的。附带提一句：里面对 `useSettingsController.ts` 的修改顺便修了一个真实 bug（保存设置会覆盖整个 `claude-settings` 对象，把不属于这个面板的字段静默清空）——这个修复是通用的正确性修复，不是个人偏好。**但还没按 `docs/upstream-pr.md` 的门槛做过 triage** —— 别默认它就该提；门槛的承重问题是"不提对本 fork 有成本吗"，而这条没有。

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

**涉及文件：** `index.html`、`public/manifest.json`、`src/utils/pageTitleNotification.ts`、`src/utils/pageTitle.ts`（含其测试）

**为什么改：** 之前 App 名字有三个不一致的写法（manifest/标题写的是"CloudCLI UI"，iOS 专用的 meta 标签写的是更旧的"Claude UI"），统一成产品现在的名字"CloudCLI"。

**同步官方时怎么办：** 保留我的，但先查一下——如果官方以后也把名字统一了，这条自定义可能就完全多余了，直接删掉即可。到 v1.37.2 为止，浏览器标签页那一半已经缩成一个常量了：官方把标题逻辑抽到了 `src/utils/pageTitle.ts` 的 `getPageTitle()`（顺带新增了"选中会话时标签页显示会话名"这个行为，本 fork 原来写在 `SidebarProjectList.tsx` 里的版本没有），所以现在整个采用官方的函数，只把里面的 `DEFAULT_PAGE_TITLE` 从 "CloudCLI UI" 改成 "CloudCLI"，并同步改 `pageTitle.test.ts` 里的两个断言。以后冲突就重新做这个改名，不要再把标题逻辑写回 fork 这边。

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

**为什么改：** 官方把整个 `.claude/` 目录都忽略掉了。这个 fork 专门开了两个例外：`.claude/CLAUDE.md`（本仓库给 Claude Code 用的项目说明，为什么放在这个位置而不是根目录的 `CLAUDE.md`——因为官方 `.gitignore` 里根目录的 `CLAUDE.md` 也被忽略了——见这份文件开头的说明）和 `.claude/skills/`（项目级 Claude Code 技能，比如 `upstream-sync`、`upstream-pr` 这两个）。这两个例外让它们能跟着 fork 走，而不是只存在于本地。`.claude/` 下面别的东西（`settings.local.json` 等）继续忽略——那些是真正的个人本地状态。

**同步官方时怎么办：** 保留我的。如果官方在同一个 `# AI specific` 区块里加了新的忽略规则，要把那两行"取消忽略"规则（`!.claude/CLAUDE.md`、`!.claude/skills/` + `!.claude/skills/**`）重新放到**所有**可能匹配到这两个路径的规则**后面**——gitignore 的"取消忽略"规则只有排在更前面的规则之后才会生效，现有的那条裸 `CLAUDE.md` 规则如果排在取消忽略规则前面，也会把 `.claude/CLAUDE.md` 重新忽略掉。

## 10. Web Push 的 VAPID subject 改成 APNs 能接受的值

**涉及文件：** `server/modules/notifications/vapid-keys.service.ts`

**为什么改：** 官方把 VAPID 的 `sub` 声明硬编码成了 `mailto:noreply@claudecodeui.local`。`.local` 是保留 TLD，而 APNs 会校验这个声明，于是每一条推送都被以 `403 BadJwtToken` 拒绝——**iOS 设备从来没收到过任何一条通知**。在真实环境上验证过（真机已"添加到主屏幕"并订阅成功）：同一条订阅、同一套密钥，只改 subject——`.local` → 403，`https://cloudcli.ai` → 201，换成真实的 `mailto:` → 201。Chrome 的 FCM 和 Mozilla 的 Autopush 都不校验这个域名，所以这个问题只在 iOS 上暴露，官方一直没发现。

**同步官方时怎么办：** 如果官方自己修了，就用官方的——任何可路由的 `mailto:`/`https:` 值都行，具体填什么字符串不重要。官方没修就保留我的、重新应用一遍。**已 triage，明确决定不上报** —— 见 `docs/pull-requests/PR01-vapid-subject-ios-push.md`。它确实严重（未经修改的装机上，任何 iOS 设备从来没收到过一条推送）、也确实一行就能修，但**对本 fork 零成本**，而这才是决定这类事情的判据。别再用"这个很严重"重开这个话题 —— 那个理由已经提过并被否掉了。官方一旦自己修了，这条就可以从清单里删掉。

## 11. 聊天消息和 AskUserQuestion 的全屏阅读

**涉及文件：** `src/shared/view/ui/FullscreenSurface.tsx`（新增）、`src/shared/view/ui/index.ts`、`src/components/chat/view/subcomponents/MessageFullscreenControl.tsx`（新增）、`src/components/chat/view/subcomponents/MessageComponent.tsx`、`src/components/chat/tools/components/InteractiveRenderers/AskUserQuestionPanel.tsx`、`src/i18n/locales/*/chat.json`

**为什么改：** 手机上聊天区太窄，长回复读起来费劲；AskUserQuestion 的选项标题和说明被挤到根本分不出哪个是哪个——而在外面用手机回答这类提问，恰恰是这个面板最主要的使用场景。两处共用一个 `FullscreenSurface`（portal 到 body 的 `inset-0` 面板，Esc 关闭，锁 body 滚动，带安全区内边距）：消息复制按钮旁边加一个全屏按钮，AskUserQuestion 头部加一个（进全屏时同时放开选项列表的 `max-h-48` 并放大字号）。桌面端也显示，同一套代码，不做断点分支。答完自动退出全屏，状态不持久化。全屏容器还带了：标题栏里的复制按钮、下滑关闭手势（只在内容滚到顶部时才生效，不会跟滚动打架）、以及 `max-w-3xl` 的最大宽度，避免宽屏桌面上一行拉太长读不动。AskUserQuestion 还额外把 Skip/Back/Submit 那条操作栏固定在视口底部（走全屏容器的 `footer` 插槽——用 `sticky` 会被卡片自己的 `overflow-hidden` 困住不生效），并且标题栏显示会话名，通过 `PermissionPanelProps` 上新增的可选字段 `sessionTitle` 一路传下来。

**同步官方时怎么办：** 保留我的。`FullscreenSurface` 是全新文件，官方没有对应物；`MessageComponent.tsx`（一行 import + 控件行里一项）和 `AskUserQuestionPanel.tsx`（state、头部按钮、底部的 `panel` 变量和包装、几处 `isFullscreen ?` 三元 class）改动都很小，官方就算重写了这两个文件也容易重新应用。从 v1.37.2 起，全屏标题栏的会话名改用官方的 `getSessionTitle()`（`src/utils/pageTitle.ts`），之前 fork 是在 `ChatInterface.tsx` 里自己重复实现了一遍——一个副作用是：没有名字的会话现在显示 "New Session"，而不是像以前那样不显示标题。

## 12. 触屏能打开的文件树菜单 + 复制相对路径

**涉及文件：** `src/components/file-tree/view/FileContextMenu.tsx`、`FileTreeNode.tsx`、`FileTreeList.tsx`、`FileTreeBody.tsx`、`FileTree.tsx`、`src/components/file-tree/hooks/useFileTreeOperations.ts`、`utils/fileTreeUtils.ts`、`src/i18n/locales/*/common.json`

**为什么改：** 官方的文件树菜单只挂在 `onContextMenu` 上，触屏设备等于**整个菜单都打不开**——重命名、删除、下载、新建文件/文件夹、复制路径全没了。这里故意做了两个入口，方便真机上比一比再决定要不要砍掉一个：长按 500ms（手指移动超过 10px 就放弃，不影响滚动），以及每行末尾一个只在 `md:` 以下渲染的 `⋮` 按钮。两者共用同一份菜单状态；`FileContextMenu` 因此多支持了函数式 children，让每一行能自己渲染触发按钮而不用接管菜单状态。detailed 视图里手机上 `⋮` 占掉权限列——那一列本来就窄到放不下 `rw-rw-rw-` 加一个按钮。另外在官方的绝对路径"复制路径"旁边加了"复制相对路径"（两个平级菜单项，不做二级菜单），并且两个都改走项目自己的 `copyTextToClipboard`——官方直接调 `navigator.clipboard`，成功提示还是同步弹的，复制失败时会同时看到"复制路径失败"和"路径已复制到剪贴板"。

**同步官方时怎么办：** 保留我的，但先看一眼入口：官方要是自己加了触屏入口，就用官方的，把重复的那个删掉。v1.37.2 在这几个文件里加了上传功能（拖拽、右键菜单项、目录行的 hover 上传按钮），但没碰"菜单在触屏上够不着"这个问题；它那个 hover 按钮是绝对定位在行的最右边，正好压在 `⋮` 上，所以合并时改成在三种视图模式里都把它内联渲染到 `menuButton` 旁边——官方以后再改行样式，保持这个形状。剪贴板那一半属于纯 bug 修复、不是 fork 偏好，**已 triage，明确决定不上报** —— 见 `docs/pull-requests/PR02-file-tree-copy-path-double-toast.md`，那里还记了上游代码在三种上下文下的**实测**行为（双 toast 只出现在权限被拒的情况；局域网明文 HTTP 下 handler 在 toast 之前就抛异常了）。注意这条**动了** `src/i18n/locales/*/common.json`（在官方已有的 `fileTree.context` 块里加了两个 key），和第 3 条刻意只用 `t(key, '英文兜底')` 的做法不一样——那个块是官方的，这里大概率会冲突，重新把两个 key 加回去即可。

## 13. 从聊天标题进入的跨项目会话快切 ❌ 已废弃（v1.37.1）

**涉及文件：** `src/lib/commandPaletteEvents.ts`、`src/components/command-palette/ForkRecentSessions.tsx`、`CommandPalette.tsx`、`src/components/main-content/view/subcomponents/MainContentTitle.tsx`、`src/utils/api.js`、`server/modules/providers/provider.routes.ts`、`services/sessions.service.ts`、`server/modules/database/repositories/sessions.db.ts`

**为什么改：** 官方的命令面板本来就能切会话，但唯一的触发方式是 Cmd/Ctrl+K——sidebar 里那个看着像按钮的东西其实是 `pointer-events-none` 的 `<kbd>` 徽章，而且 `md:` 以下根本不显示。于是手机上面板完全打不开，切会话只能开 sidebar。现在点聊天标题会直接把面板开在 Sessions 页，顺带也让面板的文件/commit/分支搜索在触屏上能用了。官方的 Sessions 分组只列当前项目（和 sidebar 是同一批），所以另加了一个 fork 自有的「Recent sessions (all projects)」分组来回答「我刚才在哪」，并且会和官方已经列出的行去重。切换本身就是 `navigate('/session/:id')`——已有的会话解析逻辑会自己找到所属项目，所以跨项目不需要额外的切项目代码。后端加了 `getRecentSessions(limit)`（`getAllSessions` 既没排序也没上限）和 `GET /api/providers/sessions/recent`；`sessions/running` 用不上，它是故意做成只返回状态的。

**已废弃（v1.37.1）：** 官方自己在侧边栏做了原生的跨项目最近会话列表（PR #1041），连分页版的 `GET /api/providers/sessions/recent` 都有了。这条的后端大约 70% 和它重复，而且重复得并不无害：合并后两个路由注册落在同一个路径上，Express 只匹配第一个，官方那个把这条的悄悄挡掉了。真正还算独有的只剩移动端入口——点聊天标题打开面板——就这一点不值得继续背着一份偏离，所以整条直接废弃，没有去适配官方的新列表。v1.37.1 同步时删掉的东西：`src/lib/commandPaletteEvents.ts` 和 `src/components/command-palette/ForkRecentSessions.tsx` 两个文件、面板里的事件监听和多出来的那个分组，聊天标题也改回纯文本。以后要是真觉得手机上少了入口难受，只把那个入口捡回来——给官方面板加个触发方式，而不是再做一份会话列表——并且作为新条目记录。

## 14. Browser 运行时装到自己管理的目录

**涉及文件：** `server/modules/browser-use/browser-use.service.ts`

**为什么改：** 官方的 `installRuntime()` 用 `cwd: process.cwd()` 跑 `npm install --no-save --no-package-lock playwright`，但 `getPlaywright()` 是从模块自身所在位置去 `require('playwright')`。全局安装的 CloudCLI 下这是两棵完全不同的树：包会装到用户当时启动 CLI 的那个目录（多半是用户主目录），而从 `<npm root -g>/@cloudcli-ai/cloudcli/dist-server/server/modules/browser-use/` 往上找 `node_modules` 永远走不到那里。结果就是装其实成功了，设置页却一直显示 `Playwright: missing`，"Install Runtime" 按钮点多少次都像没反应——每次只是往同一个够不着的地方重装一遍。现在固定装到 `~/.cloudcli/browser-use/runtime`（和已有的 `profiles/` 并列），并先写一个私有 `package.json`，免得 npm 往上找项目根、把上层目录当成自己的工程；`getPlaywright()` 则先按模块自身位置解析，找不到再从这个目录解析。`runCommand()` 为此多了一个 `cwd` 参数。manifest 既然是自己的，去掉 `--no-save --no-package-lock` 就没有副作用，留着 lockfile 重装还更快。

**同步官方时怎么办：** 这属于纯 bug 修复而不是 fork 偏好。**别人已经报给官方了** —— [#995](https://github.com/siteboon/claudecodeui/pull/995) 提的方案和这里一模一样（同一个 `~/.cloudcli/browser-use/runtime` 目录、同样的解析顺序），[#1000](https://github.com/siteboon/claudecodeui/pull/1000) 和 [#917](https://github.com/siteboon/claudecodeui/pull/917) 是同一个根因；三个从 2026 年 6–7 月开到现在都没人回。别再报第四遍（见 `docs/pull-requests/PR04-browser-runtime-install-directory.zh-CN.md`）。其中任何一个合并了，就改用官方版本并退休这条。在那之前保留我的，但要把 `installRuntime()` 和 `getPlaywright()` 当成一对看：两边必须配套才成立，官方要是改了其中一个，就两半一起重新应用，别只合一边留另一边。如果官方改成把 playwright 作为正式依赖发布，那这条整条丢掉即可——第一级解析本来就覆盖那种情况。

## 15. 移动端把标签切换栏收成一个菜单

**涉及文件：** `src/components/main-content/view/subcomponents/MainContentTabMenu.tsx`、`MainContentTabSwitcher.tsx`、`MainContentHeader.tsx`、`src/shared/view/ui/ActionMenu.tsx`

**为什么改：** 官方把标题和标签 pill 放在同一行。`lg:` 以下 pill 本来就只剩图标，但数量不固定——4 个内置，加可选的 Browser 和 Tasks，再加每个已启用插件一个——所以 375px 的手机上这排要占 148–220px，标题只剩不到 150px（6 个标签时实测 51px）。官方自己的缓解手段是给这排加横向滚动和左右渐变遮罩，能挡住溢出，但一点宽度都没还给标题。这在本 fork 里比在官方那边更亏，因为第 13 条把聊天标题变成了跨项目会话快切入口，挤窄标题等于同时挤掉一个导航入口。现在 768px 以下——用的就是 header 已经在给汉堡按钮用的那个 `isMobile`——整排收成一个约 48px 的 pill，里面是当前标签的图标加一个箭头；点开是下拉菜单，按原顺序列出全部标签，插件组前面加分隔线，当前项高亮并标 `aria-current`。标题实测宽度从 51px 变成 217px。桌面端一点没动，滚动和渐变遮罩都原样保留。

**同步官方时怎么办：** 保留我的。上游足迹刻意做得极小且全是新增：`MainContentTabSwitcher.tsx` 里一个 prop 加一个提前 `return`、`MainContentHeader.tsx` 里一行 prop 透传、以及 `ActionMenu` 上四个可选 prop（`triggerIcon`、`showChevron`、菜单项的 `iconNode` 和 `isActive`）——它原有的两处调用一个都没用到。菜单代码全在 fork 自有的 `MainContentTabMenu.tsx` 里，冲突后把那几处放回去即可。那个提前 `return` 是**故意**放在标签列表构造完之后的：两种渲染共用同一份列表，官方以后加内置标签，移动端菜单自动就有了——重新应用时别改这个位置。下拉用的是 `ActionMenu` 的 `portal` 模式，也是故意的：header 那个标签槽是 `overflow-hidden`，绝对定位的菜单会被裁掉；官方要是重构了那个容器，先确认裁剪问题再考虑换掉 portal。文案用 `t(key, { defaultValue })`，没动 `src/i18n/locales/**`（和第 3、13 条一致）。官方哪天自己做了移动端标签方案，就用官方的，把这条删掉。⚠️ v1.37.2 已经朝这个方向走了一半：标签栏现在是个正经的横向滚动条（边缘渐变、桌面端左右箭头按钮、滚轮横滚、`role="tab"` 键盘导航），移动端只在当前标签上显示文字。但那仍然是"滚动"不是"折叠"，标题拿不回宽度，所以这条先保留了——下次同步别闭眼重新应用，先在真机上对比一下再决定。

⚠️ **`MainContentHeader.tsx` 现在需要对布局本身做 `isMobile` 分支，不只是透传一个 prop。** v1.37.2 同时把 header 重构成了 `flex-col … sm:flex-row`：在 `sm:` 以下把标题和标签条各占一行，好让全宽滚动条有独立的一行。照搬过来的结果是 fork 那个紧凑 pill 单独占了一整行 —— header 从 45px 涨到 81px，标题又被压回一小截，正好跟这条定制的目的相反。所以合并后的 header 在桌面分支保留上游的 class，在 `isMobile` 时改用 `flex-row items-center` + `shrink-0`（不要 `-mx-3` 出血边距，那是给滚动条用的）。官方以后再重构 header，要重新确认 pill 还跟标题在同一行。

这个问题在浏览器 700px 下没被发现，是后来在真机上才发现的：`isMobile` 是 **<768px**，而 Tailwind 的 `sm:` 是 **640px**，所以 640–768px 这一段会同时渲染 fork 的 pill **和**上游的单行布局，看起来是对的。**移动端布局要在 ~390px 下测，不能只是"把窗口拉窄"** —— 落在两个阈值中间的视口可能同时满足两个分支，把 bug 藏起来。另外第 13 条的跨项目会话切换器已经退休，所以上面"挤压导航入口"那半个理由现在不成立了。

## 16. 推送通知按 session 收敛成一条，打开会话或在别的设备上处理完都会清掉

**涉及文件：** `server/modules/notifications/services/notification-orchestrator.service.js`、`server/modules/notifications/index.ts`、`server/modules/providers/list/claude/claude-runtime.provider.js`、`public/sw.js`、`src/components/app/AppContent.tsx`

**为什么改：** 官方给每条推送打的 tag 是 `provider:sessionId:code`，所以一个 session 只要依次触发权限请求、stop、error 三种事件，手机通知中心就会永久堆着三条通知——包括你已经在 APP 里处理过的那些，谁都不会自动消失。这个 fork 在有 `sessionId` 时把 `code` 从 tag 里去掉（变成 `provider:sessionId`）。最初想的机制——靠系统自己替换同 tag 的通知（`renotify: true`）——结果只在 Chrome/Android 上有效：iOS Safari 从来不会替换同 tag 的通知（在真机上验证过，跟 [WebKit bug 258922](https://bugs.webkit.org/show_bug.cgi?id=258922) 描述的一致），所以 `sw.js` 的 `push` 处理现在会在调用 `showNotification()` 之前，自己先把同一个 `sessionId` 已经显示的通知关掉（`closeSessionNotifications()`），不再指望浏览器代劳。在 APP 里打开该 session 时，另外会给 Service Worker 发一条 `{ type: 'CLEAR_SESSION_NOTIFICATIONS', sessionId }` 消息，复用同一个清理函数——这条路径专门兜住"没走到 tag/session 收敛逻辑"的场景。没有 session 的事件（比如 `push.enabled`）保留 `provider:global:code` 这种 tag，避免互相顶掉。另外一个独立问题：在某个设备上回答了权限请求（包括 AskUserQuestion）之后，同一条请求的推送通知会在其它每一台订阅设备上原地卡死，因为没有任何机制告诉它们"这个已经处理完了"。`chat.permission-response` 本来就是通过跟设备无关的 `resolveToolApproval()` 解析的，不管是哪个客户端发来的，所以现在这个函数会额外触发 `notifyPermissionResolved()`——一条真正、符合规范的推送（不是静默/纯数据的，那种会被浏览器判定滥用进而取消订阅），code 是 `permission.resolved`，复用同一个 session tag，通过上面的机制把"需要处理"的旧通知收敛成"已处理"。resolver 的 metadata 多了 `_userId`/`_sessionName`（跟原有的 `_sessionId`/`_toolName` 放一起），这样 `resolveToolApproval()` 不用在整条调用链上多传参数就能拿到需要的信息。

**同步官方时怎么办：** 保留我的。改动都很小很独立：orchestrator/`sw.js` 里一处 tag 表达式 + 一个 `closeSessionNotifications()` 辅助函数 + 一个 `permission.resolved` 通知函数，`claude-runtime.provider.js` 的 `resolveToolApproval()` 里加了几个 resolver metadata 字段和一次 `notifyPermissionResolved()` 调用，`AppContent.tsx` 里一个按路由 `sessionId` 触发的 `useEffect`。如果官方重做了推送 payload、tag 方案或权限批准流程，保留"每个 session 只留一条通知、打开即清、在别处处理完也会清"这个行为，照着官方的新结构重新推导 tag/清理/resolve 逻辑，别把这个功能整个丢掉。如果官方以后给别的 provider 也加上交互式审批，那个 provider 自己的 `resolveToolApproval` 等价物也需要同样的 `_userId`/`_sessionName` metadata 和 `notifyPermissionResolved()` 调用——现在只接到 Claude 上是因为目前只有它实现了 `permissions.resolve`。

## 17. Codex 模型列表改成实时拉取，不再读一份不会刷新的快照 ❌ 已废弃（v1.37.1）

**涉及文件：** `server/modules/providers/list/codex/codex-models.provider.ts`、`server/modules/providers/services/provider-models.service.ts`

**为什么改：** 官方的 `getSupportedModels()` 只读 `~/.codex/models_cache.json`——这是个不会自己刷新的时间点快照。如果用户把 Codex 走自定义 `model_provider`/中转站（通过 `~/.codex/config.toml` 里的 `model_catalog_json1` 声明），或者干脆缓存本来就旧了，就永远看不到官方新发布的模型——实测验证过：GPT-5.6 Sol/Terra/Luna 是 2026-07-09 正式发布的官方模型，而一份 2026-06-21 抓的缓存里完全没有。`@openai/codex-sdk` 的 JS API 没有对应方法能拿到这个，等价能力只存在于随包分发的 `codex` 二进制自己的 `debug models` 子命令里。这个 fork 现在会去起这个子命令的子进程（复用 `codex-runtime.provider.js` 已经在用的同一个 `@openai/codex` 二进制，通过它 `package.json` 的 `bin` 字段解析路径，保证两边版本一致），解析它的 JSON 输出；失败就退回旧的读缓存文件逻辑，再失败就退回写死的 `CODEX_FALLBACK_MODELS` 列表。同时把 `codex` 加进了 `provider-models.service.ts` 的 `UNCACHED_PROVIDERS`——不然外层那层 3 天磁盘持久化缓存会一直挡住这次刚拿到的新鲜结果，因为一次成功的缓存会被记住远超一个新模型发布的时间跨度。

**已废弃（v1.37.1）：** 当初的缺口自己没了——官方在同一个版本里刷新了他们那份写死的 Codex 列表，这条想让用户看到的新模型现在官方自带。这时候再留着实时拉取就是亏的：它是**整份替换**列表而不是合并进去，官方新加、而 `codex debug models` 又不返回的选项会从选择器里悄悄消失——正好是这条本来要防的那种问题，方向反了。v1.37.1 同步时的处理：`codex-models.provider.ts` 和 `provider-models.service.ts` 整份取官方版本，`fetchLiveCodexModels()`、`codex debug models` 子进程、`UNCACHED_PROVIDERS` 一并没了。以后列表要是又过期了，替代方案必须是**和官方列表合并**而不是替换，而且优先用正经的 SDK 方法，别再依赖没有文档的 `debug` 子命令。

## 18. Claude 模型列表改成走 SDK 实时拉取，不再是写死的列表 ❌ 已废弃（v1.37.1）

**涉及文件：** `server/modules/providers/list/claude/claude-models.provider.ts`

**为什么改：** `getSupportedModels()` 里本来就写好了一段真正调 SDK 的代码，但被注释掉了：调 `query()` 拿到的 `Query` 实例会往 `~/.claude/projects/` 下面落一份会话 jsonl，然后被侧边栏自己的项目发现机制捡到，变成一个多余的工作区。`@anthropic-ai/claude-agent-sdk`（装的已经是最新的 0.3.227）后来加了个 `persistSession: false`，官方文档写的就是给"不需要保留历史的临时/自动化调用"用的。实测验证了两次——先测原始 SDK 调用，再测真正的 `ClaudeProviderModels` 类——每次都对比 `~/.claude/projects/` 改动前后的目录列表：两次都没多出新会话，耗时大概 2.4–3.3 秒。实时拿到的列表跟写死的兜底列表不只是新旧的区别，内容也真不一样：少了旧列表里单独的 "Opus" 和 "Sonnet[1m]"，多了 `resolvedModel` 字段和更细的 effort 档位。

**已废弃（v1.37.1）：** 理由和 #17 一样。官方那份写死的列表多了实时拉取拿不到的选项——`best`、`opusplan`，以及 `xhigh` 这一档 effort——留着实时拉取等于把用户现在能选的模型砍掉。v1.37.1 同步时的处理：`claude-models.provider.ts` 整份取官方版本，`fetchLiveClaudeModels()`、`mapClaudeModel()`、`buildClaudeModelsDefinition()` 和那个 `persistSession: false` 的 SDK 调用都没了；`CLAUDE_FALLBACK_MODELS` 这个名字也彻底不存在了，官方把那份静态列表改名成了 `CLAUDE_PREDEFINED_MODELS`。别再想着把 `persistSession: false` 这条路捡回来了。在这个 fork 独立发现它之前，已经有人在 upstream 提过一模一样的方案（`persistSession: false`、同样的 `pathToClaudeCodeExecutable` 解析、失败兜底、别名保留），见 [siteboon/claudecodeui#1132](https://github.com/siteboon/claudecodeui/pull/1132)，被维护者一句"this is intentional"关闭、没有合并。结合同一个版本里 Cursor、OpenCode 的 model provider 也被砍成同样的静态目录模式来看，这是官方对"运行时/provider 端动态发现模型"这整条路线的统一否决，不是嫌某一个 PR 写得不够好。尊重这个决定——不要再向官方提同样的机制，这个 fork 里也不要重建它。

## 19. New Session 选择器只列出已连接的 provider

**涉及文件：** `src/components/chat/view/subcomponents/ProviderSelectionEmptyState.tsx`

**为什么改：** 官方的 New Session 模型选择器不管 claude/cursor/codex/opencode 这四个 provider 有没有真正安装/登录，一律全部列出来——选了个没连接的，只会在真正跑会话的时候才报错。这个 fork 接入了已有的 `useProviderAuthStatus` hook（Settings → Agents 页面已经在用），把选择器过滤成只显示 `/auth/status` 返回 `authenticated` 的 provider。检查还没跑完之前先四个都显示，避免"先显示四个、突然收窄成两个"这种闪烁感。

**同步官方时怎么办：** 保留我的——这是个实打实的体验偏好，不是修 bug（官方可能就是故意让未连接的 provider 也可见/可发现，比如方便引导新用户）。如果官方重写了这个文件，把 `useProviderAuthStatus()` 调用、挂载时触发 `refreshProviderAuthStatuses()` 的那个 `useEffect`，还有喂给 `visibleProviderGroups` 的 `connectedProviders`/`isCheckingConnections` 过滤逻辑重新套回去。

## 20. 定时触发（延后发送一条消息）

**涉及文件：** `server/modules/database/schema.ts`、`server/modules/database/index.ts`、`server/modules/database/repositories/scheduled-triggers.db.ts`、`server/modules/scheduled-triggers/`（新模块：`index.ts`、`scheduled-triggers.routes.ts`、`services/scheduled-trigger.service.ts`、`services/scheduler-poller.service.ts`、`tests/`）、`server/index.ts`、`server/modules/notifications/services/notification-orchestrator.service.js`、`.env.example`、`src/utils/api.js`、`src/components/chat/hooks/useScheduledTrigger.ts`、`src/components/chat/view/subcomponents/ComposerScheduleMenu.tsx`、`ChatComposer.tsx`、`src/components/chat/view/ChatInterface.tsx`、`src/i18n/locales/en/chat.json`

**为什么改：** 部分 Codex/Claude 中转站（第三方 API 转售服务）有自己的限流窗口，报错时给的是一句纯文本、里面点名了具体几点几分可以重试（比如"请在 今天 15:00 后再试"），而不是标准的 `retry-after` 字段。官方完全没有"等一等再重发"这个概念——session 被限流后就一直晾在那，得用户自己想起来回来手动重打字。这次加的是一个通用的、不区分 provider 的"定时发送消息"能力：任意 session 都能通过输入框旁新加的时钟图标菜单，排一条一次性的未来消息（默认内容 `continue`，可编辑）；后端每 30 秒轮询一次，到点后走的是 `chat.send` 和无浏览器的 `/api/agent` 接口本来就共用的同一个 `providerRuntimeService.run()` 入口，不需要给任何 provider 单独开后门。

轮询在真正调用 provider **之前**先把这条记录从 `pending` 抢占为 `firing`——第一版是等 provider 调用成功之后才标记，结果 provider 调用比一个轮询周期还慢的话，下一轮轮询会把它当成"还没触发过"又发一次（实测踩过：处理慢了之后，同一句 `"continue"` 被反复发进同一个正在用的 session）。因为进程崩溃卡在 `firing` 状态的记录，下次启动时会被复位成 `pending`，不会永久卡死，只是会被重新尝试。

输入框那边现在完全不做日期选择——只有一个时间框。裸的 `HH:mm` 永远表示"这个钟点接下来最近一次出现"：还没到就是今天，已经过了就是明天（最多推 24 小时），而且这个判断是**每次渲染都重新算的**，不是算一次存起来。早期版本是在 `onChange` 里算好存起来的，但原生时间输入框按段（先时、后分）多次触发 `onChange`，不是等你输完才触发一次——输到一半的中间值只要恰好判成"过了"，就会永久锁定成明天，哪怕你后面输完的时间其实还是今天。现在旁边只会有一个纯展示、不能点的"Tomorrow"文字提示，故意不留任何选具体日期的入口。5 个快捷预设覆盖常见场景：`+10min`/`+60min`（可以连续点——每次都是在当前草稿基础上累加，不是从"现在"重新算）、下一个整点、下一个 `{0,3,6,9,12,15,18,21}` 间隔点，以及固定的 `00:05`"明天一早"快捷方式。每次重新打开这个弹层，都会回到一个全新的默认值，不会停留在上一次打开/已提交/已取消时的状态上。

这一版刻意只做手工、一次性的基础能力——"自动识别中转站限流文案、自动建一条定时"是明确留到后面做的扩展，这次不实现。触发是无头(headless)执行的（没有真实 WebSocket 客户端连着），所以如果凑巧开着这个 session 的页面，看不到回复实时流式进来——页面只会通过一条 `session_upserted` 广播感知到"这个 session 变了"，而前端现在把这条事件当成只更新侧边栏用，没有处理成"刷新当前打开的会话"；把无头触发的结果真正实时推进已打开的页面，这次没做。定时时间到了但服务当时没在跑（比如电脑关机）：只在一个可配置的宽限窗口内（`SCHEDULED_TRIGGER_GRACE_WINDOW_MINUTES`，默认 60 分钟）补发，超过宽限窗口就标记为 `expired`，不会悄悄丢掉，也不会不管多久之前的都硬发一条出去。

**同步官方时怎么办：** 保留我的。新增一张表 + 一个独立模块，本身冲突面很小；唯一会碰到官方也在维护的文件的地方都是纯增量式的（`schema.ts` 里 `INIT_SCHEMA_SQL` 末尾追加一段 `CREATE TABLE IF NOT EXISTS` + 两条索引，`database/index.ts` 里加一行 repository 导出，`server/index.ts` 里加一个 import + 两行路由挂载/轮询启动，`ChatComposer.tsx` 里在已有的 `ComposerPermissionMenu` 旁边加一个 `ComposerScheduleMenu` 位置，`ChatInterface.tsx` 里多传一个 `sessionId` prop，通知模块的 orchestrator 里加两条 `CODE_MAP` 文案)。如果官方改了 `chat-websocket.service.ts` 里 `runtimeOptions` 的拼法（从 session 行取 `cwd`/`projectPath`），要同步改一下 `scheduled-trigger.service.ts` 的 `fireTrigger()`——这段是特意从那边抄过来的，没有抽成共用函数。如果官方以后做了真正的"无头触发结果推进已打开页面"机制，这里应该改用官方的，而不是继续用现在这个只更新侧边栏的 `session_upserted` 广播。

## 21. 宽表格改成横向滚动，不再挤成一团

**涉及文件：** `src/components/chat/view/subcomponents/Markdown.tsx`

**为什么改：** 官方的表格渲染是外层 `overflow-x-auto` 配上 `min-w-full` 的表格。CSS 的 auto 表格布局只有在内容**再也没法换行**时才会溢出容器，所以一张普通文字的表格会把每一列压缩到接近"最长的那个单词"的宽度，而不是溢出——外层因此没东西可滚，文字挤到看不清。（如果表格里全是长的不可断开的串，它反而会溢出并正常滚动，所以这个 bug 看起来时有时无。）加上 `w-max` 让表格按自然宽度撑开，外层才真的能滚；`th`/`td` 上的 `min-w-28`/`max-w-[22rem]` 防止单列塌掉或者撑太宽；`overscroll-x-contain` 防止在表格里横滑时把后面的整页也一起带走。

**同步官方时怎么办：** 这不是 fork 偏好，是纯 bug 修复，但**已 triage，明确决定不上报**（见 `docs/pull-requests/PR03-markdown-table-horizontal-scroll.md`：上游刚重做过这几行，而且宽度上下限是本 fork 没验证过的拍脑袋取值）。官方哪天自己修了就把这条删掉。在那之前保留我的，但要**合并、不要替换**：v1.37.2 重新设计了这几行的样式（圆角边框容器、单元格去边框、用 `my-0` 抵消 Tailwind Typography 的表格外边距），整段用 fork 这边覆盖会把这些静悄悄地退回去。做法是采用官方的 class，再把宽度/overscroll 这四个 class 加回去。

## 22. Compact：压缩会话上下文（压缩边界标记、入口、OpenCode）

**涉及文件：** `server/shared/types.ts`、`server/modules/providers/list/claude/claude-sessions.provider.ts`（+ 测试 `server/modules/providers/tests/claude-sessions.test.ts`）、`src/stores/useSessionStore.ts`、`src/components/chat/types/types.ts`、`src/components/chat/hooks/useChatMessages.ts`、`src/components/chat/view/subcomponents/MessageComponent.tsx`、`src/i18n/locales/{en,zh-CN}/chat.json`

**为什么改：** 在输入框里敲 `/compact` 其实早就能送到 provider 并真的完成压缩——问题在于 Claude session 的 normalizer 把所有 `type: "system"` 事件都悄悄丢掉了，所以压缩结果一直看不见，`/compact` 看起来就像坏的。这个能力缺口是官方自己的，但补齐它用的是本 fork 自己出的设计方案（issue [#18](https://github.com/wltiger/my-cloudcli/issues/18)），所以记在这里，不能假设以后同步官方时会自动补上。工单 [#19](https://github.com/wltiger/my-cloudcli/issues/19)（这条记录的第一部分）让 Claude Agent SDK 发出的压缩边界变得可见：给 `normalizeMessage` 加一个分支，识别 `type: "system", subtype: "compact_boundary"`，产出一个新的 `compact_boundary` 规范化消息种类，带上触发方式（`/compact` 手动触发是 `manual`，provider 自己触发是 `auto`）和压缩前后的上下文 token 数。这个事件在线上有两种不同的字段形状，得在同一个分支里都认出来：SDK 实时查询流用的是下划线命名（`compact_metadata.pre_tokens`），落盘的 JSONL 会话记录用的是驼峰命名（`compactMetadata.preTokens`）——同一个分支两种都读，这样刷新页面后标记还在。前端把它渲染成**chrome**（术语见 `CONTEXT.md` 的 glossary），直接复用现有任务通知行（`MessageComponent.tsx` 里的 `isTaskNotification` 分支）一样的视觉分量，没有另起一套样式。工单 [#20](https://github.com/wltiger/my-cloudcli/issues/20)（补全菜单入口 + token 面板按钮，按 provider 能力开关）和 [#21](https://github.com/wltiger/my-cloudcli/issues/21)（OpenCode 的旁路压缩）落地时会扩展同一条记录——到时候在这条基础上更新，不要另开新编号。

**同步官方时怎么办：** 保留我的。官方那边压根没有"压缩可见"这个概念——`/compact` 在官方那边也是看不见的——所以这次改动大部分是全新代码、落在全新位置（整个 `compact_boundary` 分支、i18n key、新增的 switch case），基本没有需要合并的重叠部分。真正的风险点是官方自己也在改的那几个共享分发点，这次在每一个上面都只加了一小块，如果官方那边结构变了，重新按"同样的形状"补一刀，而不是照搬这次的字面 diff：`server/shared/types.ts` 里的 `MessageKind` 联合类型只是在末尾追加了一个成员（`compact_boundary`）——冲突解决时不要把它排到别处去；`claude-sessions.provider.ts` 的 `normalizeMessage` 只是在算出 `baseId` 之后插入了一个分支——不要借机把周围的 if 链"顺手重构"一下；`useChatMessages.ts` 的 `switch (msg.kind)` 在 `task_notification` 旁边加了一个 `case`；`MessageComponent.tsx` 渲染用的三元链在 `message.isTaskNotification` 旁边加了一个分支。`server/shared/utils.ts` 的 `createNormalizedMessage` **完全不需要改**——它本来就是泛化地透传各种消息种类专属字段的，这也是为什么最终只涉及四个前后端文件而不是五个。
