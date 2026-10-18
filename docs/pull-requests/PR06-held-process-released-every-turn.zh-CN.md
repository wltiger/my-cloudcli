# PR06：每个新回合都会释放持有进程，后台任务撑不过下一回合

**状态：** Won't submit —— 上游每回合释放是有意的设计，提交等于请上游推翻它
**类型：** 本来会是 Issue
**目标：** `siteboon/claudecodeui`
**发现：** 2026-10-18，同步本 fork 到 v1.37.5 时从合并冲突里看出来的，不是用户报告

## 重复检查

没有做。不提交的决定先于重复检查作出，所以这条只是分诊记录，不是可以提交的草稿。想重新提交的人，必须先做重复搜索（见 `docs/upstream-pr.md` 的「起草前」一节）。

## 背景

上游 v1.37.5（`0ce5630f`）在每个新回合开始时都调用 `releaseHeldSession(sessionKey())`，所以持有会话后台任务的 Claude 进程一定会被释放。本 fork 保留这个进程，回合指纹匹配时把后续回合送进去（fork #29，claim-and-push）。v1.37.5 合并时保留了 fork 的复用路径，把上游的释放移到了只有中断发送的路径上。每次同步都要手工解这个冲突，所以记在这里。

## 证据

- 直接代码追踪：`upstream/main`（`0ce5630f`）的 `server/modules/providers/list/claude/claude-runtime.provider.js:1011` 每回合都执行 `releaseHeldSession(sessionKey());`，只由 `if (sessionKey())` 守卫。第 1008–1009 行的注释写着：「A new turn supersedes any earlier one still holding this session's process open, so held runs cannot stack up across a conversation.」
- 直接代码追踪：`upstream/main` 的 `src/modules/chat/hooks/useChatComposerState.ts:938` 在有后台任务时，交互式发送前会询问用户。
- 推断，未实测：上游把「新回合结束后台任务」当作有意的行为。我用的依据是发送前的提示；没有去搜索上游 issue 或设计说明。

## 决定（2026-10-18）

Won't submit。成本测试里有一条成立：每次同步都要手工重做这个分叉，代价大。决定性的是另一条：fork 需要的修复会要求上游推翻一个有意的设计决定（上游的注释和 composer 提示都描述了这种停止）。`docs/upstream-pr.md` 要求提交的内容不能需要上游做设计决定。

以下情况再考虑：上游改了每回合释放的逻辑，或者加了让后台任务跨回合保留的方式。那时可以提议把这个分叉作为 #29 的退役来提。
