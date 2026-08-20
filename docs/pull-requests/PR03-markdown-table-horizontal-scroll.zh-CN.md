# PR03：宽 markdown 表格被压扁而不是横向滚动

**状态：** 草稿 — 待审阅
**类型：** PR
**目标仓库：** `siteboon/claudecodeui`
**发现于：** 2026-08-21，同步 v1.37.2 时 —— v1.37.2 重做表格样式跟本 fork 已有的修复撞了，才把这件事翻出来

## 查重

2026-08-21 在 `siteboon/claudecodeui` 的 issues 和 PRs 里搜过：

- `markdown table scroll`、`wide table`、`table overflow`、`table columns squeezed` → 都没有
- `table` → 只有无关命中（#1131 模型列表"hardcoded table"、#1026 markdown 文件预览、#1132、#1161）
- `markdown rendering` → #215（已合并，就是**加上**表格支持那个 PR）、#278、#939、#1037
- `horizontal scroll` / `min-w-full` → #796 / #859，都是**代码编辑器**工具栏被长行顶出视口，不是 markdown 表格

没人报过。#215（`Add markdown improvements: inline code normalization, table support, and copy button for code blocks`）是表格的来源，它的说明就三条 bullet —— "add remark-gfm to render table" —— 完全没提溢出行为，所以现在这个 CSS 读起来像是疏漏而不是刻意选择。v1.37.2 的 #1153 重做了这几行的样式（圆角边框容器、单元格去边框），但没动尺寸行为。

## 背景

本 fork 在 v1.37.2 之前就带着一个本地修复。这次同步正好在这几行冲突，才想到去查官方是不是从来没被告知过。

## 证据

**直接代码引用。** `src/components/chat/view/subcomponents/Markdown.tsx`（`677b7ba`，199–214 行）：外层 `overflow-x-auto`，表格 `min-w-full`（即 `min-width:100%`）且无上限，单元格完全没有宽度约束。

**机制（CSS 规范行为，不是实测）。** 默认 `table-layout: auto` 下，表格实际宽度是 `max(min-content, min(max-content, available))`。对普通文字表格来说，每列的 min-content 宽度大约就是该列最长的那个单词 —— 所以 6 列、8 列的句子表格，min-content 仍然塞得进聊天列宽，浏览器就选择把文字换行压到很窄，而不是超出容器。表格既然从不超出外层，`overflow-x-auto` 就永远没东西可滚。

这也解释了为什么这个问题看起来时有时无：单元格里如果是长的不可断开串（URL、hash、路径），确实会超过 min-content、确实会溢出、现在也确实能正常滚动。纯文字表格不会。

**fork 改了什么**（三个 class，不动结构）：

- `<table>` 上加 `w-max`，和 `min-w-full` 并存 —— 表格取 max-content 宽度，才可能超出外层、才有东西可滚；`min-w-full` 仍然保证窄表格铺满列宽。
- `th`/`td` 上加 `min-w-28` / `max-w-[22rem]` —— 下限防止某列塌成一个字，上限防止某个啰嗦单元格把表格无限撑宽。
- 外层加 `overscroll-x-contain` —— 横滑到表格尽头就停住，不会把后面的页面/历史一起带走。这在触屏上比较要紧，那个手势很容易误触。

本 fork 的聊天视图里实际用过；但**没有**针对各种语言、特别是 CJK 文本做过对比测试（CJK 是逐字断行，min-content 行为不同），所以上下限的取值在那种场景下未必合适 —— 已列进下面的待定问题。

## 草稿标题 / 正文

见英文版 `PR03-markdown-table-horizontal-scroll.md` 的 "Draft title" / "Draft body" —— 那是实际提交内容，不翻译。

## 提交理由

- 查重覆盖 7 种说法、issues 和 PRs 都搜了；两个接近的（#796/#859）是代码编辑器不是 markdown。
- 失效机制明确标注为"CSS 规范行为"而不是实测结论；代码引用精确到 `677b7ba`。
- `CONTRIBUTING.md` 允许 bug 修复直接提 PR。这个改动只涉及 CSS、纯增量，而且完整保留了 v1.37.2 刚做的新样式 —— 不会读起来像在推翻官方刚做的设计决定。
- 关联：这是 fork 定制 #21。官方接受就退休这条。

## 提交前需要你定的

1. 标题/正文照发，还是要改？
2. `22rem` 上限和 `28`（7rem）下限是本 fork 自己调的，没有依据。是照原样提，还是**砍掉上下限、只提 `w-max` + `overscroll-x-contain`** —— 改动更小、更难被反驳，把列宽调优留给官方？（我倾向后者。）
3. CJK 是逐字断行，min-content 更窄、压缩更严重，但 `22rem` 上限对它也未必对。要不要在 PR 里提一句，还是超出范围？
4. 用 `wltiger` 提，还是别的身份？
