# 收工：26110901-sync-v1.37.8
结论：有遗留（用户烟测未做）　起点：cbf3832d　日期：2026-11-09

## 大纲
- 调查：两份调查（research-claude.md、research-other.md），查出能力表被自动合并贴错位置
- grill：决定 1–10（对齐上游；能不打断就发，必须打断时让用户选或等）；方案 review（sub-fable + claude-g4a）→ R-A…R-E
- 合并 v1.37.8：26374691（15 个冲突文件，Claude 运行时按草图合并，能力表改正，锁文件用上游）
- 运行时小修：678f21b8（R-E、插话行不打锚点、MCP 表单推送带 userId、旁问副本带自定义 endpoint）
- 后台状态发送：cc984597（Enter / 菜单「发送」推进进程不弹框，被拒才弹上游对话框，编辑被拒可重发）
- 排队和定时：7edd9ef6（waitFor、定时立即 / 等待、被拒识别、R-B 初版）
- 阅读设置 / 中文 / 文档：435e359b
- code review（standards sub-opus、spec sub-opus、收口 sub-fable）→ C-1…C-6
- review 修复：e684faf7（C-1 注册表按会话记观众；C-2；C-4；C-5 挪出上游文件；V4.1/V4.2 测试 + 变异验证；小问题）
- 收尾文档：PR08 / PR09（不提交）、.claude/CLAUDE.md Windows 基线、CONTEXT.md 锚点、ADR 0012 状态、memory
- 落本地：dev 快进到 sync/v1.37.8，main 快进到 v1.37.8（2053f3d7）
- 跑题：无

## 漏项 / 暂缓
- ✅ 方案 1–21、决定 1–10、R-A…R-E、code review C-1/C-2/C-4/C-5 和直接改的项
- ✅ 验收清单 V0–V5（V0 基线、typecheck、lint、前后端全量、新测试）
- ⚠️ V6 浏览器烟测：用户做，清单见 smoke-checklist.md
- ⚠️ 复查（收口续跑看修复）和验收走查：用户选择跳过
- ⚠️ R-D 热切换失败丢登记、被拒气泡残留、C-3 跨标签页误认拒绝：已进 backlog
- ⚠️ C-6：定时「等待」用 claimDue + releaseClaim，不是方案写的 listDue / claimOne，已记进 plan
- ⚠️ `createQuery` 类型断言已不需要（上游 SDK 追上），没删，#34 文档已写
- ⚠️ zh-CN 还缺一批更早就缺的条目（misc.* 等），不在本轮范围
- ⚠️ backlog 里「② 中断并发送与普通发送行为一致」已过时（中断并发送退役），留给用户处理
- ✅ upstream-pr 判断：PR08（代发回复不实时）、PR09（Windows cursor 测试卡死）都不提交，已留档
- 新增 TODO / FIXME：无

## 文档同步
### agent 文档
- ✅ .claude/CLAUDE.md：Windows 基线段补「npm test 会卡死」和跳过命令、新增稳定失败和负载偶发项
- ✅ CONTEXT.md：锚点一节补「插话行两种锚点都没有」
- ✅ ADR 0012：加 v1.37.8 状态（仍半满足，ADR 保留）
- ✅ docs/agents/antigravity-provider-implementation.md §10：补 supportsSideQuestions / supportsSteering
- ✅ docs/agents/backlog.md：删已修的定时静默丢弃，加 R-D、被拒气泡、C-3（用户未提交的改动，本轮不提交）
- ✅ memory：preexisting-windows-test-failures 补卡死和新项；scheduled-msg-background-drop 落 dev 后删除
### 其他文档
- ✅ docs/fork-customizations.md + .zh-CN.md：13 个条目的 v1.37.8 段 + code review 后的位置说明、#23 测试归属改正、#31 Files
- ✅ docs/pull-requests/：PR08、PR09（中英）+ README 索引
- ✅ 不需要改：docs/upstream-sync.md（流程没变；Windows 卡死写在 CLAUDE.md）

## 提交状态
- 本轮 commit：26374691 … e684faf7（6 个）+ 收尾文档 commit
- 未提交：docs/agents/backlog.md（用户自己的改动 + 本轮追加的 3 条，按约定不提交）、docs/browser-use.md、.scratch 里其他几个不属于本轮的目录 / 文件
- push：dev、main 已推到 origin（本记录提交后；dev 一并带上本会话开始前没推的 cbf3832d）
- stash：无；worktree：只有主工作区
- 分支：保留 sync/v1.37.8；sync/v1.37.7 打 archive/sync-v1.37.7 后删除（与 dev 比的 5 行「新增」是 dev 后来改过的旧文字）

## 清理
- ✅ 已删：/tmp 下 hold.bak rt.bak rt.keep bss.bak pan.log osq.*.log（10 个）；本会话 scratchpad 266 个中间文件（1.4M）；本目录 *.raw 测试日志和 *.fails（1.7M）
- ✅ 已删（更早，阶段清理）：g4a 方案 review 的 CLI 会话、review 导出的三套文件
- 留：本目录其余文件（计划、调查、review、验收、烟测清单、基线名单）；4 个派单 STEM 目录
- 后台任务、派出 agent：都已结束；端口 3001 / 5173 没被占用；Cron：本轮没建；派出的 CLI 会话：本轮其余都是 sub，没有 CLI 会话

## 踩坑
1. 全量后端测试放后台跑没加防卡死，被上游新测试卡了 30 分钟才发现 → 已写进 .claude/CLAUDE.md（跳过参数）和 memory
2. 用 `grep -q $'\r'` 判断换行符得出 LF，实际工作区是 CRLF（autocrlf=true），几个 node 脚本因此找不到锚点、有一次把文件内容切坏 → 拟写进 .claude/CLAUDE.md「Shell gotchas」：判断换行符用 `git ls-files --eol <path>`，脚本改文件前统一转 LF、写回再转 CRLF，找不到锚点必须报错退出——用户选择不记
3. 方案里的 V4.1 / V4.2 测试在实现时漏写，到 code review 才发现 → 拟写进 .claude/CLAUDE.md：每单收尾前对照 acceptance.md 逐条打勾，没写的测试要么补、要么记为偏离——用户选择不记
4. R-B 第一次只接上「上一个 run」的连接，没考虑 run 完成 5 分钟后会被清掉 → 一次性推理疏漏，不记
5. 测试里的模拟 runtime 写错（后台结束后忘了关「拒绝」开关）、heredoc 里正则转义丢失 → 一次性，不记

## 下一步
1. 用户按 smoke-checklist.md 烟测（发现问题在 dev 上修）
2. backlog 里 3 条新项（R-D、被拒气泡、C-3）按优先级排进迭代队列（`/to-backlog` 已记，开工时 `开工`）
3. 以后有空：删掉 `createQuery` 类型断言；补齐 zh-CN 里更早缺的条目
