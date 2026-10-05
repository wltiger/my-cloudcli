**总体结论：需修改（小改）。** 修复思路有你的真机数据支撑，代码改动本身是对的。要改的有三处：两条文档（第 1、2 条）和一处过时注释（第 3 条）。另有一个最大的风险还没测：有刘海的 iPhone 上，底部会不会被 Home 指示条盖住（见第 4 条和最后一节）。

说明：`git -C` 命令没拿到授权，所以分支和基准 commit 我没能自己核对，改动是按 diff.txt 加工作区文件审的。两边内容一致，`index.html:7,23` 和 `ThemeContext.tsx` 都和 diff 对得上。

## 问题（按严重程度）

**1. ⚠️ `docs/fork-customizations.md:539-541` 和 zh-CN `536-538` · 第 37 条只写了无刘海机型的实测，没说清有刘海机型没测过**
- 证据：
  - Why 段只写了 SE / 8 的数据，但这个改动对所有 iPhone 都生效。
  - 去掉 `viewport-fit=cover` 后，有刘海机型上 `env(safe-area-inset-*)` 预期都变成 0。依赖它的地方有：`pb-safe-area-inset-bottom`（`FullscreenSurface.tsx:125,135`、`SidebarSessionItem.tsx:199`、`Settings.tsx:177`、`SidebarProjectList.tsx:67`）、`SidebarFooter.tsx:43`、`index.css:69` 的 `--mobile-nav-total`、`index.css:771` 的 `.chat-input-mobile`。这些地方全部失去底部留白。
  - 网页这时会不会画到 Home 指示条下面，我手上没有依据，只能靠真机确认。
- 建议：先在有刘海的机型上实测（见最后一节）。在那之前，文档里注明「只在无刘海机型上验证过」，别写成全机型都成立。

**2. ⚠️ 第 37 条有两句话写成了事实，但这次没有实测支撑**
- 位置：`docs/fork-customizations.md:539` "which iOS does not honour"；`:541` "The style is read when the bookmark is added"。zh-CN `536`、`538` 是同样的话。
- 证据：你的背景说明里只有 viewport 和 inset 的测量数据。「运行中改这个 meta 不生效」和「样式在添加书签时读取」都没有测过。后者是「每次启动时读」还是「添加时读」，我也没法确定。
- 建议：要么补一次真机测试（改 meta 后杀掉 app 重开，看状态栏变不变），要么改成「据报道 / 未验证」，或者删掉这两句。

**3. ⚠️ `src/shared/context/ThemeContext.tsx:61`、`:69` · 注释过时**
- 证据：两处注释还写着 "Update iOS status bar style and theme color…"，但现在只改 `theme-color` 了。
- 建议：改成 "Update theme color for dark/light mode"。代码里没有留下没用的变量或 import，`classList` 切换和 `theme-color` 切换都还在，亮/暗切换逻辑是完整的。

**4. 视觉代价和其他做法（第 3 点）**
- 暗色主题：背景 `#141414` 配纯黑状态栏，几乎看不出接缝，可以接受。
- 亮色主题：背景 `#f6f4ef` 配纯黑条，反差很大。这是明确的代价，文档里已经写了。
- 能不能保持 `black-translucent` 又修好：按你的实测，`position: fixed; height: 100vh` 也被裁在 647。所以在这个模式下，CSS 层面没有办法画到最底下 20pt。改成不透明状态栏是有依据的选择。
- 「按主题静态选」：做不到。meta 只有一份静态值，主题是运行中才知道的。
- 值得测的另一个选项：`default`（同样不透明，浅色条）。如果它也能消除留白，亮色主题看着会更顺，代价换成暗色主题配浅色条。哪个更好要看真机效果，我不下结论。

**5. ⚠️ `docs/fork-customizations.zh-CN.md:540` · 小标题和前面条目不一致**
- 证据：zh 文件里前面 34 条都用 `**同步官方时怎么办：**`，第 37 条用的是 `**合并冲突时：**`。
- 建议：改成 `**同步官方时怎么办：**`。

**其他核对结果 ✅**
- 第 37 条里的数字（647 / 667 / 20pt、`100dvh` = 647、`100vh` = `screen.height`）和你的实测一致。
- 中英两版内容一一对应。
- 英文版格式（Files / Why / What differs / On upstream conflict）和第 36 条一致。
- 文件归属（`index.html`、`ThemeContext.tsx` 写成 upstream-owned）我没能用 `git cat-file` 核实，因为 git 命令被拦了，建议你自己跑一下。

## 不确定、需要真机验证的点

1. **有刘海机型（如 iPhone 12 及以后），竖屏，桌面书签模式**：
   - 输入框、侧栏底部、Settings 底部会不会被 Home 指示条盖住？
   - 顶部有没有和状态栏重叠，或者多出一段留白？
   - 顺便量一下 `innerHeight`、`screen.height` 和四个 inset 的值。
2. **有刘海机型横屏**：没有 cover 时左右会出现黑边或底色边。`manifest.json` 设了 `portrait-primary`，影响应该不大，但没测过。
3. **SE 修复后 `100vh` 的值**：
   - `body.pwa-mode #root` 用的是 `height: 100vh`（`index.css:174`），你修复后只量了 `innerH` = 647。
   - 如果 `100vh` 还是 667，`#root` 会比可见区域高 20pt。因为有 `overflow: hidden`，现在看不出问题，但值得确认一下。
4. **键盘**：
   - iOS Safari 应该不支持 `interactive-widget=resizes-content`（我的印象是只有 Chromium 支持，没有查证）。键盘位置实际靠 `useVisualViewportKeyboardOffset` 的 baseline 差值算。
   - 这次改动会改变 `innerHeight` 和 `visualViewport.height` 的初始差值，但 baseline 取的是看到过的最小差值，理论上能自动适应。
   - 仍建议在 SE 上弹一次键盘，确认输入框不会被顶两次，也不会被键盘挡住。
5. **`black` 和 `default` 的视觉对比**（见第 4 条），以及「已有的桌面图标要删掉重新添加」这件事本身。
