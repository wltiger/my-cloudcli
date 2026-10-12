# sync/v1.37.4 研究记录 · 02 上游 v1.37.4 变更分析

日期：2026-10-10。区间：v1.37.3 (`70e57859`) → v1.37.4 (`7c3049fe`)，53 提交。
（注：相对 dev 的 merge-base 是 v1.37.2，但 v1.37.3 的内容已在上次 sync 合过，
本次只需理解 v1.37.3→v1.37.4 的增量。）

## P0 · 与定制条目语义碰撞（需用户决策 retire/adapt/keep）

### U1. `51fb5757` custom models declare reasoning-effort levels ↔ #25/#38

上游给 `provider_models` 加了 **`effort_values` (JSON) + `effort_default`** 两列
（fresh schema + 幂等 migration），路由解析 `effort: {values, default?} | null`，
service 校验 level 必须出自该 provider 预定义模型声明的集合，
catalog 的 custom option 直接 emit `effort`（预定义形状），composer/runtime 零改动捡起。
ModelLibraryPanel 加 toggle 表单 + 列表展示。

Fork 现状（#25 follow-up）：**`effort_levels` (JSON array) 一列**，
`buildCustomModelEffort` 默认 medium-优先，`ClaudeCustomEndpointFields.tsx` checkbox 组，
`KNOWN_EFFORT_LEVELS` 前后端各一份。

碰撞点：
- 同一张表的 effort 语义，上游两列 vs fork 一列 → merge 后若并存，同一模型两处声明打架。
- 上游 `default` 语义 = "composer 送 Default 时 provider 用的 level"，
  与 #38 的 `effort.default` 生效（`resolveClaudeEffort` 解析 `'default'` sentinel）**正交但可叠加**。
- 上游校验收紧到 provider 预定义集合；fork 的校验是固定五级
  （`CUSTOM_MODEL_EFFORT_LEVELS`，且 #38 断言 Haiku 全档）。
- 上游 ModelLibraryPanel 的 toggle 表单 vs fork 的 checkbox 组：同一表单两种 UI。

倾向（待用户定）：以上游两列为底，fork 的 `effort_levels` 列退役（需 migration 搬运已存数据？——
fork 列里已有用户数据，删列前需 `effort_levels → effort_values/effort_default` 搬运，
或保留读兼容），`buildCustomModelEffort`/`assertValidEffortLevels` 转调上游形状，
checkbox UI 与上游 toggle 二选一。`base_url`/`api_key`/`context_window` 三列不受影响。

### U2. `d450ed85` compaction 可见性 ↔ #22

上游：`CompactionInfo {phase: running|done|failed, trigger?, preTokens?, postTokens?,
durationMs?, error?}`，以 **`compact?: CompactionInfo` 可选字段**挂在普通 assistant row 上
（+ `compactSummary`），server 把 system 事件转成一句话
（"Compacted · manual · 335k → 10k · 2m 22s"），client 折叠 summary 进同一行，
`useChatMessages.ts` +121 行做三行 reconciliation（boundary/summary/bare "Compacted"）。
文件：`claude-sessions.provider.ts` +76、`useChatMessages.ts` +121、
`MessageComponent.tsx` +30、`compactionRows.test.ts` 新、`claude-compaction.test.ts` 新。

Fork（#22 #19 slice）：**`compact_boundary` 独立 MessageKind**（chrome 行渲染，
`normalizeMessage` 新分支认 `type:system/subtype:compact_boundary`）。

关键判断：两者** mechanistically 正交** ——上游认的是 compaction 的开始/过程/摘要事件，
fork 认的是 SDK 的 boundary 事件；字段（`compact?`）vs kind（`compact_boundary`）不撞名。
但**视觉/语义重复**：同一次 compaction 可能渲染两行（一行上游的 Compacted 句，
一行 fork 的 Compacted marker）。SessionRewindNotice 式去重？需 merge 后实测决定：
(a) 都留（可能双行）；(b) fork 的 boundary 行在上游 `compact` 行存在时隐藏；
(c) 退役 fork 的 #19 slice（anchor/branch-filter 依赖的 `compaction` part-type 分支是 OpenCode
侧的，不受影响；但 Claude 侧 `findLastCompactBoundaryIndex` 被 anchor 规则共用——退役要连带改）。
→ 需用户决策，浏览器实测辅助。

