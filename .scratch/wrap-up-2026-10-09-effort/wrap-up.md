# 收工：wrap-up-2026-10-09-effort

结论：可收工（2 项外部事实未验证，已在文档标注并进 backlog）　起点：f9846fff　日期：2026-10-09

## 大纲

按需求分 4 组：

**A. 回答模型 id 问题（无代码）**
- haiku 档位没写死 model id，全是别名 —— 查明并解释
- "Opus 5.5" 来自 session jsonl 现算（`getCurrentActiveModel` 倒序扫 jsonl）+ `prettifyModelLabel` 前端解析

**B. 给 haiku 补 effort + 调默认值**
- `server/modules/providers/list/claude/claude-models.provider.ts` — haiku 新增 effort 块（low/medium/high/xhigh/max + ultracode，default xhigh）；`best`/`fable`/`opus`/`opus[1m]` → `medium`，`sonnet`/`sonnet[1m]` → `xhigh`

**C. 让 `effort.default` 真正生效**
- `server/modules/providers/list/claude/claude-runtime.provider.js` — `resolveClaudeEffort` 把 `'default'` 哨兵解析成目录默认值；收窄为只处理字面量哨兵，`undefined` 保持原义
- `src/modules/chat/composer/ComposerModelMenu.tsx` — 曾改触发器文案，**已整处回退**（渲染不出来，见踩坑 3）

**D. 测试与文档**
- `server/modules/providers/tests/claude-runtime.test.ts` — 新增 3 个语义测试（哨兵解析 / 省略 effort / 无 default）
- `server/modules/providers/tests/claude-models.test.ts` — 新增目录不变量测试
- `docs/fork-customizations.md` + `.zh-CN.md` — 第 38 条，四轮修正后定稿
- `docs/agents/backlog.md` — 新增 5 条暂缓项

**跑题（非本轮工作，工作区里就有）**：`start-cloudcli.bat`、`docs/browser-use.md`、`.scratch/26100401-agy-external-delete-sync/` —— 本会话开始前即存在的状态，未碰。

## 漏项 / 暂缓

| 项 | 状态 |
|---|---|
| haiku 档位支持 low…max + ultracode（依据来自仓库外） | ⚠️ 暂缓 — 文档已加"未经验证的外部事实"段；进 backlog |
| SDK 自己的默认 effort 是多少 | ⚠️ 暂缓 — 文档已标注；进 backlog（是判断 opus 升降档的基准） |
| `opusplan` 的 `high` 现会下发，SDK 如何分给两阶段 | ⚠️ 暂缓 — 进 backlog |
| 菜单哨兵仍显示 "Default"，看不出实际档位 | ⚠️ 暂缓 — 进 backlog |
| 目录档位的实际值缺测试覆盖 | ⚠️ 暂缓 — 进 backlog |

delta 里无新增 `TODO` / `FIXME`。

## 文档同步

### agent 文档

- `docs/fork-customizations.md` + `.zh-CN.md` 第 38 条 ✅ 已同步 — 四轮修正：文件清单、改动范围、会话影响机制、规范顺序、升/降档基线、未验证事实、测试引用
- `docs/agents/backlog.md` ⚠️ extra — 工作区既有 + 本轮新增 5 条
- `CLAUDE.md` ✅ 不需要 — 本轮无新的仓级规则
- dispatch `lessons.md` ✅ 已同步 — 新增 claude 只读 git 被拒一条

### 其他文档

- 无 README / `docs/` 索引改动需要 — 本轮是 provider 内部行为，无用户可见的新命令/参数/路径

## 提交状态

- 未提交：8 个文件（6 个本轮 + `start-cloudcli.bat` + `docs/agents/backlog.md`）
- 未 push：无（`@{u}..HEAD` 为空）
- stash：无
- worktree：无（仅主仓）
- 新分支：无

## 清理

| 资源 | 去向 |
|---|---|
| `/tmp/cm.bak`（不变量破环测试的备份） | 已删 |
| 后台任务 `buqo1eg6i` / `bzwdn1mrb` / `b5imi76er` / `b384sgwvr` | 全部已完成 |
| 派出 agent（haiku ×4 轮） | 全部交付，STEM `2610091038` / `2610091128` 留 |
| 出 CLI 会话文件 | 留（可能续跑） |
| Cron | 无 |
| 端口 3001（PID 20556） | 用户常驻实例，不动 |
| 调试打印 / 临时测试 | diff 里无 |
| `.scratch/` | 留 |
| `~/.agents/dispatch/` 其它 STEM（gb-platform-*） | 非本轮，不动 |

## 踩坑

**坑 1：只追 `values` 链路，没验证 `default` 有没有人读**
现象 → 第一版方案断言"加个 effort 块就自动生效"，被 haiku 第一轮抓出 `effort.default` 是死字段。
以后 → 声称某个配置字段"生效"前，先 grep 全仓确认**有消费者**，再谈写入端。

**坑 2：文档凭印象写"所有自定义模型解析为 undefined"**
现象 → `buildCustomModelEffort` 会给声明了 levels 的自定义模型生成 default，漏看了写入端。
以后 → 写"某类对象不具备 X"这类全称断言前，先找它的构造点。

**坑 3：加了一段渲染不出来的 UI 代码**
现象 → `ComposerModelMenu` 的默认档位文案被 `hasModelSection` 恒真挡死，任何路径都不可达。
以后 → 改 JSX 前先读清楚渲染条件的分支，或改完在浏览器里看一眼。

**坑 4：claude 只读模式拒绝 git 命令**
现象 → haiku 报告 `git cat-file` 被权限拒绝，改读 `.git/HEAD` 绕过，导致 `upstream-owned` 标注两轮未验证。
以后 → 已记进 dispatch `lessons.md`（材料由 `prep` 预先落盘）。

## 下一步

1. **手工升 SDK 0.3.281 → 0.3.295**（用户在做的）→ 升完回来跑测试对照基线 + 实测 SDK 默认 effort
2. 实测 SDK 默认 effort（解掉最大未验证项）→ 进 backlog
3. 真机确认 Haiku 5.5 档位支持性 → 进 backlog
4. `opusplan` 两阶段 effort 行为 → 进 backlog
5. 菜单显示实际档位 → 进 backlog
6. 目录档位值补测试覆盖 → 进 backlog
