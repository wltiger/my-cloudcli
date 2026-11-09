# 方案 review 汇总 + 收口（主会话）

评审：sub-fable（`review-plan-sub-fable.md`）、claude-g4a（`review-plan-claude-g4a.md`）。收口：主会话。
主会话已核实：POLL_INTERVAL_MS=30_000（dispatcher:15）；mergeQueuedMessages / restoreQueuedMessage（session-drafts.db.ts:57-64、167-184）；claimHeldTurn 认领即删（claude-turn-reuse.ts:346-354）+ adopt 失败 return null（runtime:1514-1516）；startRun connection=null 时 writer 无连接（chat-run-registry:214-266、chat-session-writer 构造函数注释）。

## Self 轴
- S1【共识 g4a must-fix / fable advice】V3 漏了必然失败的现有测试：composerSendOverBackgroundWork、composerSendMenu、composerSendMenuSteer、chatComposerSendMenu、composerSideQuestionRouting、composerQueuedFollowUps → 补进 V3
- S2【共识】"回合结束马上推进"没有缝：排队消息只靠 30 秒轮询 → 决定 R-A
- S3【fable】V2 的 Windows 基线是类别不是名单 → 合并前先在 dev 跑一次 npm test 记失败名单，合并后对比
- S4【fable】preset 类型缺 'sideQuestion'；拒绝回调是 useEffect([]) 闭包 → 并入第 12 条重写
- S5【g4a】第 7 条只写 claude-sessions，决定 4 写 anchors → 改在 buildClaudeAnchorIndex 里跳过 attachment 行
- S6【g4a】3b「横幅」与第 17 条「排队卡片」不一致 → 决定 R-C

## Reality 轴
- R1【共识 must-fix，已核实】waitFor 会在 readQueuedMessageInput / mergeQueuedMessages / readQueuedChatMessage 三处被丢；合并是后者覆盖（与"background 优先"相反）；restoreQueuedMessage 写回原串，改不了值 → 第 13/15 条点名这些位置并实现
- R2【共识】旁问 env：askClaudeSideQuestion 拿不到模型表；直接覆盖 env 会丢 process.env → 在 runtime 的两个调用点用 context.getProviderModels() + buildClaudeSdkEnv() 算好传进 deps
- R3【共识】runDetachedChatTurn 没有 interruptBackground 入参 → 加入参，按 handleChatSend 的约定作为 extraRuntimeOptions 传
- R4【共识】定时「等待」转排队有坑：斜杠命令 append 返回 null → 又静默丢；附件在 options 里要搬；（g4a）前端看不到服务端新建的排队卡片 → 决定 R-C
- R5【g4a must-fix + fable R3】被拒弹框流程：重发会走回 handleSubmit 的状态判断（isLoading / background 标志已变）→ 可能错排队或无限弹框；setInput 没同步 inputValueRef；乐观气泡残留 / 重复；lastSentForRefusalRef 从不清空，旧消息会被塞回；切走会话后字写进了当前会话 → 第 12 条重写（见收口 M1）
- R6【g4a must-fix，已核实，fork 既有】认领后热切设置失败 → 登记丢失，之后兼容的发送也推不进 → 决定 R-D
- R7【fable，fork 既有】拒绝只看 task tracker：进程只被 cron 快照托着时改了设置再发 → 不拒绝、直接关进程杀 cron → 决定 R-E
- R8【g4a must-fix，部分成立】后台代发的 run 没挂任何浏览器连接（上游设计："定时器开的 run 还没有观众"）；推进成功后 held 进程的输出改走这个 run → 决定 R-B
- R9【fable】writer 是类实例，不能用展开包一层 → 在 registry 的 decorateAndRecordEvent 里看到该 code 就在 run 上记标志
- R10【fable】定时弹窗不建 options（在 ChatInterface.handleScheduleMessage 建）→ 开关值经 onSchedule 签名穿过 ChatComposer → ChatInterface（3 个上游文件各改一点）
- R11【fable】choice 联合类型在 ChatComposer.tsx、useChatComposerState.ts 也有 → 一起改
- R12【fable】后台代发被拒时，聊天里也会出现错误行 → 文案改中性（只写原因），不另做处理
- R13【g4a】QueuedMessageCard 在回合中排的 'turn' 消息也显示"等后台任务" → 只在 waitFor 为 'background' 时显示
- R14【fable】第 5 条运行时合并推演 7 个极端输入，无新断点 ✅

## 收口补的
- M1 第 12 条重写：被拒时不走 handleSubmit，直接按选择执行，用被拒那条的记录（会话 id、帧类型 chat.send / chat.edit-send、anchorId、内容、附件）：
  - Send anyway → 原帧类型重发，带 interruptBackground，不再加气泡
  - 排队 / 旁问 / 取消 → 删掉那条没送达的气泡；取消时字写回被拒会话的草稿（不是当前输入框）
  - 记录在该会话下一次 complete（未被拒）时清空
- M2 编辑旧消息（chat.edit-send）遇后台任务一定被拒 → M1 已覆盖：Send anyway 时仍用 chat.edit-send
- M3 若 R-A 选 (b)：在 run 完成时调一次 dispatchQueuedMessages（经 scheduled-messages 的 barrel）

## 待用户定
R-A 30 秒轮询 · R-B 代发 run 的观众 · R-C 定时「等待」放哪 · R-D 设置切换失败丢登记 · R-E cron 快照托着时的拒绝