### U3. `3cc73ede` CLI-driven turns as running ↔ #31

上游新增 `claude-cli-liveness.service.ts`（121 行）：把 Claude CLI 自己驱动的 turn
上报为 running（`sessions.service.ts` +32，`provider.routes.ts` 1 行）。
Fork #31 的核心主张是 turn-in-flight 与 background-work-outstanding 两态分离，
且 running 状态来源是 chatRunRegistry + held-turn map。

碰撞点：上游给 "busy" 加了**第三个信号源**（CLI liveness）。
若上游的 liveness 直接写 busy 语义，可能与 #31 的两态划分冲突
（CLI 驱动的 turn 是否算 turn-in-flight？Stop 能否 abort 它？）。
需读 `claude-cli-liveness.service.ts` 全文 + `sessions.service.ts` diff 再定。
→ resolution 时重点审查文件。

### U4. `b9d3d12` + `208c7156` held-run 背景任务 ↔ #29/#30

- `208c7156`：上游自己实现了 "hold the CLI open for backgrounded agents"（runtime +24，
  `claude-background-work.test.ts` +71）——即 fork #30 替换掉的上游旧机制（`DEFERRED_WORK_TOOLS`
  名单）可能已被上游重写。#30 条目说"若上游改了 DEFERRED_WORK_TOOLS 仍执行删除"，
  但这次可能是**机制级重写**，需对比：上游新 hold 判定 vs fork 的 Stop-hook ledger。
  若上游的新判定已能看见 subagent（#30 要解决的正是 `Agent` 不在名单），
  #30 的 ledger 可能可退役或只留 fallback。
- `b9d3d12`：held run 的 background tasks 在新 turn 接管前 stop（runtime +42，
  新测试文件 `claude-runtime-hold.test.ts`）——直接碰 #29 的 reuse 语义：
  上游选择"新 turn 接管 = 先停旧 work"，fork 选择"push 进同一进程继续跑"。
  这是**设计分歧**，不是 merge 冲突：两个行为不能都要（`heldTurn` claim 点 vs stop 点）。
  → 需用户决策，P0 中的 P0。

## P1 · 同文件改动（按既有 guidance 重贴即可，但量不小）

### U5. `9212ee33` quick-settings tabs + pin-to-dock ↔ #3（30 文件，+1389/-145）

`QuickSettingsPanelView.tsx` 重写（+150）、新 `QuickSettingsTabs.tsx`、
`useQuickSettingsPanelState.ts` 新。Fork #3 在 `QuickSettingsContent.tsx` 只有两行
（import + `<ForkQuickSettings/>` 尾插）。若上游把 panel body 结构换了，
两行重贴位置要找；另 `src/shared/utils.ts` +25 是 slash-command/tab id 纯新增，
与 #1 的 flag 无 textual 冲突但同文件（conflicts.txt:222 在列）。
→ 大文件重构 + 小 footprint，resolution 机械但需定位新尾插点。

### U6. `09892b57` 双击标题改名 ↔ #36（agy title）/#23（renameSessionById）

新 `useSessionTitleRename.ts`（138 行）+ `useProjectsState.ts` +67 +
`WorkspaceTitle.tsx` +54。Fork #36 在 `renameSessionById` 里有一行 write-back call，
#23 有 `registerOptimisticSession` 改动（`useProjectsState.ts` 正在冲突列表 170 行）。
→ 改名链路现在多了一条 writer，需确认 fork 的 write-back 是否仍被调用
（若上游改名走了新 hook 而 fork 的 call 还在旧函数里，agy 改名回写会静默失效）。

### U7. `7f4eba78` assistant 回复标模型 ↔ #11（MessageComponent）/#35（tool label）

