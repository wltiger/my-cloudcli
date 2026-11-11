# 收工：26111101-ask-question-notes
结论：可收工　起点：1f9d618c　日期：2026-11-11

已执行（用户选 1–4）：清理 scratchpad 临时文件 ✅；删 STEM 2611111208 两个 g38f CLI 会话 ✅；`.claude/CLAUDE.md`「Local UI testing」加踩坑 1、2 ✅；本目录随收尾 commit 提交 ✅。漏项「Other 框光标跑到开头」→ 已进 backlog（未提交，同用户原有改动）。合回 dev：用户同意（--no-ff，合完删功能分支）；push 另问。

## 大纲
- 调查与对齐：确认 Claude CLI 原生支持 `annotations[问题].notes`、OpenCode 答案格式；grill 定 6 个决定（plan.md）
- 方案 review（claude-g38f + sub-opus，主会话收口）→ 方案定稿、acceptance.md
- 单 1 实现：面板补充框、Claude `annotations`、OpenCode 末尾 `notes:` 项、卡片显示、中英文、#40 → 4e739dc2
- code review 第一轮修复：两个焦点 bug、逻辑搬进 fork hook、规范类小修 → b711504d
- 复查剩余注释 → 645ee181
- backlog 追加 1 组 2 条既有问题（docs/agents/backlog.md，未提交，和用户原有未提交改动混在一起）
- 跑题：无

## 漏项 / 暂缓
- ✅ 决定 1–6、默认规则、方案 0–4（4e739dc2、b711504d）
- ✅ V1、V2、V3.1/V3.3/V3.4、V4、V5（V5 真 Claude 实测一次）
- ⚠️ V3.2（OpenCode `fetchHistory` 测试）暂缓：历史与实时共用 `toAskUserQuestionCall`，两家 review 都认可；不补
- ⚠️ extra：切全屏后补充框光标放末尾（实测发现，review 认可）
- ⚠️ 未改：Other 框切全屏后光标跑到开头（上游既有，同类问题）——可进 backlog
- review 意见：全部采纳，无暂缓
- 新增 TODO / FIXME / console：无

## 文档同步
### agent 文档
- ✅ 不需要：`.claude/CLAUDE.md`、`AGENTS.md`、`docs/agents/*` 不涉及这个功能
- ❌ 拟加（踩坑 1、2，见下）：`.claude/CLAUDE.md`「Local UI testing」节
### 其他文档
- ✅ `docs/fork-customizations.md` / `.zh-CN.md` #40（新增名字 useAskQuestionNotes、AskQuestionNotesField、AskQuestionNotesLine、askQuestionNotes、splitQuestionNotes 都写进去了）
- ⚠️ `docs/architecture/06-tool-view.md:461-468`（上游自有）描述面板按键和 `updatedInput` 形状，没提 `n` / `annotations`。推荐不改：改上游文档会增加合并冲突，fork 的记录在 #40

## 提交状态
- 分支 `feat/ask-question-notes`：3 个 commit 领先 dev，未 push（无上游分支）；合回 dev / push 待用户定
- 未提交：`docs/agents/backlog.md`（用户原有改动 + 本轮 9 行），按红线不提交
- 未跟踪：本目录 `.scratch/26111101-ask-question-notes/`（plan.md、acceptance.md、本文件）——惯例随收尾提交；其他 `.scratch/*`、`docs/browser-use.md` 非本轮
- stash：无；worktree：临时 worktree 已删；新分支：`feat/ask-question-notes`

## 清理
- 删：scratchpad 里本轮的临时文件（probe_notes.mjs、append_fc.py、fail_files.py、s1–s7.png、*.log、*-fails.txt、`.playwright-cli/`、t.txt——t.txt 是第一轮方案 review 的 sub-opus 写的编码测试，越过了「只写结果文件」的红线，无害）
- 删（列给用户看过）：STEM 2611111208 的两个 claude-g38f CLI 会话（spec 1.7MB、standards 718KB）；sub-opus 无 CLI 会话
- 已做：dev server（3011/5444 已释放）、浏览器会话（无）、测试项目及会话文件、SDK 探针会话、临时 worktree
- 留：`.local/test-auth.db`（固定复用的测试库）；两个派遣 STEM 目录（review 记录）

## 踩坑
1. 停 dev server 时把端口查询结果（这个环境里 Get-NetTCPConnection / netstat 的 PID 都显示 0）直接喂给 `taskkill /T /F`，打到了 PID 0/4，被系统拒绝 → 以后：停自己起的 dev server 先用后台任务句柄（TaskStop），残留进程按命令行 + 启动时间找精确 PID，永远过滤 PID ≤ 4。去处：`.claude/CLAUDE.md`「Local UI testing」
2. Vite 端口 5183 在 Windows 保留端口段（本机 5141–5240，5173 也在内）→ EACCES。去处：同上，并发跑测试那段
3. 焦点意图用 onFocus 记录，被程序调用的 `focus()` 同步触发而失效（review 抓到）→ 不记（一次性，已在代码注释和 #40 里写明）
4. `dispatch.mjs resume` 不是只读（计数 +1、备份结果）；`--add` 会内联大 diff → 已记 dispatch 教训箱
5. 派出的 sub 写了结果文件之外的临时文件（t.txt）→ 不记（一次，无害）

## 下一步
1. 合回 dev（用户定）；push 另问
2. backlog 已有：Enter 不看 Submit 是否禁用；OpenCode 选项名含 `, ` 被拆
3. 可选进 backlog：Other 框切全屏后光标跑到开头（上游既有）
