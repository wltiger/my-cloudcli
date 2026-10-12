# sync/v1.37.4 研究记录 · 03 冲突映射与 resolution plan

日期：2026-10-10。`conflicts.txt` 224 行（`Merge conflict in` ×216 + rename/delete 备注 ×8），
`clean-merged.txt`：blob triplets 1–542 + `Auto-merging` 543–807。
行号下指 conflicts.txt 行号（文件顺序即该文件顺序）。

## A. 需用户决策的 P0（upstream-sync 步骤 5.3：retire / adapt / keep）

### D1. 上游 held-run 接管语义 vs #29 reuse（`b9d3d12`）— P0 中的 P0

- 上游：新 turn 接管前先停旧 work（"A new message starts a new turn, which stops that work"）。
- Fork #29：新 turn push 进同一进程继续跑（heldTurn claim）。
- 两者互斥，不可兼得。`claude-runtime.provider.js` 在 clean-merged（自动合了！line 567），
  冲突行 24 另有 fork 改动。**自动合的结果极可能语义错误**（claim 点与 stop 点共存），
  merge 后必须人审该文件全文。
- 另 `208c7156`（上游自研 hold-open）+ `557109a2`（recover background-agent results）
  同文件自动合——三方语义叠加，需逐 hunk 确认 ledger/claim 仍成立。
- 决策选项：(a) keep #29（revert 上游 stop 点，保留 push）；(b) adapt（只在有 snapshot
  work 时 hold、无 work 时接受上游 stop？需设计）；(c) retire #29/#30/#31 整组
  （若上游 hold 已覆盖 80% 价值）。**需用户定 + 真机/实测验证**。

### D2. 自定义模型 effort 列：上游两列 vs fork 一列（`51fb5757` ↔ #25/#38）

- 上游：`effort_values` + `effort_default`；路由 `effort: {values, default?} | null`；
  校验收紧到 provider 预定义集合；ModelLibraryPanel toggle 表单（81 行冲突）。
- Fork：`effort_levels` 一列；`buildCustomModelEffort`（medium-优先默认）；
  checkbox 组；`KNOWN_EFFORT_LEVELS` 前后端各一份。
- 相关文件：冲突 19/21/22（repo/schema/migration-test）、30（routes）、32（service）、
  81（ModelLibraryPanel）、46（service test）、48（routes test）；
  clean-merged：557/558/560/561/576/578。
- 决策选项：(a) 以上游两列为底，fork 列退役 + 数据搬运 migration
  （`effort_levels → effort_values/effort_default`，medium-默认规则保留或丢？）；
  (b) 双轨并存（强烈不推荐：同一模型两处声明）。
  `base_url`/`api_key`/`context_window` 三列 + endpoint 解析不受影响，保留。
- 另 #38 的 `effort.default` 生效（`resolveClaudeEffort` sentinel）与上游 `default`
  语义正交，可保留——但上游 ModelLibrary 不再送字面 `'default'`？需合时确认。

### D3. Compaction 双行风险（`d450ed85` ↔ #22）

- 上游：`compact?: CompactionInfo` 挂 assistant row（server types +20，冲突行 60 在列），
  client fold（useChatMessages +121，冲突行 71 在列），MessageComponent +30（行 105）。
- Fork：`compact_boundary` 独立 kind。
- 机制正交（不同事件、不同字段/kind），merge 大概率文本可合；**语义风险是同一次
  compaction 渲染两行**。决策：(a) 都留，实测看；(b) fork boundary 行在上游 compact
  行存在时隐藏；(c) 退役 #19 slice（连带 anchor 规则改 `findLastCompactBoundaryIndex`
  来源——退役成本高）。**需用户定，浏览器实测辅助**。
- 附带：`d1b09330` resume-branch 显示（碰 anchor 语义，读 diff 确认）。

### D4. CLI-liveness 第三个 busy 源（`3cc73ede` ↔ #31）

- 上游新文件 `claude-cli-liveness.service.ts`（无冲突，干净加入）+ `sessions.service.ts`
  +32（冲突行 36）+ routes 1 行（行 30）。
- #31 要求 busy = turn-in-flight，background-work 独立。若上游 liveness 直接写 busy
  语义，需确认 CLI 驱动 turn 是否进 turn-in-flight（能否 Stop？dispatcher 是否排队？）。
- 另 `80dd5c29` dispatcher 把 background-work 视为 busy（clean-merged line 600，
  **自动合了**）——与 #31 "scheduler gate 只读 turn-in-flight" **语义直接相反**，
  升级为 P1，resolution 时读全文，必要时升 P0。请用户一并定：
  scheduled-message 在 hold 期间是 interrupt（上游）还是递进 held 进程（#31 设计）。

### D5. OpenCode editing 上游是否自研（#27 flag 重验）

- 条目要求每次 sync 重验 `opencode.supportsMessageEditing`。
  命令：`git show upstream/main:server/modules/providers/services/provider-capabilities.service.ts | grep -A3 opencode`
  （research 时未跑，resolution 前跑）。
