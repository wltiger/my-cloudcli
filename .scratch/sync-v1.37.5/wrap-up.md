# 收工：sync-v1.37.5
结论：有遗留　起点：5e7ae75b　日期：2026-10-18

## 大纲
- 合并上游 v1.37.5 进 `sync/v1.37.5`：`73721fdb`（merge，解 10 个冲突）+ 上游 13 个 commit（`0ce5630f`…`cfd2cc02`，merge 带入）
- 上下文窗口优先级 declared > SDK 上报 > CONTEXT_WINDOW > 160K：`claude-context-window.ts`、`provider-token-usage.service.ts`、`claude-runtime.provider.js`、`claude-sessions.provider.ts`（在 `73721fdb` 内）
- 后台任务发送四选一（发送 / 中断并发送 / 排队 / 取消）：前端 `BackgroundSendDialog.tsx`、`useChatComposerState.ts`、`backgroundWorkRefusal.ts`、`QueuedMessageCard.tsx`；后端 `claude-runtime.provider.js` claim 分支、`chat-websocket.service.ts`、`scheduled-message-dispatcher.service.ts`
- OpenCode 撤销列守卫：`opencode-sessions.provider.ts`（修合并引入的 5 个测试失败）
- 合并收尾：`agent.routes.ts` 加 antigravity；测试 harness 补字段（composer、slashCommandArguments、customModelsOnly、claude-token-budget）
- 测试：`claude-context-window-resolver.test.ts`（新）、`claude-held-turn-reuse.test.ts` 两个新用例、`composerSendOverBackgroundWork.test.ts` 9 个用例、`backgroundSendDialog.test.tsx`、`scheduled-messages.test.ts`
- 文档：`docs/fork-customizations.md` 与 `.zh-CN.md` 的 #25、#29/#31、#34
- 计划与记录：`.scratch/sync-v1.37.5/`（未提交）
跑题：无

## 漏项 / 暂缓
- ✅ 计划 Step 1a–1e、2、3、4、5、6、8 全部完成
- ✅ R1 无超时（你定的）：排队卡片显示等待文字；卡片有删除、编辑按钮
- ✅ R2 文案：英文主文案 + zh-CN；其他语言回落英文（计划里的范围外项）
- ⚠️ 「附件不重复上传」断言：测试标题只写了带上传文件，没逐行核对
- ⚠️ 后端「无后台任务时两条路径一致」：没有单独用例
- ⚠️ 定时消息是否也等后台任务：计划里是「待查」，现在只有排队消息等；我上一条说「定时消息不变」，你没确认过
- ⚠️ 「five spec lines」措辞：核对后数字对（5 个包），没改
- ⚠️ 手工冒烟（Step 7）：你在跑，结果未回报
- ⚠️ 落地：快进 dev、快进 main、推送、tag、删分支。计划写明要你确认，未做
- ⚠️ `claude-turn-compatibility`、`image-attachments` 两个失败：只核对了文件没改，没在 dev 上实跑
- ⚠️ `codex-models` 失败：node_modules 的 codex 是 0.153.4，package.json 要 0.156.1，需增量 `npm install`
- ⚠️ 「中断并发送」改名：spec review 再定（你定的）
- ❌ upstream-pr 分诊没跑：CLAUDE.md 要求同步收尾时跑，你最初的 /upstream-sync 指令也要求

