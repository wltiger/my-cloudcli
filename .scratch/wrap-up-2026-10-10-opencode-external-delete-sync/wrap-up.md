# 收工：26101001-opencode-external-delete-sync

结论：**可收工**　起点：`43441dbe`　日期：2026-10-10

## 大纲

1. **修好 OpenCode 会话被外部删除后 CloudCLI 行残留的 bug** —— 给同步器加 prune，判定信号是 `opencode.db` 的 `session` 表。（`ec8c9db5`）
2. **实测确认 OpenCode 自身删除是干净的**（`DELETE /session/{id}` 与 `opencode session delete` 都清 session/message/part、`storage/` 无残渣）→ 修复只落在 CloudCLI 索引侧，不碰 opencode 存储、不加删除钩子。
3. **第一轮 code review 修订**（claude-opus + agy-g38f）：mtime 改为在读快照前取 · 补 `-wal` 测试 · JSDoc 补 prune 说明 · 文档 21→22 + 补「空壳行」已知限制。（`ca4fedfe`）
4. **第二轮 code review 修订**（opencode-space-bunny + opencode-step-5）：补判定键判别用例 · `await import` 包 try/catch · 抽出非 async 的 `pruneRows()` · 文档 keep-list 补两条 + 改正 upstream 冲突说明。（`2634b851`）
5. **第二轮复核后的收尾项**：补 F2 的 import 守卫用例 · 文档补 `synchronizeRows` 三参改动。（`f4fd65a7`）
6. **文档**：`docs/fork-customizations.md` 新开 #39、改 #33 的 prune 归属句，`.zh-CN.md` 同步。

## 漏项 / 暂缓

基准 = 用户原话（「发现 opencode session 也存在目标删除，cloudcli 还在的问题，需要也修复下」）+ `plan.md`。

| # | 项 | 状态 |
|---|---|---|
| 1 | 外部删除 opencode 会话后，CloudCLI 行被清掉 | ✅ `ec8c9db5` |
| 2 | 不误删存活/运行中/pending 行 | ✅ 4 道守卫 + 12 条用例，两家变异测试确认各被钉住 |
| 3 | 本机 21→24 行僵尸被清 | ✅ 端到端实测（拷贝真实 db 到沙箱）：24 清 / 19 留（真实库未动，待实例重启自动清） |
| 4 | 文档（fork-customizations #39 + #33 + zh-CN） | ✅ |
| 5 | 方案 review（两家） | ✅ `2610100759` |
| 6 | code review 第 1 轮（双轴，两家） | ✅ `2610100841` |
| 7 | code review 第 2 轮（换视角，两家） | ✅ `2610100944` |
| 8 | 项目强删路径（`project-delete.service.ts`）同类缺口 | ⚠️ 暂缓 —— 方案 Q6 明确不碰，与 agy D2 一致。**用户 2026-10-10 决定：不做、也不记 backlog** |
| 9 | S1 的取 mtime 顺序**无测试保护** | ⚠️ 暂缓 —— 两家都判「测试成本高于收益」，改为在 #39 keep-list 写明该规则 |
| 10 | 补 backlog 条目 | ⚠️ 本 bug 由用户在对话里直接提出，**backlog 里从来没有过这条**；**用户 2026-10-10 决定：不补** |

新增 `TODO` / `FIXME`：delta 内 **0 处**。

## 文档同步

### agent 文档

- `CLAUDE.md`：本轮**无新增规则**（未改流程、未加约定）→ 不需要。
- `.scratch/26101001-*/plan.md`、`research-external-delete.md`：任务内文档，已随进度更新 ✅。
- ✅ `docs/fork-customizations.md` #39 新增（fork-only 行为）+ #33 prune 归属句改写；`.zh-CN.md` 同步。
  - 新增名字全部已写进 #39：`pruneDeletedSessions` / `pruneRows` / 判定键 `provider_session_id` / mtime 读序 / 非 async 约束。

### 其他文档