- 若仍 false：重贴 boolean + 两个 facet（行 28/31/55/65/62 + chat.json 行 135/153）。
- 若 true：整条退役（两个 revert 路径会打架）。

## B. 按条目 resolution（keep + 重贴，shape 优先于 literal diff）

| 条目 | 冲突行 | clean-merged 必审 | 要点 |
|---|---|---|---|
| #1 sidebar flag | 192–194, 222 | 775–778, 806 | resize（`6c51fcaa`）同文件，逐 hunk |
| #2 favorites | 178, 201, 204 | 757, 785, 788 | 同上 |
| #3 chat 外观 | 68, 93, 95, 101, 108–109, 173, 178, 180 | 617, 628, 642, 653, 655, 657, 660–661, 753, 755, 759 | U5 重写 PanelView，找新尾插点；max-w 五处（剩四处）sync |
| #4 model label | 66, 110 | 615, 662 | 与 #28 同文件一起合 |
| #5 sw 离线 | —（无冲突） | 758 AboutTab | ADR 重读：上游动过 sw.js/headers？`git log upstream` 查 |
| #6 命名 | 222 | 806 | 重验三字符串仍分叉 |
| #7 PWA last session | 170 | 749 | — |
| #8 版本 SHA | 223, 224 | — | ⚠️ vite.config 双 `define` 必 grep |
| #9 .claude gitignore | — | — | 有改动才需重贴 |
| #10 VAPID | — | — | 上游修了就取上游（`git log -S noreply@claudecodeui`） |
| #11 fullscreen | 67, 95, 105, 220 | 616, 645, 657, 804 | U7 同文件 |
| #12 file-tree touch | 123–126 | 674–680 | — |
| #14 browser runtime dir | — | — | 上游 PR #995/#1000/#917 是否合了？`git log --grep` 查 |
| #15 tab menu | 164–165 | 743, 745, 801 | — |
| #16 通知 collapse | 16?, 53–55 | 602–604 | sw.js？（conflicts 无 sw.js → 上游未动，keep） |
| #19 picker 过滤 | 72, 107, 172 | 620, 659, 752 | #1229 后形状已在条目内更新，照做 |
| #21 表格滚动 | 103 | 655 | 取上游 class + 4 class；另合 LaTeX/image-path hunk |
| #22 compact | 60, 25, 31, 76, 216, 71–72, 69, 77, 105, 80, 135, 153 | 568, 577, 609, 619–620, 624, 628, 657, 800 | D3；opencode-runtime 自动合（574）必审 guard 还在 |
| #23 fork/clear | 60, 58, 25, 28, 31, 30, 206, 62, 71–72, 69, 77, 76, 105, 170, 135, 153, 87 | 609, 607, 568, 575, 577, 576, 790, 612, 619–620, 618, 625, 624, 657, 749, 663, 692, 725 | 路由表重查 duplicate（行 30）；`bb81d0b0` 看 session 建立链路 |
| #24 路径大小写 | 18, 41, 43 | 557, 563, 610 | migration 追加位；codex 测试断言 shape |
| #25 endpoint | 60, 21, 18, 19, 32, 30, 24, 216, 81, 25, 33 | 609, 560, 557–558, 578, 576, 567, 800, 629, 568, 579 | D2；`mapCliOptionsToSDK` 两 block 都留 |
| #26 TTS | 206, 78, 106, 181, 79, 1 | 790, 626, 658, 760, 627 | 小 hunk 重贴 |
| #27 OC edit | 31, 28, 55, 65, 62, 135, 153 | 577, 575, 604, 614, 612 | D5 先行 |
| #28 footer | 65–66 | 614–615 | 与 #4 同文件 |
| #29 reuse | 24 | 567（自动合⚠️） | D1；canUseTool live-reads 必保 |
| #30 ledger | 24, 37 | 567, 586（上游新 hold 测试！） | D1；`claude-background-work.test.ts` 上游 +71 行是新机制测试，需逐行读 |
| #31 两态 | 54–55, 53, 62, 74, 73, 58?, 135, 153, 214? | 602–604, 612, 622, 621, 600（⚠️自动合） | D4；abort 臂、`isActivityIndicatorVisible` 两处调用 |
| #32 Other 多行 | 95 | 645 | — |
| #33 agy | 17, 18, 21, 30, 35–36, 58, 50, 107, 157, 172, 205, 207, 213, 216, 221 + locales | 554–555, 557, 560, 576, 581–583, 607, 599, 659, 734–735, 751–752, 789, 791, 796, 800, 805 | CHECK 并集；migration 顺序；watch roots 并集；grant 路由 additive |
| #34 依赖 pin | 15（package.json）、14（lock） | — | 五 spec 行：上游升了就取上游，否则 keep；lock 重生成；`allowedTools` block 在行 24 里保 |
| #35 agy 显示 | 98, 103–104, 100, 73, 76, 105, 30, 33, 48 | 650, 655–656, 652, 621, 624, 657, 576, 579, 597 | Express 4 wildcard 语法保（查 package.json express 大版本！） |
| #36 agy title | 58, 36?, 170 | 582（watcher roots）、583 | U6 改名链路：确认 write-back call 仍在调用路径上 |
| #37 状态栏 | 209, 215 | 793 | 上游 `87c44f58` follow-OS 是否碰同一 meta？互补则共存 |
| #38 effort 默认 | 23, 24, 38, 207 | 566, 567, 791 | D2 连带；catalog 不变量测试（default ∈ values）上游加 Haiku block 后重跑 |
| #39 OC prune | 29 | 575（⚠️自动合，上游重写了 synchronize） | 条目内已有三方 diff 方案，照做 + 补 `deleteSessionByProviderSessionId` |

