# 汇总：iOS 底部留白修复 review（claude-opus + agy-g38f）

结论：两家都判「需修改（小改）」，方向对，但有刘海 iPhone 没测过。

## 共识（2 家）
- 有刘海机型风险未验证：去掉 `viewport-fit=cover` 后 `env(safe-area-inset-*)` 变 0，依赖它的 `pb-safe-area-inset-bottom` 等处失去底部留白，可能被 Home 指示条盖住。
- `ThemeContext.tsx:61,69` 注释还写着 status bar，过时。
- `fork-customizations.zh-CN.md` 第 37 条小标题与前面条目不一致（`合并冲突时` → `同步官方时怎么办`）。
- 键盘逻辑不受影响；ThemeContext 删除后无死代码。
- 无法在保持 `black-translucent` 的前提下用 CSS 修复；亮色主题配黑色状态栏有视觉代价，暗色几乎无感。

## 单家
- opus：第 37 条两句话没实测（「iOS 不认运行中改 meta」「添加书签时读取」）；建议试 `default`（浅色状态栏）；`#root` 的 `100vh` 修复后实测值待确认。
- agy：建议试「只改 `black`、保留 `viewport-fit=cover`」是否足够；中文版 `**原因：**` 也应为 `**为什么改：**`。

## 分歧
- 第 37 条事实：opus 说两句没测过要改；agy 说都准确。以 opus 为准（我们没测过）。
- agy 担心刘海机顶部「双重留白」（`index.css:179`）：去掉 cover 后 inset=0，我判断不成立，待真机。
