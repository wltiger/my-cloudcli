# 收工：26110101-sync-v1.37.7
结论：有遗留（用户烟测未做）　起点：a18a4701　日期：2026-11-01

## 大纲
- 落地 v1.37.6：自检后 main → c17c2f6d，dev → a18a4701，已 push（会话内，起点之前）
- 合并 v1.37.7：9361b4df。OpenCode 对齐上游，删 fork 的 Compact / Fork / Edit；前端和 chat-websocket 冲突两边都留；能力表、测试、fork-customizations 同步
- 复查修复（文档）：97a064b1（第一轮 review 的 R1–R4）、80ed9142（最终审查的 F1–F4）
- 复查修复（代码）：e066b97e，切全屏时「其他」输入框保持焦点和高度（F5），带测试
- 落本地：dev → e066b97e，main → 13e9ef64，未 push
- 检查清单：checklist-v1.36-v1.37.md
- 跑题：无

## 漏项 / 暂缓
- ✅ OpenCode 对齐上游：9361b4df，`list/opencode/` 相对上游只差 #39 的同步器
- ✅ E1 #39 保留 · E2 通用底层保留 · E3 Clear 保留 · E4 全屏标题
- ✅ fork-customizations 中英文同步（#11 #22 #23 #27 #32）
- ✅ 用户要的 1.36–1.37 清单
- ⚠️ 浏览器烟测：用户选择先合并，自己编译后再测
- ✅ push main / dev：用户选择烟测前就推
- ⚠️ 实际编译、最后 2 个 commit 后的全量测试：都没跑（只跑了 typecheck、lint、问题面板测试）
- ⚠️ R5：约 6 处代码注释仍按现在时讲 OpenCode 的 Edit / Fork，留到 OpenCode v2
- ⚠️ F6：Windows 上 `reapOrphanedOpenCodeServers` 不生效（上游代码，只读过代码），不处理
- ⚠️ 未验证：只剩后台任务时 Stop 与新 run 的竞态；`CLAUDE_CODE_ENTRYPOINT` 对 claude.exe 的实际影响
- ✅ upstream-pr 判断：F6 不提交，已写 docs/pull-requests/PR07
- ✅ 旧分支已清理：sync/v1.37.4、5、6 已删（archive tag 保留）
- 新增 TODO / FIXME：无

## 文档同步
### agent 文档
- ✅ CONTEXT.md、ADR 0004 / 0009 / 0011
- ⚠️ .claude/CLAUDE.md 的 Windows 基线段：缺 chat-edit-send（30ms settle）、前端 authTokenRefreshRemount、file-tree symlink EPERM（用户选择不记）
- ✅ docs/agents/antigravity-provider-implementation.md:129 已改
- ✅ memory project-claude-first-message-edit-wontfix 已补
- ⚠️ memory project-preexisting-windows-test-failures：同上（用户选择不记）
### 其他文档
- ✅ docs/fork-customizations.md + zh-CN
- ✅ 不需要改：docs/antigravity-agy-provider-feasibility.md（当时的调研快照）

## 提交状态
- 未提交：docs/agents/backlog.md、docs/browser-use.md、.scratch/open-in-os-spec.md、.scratch/26100401-*、.scratch/26101001-*、.scratch/sync-v1.37.5/plan.md 都不是本轮的；本轮只有 .scratch/26110101-sync-v1.37.7/
- push：main、dev 已推到 origin（本记录提交后）
- stash：无；worktree：只有主工作区
- 分支：新建 sync/v1.37.7，保留（按 upstream-sync，只留最新）

## 清理
- ✅ 已删：/tmp 下 f.py r.py t.py t2.py t3.py notes.py lint.log b.txt n.txt n2.txt base.txt now.txt
- ✅ 已删（打 archive tag 后）：sync/v1.37.5、sync/v1.37.6；sync/v1.37.4 已有 tag，直接删
- ✅ 已删：派出的 CLI 会话，STEM 2611011652-claudecodeui-review（4 个）、2611010833-claudecodeui-review-final（1 个）
- ✅ 已删：fe-full.raw（104K，结论已在 fe-full.log）
- 留：端口 3001 的实例（PID 7980，用户自己的）；本目录其余文件；派单 STEM 目录
- 后台任务、派出 agent：都已结束；Cron：本轮没建

## 踩坑
用户选择不记教训（第 1、2、4、5、6 条都没写进规则文件）。
1. 对上游测试文件用 `checkout --theirs`，把 fork 的 #24 适配也冲掉了 → 写进 docs/upstream-sync.md
2. 退役一部分功能时只在条目顶部加说明，"On upstream conflict" 还在教人装回去，我还判断过不用改 → 写进 docs/upstream-sync.md
3. "没有 provider 用 Rewind"、"没有产出方" 是推断没核对，多家 review 也没发现 → 全局 CLAUDE.md「Universals」已覆盖，不记
4. upstream 已越过要落的版本时，main 要快进到 tag 的 commit；`git fetch . <sha>:main` 和 annotated tag 都不行 → 写进 docs/upstream-sync.md
5. Windows 测试基线缺 3 类 → 写进 .claude/CLAUDE.md + memory
6. 只读 sub 比对时在 /tmp 建了临时文件，越过「只写一个文件」 → dispatch 教训箱
7. re.subn 的替换串里 `\n` 会变成真换行，用了 3 轮才发现 → 一次性，不记

## 下一步
1. 用户编译 + 按清单烟测（发现问题在 dev 上修）
2. OpenCode v2 出来时：重新梳理 Compact / Fork / Edit，顺手改 R5 的注释