## C. 无条目冲突（unexpected — 按 merit 解，大概率取上游）

- 行 27 `codex-runtime.provider.ts`、行 42 `codex-runtime.test.ts`、行 44 `opencode-models.test.ts`、
  行 47 `provider-token-usage.service.test.ts`、行 49 `session-history-cache.service.test.ts`、
  行 34/59 `session-history-cache.service.ts` / `message-unification.ts`（后者重点查：
  fork 是否动过？`git diff merge-base..dev -- 该文件`）、行 56–57 shell-websocket、
  行 61 AuthContext（`dc7cb6c6`）、75 useFileMentions、82–86 chat 杂项测试、
  89 tokenBudgetSessionScope、90 toolGrouping、92 CollapsibleDisplay、94 DiffStatsBadge
  （`d392d9eb`？）、96 SubagentPanel、99 tools/index、111 streamingMarkdown、112 toolGrouping、
  113 CodeEditor（`05b63060`）、116–120 code-editor/command-palette renames、
  127–131 git-panel（`a2ed7f3c`）、158 Onboarding、159 workspaceApi、
  184–190 shell 全套（`68283131`）、208 SessionProtection、210 WebSocketContext
  （`d4dd34da`）、211–212 useSessionProtection、217 DarkModeToggle。
- 原则：先看 fork 侧 diff 是否为零（`git diff <merge-base>..dev -- <file>` 空 = 直接取上游，
  冲突纯因上游改 + fork 侧 rename 扰动）。非零才人审。
- `message-unification.ts`（行 59）若 fork 非零且无条目 → 补条目或并入 #35。

## D. 全局必查（逐项打勾）

1. `vite.config.js` grep 双 `define:`（#8，行 224）。
2. `provider.routes.ts` 路由表 duplicate registration（行 30；`/fork` vs `/fork-at-anchor`
   + #33 grant + #35 media + 上游新路由）。
3. fork-owned 复活检查：`scheduled-triggers` 表/`ComposerScheduleMenu`（#20）、
   `claude-first-message` 相关（wontfix 记忆）、`supportsRewind`/`rewindAnchor`
   （#23 已删，勿从旧 diff 重贴）。
4. `codex-models.provider.ts`（行 26）：#17 已退役取上游 + `48c8ae4c` GPT-6，
   确认无 fork 残留。
5. `.oxlintrc.json`（行 1）：`frontend-shared-file` 含 chatSpacing/chatTypography
   + voiceStreamConfig（#3/#26）。
6. i18n：en/zh-CN 保留 both sides（#3/#12/#22/#23/#27/#31/#32/#33）；其余 locale 取上游；
   config.ts 新语言注册（cs/he/pt/id）+ fork 侧是否有 agy 语言项。
7. `package.json`：test 脚本 `--experimental-test-module-mocks`（#25）+ 五 pin（#34）；
   express 大版本（#35 wildcard 语法）。
8. typecheck + lint + npm test（失败集对基线：Windows ~11 + 本机已知）。
9. smoke-test 三层（按 upstream-sync 步骤 6）：D1–D4 退役/适配区 → 上游新功能×定制
   共存（quick-settings tabs × ForkQuickSettings、rename × agy title、model 标签 × #11、
   compaction 双行、permission 只读显示 × adopt）→ 上游 bugfix 抽查。

## E. 留给执行阶段的命令备忘

- `git fetch upstream`（动手前重跑）→ `git merge-tree --write-tree dev upstream/main`
  确认 preview 仍有效（`00-baseline.md` 结论：main 未动则有效）。
- `git checkout -b sync/v1.37.4` 已存在且即当前分支 → 直接 `git merge upstream/main`。
- D5 先行：`git show upstream/main:...provider-capabilities.service.ts | grep -B2 -A8 opencode`
- #10：`git log upstream/main --oneline -S 'noreply@claudecodeui' -- server/modules/notifications/vapid-keys.service.ts`
- #5：`git log v1.37.2..upstream/main --oneline -- public/sw.js server/index.ts`
- #14：`git log upstream/main --oneline --grep='995\|browser.*runtime\|playwright' -i | head`
- C 组 fork-diff 速查：`git diff 677b7ba4..dev --stat -- <file>`（merge-base 见 00）。
