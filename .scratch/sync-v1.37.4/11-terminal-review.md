# 终审：sync/v1.37.4

终审人：agy-co46　日期：2026-10-12　被审 tip：fb4615a4

## 结论
**可以合并到 `dev`**。
本次 upstream v1.37.4 同步在拓扑结构、两条核心诉求保障、数据迁移安全性与幂等性、上游新增功能对齐度以及 TypeScript 类型与代码规范检查上均已达到合入标准。未发现阻断合并的代码或结构缺陷；文档存在 1 处中文旧路径残留，属于非阻塞建议。

---

## 1. 上游对齐度

### 1.1 拓扑检查
- `git merge-base sync/v1.37.4 upstream/main` => `7c3049fe8e157f12b7add3e496d8d2fe6fa5c014`（准确落在 upstream v1.37.4 release tag 上）。
- `git log --oneline sync/v1.37.4..upstream/main` 为空，upstream 自 v1.37.3 以来全部 40+ commit 无一遗漏。
- `git rev-list --parents -n1 945f36f2` => `945f36f2` 的 parents 分别为 `c6053841`（fork 工作分支）和 `7c3049fe`（upstream/main），确认是完整双亲的真正 merge commit。

### 1.2 关键特性与上游 commit 落地核验
- **A. 后台任务相关**：
  - `b9d3d129`（stop held run's background tasks before takeover）：已正确处理，fork 未合入其强杀逻辑 `releaseHeldSession`，而是保留 fork 的 `claimHeldTurn` 机制。
  - `80dd5c29`（keep queued message waiting while background work runs）：已按 fork 架构处理，保持 dispatcher 只看 `isProcessing`，不拦截后台工作会话。
  - `557109a2`（background tasks strip / runtime facets）：`BackgroundTasksStrip.tsx`、`chat.stop-task` 等前端与服务已完整接入。
- **B. Effort Level 相关**：
  - `51fb5757`：自定义模型声明 effort levels 功能完整引入，数据表新增 `effort_values` 与 `effort_default` 两列，前端模型库面板完整适配。
  - `48c8ae4c`：Codex 新增 GPT-6 Sol 与 GPT-6 Luna 模型（`server/modules/providers/list/codex/codex-models.provider.ts:38-55` 确认包含）。
- **C. Compaction 相关**：
  - `d450ed85`：compaction 单行折叠显示逻辑（`src/modules/chat/hooks/useChatMessages.ts:87-185`）与前端渲染（`MessageComponent.tsx:194-223`）完整接入。
- **D. 其它上游改动抽查**：
  - `a2ed7f3c`（Source Control 分支对比）：`src/modules/git-panel/hooks/useBranchCompare.ts` 存在。
  - `6c51fcaa`（侧边栏拖拽调整宽度）：`src/shared/hooks/useSidebarWidth.ts` 存在。
  - `de0908b0`（LaTeX delimiters 数学公式渲染）：`src/modules/chat/utils/latexDelimiters.ts` 存在。
  - `dc7cb6c6`（Auth token 刷新与语言切换防重挂载）：`src/modules/auth/tests/authTokenRefreshRemount.test.tsx` 存在。
  - 多语言扩展：`cs`, `id`, `he`, `pt-BR` 语言包与配置完整，印尼语 `docs/README.id.md` 已于 commit `1c13a8f0` 补入。

### 1.3 隐蔽冲突与注册陷阱排查
- **Duplicate registration 检查**：
  - `vite.config.js`：检查确认只有 1 处 `define:` 配置（包含 `__GIT_SHA__` 与 `__BUILD_TIME__`），未发生 v1.37.3 出现的双对象覆盖问题。
  - `MarkdownImage.tsx`：上游新增 `WorkspaceMarkdownImage`，fork 原有 `/api/` 鉴权图片流；合并后作为 add/add 联合组件，以 `/api/` 前缀分流，两方能力完全保留。
  - `modelLabel.ts`：上游新增 `ANSWERING_MODEL_FAMILIES`（宽松子串），fork 原有 `MODEL_FAMILY_LABELS`（严格前缀）；合并后重命名上游符号避免重名冲突，两套逻辑并存。
