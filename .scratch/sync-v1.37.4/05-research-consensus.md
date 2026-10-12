# sync/v1.37.4 研究记录 · 05 五家研究共识汇总

日期：2026-10-11。S1×2（opus+sonnet，深研 D1）、S2×2（opus+sonnet，深研 D2/D3）、
S3×1（haiku，扫 59 文件）。结果文件在
`~/.agents/dispatch/2610111213-claudecodeui-research/`（S1-opus.md 等 5 份）。
D5 由主会话自验（见 §4）。

## §1 D1（held-run vs #29/#30/#31）：两家共识 + 3 处分歧

### 共识（可直接执行）

| # | 两家一致的结论 |
|---|---|
| 1 | **整组不 retire**：ADR 0012:11 退出条件（上游同时实现 reuse + tracking）只满足后半句。上游 `b9d3d129` 选的是"停掉再放"，与 #29 的"推进同一进程"产品分歧。 |
| 2 | `208c7156`（名单加 `Agent`）机制弱于快照：`!== false` vs `=== true` 默认值方向相反；不认 `session_crons`（上游零命中）；上游自己在 `557109a2` 里承认名单缺陷又加 tracker 修补。**上游名单机制整个丢掉，不移植 `Agent` 分支。** |
| 3 | `b9d3d129` 取，但**落点必须在 fork `:942`**（claim 块之后），不能照搬上游 `:953` 位置——否则 claim 恒返 null，#29 静默变死代码，不报错。 |
| 4 | `releaseHeldSession` 要 taskId，fork ledger 只有 boolean。**不移植 tracker 就不动 `:942`**，留 TODO。两家都否决半截 `stopTask(null)` 占位写法。 |
| 5 | `claude-background-work.test.ts` **取 fork 479 行，不拼接**：上游 import 的 `startsBackgroundWork` 正是 #30 删掉的；两组断言同条件期望相反。 |
| 6 | #31 两态与上游一致：`startRun`/`isProcessing`/agent 409/`chat.abort` 四处语义未变。吸收 `setRetentionGuard` + subscribe attach 臂（修静默丢帧）；queued-message 门**不照抄上游**（`80dd5c29` 与 #31 语义反向）。 |
| 7 | fork `finally` 的 `inputReleased`（`:1366`）是独有增益（上游 `git log -S` 零命中），重贴时别丢。 |

### 分歧（需 grill 定，编号 G1–G4）

- **G1 · tracker 本次移植还是 TODO？** 两家同意"不移植就不动 :942"。移植 = 接上 `releaseHeldSession` + 收 `claude-runtime-hold.test.ts` 的 supersede 用例 + 补 fake `stopTask`；TODO = 留已知缺口（不可复用 takeover 双写 ~90s，测试未覆盖）。代价：移植约半天量级且与 #30 ledger 并存两套状态；TODO 零风险但缺口留着。
- **G2 · #30 的 `BACKGROUND_WORK_TOOLS`（fork 自身 `['Bash','Agent','Task']` + `=== true`）留还是退？** sonnet：tracker 落成后退役（它只为"hook 未注册"存在）；opus：没表态退它，只说删上游名单。若 G1 选 TODO，则此表必须留（无快照时的唯一兜底）。
- **G3 · 上游 composer 确认弹窗（"新 turn 会停 work"）引不引入？** sonnet：fork 可复用场景下这句话是撒谎，别引入（fork #31 已让 composer 全程发送键）。opus 未涉及。倾向：不引入。
- **G4 · `chat.stop-task` + per-task UI 本次做不做？** 两家一致：这是 tracker 之后的增强，非替代，且 fork 布尔信号做不到。倾向：推迟到 tracker 落成后。

### 附带（执行时顺手）

- 条目 #30 正文漂移：`:426` 仍写"`Agent` 刻意不加"，代码 `:43` 早已是三项。合并时更新文档。
- #30 guideline 重写："删 DEFERRED_WORK_TOOLS"已过时，上游是机制级竞品。

## §2 D2（effort 列）：两家几乎完全一致

### 共识（可直接执行）