- README / `docs/README.*.md`：本次是后端内部修复，用户可见行为只有「侧边栏不再残留已删会话」；#39 已记，README 不需要 ✅。
- `docs/agents/antigravity-provider-implementation.md`：只写 agy，本次未碰 ✅。
- 无 `opencode-provider-implementation.md`（不存在，已核实）。

## 提交状态

- 分支 `feat/opencode-external-delete-sync`（本轮新建，未 push；该分支**没有 upstream 跟踪**，`git log @{u}..HEAD` 无输出是因为没设 upstream）。
- 4 个 commit：`ec8c9db5` · `ca4fedfe` · `2634b851` · `f4fd65a7`。
- stash：空。worktree：仅主工作区。端口 3001 是**用户自己的实例**，非本轮产物。

## 清理

| 资源 | 去向 |
|---|---|
| `/d/tmp/oc-backup`、`sync-v2..v5.ts`、`oc-e2e.mts` | ✅ 已删 |
| opencode 复核沙箱 `%TEMP%\opencode\mut`（13M） | ✅ 已删 |
| `%TEMP%\opencode\gbcheck` | 留 —— **不是本轮的**，属别的项目 |
| 后台任务 | 全部已结束（无 Monitor / Cron / 后台 Bash 残留） |
| 派出 agent | 已全部交付：`2610100759` / `2610100828` / `2610100841` / `2610100944`（`2610100927` sub-fable 被用户叫停，无产出） |
| 派出的 CLI 会话 | 待用户确认后 `dispatch.mjs sessions ... --yes` 删 |
| `.scratch/` 记录 | 留 |

## 踩坑

| # | 现象 → 以后怎么做 | 去处 |
|---|---|---|
| 1 | **fable 被手打点名后我直接派了**，没先确认 4x 费率 → 用户叫停。**规则**：即使模型被点名，fable 也必须在派之前把费率摆出来单独确认一次；「用户打了名字」≠「用户已同意代价」。 | 目标仓 `CLAUDE.md`（拟写原文见下） |
| 2 | 我把 `-wal` 的推理**写反了**：让实现方「断言该行因 `-wal` 更新被跳过」，实际 `-wal` 变新 → mtime 变大 → 守卫更宽 → 该行**会被清**。实现方纠正了我。**规则**：给写出「断言方向」的指示前，先自己推一遍单调性（mtime 越大 → 跳过越少）。 | 目标仓 `CLAUDE.md`（与 #1 合并成一条「派遣时的指示质量」） |
| 3 | 两次触发「Step-5 没写结果文件」：**opencode 的 plan mode 禁止写文件**（只放行 `.opencode/plans/*.md`），内容只在回复里 → `check` 报 ✗ 是假信号。**规则**：opencode 只读派遣的结果可能落在 `.ndjson` 的 `text` 事件里而非 `.md`，`check` ✗ 时先看 ndjson 是否有 `text`。 | dispatch-agent 教训箱（`dispatch.mjs lesson opencode`） |
| 4 | 给变异测试的 python 替换脚本用 LF 字面量，撞上仓库文件是 **CRLF** → 多花两轮。**规则**：改仓内文件前先确认行尾（本项目源码是 CRLF）。 | 目标仓 `CLAUDE.md` |

## 下一步

1. **[用户动作]** 重启 :3001 实例 → 本机 24 行僵尸由新 prune 自动清掉，用 UI 确认侧边栏干净。
2. **[用户动作]** 决定分支去向：`feat/opencode-external-delete-sync` 合入 `dev`（agy 那次是 fast-forward 合入并 push）。
3. ⚠️ 第 8 项（项目强删路径）→ 若要跟进，走 `/to-backlog` 立项；与 agy D2 是同一件事，建议**一起**做。
4. ⚠️ 第 10 项（backlog 补条）→ 若要，走 `/to-backlog`。
5. 下次 `upstream-sync` 时注意 #39 的提示：upstream `ed3f0bfc` 已重写同一文件，需手工三方对，并补 `deleteSessionByProviderSessionId`。
