**总体结论：有风险，建议补改 1 处再说放心。** `black` 本身没查到任何机型/场景会比原来更差；真正的风险是有刘海机型底部：窗口现在会一直铺到屏幕最底，而聊天输入框没有 `safe-area-inset-bottom` 垫底，会被 Home 指示条压住。另外两点要用户自己定：是否改成 `default`（亮色主题更好看），以及 meta 到底是安装时读还是启动时读（你的 SE 实测就能回答）。

先说一个关键发现：**SE 上那个 20pt 缺口不是机型 bug，是 iOS 26 系的 WebKit 回归（bug 301108）**。`black-translucent` + `viewport-fit=cover` 时，iOS 26 把页面从屏幕顶画起，但窗口高度按"状态栏以下"算，正好少一个状态栏高度；少的那条画不出任何东西。这和你测到的 `innerHeight`=647 / `screen.height`=667 / `inset-top`=20 完全吻合。刘海机少 47，灵动岛机少 59，iPad 少 20–24。改成不透明状态栏（`black` 或 `default`）是社区统一的修法。

## 场景表

| # | 场景 | 结论 | 依据 |
|---|---|---|---|
| 1 | 刘海/灵动岛 iPhone 竖屏 | ⚠️ 顶部变好，底部输入框会压到 Home 条 | 代码推出 + 资料 + 推测 |
| 2 | 其他机型/iOS 版本 | iOS 26 系全中招，机型只决定缺口大小；iOS ≤18 两种写法都没缺口 | 资料 + 推测 |
| 3 | iPad | 不确定，倾向变好/无变化 | 推测 |
| 4 | iPhone 横屏 | 无变化（刘海机横屏本就没有状态栏） | 资料 + 推测 |
| 5 | Android / 桌面 / Safari 标签页 | 无变化，meta 完全不生效 | 资料 + 代码推出 |
| 6 | 键盘弹起 | 无变化 | 代码推出 + 实测 |
| 7 | 亮/暗主题 | 变差（亮色下黑条）；`default` 大概率更好 | 实测 + 资料 |
| 8 | meta 读取时机 | 资料说安装时读；未查到 Apple 官方说明 | 资料（二手） |
| 9 | 是否要补改 | 要：输入框加底部安全区 padding；不需要按机型分 | 代码推出 |

## 逐条说明

**1. 刘海机竖屏。** 资料（arc PR #8，灵动岛 Pro Max 实测）：`black` 下 web view 从状态栏下方开始，`env(safe-area-inset-top)`=0，窗口填满到屏幕底。`inset-bottom`=34 是推测（窗口到底了，Home 条必然盖在上面），没找到直接数值。按代码算：
- `#root` padding-top = 0（`src/index.css:163`）；`--header-total-padding` = 0 + 8px（`:74`）；`body.pwa-mode .fixed.inset-0 { top: 8px }`（`:180`）→ 工作区壳从状态栏下方 8px 开始，上面是同色的 body，**没有双重留白**，只是黑色状态栏本身 47–59pt 高，亮色主题下很显眼。
- 这条 `.fixed.inset-0` 规则同时命中 `FullscreenSurface.tsx:91`，它自己又加了 `0.5rem + env(top)`（`:100`）。原配置下刘海机是 55 + 55 的**双重顶部缩进**，新配置变成 8 + 8 → 这一处变好。
- 底部：壳 `bottom: 0`（`ProjectWorkspaceShell.tsx:20`）直达屏幕底。聊天输入框外壳只有 `pb-2`（`ChatComposer.tsx:300`），**没有任何 safe-area 底部 padding**；`index.css` 里的 `.chat-input-mobile`、`.ios-bottom-safe`、`--mobile-nav-total` 全是无人引用的死 CSS。所以 34pt 的 Home 条会压在输入框下沿。原配置在 iOS 26 上因为窗口短了 47–59 反而"碰巧"躲开了；在 iOS ≤18 上本来就被压（既有问题）。终端页的手机底栏 `Shell.tsx:345` 同样没垫。侧栏/设置/全屏面板都有 `pb-safe-area-inset-bottom`，没问题。

**2. 其他机型。** 缺口 = 状态栏高度，与 iOS 版本相关、与机型无关：SE 20、X 系 44–47、灵动岛 54–59、iPad 20–24（推测，基于 301108 描述 + arc PR 的 59 + 你的 20）。资料均写"iOS 26 起"；MacRumors/Glide 另报 iOS 26.1 起 `black-translucent` 竖屏干脆不透明了。iOS ≤18 按 Apple 文档语义两种写法都正常（推测，没找到反例）。注意 iPhone 8 最高只到 iOS 16，跑不了 iOS 26；请确认手上到底是哪台、什么系统。

**3. iPad。** 没找到 iPad 专门报告。推测：iPad 状态栏横竖屏都显示，`black` 下顶部一条黑（20–24pt）、`inset-top`=0，Face ID iPad 的 `inset-bottom` ≈ 20；分屏/Slide Over 同理。iPadOS 26 的窗口模式另有"红绿灯按钮盖住页面、顶部黑缝"问题（dev.to 报告），与本 meta 无关。

**4. iPhone 横屏。** 刘海机横屏 insets 为 0/21/44–59/44–59（top/bottom/left/right），即横屏没有状态栏，两种写法无差别（资料 gist + 推测）。左右 inset 来自保留的 `viewport-fit=cover`，`#root` 和 `.fixed.inset-0` 的 left/right 规则照旧。SE 横屏有个 iOS 12 时代的"旋转后出空白状态栏"旧 bug（Apple 论坛 110854），现状未知。另外 manifest 的 `orientation: portrait-primary` 在 iOS 上是否锁竖屏，资料互相矛盾（Firtman 说不支持；tldraw #1724 说被锁了）→ 不确定。

