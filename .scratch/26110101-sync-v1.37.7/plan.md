# sync v1.37.7

路线：S（方案 = 冲突解决表，见对话 + research-*.md）
当前阶段：完成（遗留：用户烟测）

## 已完成
- v1.37.6 自检通过（只有 Windows 基线类失败 + 1 个偶发），已落地：main → c17c2f6d，dev → a18a4701，已 push
- 分支 sync/v1.37.7 从 dev 切出

## STEM
- 2611011504-claudecodeui-research-opencode · 调查 OpenCode runtime 重写 vs #22 #23 #27 #31 #39 · sub-sonnet
- 2611011504-claudecodeui-research-frontend · 调查前端冲突 vs #11 #28 #32 等 · sub-sonnet

## 决定（2026-11-01）
- OpenCode 对齐上游：退役 #22 OpenCode 部分、#23 OpenCode Fork/Edit 部分、#27；删 opencode-anchors/rewind/serve + 测试；capabilities 关 Compact/Fork/Edit/rewindRestoresFiles
- E1 #39 保留 · E2 通用 Fork/Edit 底层留着不删 · E3 OpenCode Clear 保留 · E4 全屏标题改用 agentPrompts.needsInput
- 执行：一单，主会话；sync/v1.37.7 上可随时 commit；落 dev/main、push 另问

## 进度
- 单 1 ✓ 9361b4df 合并 v1.37.7 + OpenCode 对齐上游 + 文档；typecheck ✓ lint ✓
- 测试：后端失败全属 Windows 基线 / 负载偶发（chat-edit-send 的 30ms settle 单跑 3/3 过）；前端只剩 authTokenRefreshRemount 偶发
- 固定点（review 范围起点）：a18a4701
- 2611011652-claudecodeui-review · code review 2x2（g38f 两轴；ds41f standards@133 / spec@138）· 收口 sub-opus（用户改，原 k31p@138）待中级跑完
- 2611011810-claudecodeui-review-close · code review 收口 · sub-opus
- code review 完（报告 review-close.md）；R1-R4 文档修复已 commit；R5 注释留到 OpenCode v2
- 2611010833-claudecodeui-review-final · 最终审查（独立，不给前面结论）· claude-opus
- 最终审查完（review-final.md）；F1-F4 文档、F5 焦点修复已 commit；F6（Windows 孤儿 opencode serve，上游代码）不管，收尾按 upstream-pr 判断
