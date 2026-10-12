# 终审任务：sync/v1.37.4 合并前全面检查（去/留的判据）

## 你是谁、在哪

你是这次 upstream 同步的**独立终审者**。前面已有 5 轮方案评审、1 轮代码 review（3 家）、1 轮文档 review（3 家）——但那些都是**在被审者自己划定的范围内**做的。你的任务是**跳出来，从头独立复核**，最后给出一个明确的结论：**这个分支能不能合进 `dev`**。

仓库：`d:/code/opensource/claudecodeui`（Windows，Git Bash）
当前分支：`sync/v1.37.4`，tip = `fb4615a4`

**不要改任何文件。** 你是只读审计。发现问题就报告，不改代码、不改文档、不 commit。

## 背景（已核实的事实，你可以直接用，但值得抽查）

远端配置：`upstream` = `siteboon/claudecodeui`（官方），`origin` = `wltiger/my-cloudcli`（本 fork）。
`main` 镜像 `upstream/main`；`dev` 是 fork 的工作分支。

本次要合的版本：**upstream v1.37.4**（commit `7c3049fe`，tag `v1.37.4`）。

上游这次的核心内容是这些（从 `git log` 拿的，按主题分组）：

**A. 后台任务相关（本次冲突的重灾区，也是 fork 的核心诉求）**
- `b9d3d129` fix(claude): stop a held run's background tasks before a new turn takes over (#1395)
- `80dd5c29` fix(chat): keep a queued message waiting while background work runs (#1434)
- `208c7156` fix(claude): hold the CLI open for backgrounded agents and workflows (#1291)
- `557109a2` fix: recover background-agent results and status, read-only temp browsing, clone-token redaction (#1347)

**B. effort level 相关**
- `51fb5757` feat(providers): let custom models declare reasoning-effort levels (#1418)
- （另有 `48c8ae4c` codex 新模型、`b7320c91` opencode reasoning variants）

**C. compaction 相关**
- `d450ed85` feat(chat): say a compaction out loud, as one row with its summary folded in (#1295)

**D. 其他大量 upstream 改动**（i18n 多语言、sidebar、settings、git compare、model 标签、LaTeX、IME 等，约 40+ commit）

**上游这次 tag 之前的版本**：v1.37.3（`70e57859`）。注意：fork 曾**丢失过 v1.37.3 的 merge 信息**，用 `c6053841`（record-only merge）补回。

## fork 的两条核心诉求（本次合并成败的最终判据）

fork 有大量自定义，但**只有两条是"必须保住、否则这次合并就是失败的"**：

1. **后台任务中给主 agent 发消息，不能把后台任务/子 agent 杀掉。**
   场景：用户在跑 dispatch-agent CLI（主 agent 停下等子 agent），此时发消息 → 老版本会把后台任务全杀。fork 为此做了一系列修复。
   注意方向：原则上尽量用 upstream 的方案（upstream 这次的 `b9d3d129` 正是解决同一问题），但**"不杀后台任务"这个行为必须保住**。

2. **compaction 只显示一行**（摘要折叠在那一行里）。
   fork 的实现（`MessageKind = 'compact_boundary'`）vs upstream 这次新加的（`compact?: CompactionInfo` 字段，三阶段 running/done/failed）。用户的实际痛点是：老版本压缩内容显示两遍、极占界面，要翻山越岭才能找到压缩前的记录。**合并后必须是"一行"**。

## 你要做的检查（四大块）

### 块 1：上游同步对齐度（最重要）

逐条核实：**upstream v1.37.4 的内容是否完整、正确地进了这个分支**。

方法（自己动手验，不要只信我的描述）：

```bash
cd /d/code/opensource/claudecodeui

# 拓扑检查
git merge-base sync/v1.37.4 upstream/main        # 应 = 7c3049fe
git log --oneline sync/v1.37.4..upstream/main    # 应为空（upstream 无遗漏）
git rev-list --parents -n1 945f36f2              # 应有两个 parent = 真 merge

# 内容检查：拿 upstream 的每次改动，看落在 fork 里是不是对的
git log --oneline v1.37.3..v1.37.4               # 本次上游全部 commit
git diff v1.37.3..v1.37.4 --stat                 # 本次上游全部改动文件
```

**重点抽查**：上游改动过的文件里，有哪些是 fork 也改过的（即冲突文件）？冲突文件解出来的结果，**是否保留了 upstream 的新增部分**？

特别要警惕一种翻车（`docs/upstream-sync.md` 第 5 步有写）：
- **duplicate registration**：两边在同一个"概念槽位"各加了一个东西（路由、事件监听、导出），物理位置不同 → git 看不出冲突 → 运行时只用其中一个，静默错误。
- **rename 只改到一边**：upstream 改了共享符号的名字，fork 自己加的引用旧名字的行不在冲突块里 → 静默过期。

### 块 2：两条核心诉求是否真的保住了

**不要只看测试绿不绿**，要读代码确认行为：

诉求 1（后台任务不杀）：
- 主实现文件 `server/modules/providers/list/claude/claude-runtime.provider.js`
- 守卫在 `finally` 附近（搜 `heldForBackgroundWork` / `backgroundWorkPending` / `hasOutstanding`），三个信号是 OR 关系——**三方都要在**，少一个就是缺陷。
- 快照文件 `server/modules/providers/list/claude/claude-background-work.ts`
- 测试 `server/modules/providers/tests/claude-background-work.test.ts`（38 个）、`claude-runtime-hold.test.ts`
- 要问自己：upstream 的 `b9d3d129`（"stop a held run's background tasks before a new turn takes over"）**和 fork 的"不杀"是不是直接矛盾**？如果 upstream 是"接管前先杀"，fork 却要"不杀"，那这两者怎么共存的？fork 是否正确地**屏蔽/绕开**了 upstream 那段杀逻辑，同时保住了 upstream 其他修复？（fork 的做法是保留自己的 claim/reuse 机制替代 upstream 的 stop-before-takeover —— 核实这一点是否真的成立。）

诉求 2（compaction 一行）：
- fork 侧：`compact_boundary` MessageKind —— 搜 `compact_boundary`
- upstream 侧：`compact?: CompactionInfo` —— 搜 `CompactionInfo` / `compaction`
- 前端：`useChatMessages.ts`、`MessageComponent.tsx`
- 核实：两套机制是否**共存不打架**？UI 上会不会又变成两行/两遍？

### 块 3：数据迁移（用户要拿真库升级）

`server/modules/database/migrations.ts`。

fork 原来有 `effort_levels` 列（自定义模型用），upstream 这次引入 `effort_values` + `effort_default`。迁移序列应该是：

```
addProviderModelEffortColumns(db);
copyProviderModelEffortLevels(db);
widenProviderModelsProviderCheck(db);
dropProviderModelEffortLevelsColumn(db);
```

**关键**：`widen` 会重建表（SQLite 改 CHECK 约束只能重建），重建时**读旧列 → 写新列**，所以 `copy` 必须在 `widen` **之前**，`drop` 必须在 **之后**。顺序错了会**静默丢掉所有自定义模型的 effort 数据**。

请独立核实：
1. 这四步的调用顺序是否如上（读代码，别信我抄的）。
2. `copyProviderModelEffortLevels` 的 WHERE 条件是否会漏数据 / 重复覆盖（应为 `effort_levels IS NOT NULL AND effort_values IS NULL`）。
3. `widen` 重建表时列定义是否完整（有没有丢列）。
4. 迁移是否幂等（重复跑会不会炸）——看 PRAGMA table_info 之类的 guard。
5. 有没有对应的测试，测试断言了什么。

### 块 4：文档完整性与准确性

要检查的文档（英中双语都要看）：

| 文档 | 看什么 |
|---|---|
| `docs/fork-customizations.md` + `.zh-CN.md` | 本次改动的 11 个条目（#1,#4,#8,#22,#25,#29,#30,#31,#35,#38,#39）；描述是否还准确；有没有该退休没标退休的 |
| `docs/upstream-sync.md` + `.zh-CN.md` | 新增的「第 0 节：查 merge base」是否正确、可操作 |
| `docs/adr/0012-*.md` | 状态注记 |
| `.claude/CLAUDE.md` | 新增的 `## Dispatched agents` 节是否吞掉了别的标题（之前踩过这个坑） |
| `.scratch/sync-v1.37.4/00~10` | 本次的全过程记录是否连续、有没有自相矛盾 |
| `docs/README.id.md` | 上游新增的印尼语 README（`git add -u` 曾漏掉它） |

**文档审计的重点是"事实错误"，不是"文笔"**。前一轮文档 review 抓出的错误类型很有代表性，请重点复查这些是否已全部修好、有没有同类漏网的：

- 把**方案阶段的笔记**当成了代码事实写进文档（最典型的错误来源）；
- 行号过期（代码改了，文档里的 `:942` 还是旧的）；
- 归属判断错误（说"这是 fork 独有的文件"，其实 upstream 也有 → 用 `MSYS_NO_PATHCONV=1 git cat-file -e "upstream/main:<path>"` 核，**成功 = upstream 有，失败 = fork 建的**）；
- 说"某段代码在 commit X 里"但其实不在。

**这一条务必执行**：`docs/fork-customizations.md` 里每一条的「Files」列表，凡声称归属的，用 `git cat-file -e` 逐条核一遍。归属标错的文件会在**下一次合并**时才爆雷。

## 输出要求

写到：**`d:/code/opensource/claudecodeui/.scratch/sync-v1.37.4/11-terminal-review.md`**

（这是唯一允许你写的文件。别的一律只读。）

格式：

```markdown
# 终审：sync/v1.37.4

终审人：agy-co46　日期：2026-10-12　被审 tip：fb4615a4

## 结论
[明确一句话：可以合并到 dev / 不可以，必须修 X 后才能合]

## 1. 上游对齐度
[逐项 + 证据（命令输出 / file:line）]

## 2. 两条核心诉求
[诉求1 / 诉求2 分别给结论 + 证据]

## 3. 数据迁移
[四条顺序核实 + 幂等 + 测试]

## 4. 文档
[问题清单]

## 必须修（must-fix）
| # | 问题 | 证据 | 建议 |
|---|---|---|---|

## 建议但不阻塞
...

## 我核过但确认没问题的
[列出来，让用户知道覆盖到了]
```

**纪律**：

- **每条结论都要有证据**（命令 + 输出，或 `file:line` + 代码）。没验到的写"未验证"，不要猜。
- 如果查到的和任务描述里说的**不一样**，如实写，并明确指出是哪一条描述错了。这份任务书本身可能就有错——前面 5 轮就抓出过我写的多处事实错误。
- 找不到问题也要说清楚**你覆盖了什么范围**，不能说"看起来没问题"。
- 用中文写结论（技术名词保留英文）。