**5. Android / 桌面 / Safari 标签页。** Apple 文档明写该 meta 是 iOS 专属扩展，且"非全屏模式下无效"；Android Chrome 状态栏走 `theme-color`，`ThemeContext.tsx:62-73` 的 theme-color 同步没动 → 无变化，无副作用。

**6. 键盘。** `interactive-widget` 在 Safari 公开版至今没实现（bram.us 2026-09-11，WebKit 259770），iOS 上一直是被忽略的，这点不因本次改动变化。`useVisualViewportKeyboardOffset.ts:17-33` 只看 `innerHeight − visualViewport.height` 的差值并自动扣基线；你实测两者都是 647，基线 0，键盘逻辑无变化。顺带：iOS 26.0 有个独立 bug（Apple 论坛 800125/800154，WebKit 297779）：收起键盘后 `visualViewport.height` 持续少 24，这个 hook 会算出 `--keyboard-height: 24px`，底部留一条 24px。与本改动无关，26.0.1 仍在，26.1 据称修了。

**7. 主题。** `black` = 两种主题都是纯黑条白字（SE 实测）。Firtman 确认 iOS 15 起 standalone 状态栏采用 `theme-color`，且 `apple-mobile-web-app-status-bar-style` 除 `black-translucent` 外已弃用（`black` 现在仍生效但属弃用值）；herdr PR #199 在 iOS 26 上实测去掉该 meta 后"状态栏按 theme-color 着色、无模糊"。本项目已经按主题同步 `theme-color`（#f6f4ef / #141414），所以 **`default` 大概率两种主题都跟 app 背景同色**，这是更好的静态选择。未验证点：运行中切主题状态栏会不会即时变色（未查到），字色是否自动反转（推测会）。

**8. 读取时机。** 多份资料一致说"添加到主屏幕时读取，改了要删掉重加"，但全是 GitHub PR 描述（多为 AI 代理写的），Apple 文档没提。你的实测能一锤定音：改完 meta 如果**没重加书签**就生效了，那至少当前 iOS 是启动时读。运行中改 meta 无效这点各方一致（原先 ThemeContext 的运行时切换代码本来就不起作用，删掉是对的）。

**9. 补改。** 不需要也无法按机型分：同一份 HTML、UA 看不出刘海、运行中改 meta 无效。最小补改一处：`.chat-composer-shell` 在 pwa-mode 下 `padding-bottom: calc(0.5rem + env(safe-area-inset-bottom))`（按 fork 惯例放 fork 自己的 CSS 文件而不是改 `index.css`）；`Shell.tsx:345` 那条可一并加。验证通过后可考虑 `black` → `default`。

说明：WebFetch 只放行了 developer.apple.com；github.com、bugs.webkit.org、firt.dev、medium、dev.to 的内容都来自搜索摘要，没能打开原文，301108 的描述是二手转述。upstream 原始 ThemeContext 代码没拿到（git/gh 都要审批），以你描述为准。

## 真机测试清单（按优先级）

1. **SE（现有）**：设置 → 通用 → 关于本机，报 iOS 版本；并回答"改 meta 后有没有删掉重加书签"。
2. **任一刘海/灵动岛 iPhone，竖屏，删掉重加书签后**：看聊天输入框下沿是否被 Home 条压住、底部有没有空白条、顶部 header 文字有没有被毛玻璃糊掉；Web Inspector 读 `innerHeight`、`screen.height`、`100vh`（期望 innerHeight = screen.height − 状态栏高，如 Pro Max 932−59=873）、`env(safe-area-inset-top/bottom)`（期望 0 / 34）。
3. **同一台，亮色主题**：看黑条观感；可顺手把 meta 改 `default` 重加一次，看状态栏是否跟背景同色、切主题是否即时变。
4. **SE 或刘海机**：聊天页弹键盘再收起，看输入框下方有没有多出一条空白（iOS 26.0 键盘 bug）。
5. **SE 横屏**：先看书签会不会旋转；会的话看顶部有无空白条。
6. iPad 有再测：竖/横屏顶部黑条高度、底部有无缺口。

主要链接：[Apple meta 文档](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariHTMLRef/Articles/MetaTags.html) · [WebKit 301108](https://bugs.webkit.org/show_bug.cgi?id=301108) · [arc PR #8](https://github.com/joejohnston72-dev/arc/pull/8) · [herdr PR #199](https://github.com/devswha/herdr-web-ui/pull/199) · [band PR #681](https://github.com/band-app/band/pull/681) · [MacRumors iOS 26.1](https://forums.macrumors.com/threads/ios-26-1-pwa-full-screen-broken.2470545/) · [Firtman iOS 15 theme-color](https://x.com/firt/status/1402035503189434376) · [firt.dev 兼容表](https://firt.dev/notes/pwa-ios/) · [bram.us interactive-widget](https://www.bram.us/2026/09/11/webkit-supports-interactive-widget-and-hopefully-safari-will-too/) · [Apple 论坛 800125 键盘 bug](https://developer.apple.com/forums/thread/800125) · [Apple 论坛 110854 SE 横屏](https://developer.apple.com/forums/thread/110854) · [横屏 inset 表](https://gist.github.com/fozzedout/5e77925381991a9570151550992baf14) · [tldraw orientation](https://github.com/tldraw/tldraw/issues/1724) · [dev.to iPadOS 26](https://dev.to/reinhart1010/pwa-in-ipados-26-is-a-joke-38g1)
