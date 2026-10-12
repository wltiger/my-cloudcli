# 收工：sync-v1.37.4（续）

结论：**可收工**　起点：`fb4615a4`　日期：2026-10-12

## 大纲

**目标：对已完成的 v1.37.4 合并做独立终审，确认可落地，然后落地并推送。**

| # | 做了什么 | 落点 |
|---|---|---|
| 1 | 外派 `agy-co46` 做终审；首次跑挂（我 prompt 没给写文件手段），用户续跑完成 | `.scratch/sync-v1.37.4/11-terminal-review.md` |
| 2 | 独立复核终审报告：抽查 10 项，逐条对 Windows 基线 25 个 fail | 对话 |
| 3 | 修终审报的唯一实错：zh-CN 条目 1/4/22 的 `涉及文件` 行旧路径 | `c861aa2d` |
| 4 | `dev` 合并 `sync/v1.37.4`（实际为快进，非预告的真 merge） | `c861aa2d` |
| 5 | 删 `sync/v1.37.3`、`sync/v1.37.3-split`，各留 `archive/*` tag | 已删 |
| 6 | 把「只留最近一条 `sync/`」的分支收拾约定写进同步指南（英中） | 本次提交 |

**跑题**：无。

## 漏项 / 暂缓

基准 = 用户本次诉求：派 agy-co46 终审 + 核查 1.37.4 的 merge 信息是否正常。

| 诉求 | 状态 | 证据 |
|---|---|---|
| agy-co46 终审全量检查 | ✅ | `11-terminal-review.md`（10.9KB，四块：上游对齐 / 核心诉求 / 数据迁移 / 文档） |
| **1.37.4 merge 信息正常** | ✅ | `945f36f2` 双 parent（`c6053841` + `7c3049fe`）；`merge-base sync/v1.37.4 upstream/main = 7c3049fe`；`sync..upstream/main` 为空 |
| 结论可否合 dev | ✅ **可以**，零 must-fix | 我抽查 10 项全对，含逐条对基线 |
| 修 zh-CN 旧路径 | ✅ | `c861aa2d` |
| 合并到 dev | ✅ | `dev = c861aa2d`，`git diff dev sync/v1.37.4` 为空 |
| 保留 v1.37.4 / 删旧版本分支 | ✅ | 见「清理」 |
| 清外派 session | ✅ | 2 个已删，复查"没找到会话文件" |
| push dev | ✅ | 见「提交状态」 |

**我先前说错、本次纠正的两处**（写进记录，避免以后再犯）：

1. `dev` 领先 `origin/dev` 是 **80** 个 commit，不是 6 —— 我早先把 `sync/v1.37.3` 的 4 个 commit 当成了全部差额。
2. 落地是 **fast-forward**，不是真 merge —— 我凭一条报错的命令（`git rev-parse --short dev sync/v1.37.4` 在 Git Bash 下 `fatal: Needed a single revision`）就断言"dev 领先、不能快进"。实际 `6ef663ba` 本就是 `sync/v1.37.4` 的祖先。

## 文档同步

### agent 文档

| 文档 | 状态 |
|---|---|
| `docs/upstream-sync.md` | ✅ 本次新增「分支收拾」节 + `dev` 可能不快进的说明 |
| `docs/upstream-sync.zh-CN.md` | ✅ 同上（中文版） |
| `.claude/CLAUDE.md` | ✅ `## Dispatched agents` 节完好，未受影响 |
| `.scratch/sync-v1.37.4/11-terminal-review.md` | ✅ 新增（agy 写） |
| `.scratch/sync-v1.37.4/11-terminal-review-brief.md` | ✅ 新增（我写的任务书） |

### 其他文档

| 文档 | 状态 |
|---|---|
| `docs/fork-customizations.zh-CN.md` | ✅ 本次修 3 行（`c861aa2d`） |

## 提交状态

- **未提交**：无（5 个未跟踪项，均为会话前既有，见下）
- **未 push**：`dev` 领先 `origin/dev` 80 个 commit → 本次推送
- **stash**：无
- **worktree**：只剩主工作区（`worktree-agent-*` 是遗留分支，无对应目录）
- **本轮新建分支**：无

未跟踪项（**都不是本轮产物**）：`.scratch/26100401-agy-external-delete-sync/`、`.scratch/26101001-opencode-external-delete-sync/`、`.scratch/sync-v1.37.4/11-*.md` ×2、`docs/browser-use.md`。

## 清理

| 资源 | 去向 |
|---|---|
| 外派 CLI 会话 ×2（agy-co46、cbc-hy4 test-timing） | ✅ 已删（用户指定） |
| 其余 6 个 STEM 的会话 | 早为"没找到会话文件"，无需动 |
| `sync/v1.37.3`、`sync/v1.37.3-split` | ✅ 已删，留 tag `archive/sync-v1.37.3`、`archive/sync-v1.37.3-split` |
| `sync/v1.37.4` | **留**（用户指定：保留最近一次同步分支） |
| `/tmp/up-bw.test.ts` | ✅ 已删（比对测试时建的） |
| `d:/tmp/migtest/` | 留（迁移实测证据） |
| 端口 3001（PID 23876） | 留 —— 用户正在测的应用 |
| Cron / Monitor / 后台任务 | 无 |
| `.scratch/` 记录 | 留 |

## 踩坑

用户决定：**本轮不记教训**。

识别到但未记录的三条（供参考）：

1. 派 agent 却没给它交付手段（prompt 写了"唯一允许写的文件"，但 agy runner 没有写文件原语）。
2. 凭一条报错命令的输出下拓扑结论。
3. 把自己写在 commit message 里的数字当独立证据引用。

## 下一步

1. ✅ push `dev` → `origin`（本次执行）
2. ⚠️ 主干外遗留分支未处理，需要时另开：`chore/upgrade-deps-2026-09`、`feat/agy-external-delete-sync`、2 个 `worktree-agent-*`、远端 `origin/sync/v1.37.3`
3. 下一版本同步（v1.37.5）时按新约定：保留 `sync/v1.37.5`，删 `sync/v1.37.4`（删前打 `archive/` tag）
