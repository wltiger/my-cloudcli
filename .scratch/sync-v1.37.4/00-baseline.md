# sync/v1.37.4 研究记录 · 00 基线（2026-10-11 修正版）

> ⚠️ 修正：初版误写 merge-base 为 v1.37.2 release 即"跨度 v1.37.2→v1.37.4"。
> merge-base 的 commit hash 确是 `677b7ba4`（v1.37.2），但 dev 的**内容**已含 v1.37.3。
> 以下为核实后的准确拓扑。

## 真实拓扑：v1.37.3 是"搬运"进 dev 的，不是 merge 进去的

- `dev` 与 `upstream/main` 的 merge-base = `677b7ba4`（v1.37.2 release）。✓（hash 无误）
- 但 `70e57859`（v1.37.3）**不在 dev 祖先里**（`merge-base --is-ancestor` exit=1）。
- v1.37.3 的内容经两条搬运线进入 dev，**6 个提交全已在 dev 历史里**：
  - `53b1dc1d` chore: sync upstream v1.37.3（09-11，单父节点，大搬运：764 文件 +39798/-21921）
  - `110fee3b` adopt upstream scheduled-messages dispatcher
  - `6001b587` unify Fork on upstream base
  - `ac05aeb5` OpenCode editing via upstream Edit path
  - `d6f329b1` retire fork Rewind
  - `111e56a1` reconcile glossary/ADRs/inventory（=`sync/v1.37.3-split` 尖端，IN-dev ✓）
- 另有 `sync/v1.37.3` 分支（尖端 `2c067b43`）：含真解决提交 `ecb17c4d`（815 文件），
  **NOT-in-dev**。`dev` 与 `ecb17c4d` 差 207 文件（+30025/-7731），差值顶部全是搬运后新增的
  fork 功能（agy 整套、turn-reuse、ledger 等）——即 split 线的决议 dev 都有，
  之后 fork 又往前走了 59 个提交。
- 定量：`dev` vs 上游 v1.37.3（server+src）：292 文件不同，其中 +27256/-701 行；
  上游 v1.37.2→v1.37.3 共 709 文件，交集（债务候选）149 文件；
  上游 v1.37.3 新增且 dev 缺失的文件：**0**（新文件全搬到了，除路径重组外）。
- `main` == `upstream/main` == `7c3049fe`（v1.37.4）。rerere=true。工作树干净。

## 后果：merge-base 陈旧 → 假冲突

- 旧基线（677b7ba4）直接 preview：`added in both` **224** + `changed in both` 63
  = 287 个双改文件，conflict markers 1434 处。
  其中 224-4=**220 处是假冲突**：v1.37.3 已搬运进 dev，merge 误判为双方新增。
- 新基线（70e57859）preview（`preview-step2.txt`，52349 行）：
  `changed in both` **92** + `added in both` **4** = **96 个双改文件**，
  conflict markers 138 处。旧 `conflicts.txt`（224 行）**作废**，勿再使用。
- 4 处 add/add 全是真冲突（双方 v1.37.3 后各建同名文件）：
  1. `claude-background-work.test.ts` — fork #30 ledger 测试 vs 上游 `208c7156` 新 hold 测试
  2. `provider-capabilities.service.test.ts` — fork #22 compact 测试 vs 上游 `51fb5757` effort 测试
  3. `MarkdownImage.tsx` — fork #35 agy 媒体 vs 上游 `4b98d2ea` workspace 图片
  4. `modelLabel.ts` — fork #4 美化 vs 上游 `7f4eba78` 模型标签（fork 侧亦为 v1.37.3 后新建）
- 96 双改 ∩ 51 定制文件 = **37 文件**（`step2-fork-hit.txt`）。即"逐个合"人审核心集。
- 上游 v1.37.4 相对 v1.37.3 的真新文件（dev 缺失）：server+src 共 **130** 个，
  含 `claude-cli-liveness.service.ts`（D4）、`claude-settings-permissions.service.ts`（U8）、
  `claude-runtime-hold.test.ts`（D1）、`claude-compaction.test.ts`（D3）等关键文件——
  新基线 merge 会自动取用，无需手工搬。

## 关键程序性结论

`docs/upstream-sync.md` 步骤 1 的 preview 命令以 `dev` 为 base：
`git merge-tree --write-tree dev upstream/main` ——在搬运拓扑下它天然产生 220 处假冲突。
本次 sync 必须先解决基线问题（见 04-merge-strategy.md），否则所有冲突分析都建立在假信号上。
`03-conflict-map.md` 基于旧 conflicts.txt，**决议映射表（B/C/D 节）作废**，
但 `02-upstream-analysis.md` 的语义分析（P0 决策点 D1–D5）不受影响——那些是内容碰撞，
与基线无关。