## 文档同步
### agent 文档
- ❌ memory `project-claude-bg-interruption-diagnosis.md` 第 15 行，及 MEMORY.md 第 7 行索引「追问强杀=已知限制」已过时。拟改：有后台任务时发送改为拒绝并回填草稿（`background_work_not_kept`），不再强杀；没有后台任务时行为不变
- ❌ memory `project-preexisting-windows-test-failures.md`，及 MEMORY.md 第 9 行「~11 个」已过时（本轮 26 个）。拟改：数量随 node_modules 变，以 CLAUDE.md 分类为准，不写死数字
- ✅ 仓内 agent 文档（AGENTS.md、CLAUDE.md、providers README、docs/agents/*）无相关描述
### 其他文档
- ✅ fork-customizations 两个语言版本：#25、#29/#31、#34 已更新
- ✅ `.env.example` 不改：上游文件，declared 规则已在 #25 记录
- ✅ README 无 CONTEXT_WINDOW 描述

## 提交状态
- 未提交：无已跟踪改动。未跟踪的 `.scratch/sync-v1.37.5/` 是本轮的；`.scratch/26100401-…`、`.scratch/26101001-…`、`docs/browser-use.md` 不是本轮建的，不动
- 未 push：`sync/v1.37.5` 没有 upstream，14 个 commit 都没推。`dev` 与 origin/dev 一致。`main` 落后 upstream 13（落地时快进）
- stash：无
- worktree：只有主工作树
- 分支：`sync/v1.37.5`、`sync/v1.37.4` 落地后按 docs/upstream-sync.md 第 143–144 行收尾。`worktree-agent-a3ac…`、`worktree-agent-aacb…`（2026-09-16 建）、`feat/agy-external-delete-sync`、`chore/upgrade-deps-2026-09` 非本轮，留

## 清理
- 删：`.scratch/sync-v1.37.5/base-block.ts`（测试草稿，未跟踪）
- 删：`.scratch/sync-v1.37.5/new.ts`（与已跟踪的 `scheduled-messages.test.ts` 内容一致）
- 无：系统 temp（本轮没建）；后台进程（3001 是你的实例 PID 60804，不动；5173 没起过）；后台任务；Cron（无）；调试打印 / TODO / FIXME（diff 新增行 0 处）；派出的 agent 与 CLI 会话（本轮没有；收工后另外删了上一轮遗留的 26 个 STEM、35 个会话）
- 留：`.scratch/sync-v1.37.5/` 的 plan.md、日志（审阅证据）

## 踩坑
- 现象：没先汇报上游改动和冲突表就开始解冲突，被你纠正 → 以后：/upstream-sync 先出「上游改了什么 + 冲突表」，你看过再动手。去处：目标仓 CLAUDE.md（拟写原文见下）
- 现象：单行 Edit 只换掉冲突块的一部分，留下 `<<<<<<< HEAD` → 以后：每个文件解完都 grep 三种标记，确认为空再 stage。去处：目标仓 CLAUDE.md
- 现象：fork 新读的 `revert` 列在上游测试库里没有，读取抛错被吞成空历史 → 以后：fork 新读的列要 `PRAGMA table_info` 守卫。去处：目标仓 CLAUDE.md
- 不记：合并后 typecheck 才报 harness 缺字段；Explore 误填成工具名；被拒的 run 没结束；凭印象说「约 11 个 locale」（全局规则已覆盖）

拟写到目标仓 CLAUDE.md（同步节，待你同意）：
- 同步上游时，先汇报上游变更和冲突表，你确认后再解冲突
- 解完冲突，每个文件都要 grep `^(<<<<<<<|=======|>>>>>>>)`，确认为空再 stage
- fork 新读的 SQL 列（如 `revert`）在上游测试库里可能不存在，读取处要 `PRAGMA table_info` 守卫

## 执行结果（2026-10-18）
- ✅ 清理：删 `base-block.ts`、`new.ts`
- ✅ 补文档：memory 正文两条和 MEMORY.md 索引两行已改（仓外，不入库）。bg 那条改为「有后台任务时拒绝、不再强杀」，失败基线那条去掉「~11」
- ✅ 提交：本文件（信息见 git log）
- ✅ 合并（仅本地）：dev 快进到 `sync/v1.37.5`，main 快进到 `upstream/main`。已推送：origin/main（0ce5630f）、origin/dev（d34b7762）
- 分支：`sync/v1.37.5` 保留（最新的 sync 分支）；`sync/v1.37.4` 也保留（`archive/sync-v1.37.4` tag 已打；误删后已恢复）

## 下一步
- ❌ upstream-pr 分诊 → `/upstream-pr`，只分诊不提交。候选：v1.37.5 每回合无条件 `releaseHeldSession`，和 fork 的 held process 复用冲突（fork 侧已改，上游要不要知道需要判断）。OpenCode 缺列是 fork 侧，不报
- ✅ memory 两条已改（见执行结果）
- ⚠️ 定时消息是否等后台任务 → 你定（现状：不等）
- ⚠️ 冒烟结果 → 你回报
- ✅ 推送 origin/dev、origin/main：已完成
- ⚠️ dev 上复跑两个失败测试 → 需要你同意切分支
- ⚠️ codex 增量 `npm install` → 你同意后做（可能改 lock）
- ⚠️ 「中断并发送」改名 → `/to-backlog`，spec review 时定
- ⚠️ 「five spec lines」→ 建议不改