- **adapt**：取上游 `effort_values` + `effort_default` + 三态 PATCH（省略保留/`null` 清空）+ per-provider `effortLevels` 白名单；退役 fork `effort_levels` 列、`CUSTOM_MODEL_EFFORT_LEVELS`/`assertValidEffortLevels`、checkbox 组 + `KNOWN_EFFORT_LEVELS`。
- 保留：`base_url`/`api_key`/`context_window` 整链不动；`buildCustomModelEffort` 留用但规范序换成 provider 的 `effortLevels`（medium 优先规则不变——#38 sentinel 依赖它）；#38 一行不改。
- 搬运：`UPDATE ... SET effort_values = effort_levels WHERE ...`（条件见 G5）；`effort_default` 留 NULL 走派生兜底。
- UI：留上游 fieldset（放 `<ClaudeCustomEndpointFields>` 之前，与 endpoint toggle 解耦），退 checkbox。
- 必做：antigravity 矩阵补 `effortLevels: []`（上游必填，否则 typecheck + 新测试双红）。
- 拼接：`provider-capabilities.service.test.ts` 纯追加可拼；`ModelLibraryPanel.tsx` 状态机可拼（effort 控件只留上游）；列清单断言取并集（13 列）。

### 分歧（G5–G6）

- **G5 · 搬运 WHERE 条件**：opus 版 `WHERE effort_values IS NULL`（幂等） vs sonnet 版 `WHERE effort_levels IS NOT NULL`。无实质分歧——合并两者即可。倾向：直接定，无需 grill。
- **G6 · 旧 `effort_levels` 列删不删？** sonnet：留列删代码（SQLite 版本不保证 ≥3.35，且 CHECK 重建列清单要同步）；opus：退役列（删读写代码）。倾向：留列删代码（sonnet 理由硬）。需用户点头。

## §3 D3（compaction 行）：两家一致，选项 b

### 共识（可直接执行）

- **adapt = 选项 b 精确形式**：Claude 的 boundary 改走上游分支（顺序 B：上游块在前，fork Claude 分支删除）；`compact_boundary` kind + 字段 + 前端 case/渲染 + `compact.*` i18n **全留**（OpenCode #21 + Antigravity #33 唯一实现，上游零覆盖）。
- 两个纠正（两家都发现）：①"退役成本高因 anchor 共用"是误读——`findLastCompactBoundaryIndex` 扫原始 transcript 行，退役渲染层零影响；② `compact.button`/`compact.description` 属 #20，退役时别误删。
- 净效果：Claude 一行（数字+时长+可折叠 summary，白拿 running/failed）；OC/agy 维持现状。
- 测试：`claude-sessions.test.ts:598,633` 改断言 `.compact`；`claude-anchors`/`claude-rewind` 测试不动（喂原始行）。
- 语义盯点：`normalizeMessage` 里两 `system` 分支相对顺序；`isCompactSummary` 分支仍在上游分支之后。

无分歧项。D3 可直接定。

## §4 D5（主会话自验）：#27 keep

上游 `opencode.supportsMessageEditing` 仍 `false`（claude:true / cursor:false / codex:true /
opencode:false）。#27 整条 keep：重贴 boolean + `resolveEditAnchor`/`rewindSession` + 注释。
无决策点。

## §5 S3（59 非定制文件）：0 CLEAN 全 REVIEW，但分量差极大

- 0 CLEAN 是结构性的（96 双改定义使然），不是"都有散改"：42/59 在 v1.37.2 根本不存在
  （整文件搬运产物），23 个是 i18n 同模式（搬运语言包 + fork key，key 已验证上游没有）。
- 真要拍板的：18 个〔真冲突〕（含 4 add/add，其中 2 测试已由 S1/S2 决议，
  `MarkdownImage.tsx` + `modelLabel.ts` 需手工合）；41 个自动合并。
- 人审优先级：17 modified 先看 → 18 真冲突 → 其余抽查。
- 两个笔误纠正：prompt"在 real-conflicts.txt 里"应为 step2 96 文件；
  `step2-both.txt` 漏 `.gitignore`（95≠96）。

## §6 待 grill 决策清单（共 6 项，4 项真需定）

| # | 问题 | 两家立场 | 推荐 |
|---|---|---|---|
| G1 | tracker 本次移植还是 TODO？ | 一致：不移植就不动 :942 | grill（工作量 vs 缺口） |
| G2 | `BACKGROUND_WORK_TOOLS` 留退？ | sonnet：tracker 落成后退；opus：未表态 | 绑定 G1：TODO 则留 |
| G3 | 上游 composer 确认弹窗引否？ | sonnet：不引；opus：未涉及 | 不引（grill 确认） |
| G4 | per-task UI 本次做否？ | 一致：推迟 | 推迟（grill 确认） |
| G5 | 搬运 WHERE 条件 | 互补，可合并 | 直接定（无需 grill） |
| G6 | 旧列删否？ | sonnet：留列删代码；opus：倾向连列删 | 留列删代码（grill 确认） |
