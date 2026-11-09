# code review 汇总（cbf3832d..435e359b）

评审：Standards = sub-opus（review-code-standards-sub-opus.md）· Spec = sub-opus（review-code-spec-sub-opus.md）· 收口 = sub-fable 双轴合一（review-code-sub-fable.md）。汇总：主会话。
主会话已核实：S1 oxlint 报 `t` 多余依赖（:1526）；S2 `presetChoice === 'sideQuestion'` 不可达（菜单的旁问在 handleSendMenuChoice 里先处理）；S3 `QueuedMessageWaitFor` 无 doc；P1 确实没写 V4.1/V4.2；P2 `COMPLETED_RUN_RETENTION_MS` = 5 分钟。

## Standards 轴
共识（两家）：
- S3 must-fix：`server/shared/types.ts` 的 `QueuedMessageWaitFor` 缺 doc 注释 → 直接改
- S4 advice：fork 新逻辑大段写进上游文件（dispatcher 的 wait 模式约 50 行、composer hook 的 `handleRefusedSend` 约 90 行）→ 决定 C-5
- S5 advice：`busy-session-sends.test.ts` 里测 `startRun` / `runDetachedChatTurn` 的两个用例属于 websocket 模块 → 直接挪
- S7 advice：dispatcher 用错误原文判断"已有 run" → 不改（照抄上游 :53 自己的写法；改返回值要多动上游文件）
单家（sub-opus）：
- S1 must-fix：`submitMessage` 依赖数组残留 `askBeforeSendingOverBackgroundWork`、`t` → 直接改
- S2 must-fix：`presetBackgroundChoice` 的 `'sideQuestion'` 分支不可达 → 直接删
- S6 advice：`holdsBackgroundWork` 在 `dispatchQueuedMessages` 里重复写了一遍 → 直接改
- S11 advice：`waitFor` 合法值检查写两遍 → 直接加 `isQueuedMessageWaitFor`
- S8/S9/S10 advice（错误码字符串 3 处、发送帧拼两遍、choice union 4 处）→ 不改（都是小重复，改了要多碰上游行）
单家（sub-fable）：
- S12 advice：`readBusyMode({ onBusy })` 绕路 → 直接改
- S13 advice：elicitation 测试 mock 了 notifications 模块内部路径 → 不改（与已有 fork 测试同一写法，mock barrel 会丢掉别的导出）

## Spec 轴
共识（两家）：
- P1 must-fix：V4.1（claim 来的 follow-up 留有未读 steer）、V4.2（旁问推迟 release 撤销 handle）没写测试 → 直接补
- P7 advice：第 18 条没按计划加 `listDue` / `claimOne`，改成 `claimDue` + `releaseClaim`（等待中的条目每 30 秒被认领再退回）→ 决定 C-6
单家（sub-opus）：
- P2 must-fix：R-B 只接得上「还在注册表里」的上一个 run（完成后保留 5 分钟），会话闲置较久后到点的定时消息仍看不到实时回复 → 决定 C-1
- P3 advice：认领成功但热切换失败时句柄已删、任务列表又为空 → 直接关进程（R-E 的漏洞）→ 决定 C-2
- P4 advice：拒绝只按会话 id 匹配；R-B 后别的标签页的拒绝也会到达，极端并发下会被当成自己的 → 决定 C-3
- P5 advice：被拒的编辑选「排队」变成普通追加、选「取消」丢了编辑状态 → 决定 C-4
- P6 advice：定时横幅只有取消、没有修改 → 不改代码，plan 措辞已过时（上游横幅本来就只有取消）
- P8 advice：#31 的 Files 没列这次改到的上游文件 → 直接补文档
单家（sub-fable）：
- P9 advice：定时弹窗的「立即 / 等待」选择不会恢复默认 → 直接改：每次定时后回到「按时发送」
- P10 advice：`notifyRunSettled` 对任一 complete 都清 → 不改（拒绝帧总在 complete 之前，无害）

## 待用户定
C-1 R-B 补全 · C-2 R-E 漏洞 · C-3 跨标签页拒绝误认 · C-4 被拒的编辑 · C-5 挪出上游文件 · C-6 定时认领方式
