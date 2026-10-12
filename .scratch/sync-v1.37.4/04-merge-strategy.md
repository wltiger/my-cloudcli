# sync/v1.37.4 研究记录 · 04 合并策略评估

日期：2026-10-11。问题：53 个上游提交逐个 cherry-pick，还是一次 merge？
用户原则：上游已实现同功能 → 比较后优先上游方案，fork 有增量改进则薄调；
fork 方案同等或更差 → 撤销 fork 方案；无关功能同文件 → 比对避让，
fork 尽量走独立文件替换/集成。

## 先说结论：不要逐个 cherry-pick。用"调基线后的一次 merge"。

### 证据 1：cherry-pick 在搬运拓扑下基本不可用

- 53 提交中文件清单 CLEAN（不碰 51 定制文件）的 22 个，实测 `cherry-pick --no-commit`：
  **14 过 / 8 败**。败例：`6b2fdd8e`（i18n 语言注册，`languages.ts` 上下文对不上）、
  `ed3f0bfc`（opencode child sessions，synchronizer 已被搬运改得面目全非）。
- 按时间顺序从最老试 3 个（`99ea0525`、`c1be241b`、`46973fc9`）：**0/3 全败**。
- 根因：cherry-pick 的三方基线是"该提交在上游的父提交"，而 dev 的对应内容是搬运来的——
  行号、上下文、甚至文件路径都对不上。这不是"解几个冲突"的事，是**系统性上下文错位**。
  53 个里 34 个碰定制文件，只会更糟。逐个合 = 53 次手工三方比对，成本高于一次 merge，
  且每次都要人肉重建基线，出错概率更高。

### 证据 2：调基线后一次 merge，冲突面从 287 缩到 96

- 新基线 preview（`preview-step2.txt`）：96 双改文件，markers 138 处。
- 其中 37 个是定制文件（`step2-fork-hit.txt`），59 个是非定制文件（大概率取上游即合）。
- 上游 130 个真新文件自动进入（含 D1/D3/D4 的关键新文件）。
- 即：一次 merge 的真实人审量 ≈ 37 定制文件 + 4 add/add + 59 非定制抽查。
  逐个合的人审量 ≈ 34 个碰定制文件的提交 × 每提交多文件 + 8 个 CLEAN 失败。
  **一次 merge 完胜**。

### 推荐方案：B — 新 scratch 分支 +  graft 基线说明 + 一次 merge

具体走法（待用户拍板后执行）：

1. 从 `dev` 建新 scratch（如 `sync/v1.37.4-take2`，旧 `sync/v1.37.4` 废弃或重用——需定）。
2. 在该分支上 `git merge upstream/main`，得 96 双改文件的真实冲突。
3. 逐文件决议，遵循用户原则：
   - **P0 五项先行**（D1–D5）：D1（held 接管 vs reuse）、D2（effort 两列 vs 一列）、
     D3（compaction 双行）、D4（liveness busy）、D5（OC editing flag 重验）。
     每项都是"上游实现了相近功能"的验收点——按用户原则做 upstream-first 比较，
     fork 有增量则薄调，同等/更差则撤销。D1–D4 需用户逐项定（已列选项，见 03 的 A 节，
     语义分析仍有效）；D5 是一行命令先验。
   - **37 定制文件**：按条目 guidance 重贴（shape 优先），其中 #25/#38（effort）、
     #22（compact）、#29/#30/#31（hold 两态）与 P0 绑定。
   - **59 非定制文件**：默认取上游，抽查是否有 fork 散改
     （`git diff 677b7ba4..dev -- <file>` 非空才人审）。
   - **4 add/add**：逐个手工合（两个测试文件可大概率拼接，两个源码文件需设计取舍，
     尤其 `MarkdownImage.tsx` 与 `modelLabel.ts`）。
   - **全局必查**（03 的 D 节转抄）：vite 双 define、路由 duplicate、退役残留复活、
     express 大版本、i18n both-sides、oxlintrc、test 脚本 flag。
