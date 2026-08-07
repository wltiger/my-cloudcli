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

**涉及文件：** `src/components/chat/utils/chatSpacing.ts`、`hooks/useChatSpacing.ts`、`view/subcomponents/ChatMessagesPane.tsx`、`MessageComponent.tsx`、`ToolGroupContainer.tsx`、`src/components/settings/hooks/useSettingsController.ts`、`settings/view/tabs/AppearanceSettingsTab.tsx`、`src/components/quick-settings-panel/view/QuickSettingsContent.tsx`、`QuickSettingsChatSpacingRow.tsx`

**为什么改：** 手机屏幕小，聊天气泡左右固定的留白很浪费空间。加了"宽松/紧凑/无间距"三档设置（只影响移动端），完整 Settings 和 Quick Settings 面板都能调，两边共用同一个 `useChatSpacingLevel()` hook。（分两次迭代做的：先加设置本身，后来又改名+接入 Quick Settings——算作一条自定义。）

**同步官方时怎么办：** 保留我的。纯 opt-in 设置项，加法改动。

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
