# 收工：wrap-up-2026-10-05
结论：有遗留（见「漏项 / 暂缓」）　起点：43edb1fc　日期：2026-10-05

> 本文件同时是 **iOS 桌面书签底部留白** 的完整排查记录，以后别的机型再出问题可以从这里追溯。
> 同目录：`research-fable-other-devices.md`（fable 对其他机型的评估）、`review-opus.md` / `review-agy-g38f.md` / `review-summary.md`（改动 review）。
> 派遣目录（14 天后可能被清理，已拷贝结果到本目录）：`~/.agents/dispatch/2610050853-claudecodeui-review`、`~/.agents/dispatch/2610050917-claudecodeui-research`。

## 一、排查记录（追溯用）

### 现象
用户用 Safari「添加到主屏幕」把页面装成桌面书签，设备 **iPhone SE 3（375×667pt，无刘海，Home 键），iOS 26.5.2**。登录页底部有一条约 20pt 空白，页面没撑满；聊天页输入框下方也有一条较大空白。

### 配置（改前）
- `index.html`：viewport 含 `viewport-fit=cover`、`interactive-widget=resizes-content`；`apple-mobile-web-app-status-bar-style` = `black-translucent`
- `ThemeContext.tsx`：切主题时在运行中把该 meta 在 `default` / `black-translucent` 之间切换

### 真机实测数据（用临时调试条取得，已删除）
**改前**（`black-translucent` + `viewport-fit=cover`），聊天页：

| 项 | 值 |
|---|---|
| `innerHeight` = `visualViewport.height` = `clientHeight` = `100dvh` = `100svh` | 647 |
| `100vh` = `100lvh` = `screen.height` | 667 |
| `env(safe-area-inset-top / right / bottom / left)` | 20 / 0 / 0 / 0 px |
| `navigator.standalone` / `display-mode: standalone` | true / true |
| `body.pwa-mode`、`#root` 的 top / height | 有、0 / 667 |
| 固定在 `top:0` 的探针 | 在屏幕最顶（状态栏盖在上面） |
| 固定在 `bottom:0` 的探针 | 停在 647，屏幕最底 20pt 是页面底色 |
| 固定 `height:100vh` 的探针、`bottom:-20px` 的探针 | **同样被裁在 647，画不出来** |

登录页（改前）：内容区被裁在约 647，底部一条米色带，卡片底部被截断。

**结论**：页面从屏幕最顶开始画，但布局视口只有 `屏幕高度 − 状态栏高度`，且是从**底部**扣掉；底部那段 CSS 完全无法使用。

**改后 A**（`black` + 去掉 `viewport-fit=cover`）：`innerH` 647，inset 全为 0，窗口从状态栏下面开始，红色底边条贴在屏幕最底，留白消失。
**改后 B**（`black` + **保留** `viewport-fit=cover`）：`innerH` 647，`inset T0 B0`，`meta cover: true`，红条贴底，留白消失 ✅。→ 结论：只有状态栏样式是原因，`viewport-fit=cover` 不用去掉。
**改后 C**（`default` + 保留 `viewport-fit=cover`）：用户反馈"好像也可以"（底部无留白）；亮/暗主题下状态栏颜色、切主题是否即时变色、暗色下字色，**用户尚未明确确认**。

### 走过的错路（避免重蹈）
1. 凭猜测把 `100vh` 改成 `100dvh`（登录页、Onboarding、`#root`）：方向反了，`dvh` 恰好是错的那个值（647），已还原。
2. 同时改了 `useVisualViewportKeyboardOffset.ts` 的基线逻辑和给 `html` 加背景色：没有数据支撑，已还原。
3. 一度以为 `.chat-input-mobile` 的 60px 是原因：它是无人引用的死 CSS，不是。
4. 教训：**没拿到真机数值前不要动代码**。一开始就应该加调试条（`innerHeight` / `100vh` / `100dvh` / `100lvh` / safe-area inset / 固定边缘探针），拿到数值再判断。

### 原因（实测 + 二手资料）
- 实测事实：`black-translucent` 下，页面画在整个屏幕上，布局视口却少了状态栏高度，缺口在底部。
- 疑似根因（fable 查到，**只有搜索摘要，没能打开原文，属二手资料**）：iOS 26 系的 WebKit 回归，WebKit bug 301108：`black-translucent` + `viewport-fit=cover` 时窗口高度按"状态栏以下"算，少一个状态栏高度。
- 缺口大小只取决于状态栏高度（推测）：SE 20pt（实测）、刘海机约 47、灵动岛机约 59、iPad 约 20–24。iOS ≤18 两种写法都没有缺口（推测，没找到反例）。
- 另有资料称 iOS 26.1 起 `black-translucent` 竖屏会变成不透明（MacRumors），本机 26.5.2 仍有缺口，**与该说法不符**，以实测为准。

