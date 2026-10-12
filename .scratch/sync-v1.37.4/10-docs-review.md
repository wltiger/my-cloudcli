# sync/v1.37.4 · 10 文档 review 核验

日期：2026-10-12。STEM `2610121108-claudecodeui-review`。
**审的对象**：`docs/fork-customizations.md` + `.zh-CN.md` + `docs/adr/0012-...md` 的 v1.37.4 更新
（11 个条目 + 1 个 ADR 注记，主会话写的）。
**3 家**：`sub-opus` / `cbc-hy4` / `agy-g38f`（跨三个厂商）。方式：合一份 prompt，四节
（Q1 事实核对 / Q2 指引风险 / Q3 遗漏 / Q4 结论）。

## 已核验并修复的条目

### D1 · #30 误称快照读数进 `finally` —— **成立（sub-opus，must-fix）**

- opus 证据：`claude-runtime.provider.js:1654-1657` 的 `finally` 只有
  `!inputReleased && (heldForBackgroundWork || backgroundWorkPending || backgroundWork.hasOutstanding(...))`；
  全函数 `snapshotOutstanding()` 只出现在 `:1471`（早释放）与 `:1505`（result）。
- 主会话核验：`grep -n "snapshotSource\." ` → `:1172`（注册）/`:1453`（observe）/`:1471`/`:1505` —— **`finally` 无**。
- **根因**：主会话写文档时把"方案里的意图"当成了代码事实。
- **已修**：`Files:` 行的"…the `result` handler, the early-release branch and the `finally` block"
  改为"…the `result` handler and the early-release branch"；并在 `On upstream conflict` 里
  明确写"`finally` 块**不在**其中，这是刻意的"。英中同步。

### D2 · #29 的 `:942` 行号失效 + `releasePromptStream` 不在那个 hunk —— **成立（sub-opus + agy，must-fix）**

- agy 证据：合并后 `grep -c releaseHeldSession claude-runtime.provider.js` = **0**。
- opus 证据：`git show b9d3d129 -- claude-runtime.provider.js` 只有三个 hunk
  （新函数 / 声明 / 那一行替换），**grep 该 commit 的 +/- 行没有任何 `releasePromptStream`**；
  该赋值在 `b9d3d129^` 就已存在，离 `:953` 一百多行。
- 主会话核验：两处都确认（`grep -c releaseHeldSession` = 0；`:1161` 是 fork 的 `releaseInput` 直调）。
- **根因**：这两句都来自**方案阶段看 `preview-step2` 合并预览**时的笔记，没在最终代码上复核。
- **已修**：改为"merge 后代码里没有 `releaseHeldSession`（`:1161` 仍是 `releaseInput` 直调）"；
  删掉"同一 hunk 搭车的 `releasePromptStream`"这一说法，改为"该缝是 `queryClaudeSDK` 顶部两行，
  不在 `releaseHeldSession` 那个 hunk 里，单独取"。英中同步。

### D3 · #22 英中不一致（英文残留旧指引）—— **成立（agy 首报，must-fix）**

- agy 证据：英文 `:226` 仍有 "`normalizeMessage` in `claude-sessions.provider.ts` gained one branch
  inserted right after `baseId` is computed — do not reorganize…"，中文已删。
- 主会话核验：`grep -c "gained one branch inserted right after" docs/fork-customizations.md` → **1**（英文有）。
- **根因**：主会话改英文时只替换了段首，把尾巴漏了。
- **已修**：删掉该句，改成"**The `normalizeMessage` guidance this paragraph used to carry is gone**"，
  并把 dispatch 点从"后端"改为"前端两处 + `MessageKind` 成员"。英中同步。

### D4 · #25 残留"effort 档位校验、effort 复选框"—— **成立（agy，must-fix）**

- 主会话核验：`custom-model-endpoint.ts` 的 `assertValidEffortLevels` 与
  `ClaudeCustomEndpointFields.tsx` 的复选框组**都已退役**（grep EFFORT = 0），
  但文档 `On upstream conflict` 仍把它们列为"fork 自有逻辑"。
- **已修**：改为"成对校验、端点解析、开关 UI、**以及 v1.37.4 起的读时 effort 派生**"，
  并加一句"`effort_levels` 校验和复选框组已在 v1.37.4 删除"。英中同步。

### D5 · #30 改写时丢了 `notifyBackgroundWorkCompleted` 门控 —— **成立（sub-opus，must-fix）**

- opus 证据：`grep notifyBackgroundWorkCompleted docs/` **无命中**，而代码在
  `claude-runtime.provider.js:1526-1539`（条件 `heldForBackgroundWork && !answersFollowUpPrompt
  && !abortPending && !holdForTurn`）。
