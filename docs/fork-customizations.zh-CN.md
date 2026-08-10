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

## 3. 聊天消息间距设置

**涉及文件：** `src/components/chat/utils/chatSpacing.ts`、`hooks/useChatSpacing.ts`、`view/subcomponents/ChatMessagesPane.tsx`、`MessageComponent.tsx`、`ToolGroupContainer.tsx`、`src/components/settings/hooks/useSettingsController.ts`、`settings/view/tabs/AppearanceSettingsTab.tsx`、`src/components/quick-settings-panel/view/QuickSettingsContent.tsx`、`ForkQuickSettings.tsx`、`QuickSettingsChatSpacingRow.tsx`

**为什么改：** 手机屏幕小，聊天气泡左右固定的留白很浪费空间。加了"宽松/紧凑/无间距"三档设置（只影响移动端），完整 Settings 和 Quick Settings 面板都能调，两边共用同一个 `useChatSpacingLevel()` hook。因为这个设置在 `sm:` 断点以上是空操作，Quick Settings 那一行下面留了一句小字说明"只影响窄屏"——而不是在桌面端直接隐藏，隐藏会让人以为设置被删了。（分三次迭代做的：先加设置本身，然后改名+接入 Quick Settings，最后抽出下面说的 `ForkQuickSettings`——算作一条自定义。）

**同步官方时怎么办：** 保留我的。纯 opt-in 设置项，加法改动。现在 `QuickSettingsContent.tsx` 里 fork 的全部痕迹只有两行——一行 `ForkQuickSettings` 的 import，一行贴在面板 body 最末尾的 `<ForkQuickSettings />`。fork 自己加的快捷设置全部放在 `ForkQuickSettings.tsx`（官方没有这个文件）里，所以冲突后只要把那两行放回去就行，别再把新设置塞进官方自己的分组里。所有文案都用 `t(key, '英文兜底')` 的写法，是故意的——不动 `src/i18n/locales/**`，翻译文件保持零冲突面。

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

**为什么改：** 手机上聊天区太窄，长回复读起来费劲；AskUserQuestion 的选项标题和说明被挤到根本分不出哪个是哪个——而在外面用手机回答这类提问，恰恰是这个面板最主要的使用场景。两处共用一个 `FullscreenSurface`（portal 到 body 的 `inset-0` 面板，Esc 关闭，锁 body 滚动，带安全区内边距）：消息复制按钮旁边加一个全屏按钮，AskUserQuestion 头部加一个（进全屏时同时放开选项列表的 `max-h-48` 并放大字号）。桌面端也显示，同一套代码，不做断点分支。答完自动退出全屏，状态不持久化。全屏容器还带了：标题栏里的复制按钮、下滑关闭手势（只在内容滚到顶部时才生效，不会跟滚动打架）、以及 `max-w-3xl` 的最大宽度，避免宽屏桌面上一行拉太长读不动。

**同步官方时怎么办：** 保留我的。`FullscreenSurface` 是全新文件，官方没有对应物；`MessageComponent.tsx`（一行 import + 控件行里一项）和 `AskUserQuestionPanel.tsx`（state、头部按钮、底部的 `panel` 变量和包装、几处 `isFullscreen ?` 三元 class）改动都很小，官方就算重写了这两个文件也容易重新应用。

## 12. 触屏能打开的文件树菜单 + 复制相对路径

**涉及文件：** `src/components/file-tree/view/FileContextMenu.tsx`、`FileTreeNode.tsx`、`FileTreeList.tsx`、`FileTreeBody.tsx`、`FileTree.tsx`、`src/components/file-tree/hooks/useFileTreeOperations.ts`、`utils/fileTreeUtils.ts`、`src/i18n/locales/*/common.json`

**为什么改：** 官方的文件树菜单只挂在 `onContextMenu` 上，触屏设备等于**整个菜单都打不开**——重命名、删除、下载、新建文件/文件夹、复制路径全没了。这里故意做了两个入口，方便真机上比一比再决定要不要砍掉一个：长按 500ms（手指移动超过 10px 就放弃，不影响滚动），以及每行末尾一个只在 `md:` 以下渲染的 `⋮` 按钮。两者共用同一份菜单状态；`FileContextMenu` 因此多支持了函数式 children，让每一行能自己渲染触发按钮而不用接管菜单状态。detailed 视图里手机上 `⋮` 占掉权限列——那一列本来就窄到放不下 `rw-rw-rw-` 加一个按钮。另外在官方的绝对路径"复制路径"旁边加了"复制相对路径"（两个平级菜单项，不做二级菜单），并且两个都改走项目自己的 `copyTextToClipboard`——官方直接调 `navigator.clipboard`，成功提示还是同步弹的，复制失败时会同时看到"复制路径失败"和"路径已复制到剪贴板"。

**同步官方时怎么办：** 保留我的，但先看一眼入口：官方要是自己加了触屏入口，就用官方的，把重复的那个删掉。剪贴板兜底和重复 toast 属于纯 bug 修复、不是 fork 偏好，值得给官方提 PR。注意这条**动了** `src/i18n/locales/*/common.json`（在官方已有的 `fileTree.context` 块里加了两个 key），和第 3 条刻意只用 `t(key, '英文兜底')` 的做法不一样——那个块是官方的，这里大概率会冲突，重新把两个 key 加回去即可。