### 修法与代价
- 改：`index.html` 状态栏 meta → 不透明样式；`ThemeContext.tsx` 去掉运行中切换该 meta 的代码（iOS 不认，各方一致）。
- `black`：已在 SE 3 实测通过，代价是亮色模式下状态栏纯黑。
- `default`：状态栏理论上跟随 `theme-color`（iOS 15+，来源 Firtman 推文，二手），项目 `ThemeContext` 已按主题同步 `theme-color`（亮 `#f6f4ef`、暗 `#141414`），所以两种主题应与页面同色。当前 `index.html` 为此值。
- 该 meta 何时读取（添加书签时 / 每次启动）：多份资料说添加时读，**全是 GitHub PR 描述，Apple 文档没提，未验证**。我们每次改动都重新添加了书签，所以没有对照实验。

### 其他机型的评估（fable，详见 `research-fable-other-devices.md`）
| 场景 | 结论 | 依据类型 |
|---|---|---|
| 刘海 / 灵动岛 iPhone 竖屏顶部 | 变好（原配置有双重顶部缩进） | 代码推出 |
| **刘海 / 灵动岛 iPhone 竖屏底部** | ⚠️ 窗口会铺到屏幕底，聊天输入框只有 `pb-2`，**没有底部安全区内边距**，Home 指示条（约 34pt）可能压住输入框 | 代码推出 + 推测，**未实测** |
| iPhone 横屏 | 无变化 | 资料 + 推测 |
| iPad | 不确定，倾向变好 / 无变化 | 推测 |
| Android / 桌面 / Safari 标签页 | 无变化（该 meta 是 iOS 专属，非全屏无效） | 资料 + 代码推出 |
| 键盘弹起 | 无变化 | 代码推出 + 实测 |
| 亮色主题 | `black` 变差，`default` 大概率更好 | 实测 + 资料 |

附带发现（与本改动无关）：iOS 26.0 有 bug，收起键盘后 `visualViewport.height` 持续少 24，`useVisualViewportKeyboardOffset` 会算出 24px 残余；据称 26.1 已修，本机 26.5.2 应不受影响。

### 以后别的机型出问题怎么查（最小步骤）
1. 在 `src/main.tsx` 临时加调试条：`innerHeight`、`screen.height`、`100vh/100dvh/100svh/100lvh`（用探针 div 取 `offsetHeight`）、四个 `env(safe-area-inset-*)`（用 `padding:env(...)` 的探针读 `getComputedStyle`）、`navigator.standalone`；再加固定在 `top:0` 和 `bottom:0` 的彩色细条，看是否贴到屏幕边。
2. 改完 `npm run build:client`；设置里点「Refresh offline cache」（`sw.js` 对 `/` 是缓存优先）；删掉桌面书签重新添加。
3. 对照上表：`innerHeight` ≠ `screen.height` 且差值 = 状态栏高度 → 就是本问题；底部条贴不到屏幕底 → 同上。
4. 刘海机若出现输入框被 Home 指示条压住：给 `.chat-composer-shell`（`ChatComposer.tsx:300`）在 pwa-mode 下加 `padding-bottom: calc(0.5rem + env(safe-area-inset-bottom))`，终端手机底栏 `Shell.tsx:345` 同理；按 fork 惯例放进 fork 自己的 CSS 文件，不改 `index.css`。
5. 调试完删掉调试代码，重新 build。

## 大纲
- 排查并修复 iPhone SE 3 桌面书签底部留白：`index.html` 状态栏 meta 改 `default`（实测过 `black`）；`ThemeContext.tsx` 去掉运行中切换状态栏 meta（未提交）。
- 文档：`docs/fork-customizations.md` + `.zh-CN.md` 新增第 37 条（未提交）。
- 派 opus + agy 做 review，派 fable 评估其他机型；结果见同目录。
- 跑题：无（`docs/agents/backlog.md`、`start-cloudcli.bat`、`docs/browser-use.md`、`.scratch/26100401-agy-external-delete-sync` 在本会话开始前就已存在，与本任务无关）。

