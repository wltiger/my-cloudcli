# 收工：sync-v1.37.4

结论：**可收工**（附 3 条待你人工验证）　起点：`c6053841`　日期：2026-10-12

## 大纲

**目标：把上游 v1.37.4 合进 fork，保住两条核心诉求（后台任务不被杀 / compaction 只显示一行）。**

| # | 做了什么 | 落点 |
|---|---|---|
| 1 | 查清拓扑：v1.37.3 内容已在 dev 但 **merge 信息缺失**（merge-base 停在 v1.37.2） | `c6053841` record-only merge |
| 2 | 用 record-only merge 补上 v1.37.3 的祖先关系（树不变，只修拓扑） | `c6053841` |
| 3 | 五轮方案评审（4 家 × 4 轮 + 终审），方案从 v1 迭代到 v6 | `.scratch/sync-v1.37.4/06~08` |
| 4 | 执行合并：40 个冲突文件全部解完 | `945f36f2` |
| 5 | 修复实施者引入/方案遗留的 hold 守卫缺陷（`finally` 缺 `backgroundWorkPending`） | 同上（`claude-runtime.provider.js`） |
| 6 | 代码 review 3 家 → 修 → 复核通过 | `.scratch/sync-v1.37.4/09` |
| 7 | antigravity 专项审计（你提的盲区）：**零 must-fix** | `.scratch/sync-v1.37.4/` 对话记录 |
| 8 | 数据库迁移实测（真实库副本）：7 行数据全部保值 | 同上 |
| 9 | 更新 fork 定制清单 11 个条目 + ADR 0012 状态注记 | `f3b486df` |
| 10 | 文档 review 3 家 → 修 16 处（含 7 条归属/前提错误） | `.scratch/sync-v1.37.4/10` |
| 11 | 补上游新增的 `docs/README.id.md`（`git add -u` 漏掉的新文件） | `1c13a8f0` |

**跑题**：无。

## 漏项 / 暂缓

基准 = 你的原始诉求。

| 诉求 | 状态 | 证据 |
|---|---|---|
| 上游 v1.37.4 合进 fork | ✅ | `945f36f2`，40 冲突全解 |
| **后台任务中发消息不被杀** | ✅ 代码已实现 | `finally` 三信号守卫 + `backgroundWorkPending`；`claude-runtime-hold` 6/6、`claude-background-work` 38/38 |
| **compaction 只显示一行** | ✅ 代码已实现 | D3 三文件（后端 + `useChatMessages.ts` + `MessageComponent.tsx`） |
| 优先用上游方案 | ✅ | D1 tracker 取上游、D2 effort 列取上游、D3 Claude 取上游 |
| fork 改进保留 | ✅ | claim 保留、`buildCustomModelEffort` 保留、dispatcher 门保留 |
| 不影响上游 / 避开干扰 | ✅ | 四条红线全落实（tree 已核） |
| **实际运行验证** | ⚠️ **你人工在做** | 代码已提交，工作区干净 |
| 数据库能否直接升级 | ✅ | 副本实测：迁移成功、数据无损 |

**delta 里的 TODO/FIXME**：无。

## 文档同步

### agent 文档

| 文档 | 状态 |
|---|---|
| `.claude/CLAUDE.md`「Syncing with upstream」 | ✅ 已指向 `upstream-sync.md` / `fork-customizations.md`，无需改 |
| `docs/fork-customizations.md` + `.zh-CN.md` | ✅ 本次已更新 11 条（本次改动的主体） |
| `docs/adr/0012-...md` | ✅ 加了状态注记（退出条件半满足） |
| `docs/upstream-sync.md` | ❌ **缺 record-only 流程**（本次会话开头做的关键一步，文档里 0 命中） |

### 其他文档

| 文档 | 状态 |
|---|---|
| `docs/README.*.md`（含新增 id） | ✅ 上游带的，已提交 |
| `.scratch/sync-v1.37.4/*` | ✅ 本次全部记录（00~10） |

## 提交状态

- **未提交**：无（`git status` 只剩 4 个会话前就存在的未跟踪项）
- **未 push**：`sync/v1.37.4` 无上游跟踪，未 push
- **stash**：无
- **worktree**：无（只有主工作区）
- **本轮新建分支**：无（直接在 `sync/v1.37.4` 上做）

## 清理

| 资源 | 去向 |
|---|---|
| `.scratch/diff-zh.txt`（agent 临时产物） | ✅ 已删 |
| `tsconfig.tsbuildinfo`（审计时 `tsc -b` 生成） | ✅ 已删 |
| `d:/tmp/migtest/`（迁移实测的库副本） | 留（证据，体积小） |
| 端口 3001（PID 23876） | **留** —— 你正在测的应用 |
| 派出的 CLI 会话（5 个 STEM） | 留（证据；你说了要清理时再清） |
| 后台任务 / Monitor / Cron | 无残留 |
| `.scratch/` 记录文件 | 留 |

## 踩坑

用户过目后**只采纳第 4 条**（其余为一次性、默认就会的，不记）。

| 现象 | 以后怎么做 | 去处 | 状态 |
|---|---|---|---|
| **派出的 agent 失败/空返回时我擅自改派**（`cbc-hy4` 空跑后直接换成 `cbc-glm53`，用户纠正） | 报告 + 问用户，不擅自换标签/模型/渠道；空文件也可能是"还在跑"（cbc 会派 subagent 并等它，外壳退了会话没结束） | 目标仓 `.claude/CLAUDE.md` 新增 `## Dispatched agents` 节 | ✅ 已写 |
| cbc runner 退 0 无输出 | 先看是否仍在运行（在等 subagent），确认真结束后再 `check`；不要当失败重派 | dispatch-agent 教训箱 | ✅ 已记 |

**未采纳**（用户判断为一次性或默认就会）：把方案笔记当代码事实、`git add -u` 漏新文件、英中双语单边改、review 要盯归属判断、哨兵事实要标注推断/实测。

## 下一步

1. **人工验证**（你在做）：D3 压缩单行、D1 后台不杀、G4 per-task UI、D2 effort fieldset、数据库迁移
2. ~~补 `docs/upstream-sync.md` 的 record-only 一节~~ → ✅ 已完成（第 0 节，英中）
3. ~~把踩坑写进 `CLAUDE.md`~~ → ✅ 已完成（第 4 条，`## Dispatched agents` 节）
4. `sync/v1.37.4` → `main` → `dev` 的合并与 push —— 等你验完