4. 验证：typecheck + lint + npm test（对 Windows 基线失败集）+ 三层 smoke 清单。
5. 落盘：dev fast-forward（或按 upstream-sync 步骤 7 走 main→dev）+ push（两次确认）。

### 为什么不用"先把 v1.37.3 真 merge 进 dev 再合 v1.37.4"（方案 A）

- 把 `70e57859` 真 merge 进 dev 会产生一个**内容几乎全等的空 merge**
  （新文件 0 缺失，292 文件差异几乎全是 fork 定制）——除了把 merge-base 修到 v1.37.3，
  不带来任何内容收益，却要解一轮"搬运 vs 原版"的假冲突（116 added-in-both 级别），
  纯成本。
- 替代：merge 时用 `--allow-unrelated`？不，历史是相关的，只是内容搬运。
  最干净的是**不动历史、只在新 scratch 分支上 merge**——git 的 merge-base 陈旧
  只影响冲突计算量（96 已可接受），不影响结果正确性。历史第 2/3 代价
  （`git log`  archaeology 变难）可通过 merge message 注明基线来缓解。

### 与用户原则的对照（执行阶段的每文件 checklist）

1. 上游同功能 → 比较 → upstream-first，fork 增量薄调 / fork 落后则撤销。
   适用：D1（hold）、D2（effort 列）、D3（compact 行）、D5（OC edit）、
   #14（browser runtime：查 #995 是否合）、#10（VAPID：查是否修）、#21（表格：merge 非 replace）。
2. 无关功能同文件 → 比对避让，fork 走独立文件。
   现状审计：#3（ForkQuickSettings 独立文件 ✓，只剩两行 footprint）、
   #11（FullscreenSurface 独立 ✓）、#22（compactCommand 独立 ✓）、
   #29/#30（turn-reuse/background-work 独立 ✓，runtime 只剩 call sites）、
   #33/#35（agy 目录独立 ✓）。**这次 merge 不新增独立文件需求**，
   但 4 处 add/add 中的 `MarkdownImage.tsx`（fork #35 的媒体组件 vs 上游同名同职责文件）
   是反例：同名同目录，避让失败，需二选一或改名——执行时重点处理。
3. 退役检查（sync 后）：D2 若取上游列 → `effort_levels` 列 + 相关条目退役（含数据搬运）；
   D5 若上游自研 → #27 整条退役；D1 若取上游 → #29/#30/#31 整组退役（最大的一块）；
   D3 若取上游 → #22 的 #19 slice 退役（连带 anchor 来源改）。

## Subagent 派遣建议（待用户确认后派）

以下三项适合并行外派，均为只读研究（read-only），互不依赖：

1. **S1 · D1 深研**（`subagent-opus`，思考型）：读 `b9d3d12` + `208c7156` + `557109a2`
   全文 vs fork #29/#30/#31 三个条目 + `claude-runtime.provider.js` 现状，
   输出"上游 hold 机制 vs fork ledger/reuse/两态"的逐点对等表 + retire/adapt/keep 建议。
   理由：P0 中最复杂的语义对比，主会话做会吃掉大量上下文。
2. **S2 · D2+D3 深研**（`subagent-opus`，思考型）：`51fb5757` 全文 vs #25/#38 +
   `d450ed85` 全文 vs #22，输出列级/字段级对等表 + 数据搬运方案 + 双行渲染预测。
   理由：同上，且 D2 涉及 DB migration 设计。
3. **S3 · 59 非定制文件扫描**（`subagent-haiku`，繁琐型）：对 step2-both.txt 中不在
   fork 清单的 59 文件逐个跑 `git diff 677b7ba4..dev -- <file>`，输出"非空（需人审）"
   vs "空（取上游）"两列清单。理由：机械、量大、判断简单。

S1/S2 完成后用户定 D1–D4，再进执行。不派 S3 则主会话自己扫（约 59 条命令，可脚本化，
其实也可不派——一句话脚本能出清单，人审非空项即可， Paso 可选）。