## 漏项 / 暂缓
- ⚠️ 暂缓：`default` 的三项验证——两种主题下状态栏颜色是否与页面一致、切主题是否即时变色、暗色下字色是否清楚。用户只说"好像也可以"。**不通过就退回 `black`（已实测）**。
- ⚠️ 暂缓：有刘海 iPhone 没测；输入框底部安全区内边距未补（用户决定"尽量安全修改，只保证 SE 3 没问题"，所以不补）。
- ⚠️ 暂缓：review 意见里没采纳的——`.chat-composer-shell` 底部内边距、保留 cover 之外的刘海机真机验证。
- ✅ 已做：review 提出的注释过时（`ThemeContext.tsx`）、中文小标题不一致、第 37 条两句未测过的话已删或标注。
- ⚠️ 未做：`.chat-input-mobile`、`.ios-bottom-safe`、`--mobile-nav-total` 是无人引用的死 CSS（fable 发现），属原有问题，未动。

## 文档同步
### agent 文档
- `.claude/CLAUDE.md`（项目）：不需要改。
- `docs/fork-customizations.md` + `.zh-CN.md`：已新增第 37 条，且已按 `default` 更新 ✅。官方归属已核对：`index.html`、`ThemeContext.tsx` 均为 upstream-owned（`git cat-file -e upstream/main:<path>` 成功）。
- memory：拟新增一条 reference，见「踩坑」。
### 其他文档
- 全仓 `*.md` 里除 fork-customizations 外没有提到 `status-bar-style` / `black-translucent` / `viewport-fit`，无需同步 ✅。

## 提交状态
- 未提交：`index.html`、`src/shared/context/ThemeContext.tsx`、`docs/fork-customizations.md`、`docs/fork-customizations.zh-CN.md`、`.scratch/wrap-up-2026-10-05/`（本轮）。
- 本会话开始前就未提交、与本任务无关：`docs/agents/backlog.md`、`start-cloudcli.bat`、`docs/browser-use.md`、`.scratch/26100401-agy-external-delete-sync/`（**提交时不要带上**）。
- 未 push：无（`git log @{u}..` 为空）；stash：无；worktree：只有主仓；本轮新建分支：无。

## 清理
- 临时文件：调试代码已删除（`src/main.tsx` 已还原）✅；`dist/` 已重新 build，不含调试代码。
- 后台任务 / 派出 agent：opus、agy-g38f、fable 都已完成 ✅；没有占用端口的进程（本轮没起 dev server）。
- 派出的 CLI 会话（已交付、不续跑，已按用户确认删除 3 个）：agy 的 `d2e16be6-…`（约 2.3MB）、opus `3556f08d-…jsonl`（463KB）、fable `a772053a-…jsonl`（957KB）。这三个任务已交付、不需要续跑，已删。
- 派单 STEM 目录：`2610050853-claudecodeui-review`、`2610050917-claudecodeui-research` 保留（结果已拷到本目录）。

## 踩坑
1. 看到用户消息末尾的 `/as-dispatcher`，因为不在技能列表里就当成没有，没去磁盘查，也没问。原因：该 skill 有 `disable-model-invocation: true`，不出现在可调用列表里。→ **以后：遇到 `/xxx` 不在列表里，先 Glob `~/.claude/skills/` 确认；是 `disable-model-invocation` 的就 Read 它的 SKILL.md 照做，不要默默忽略。** 去处：全局 `~/.claude/CLAUDE.md`（跨仓通用）。
2. 没拿到真机数值就改 `100vh/100dvh`、键盘 hook，白改两轮。→ **以后：iOS 表现类问题，先加调试条取数值再判断。** 去处：本记录 + memory。
3. 改动后没提醒用户要先 `npm run build:client`，且 `sw.js` 对 `/` 缓存优先，导致可能没测到新代码。→ **以后：生产模式的前端改动，要告知"先 build、再点 Refresh offline cache、必要时重新添加书签"。** 去处：项目 `CLAUDE.md`（只对本仓成立）。
4. 拟写进 memory 的 reference：`reference-ios-pwa-status-bar-gap.md`——"iPhone SE3 iOS 26.5.2 桌面书签底部 20pt 缺口：根因 black-translucent，解法状态栏 meta 改 default/black；排查步骤和数据见 `.scratch/wrap-up-2026-10-05/wrap-up.md`；刘海机未测"。

## 下一步
1. 用户在 SE 3 上确认 `default` 的三项（颜色、切主题、字色）；不通过 → 退回 `black`，改 `index.html` 一行并同步文档第 37 条。
2. 有刘海 iPhone 到手后再测，若输入框被压 → 按「以后别的机型出问题怎么查」第 4 步补。可敲 `/to-backlog` 记一条。
3. 提交（拟 `fix(pwa): use opaque status bar to avoid 20pt bottom gap on iOS 26`）；push 另问。