`MessageComponent.tsx` 在冲突列表（105 行）；上游给每条 assistant 回复加模型标签，
fork #11 在同文件有 footer control row 触点（import + 1 个 control），
#4/#35 有 label 逻辑。→ 同文件三方改动，逐 hunk 合。

### U8. `45677008` 权限规则只读显示 ↔ #29（adopt 权限）/#33（agy 权限）

`PermissionsContent.tsx` +4，新 `ClaudeSettingsFileRules.tsx`（90 行）。
Fork #29 的 `adopt()` 写 `permissions.allow/deny` 进 flag-settings 层，
上游现在把 settings 文件的 rules 只读展示出来——语义互补（一个写一个读），
但若用户在 fork 行为下改了 allow，展示是否一致需验证。→ 主要是 smoke-test 项。

## P2 · 同文件但基本机械

- `ed3f0bfc` opencode hide child sessions ↔ #39：#39 条目已写明"三方 diff 重贴 prune +
  补 `deleteSessionByProviderSessionId`"，本次照做。
- `d1b09330` resume branch 显示 ↔ #29（resume anchor）：读 diff 确认 anchor 语义未变。
- `4b98d2ea` workspace image paths in markdown + `de0908b0` LaTeX ↔ #21（Markdown.tsx）
  + #35（Markdown img 入口）：同文件多 hunk，逐个合。
- `d392d9eb` Bash changed-files row ↔ #35（tool row）：`ToolRenderer`/toolConfigs 附近，
  看 diff。
- `80dd5c29` queued while background work ↔ #31：dispatcher 把 background-work 视为 busy；
  #31 明确要求 scheduler gate 只读 turn-in-flight。**语义直接相反**，需看 diff 全文：
  若上游 dispatcher 现在 `hasBackgroundWork → busy → 拒绝/排队`，fork 的 scheduled-message
  行为（#20 已退役，上游 scheduled-messages 模块是 fork 要兼容的）是否受影响。
  → 升级为 P1，resolution 时读全文。
- `6c51fcaa` sidebar resize ↔ #1/#2/#15（Sidebar 系列全在冲突列表 191-204）：
  sidebar 是 fork 改动最密的区域之一，上游加了 resize 手柄，需逐文件合。
- `f34ac83` 批量删 session ↔ #2（SidebarProjectList 等）：同上。
- `b028e0d` pin project header ↔ #2：同上。
- `7704a90` sidebar 显示 title 而非 prompt ↔ #36（agy title 以 annotation 为准）：
  上游 title 来源若变，需确认 fork 的 override 点仍生效。
- `bb81d0b0` 首消息只发一个 session ↔ #23（session 建立链路）：看 diff。
- i18n 新增 cs/he/pt/id 四语言：`config.ts`（132 行冲突）要加 namespace 注册？
  上游 i18n 条目说"add language support"通常含 config 改动；fork 的 en/zh-CN key 照例保留 both sides。
- `48c8ae4c` GPT-6 Sol/Luna：`codex-models.provider.ts`（26 行冲突），取并集即可。
- `557109a2` recover background-agent results：读一下是否碰 runtime hold 语义（与 U4 相关）。
- `f3620803` ANSI strip、`544baffe` opencode model prefix、`5ce8ed45`/`a6d50c84` codex
  会话：opencode/codex provider 文件多在冲突列表，按文件逐个合。

## P3 · 预计零碰撞（扫 stat 确认即可）

`5fd3de63` id README、`dc946830`/`f05ba1fd` 插件推荐、`5e73a49b` electron build、
`272a1088` cursor login、`dc7cb6c6` auth remount、`fce5c2e7` @file refetch（`useFileMentions`
虽在冲突列表 75 行，但属 #23 触点外围？需合时确认）、`eef9791e` Tab slash、
`580be52d` file refs、`fd424f3f` IME、`3ed3be5a` settings esc、`c6468e13` api key 警告、
`68283131` shell theme、`7090a5db` Running collapse、`05b63060` code-editor confirm、
`4cd470fa` desktop maximize、`f24fa191` auth envelope、`87c44f58` theme follow OS、
`3576232e` memo perf、`d4dd34da` connection lost。
