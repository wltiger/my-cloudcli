# 向官方反馈问题

把 bug、设计缺口，或者在这个 fork 里干活时发现的技术结论，反馈给 `siteboon/claudecodeui`（`upstream`）的流程和模板。跟 `docs/upstream-sync.md`（反方向：把 upstream 的改动拉进来）配套。这个要在主对话里交互着跑——为什么不能后台跑，见 `upstream-pr` 这个 skill 自己的说明。

## 起草之前

**先查重。** upstream 自己的 `CONTRIBUTING.md` 里明文写着：*"Search first. Check existing issues and pull requests to avoid duplicating work."* 当成硬性要求，不是可做可不做——这条已经救过这个 fork 一次：避免了重新提一个 upstream 已经仔细考虑过、并且拒绝掉的方案（`siteboon/claudecodeui#1132`，被维护者一句"this is intentional"关闭、没有合并）。只搜标题不够——搜到相近的东西，要把那个 issue/PR 的正文和评论全部打开看完，不能只看标题，真正的理由通常在评论里，不在标题上。

```
gh search issues "<几种不同的说法>" --repo siteboon/claudecodeui --json number,title,state,url
gh search prs "<同样几种说法>" --repo siteboon/claudecodeui --json number,title,state,url
gh issue view <n> --repo siteboon/claudecodeui --json body,comments,closedAt
gh pr view <n> --repo siteboon/claudecodeui --json body,comments,mergedAt,closed,commits
```

至少试 2-3 种不同的措辞——能查到真正相关结果的那个说法，很少是第一次想到的那个。

**除非是一眼就能看出对错的小 bug，否则先问方向再动手。** 同样是 `CONTRIBUTING.md` 里的话：*"Discuss first for new features. Open an issue to discuss your idea before investing time in implementation. We may already have plans or opinions on how it should work."* upstream 确实说了纯 bug 修复可以直接开 PR（"Bug fixes are always welcome. If you spot a bug, feel free to open a PR directly."）——但 `#1132` 当初也是按"修 bug"的名义提的，照样在设计层面被拒了，所以只要涉及真实的设计取舍（不只是一处显而易见的改错），默认先开 issue、提出方向，而不是先把代码写出来。等维护者确认方向之后再补 PR。

## 起草条目

第一次用到这套流程时再新建 `docs/pull-requests/`（带一个 `README.md` 索引）——不用提前建好。每条单独一个文件，不管最后是 issue 还是代码 PR 都统一编号（GitHub 的 issue 和 PR 本来就共用一套编号）：`docs/pull-requests/PR{NN}-{slug}.md`，再配一个 `.zh-CN.md` 版本给维护者自己审核用（不管中文版怎么写，里面草稿的标题/正文本身都保持英文——见下面）。

模板：

```markdown
# PR{NN}: {标题}

**状态：** 草稿——待审核
**类型：** Issue | PR
**目标仓库：** `siteboon/claudecodeui`
**发现时间：** {日期}，{背景——比如"同步这个 fork 到 vX.Y.Z 的过程中"}

## 查重
{跑过哪些搜索、试过哪些说法、查到了什么（如果有的话）、为什么那些不能覆盖这次的问题}

## 背景
{为什么是现在发现的，跟别的什么事有关联}

## 证据
{每条结论都要能对应到当前实际上线代码里的具体文件/行号——不是转述之前的研究笔记；起草这一步要重新对着 HEAD 核实一遍，从最初发现到写草稿之间代码可能已经变了。明确区分哪些是直接的代码追踪结论（"这一行代码就是这么写的"），哪些是自己的解读/推断（"这样看是这个意思，但代码没有明说"）——维护者需要知道这个区分，才知道该在哪个点上反驳。}

## Issue/PR 标题草稿
> {标题}

## Issue/PR 正文草稿
{`gh issue create --body` / `gh pr create --body` 要用的原文，英文——这是真正要提交的内容，哪怕这份文件其他地方都是中文，这一块也不要翻译。}

## 提交理由
- 查过重了（附上搜索记录）
- 证据是代码实证的，不是猜的
- 定位成"报告/提问"而不是"要求"——相关的话引用 `CONTRIBUTING.md` 的"discuss first"
- 跟已知的其他事情的关系（比如某个已退休的定制项、之前被拒绝过的类似尝试）

## 提交前待确认
1. 标题/正文要不要改？
2. 现在提，还是等某件事（比如你自己先动手用一下受影响的功能）？
3. 用哪个 GitHub 身份提交？
```

在 `docs/pull-requests/README.md` 加一行：

```markdown
| # | Title | Type | Status | Link |
|---|---|---|---|---|
| [PR{NN}](PR{NN}-{slug}.md) ([中文](PR{NN}-{slug}.zh-CN.md)) | {标题} | Issue/PR | {状态} | {提交后的 GitHub 链接，没提交就填 —} |
```

## 如果维护者反驳某个结论

要有心理准备——这是审核在起作用，不是出问题了。被反驳的时候，不要直接重申，也不要立刻让步。往下多追一层，把代码路径完整走一遍（比如从界面上的一次选择，一路追到服务端校验，再到最终传给底层 SDK/CLI 调用的那个具体参数），不要停在第一处看着像那么回事的地方就下结论。回去之后精确说清楚：现在确认了什么、之前哪里说错了、为什么。一个结论如果扛住了这种反驳，比一个从没被质疑过的结论，对最终提交来说是硬得多的证据。

## 提交之前

标题、正文、提交理由都要拿到明确同意，才能跑 `gh issue create` / `gh pr create`，没有例外。批准并提交之后，把这条的 `状态` 改成"已提交"，附上生成的 issue/PR 链接，文件不要删——留一份"提交了什么、后来怎么样了"的记录（合并了、被拒了、还开着）。

如果最后决定不提交了（优先级变了、发现这事对这个 fork 其实不重要了等等），文件也留着——把`状态`改成"不提交——{原因}"，不要删。哪怕这次不提交，之前做的核实工作也是真实、以后用得上的。