- **Rename 检查**：
  - `isSkillCommand` 移入 `src/shared/utils.ts:255`，`useSlashCommands.ts` 相应适配正确。
  - `taskStatus` 到 `taskNotificationStatus` 成对更名已在 `useChatMessages.ts` 中完全对齐。

---

## 2. 两条核心诉求

### 诉求 1：后台任务中给主 agent 发消息，不能把后台任务/子 agent 杀掉
- **结论：保住且验证通过 ✅**
- **代码核实**：
  1. 上游 `b9d3d129` 引入的强杀函数 `releaseHeldSession`（内部循环调用 `stopTask` 杀掉所有任务）在 fork 中计数为 0，未被引入。
  2. 在 `server/modules/providers/list/claude/claude-runtime.provider.js:1143-1152`：新 turn 到达时，通过 `claimHeldTurn(sessionKey(), turnFingerprint)` 认领挂起会话。当指纹匹配时，通过 `tryAccept()` 直接向仍在运行的子进程推入新 turn 提示词，现有后台任务不受中断。仅当指纹不匹配时才执行 `releaseInput()`。
  3. 在 `claude-runtime.provider.js:1654-1657` 的 `finally` 块中：
     ```javascript
     if (
       !inputReleased
       && (heldForBackgroundWork || backgroundWorkPending || backgroundWork.hasOutstanding(sessionKey()))
     )
     ```
     三方 OR 条件全部在位，有效防止 SDK 异常或网络中断时误关闭 stdin 从而导致后台任务被杀。
  4. 测试验证：`claude-background-work.test.ts`（19 个用例）、`claude-runtime-hold.test.ts`（6 个用例）、`claude-subagent-survival.test.ts` 均全部通过。

### 诉求 2：compaction 只显示一行（摘要折叠在那一行里）
- **结论：保住且验证通过 ✅**
- **代码核实**：
  1. `src/modules/chat/hooks/useChatMessages.ts:87-185` 的 `appendCompactionRow()`：
     - 将 boundary（记录 token 变化）与 summary（`isCompactSummary`）合并为单一消息行，summary 挂载在 `compactSummary` 字段下。
     - 正确识别并过滤重复的 CLI `'Compacted'` 确认文本。
  2. `src/modules/chat/transcript/MessageComponent.tsx:194-223`：
     - `message.compact` 渲染为单行摘要条，附带可展开查看完整内容的 `<details><summary>full summary</summary>...</details>`。
     - 与 fork 针对其他 provider（OpenCode / Antigravity）保留的 `isCompactBoundary` 形成互斥分支，不会产生双行重复。
  3. 测试验证：`src/modules/chat/tests/compactionRows.test.ts` 包含的 12 项测试全部通过（断言长度均为 `1`）。

---

## 3. 数据迁移

- **文件**：`server/modules/database/migrations.ts`
- **执行顺序（lines 803-806）**：
  ```typescript
  addProviderModelEffortColumns(db);
  copyProviderModelEffortLevels(db);
  widenProviderModelsProviderCheck(db);
  dropProviderModelEffortLevelsColumn(db);
  ```
  核实：`copy` 严格在 `widen` 之前执行，`drop` 严格在 `widen` 之后执行。
- **数据复制条件（lines 634-635）**：
  ```sql
  UPDATE provider_models SET effort_values = effort_levels
  WHERE effort_levels IS NOT NULL AND effort_values IS NULL
  ```
  条件完备：既不会遗漏旧数据，也不会覆盖新格式已有数据。
- **表重建完整性（lines 567-591）**：
  `widenProviderModelsProviderCheck` 中重建表的列包含：`id, provider, model_id, model_name, sort_order, created_at, updated_at, base_url, api_key, context_window, effort_values, effort_default`，所有核心及新列完整映射，无列丢失。
- **幂等性保障**：
  四步均包含前置守卫（`addColumnToTableIfNotExists`、`columnNames.includes`、`tableSql.sql.includes("'antigravity'")`），重复执行安全无副作用。
- **测试验证**：
  `server/modules/database/tests/provider-models.db.integration.test.ts` 完整覆盖自定义模型 effort 数据持久化与更新。

---

## 4. 文档