- **后果**：这是 fork 的**真实增益**（一组后台活儿只播报一次），下次同步会被当死代码删掉。
- **已修**：补回一段（"挂起"一半快照天然管住、"完成通知"那一半需要一个门控 + 两处接受的收窄 +
  "hold 判断算在 notify 之前正是为了这道门控"）。英中同步。

### D6 · #30 的退役条件表述不完整 —— **成立（agy，advice→已修）**

- agy：只提 cron 不够，还要覆盖**不发任务事件的工具**。
- **已修**："如果官方哪天让追踪器能看见这个源覆盖的**两类**东西——定时任务**和**那些根本不发
  任务事件的工具——这一条才可以退役；只看见 cron 还不够"。英中同步。

### D7 · #30 该写明 `DEFERRED_WORK_TOOLS` 的 `Workflow` 与 `Agent` 的 `!== false` —— **成立（opus，Q3 遗漏）**

- 主会话核验：上游 `:598` 白名单含 `Workflow`；`:669-670` 的 `Agent` 分支用 `!== false`。
- **已修**：在 #30 的 Why 里把清单展开（`Monitor`, `ScheduleWakeup`, `CronCreate`, `TaskCreate`,
  `Workflow`），并说明"清单覆盖靠名字自报家门的工具、追踪器覆盖有 `task_id` 的、
  **两者都不覆盖 cron**"。英中同步。

### D8 · #22 的 Files 该注明 `claude-sessions.provider.ts` 只因数上游重写而冲突 —— **成立（opus，Q3）**

- **已修**：该文件后加"（自 v1.37.4 起：**这里只是因为上游重写了同一文件而冲突**——
  fork 在这个文件里的 compaction 分支已退役）"。英中同步。

### D9 · #31 该点出 liveness 与快照源读的是相关但不同的事实 —— **成立（opus，Q3）**

- **已修**：加一句"liveness 问'还有某个 Claude 进程在忙这个会话吗'，快照问'这次运行挂着的那个进程
  还有活儿在飞吗'——两者都成立时运行列表可能把同一件活儿报两遍；这是显示层重复，不是状态错"。
  英中同步。

### D10 · #22 中文缺 `isSkillCommand` 搬家的提示 —— **成立（opus，advice）**

- 主会话核验：英文有、中文 `grep -c "isSkillCommand 本身"` = 0。
- **已修**：中文补上"从 v1.37.4 起 `isSkillCommand` 本身已下移到 `src/shared/utils.ts`，
  fork 的子句留在调用点"。

### D11 · #30 内部自相矛盾（Files 说进 finally、conflict 段说两处）—— **成立（opus，advice）**

- **已修**：统一为"两处"（即 D1 的修复）。

## 已核验但**不成立**（丢弃）

### N1 · #35 没记 MarkdownImage 的解法 —— **不成立（agy）**

- agy 说"条目 35 未记录该处理"。核验：`awk '/^## 35\./,/^## 36\./' | grep -c "MarkdownImage|add/add"`
  → **3 次命中**。agy 可能只看了 v1.37.4 更新块，没看条目正文。**丢弃。**

### N2 · #22 的 Files 写旧路径 `src/components/chat/useChatMessages.ts` —— **不成立（agy）**

- 核验：`grep -c "src/components/chat/useChatMessages"` → **0**。文件里写的是
  `src/modules/chat/hooks/useChatMessages.ts`（新路径）。agy 报的行号与实际内容对不上。**丢弃。**

### N3 · #22 中英 Files 路径不一致（中文旧、英文新）—— **误报（opus）**

- opus 说中文 `:211` 仍是 `src/stores/useSessionStore.ts`、`src/components/chat/**` 旧路径。
- 核验：`:211` 与英文 `:210` **开头都是新路径**；
  文档中确有旧路径引用（7 处），但它们**带出处说明**（"v1.37.3 折叠进这里"），
  且 #23 条目有一条**已有的**"⚠️ 路径说明（v1.37.3）"声明这类历史引用。
  **不是本次遗漏，不修。**

### N4 · #29 "取官方 hunk 会盖掉认领块" 措辞不准 —— **部分成立（opus，advice）**

- opus：严格说不会"盖掉"——`releaseHeldSession` 的调用点就是认领块的下一行，
  整取的结果是 **stop 回来了、认领块仍在但失效**。
- **判断**：措辞可更准，但结论（别整取）正确，且 D2 的修复已重写该段。
  **已随 D2 一并改善**（改为"brings the stop back and covers the claim block"→ D2 里已写成
  "…having been taken by mistake"的表述）。**不再单独改。**

## 待补
- `cbc-hy4` 结果（运行中）