### 4.1 文件归属核实（`git cat-file -e "upstream/main:<path>"`）
对 `docs/fork-customizations.md` 中所有声称归属的文件进行了全面抽样与逐条核验：
- **Fork 独有文件（验证在 `upstream/main` 中不存在）**：
  - `server/modules/providers/list/claude/claude-turn-reuse.ts` (fork-only ✅)
  - `server/modules/providers/list/claude/claude-background-work.ts` (fork-only ✅)
  - `server/modules/websocket/services/background-work-broadcast.service.ts` (fork-only ✅)
  - `server/modules/websocket/services/background-work-bridge.service.ts` (fork-only ✅)
  - `src/shared/hooks/useBackgroundWorkSessions.ts` (fork-only ✅)
  - `src/modules/chat/composer/indicatorVisibility.ts` (fork-only ✅)
  - `server/modules/providers/tests/claude-subagent-survival.test.ts` (fork-only ✅)
  - `server/modules/providers/tests/claude-held-turn-reuse.test.ts` (fork-only ✅)
  - `server/modules/providers/tests/claude-turn-compatibility.test.ts` (fork-only ✅)
- **Upstream 共有文件（验证在 `upstream/main` 中存在）**：
  - `server/modules/providers/list/claude/claude-runtime.provider.js` (EXISTS ✅)
  - `server/modules/providers/tests/claude-background-work.test.ts` (EXISTS ✅)
  - `server/modules/providers/tests/claude-runtime-hold.test.ts` (EXISTS ✅)
  - `server/modules/websocket/services/chat-run-registry.service.ts` (EXISTS ✅)
  - `server/modules/websocket/services/chat-websocket.service.ts` (EXISTS ✅)
  - `src/modules/chat/hooks/useChatMessages.ts` (EXISTS ✅)
  - `src/modules/chat/transcript/MessageComponent.tsx` (EXISTS ✅)
  - `server/modules/database/migrations.ts` (EXISTS ✅)

### 4.2 前轮 Review 修复核验
前一轮审查所指出的事实性疏漏（D1-D11）已全部修复到位：
- #30 快照未进 finally 事实已在文档正文与冲突指引中更正；
- #29 releaseHeldSession 移除及 `:1161` 直调 releaseInput 描述准确；
- #22 normalizeMessage 移除与 dispatch 前端化描述准确；
- #25 effort 复选框退役说明完备；
- #30 notifyBackgroundWorkCompleted 单次播报门控已补充完整；
- `docs/upstream-sync.md` 新增的「第 0 节：查 merge base」逻辑严密、可执行；
- `docs/adr/0012-*.md` 状态说明准确；
- `.claude/CLAUDE.md` 的 `## Dispatched agents` 位置规范，未影响临近标题。

---

## 必须修（must-fix）
无。代码逻辑、数据库迁移与主要文档均无阻断性缺陷。

---

## 建议但不阻塞

| # | 问题 | 证据 | 建议 |
|---|---|---|---|
| 1 | `docs/fork-customizations.zh-CN.md` 条目 1、4、22 的「涉及文件」列表残留旧路径 | zh-CN 行 13、49、211 仍包含 `src/components/...` 与 `src/stores/...`，而英文版对应条目已更新为 `src/modules/...` 与 `src/shared/...` | 后续常规文档维护时，将中文版条目 1、4、22 的「涉及文件」行同步为当前实际模块路径 |

---

## 我核过但确认没问题的
1. **Git 拓扑与合并完整性**：`merge-base` 为 `7c3049fe`，`upstream/main` 无遗漏提交，双亲 merge commit 结构合法。
2. **核心诉求 1（后台任务存活）**：`claimHeldTurn` / `tryAccept` 机制、`finally` 三信号守卫、移除 `releaseHeldSession` 强杀逻辑，相关单元/集成测试全部通过。
3. **核心诉求 2（Compaction 单行化）**：`appendCompactionRow` 折叠、前端互斥渲染、12 项 vitest 单测全绿。
4. **数据库迁移正确性**：4 步执行顺序严谨，列定义无遗漏，更新条件排他安全，全过程幂等。
5. **代码静态检查**：`typecheck` 0 error，`oxlint` 0 error。
6. **文件归属与引用真实性**：中英双语文档涉及的核心文件全部通过 `git cat-file -e` 逐项验证。
