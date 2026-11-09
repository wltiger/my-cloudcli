# sub-fable · sync v1.37.8 code review

范围：`merge-resolution.diff`（26374691 冲突解决）+ `fork-commits.diff`（678f21b8…435e359b）。仓根 `D:/code/opensource/claudecodeui` 已确认存在。每条结论后附原文摘录。

## Standards

- must-fix · standard · `server/shared/types.ts:1739` · SKILL.md「Give every shared type … a detailed doc comment」 · `QueuedMessageWaitFor` 导出类型无 doc 注释（说明写在 1729 行的字段上）；把注释挪到类型声明上｜摘:「type QueuedMessageWaitFor =」
- advice · smell · `server/modules/scheduled-messages/services/scheduled-message-dispatcher.service.ts:185` · Primitive Obsession / Duplicated Code · 拿 `runDetachedChatTurn` 的错误原文做分支判断，第 53 行上游已有一处，现在两处；让返回值带错误码（如 `reason: 'run_in_progress'`）或导出常量｜摘:「A run was already in progress」
- advice · smell · 同文件 `:151-152` · Mysterious Name（绕路） · 解构出 `onBusy` 后再包成对象传给 `readBusyMode(options)`；让 `readBusyMode` 直接收 `unknown`｜摘:「readBusyMode({ onBusy })」
- advice · standard · `src/modules/chat/hooks/useChatComposerState.ts:2243-2302` · prompt「prefer new fork-owned files」+ Divergent Change · `handleRefusedSend`、`RefusableSend`、两个 ref、两个 effect 约 90 行加进上游所有的 2000 行 hook（`git cat-file -e` 确认上游所有）；可抽成 fork 自有 `useRefusedSend.ts`，hook 里留一行调用｜摘:「const handleRefusedSend = useCallback」
- advice · standard · `server/modules/scheduled-messages/tests/busy-session-sends.test.ts:1444` · SKILL.md「Put feature tests in server/modules/<feature>/tests/」 · 末尾用例只测 `chatRunRegistry.startRun` 继承 audience（websocket 模块），应放 `server/modules/websocket/tests/`｜摘:「keeps every tab that watched」
- advice · standard · `server/modules/providers/tests/claude-elicitation-push-clear.test.ts:625` · CLAUDE.md「Cross-module imports MUST go through that barrel」 · `t.mock.module` 写死另一模块内部路径 `notifications/services/notification-orchestrator.service.js`，lint 查不到但耦合内部文件；改 mock barrel 或只断言 writer 收到的帧｜摘:「Mocked one level below the notifications barrel」

已核对无问题：`ScheduleBusyModeToggle.tsx`、`backgroundWorkRefusal.ts` 为 fork 自有新文件；`provider-capabilities` 两字段放对 provider；dispatcher 只经 `@/modules/websocket/index.js` barrel 取 `chatRunRegistry`/`runDetachedChatTurn`（`:4`）；`package.json:143` 取 `^0.3.311`；`BackgroundSendDialog.tsx` 与 upstream/main 零 diff。

## Spec

- must-fix · missing · V4「claim 来的 follow-up 留有未读 steer 时 settled 等到后续 result」「旁问推迟 release 时 handle 已撤销、新 send 不推进」 · `server/modules/providers/tests/`（无对应文件） · 两条验证没有测试：fork 新增/改动的 8 个 provider 测试里，`steer|forgetHeldTurn|heldTurns` 只命中上游的 `claude-steer.test.ts`；执行表各单元列的验证也没有 V4.1/V4.2，且不在两处已记录的偏离里。它们是手工合并的 `settleTurnResult`（`settleFollowUpTurn()` 放进 settle 内）和 `unpublishDeferredHold` 唯一的自动化覆盖｜摘:「V4 后端新测试：claim 来的 follow-up」
- advice · partial · 12「后三种删掉那条没送达的乐观气泡」 · `useChatComposerState.ts:2259-2275` · cancel / queue / sideQuestion 都不删气泡；执行记录已声明偏离并进 backlog、docs #31 写了 Known gap，这里只记一笔｜摘:「被拒气泡删除未做：需穿 4 个上游文件」
- advice · wrong · 18「加只读的 listDue(now) 和按 id 认领的 claimOne(id)」 · `scheduled-messages.db.ts:108-116`、`scheduled-message-dispatcher.service.ts:219-226` · 实现是 `claimDue` 整批标 `'sent'`，再对 `wait` 条目 `releaseClaim` 退回 `'pending'`：「回合在跑 → 不认领」变成每 30 秒认领再退回，`updated_at` 反复刷新，中间瞬间 `listForSession` 读到 `'sent'`。最终行为与计划一致，机制不同｜摘:「先列出到期条目，逐条判断」
- advice · partial · 17「onBusy … 默认 'interrupt'」 · `ScheduleMessagePopover.tsx:57` · `busyMode` 是常驻组件的 state，弹窗关闭不重置：选过一次「等待」后，同一会话下一次定时默认就是「等待」；若默认按次生效，在 `commit` 里重置｜摘:「useState<ScheduleBusyMode>('interrupt')」
- advice · partial · 12「下一次未被拒的 complete 到达时清空」 · `useChatRealtimeHandlers.ts:377` · 任一 `complete` 都清（含被拒 run 自己的 exit 1）；服务端 error 帧先于 complete，ref 已被拒绝处理清空，实际无害，只是与措辞不同｜摘:「notifyRunSettled(sid)」

### 极端输入推演（5、10–18）
- 5：result 时 `pendingSteerIds>0` 且有后台任务 → `awaitSteerFollowUp`，`turnInFlight` 保持 true → follow-up result → `settleTurnResult` → `registerHeldTurn`；旁问挂起 → release 推迟 → `unpublishDeferredHold` → `forgetHeldTurn` ✓（但无测试，见 must-fix）｜摘:「settleFollowUpTurn()」
- 10：菜单选 Send anyway，到 `submitMessage` 时后台标志已翻 false → `presetChoice` 为 undefined → 普通发送不带 `interruptBackground`，无可中断，合理 ✓ `useChatComposerState.ts:1442-1443`｜摘:「presetChoice === 'send'」
- 11：`sendKeep` → `handleSubmit()` 无 preset ✓ `:1602`｜摘:「if (choice === 'sendKeep')」
- 12：切走后被拒 → `writeDraftText(被拒会话)`、不弹框 ✓；edit 被拒选 Send anyway → `chat.edit-send` + `anchorId` + `interruptBackground` ✓（测试 `composerSendOverBackgroundWork.test.ts:2796`）｜摘:「an edit stays an edit」
- 13：旧行无 `waitFor` + 新 `'turn'` 合并 → `'background'` ✓ `session-drafts.db.ts:349-351`；restore 带 `waitFor` 时写新 JSON 不写 `claimToken` ✓ `:385`｜摘:「changes.waitFor ? JSON.stringify(restored)」
- 14：拒绝帧在 `decorateAndRecordEvent` 置位，`dispatchRun` await 后读出；`interruptBackground` 顶层传入不进 options ✓｜摘:「Top level, as on `chat.send`」
- 15：`'turn'` + 只剩后台（含注册表 cron 持有）→ 推进；拒绝 → 改 `'background'` 下轮跳过 ✓ `:60-63, :85-88`｜摘:「put it back to wait for the work」
- 16：开新 run 继承上一 run 的 OPEN 连接；客户端 `lastSeq` 只增不减、不丢低 seq 帧（`useChatRealtimeHandlers.ts:152`）✓｜摘:「for (const connection of existing?.writer.audience()」
- 17：见 advice 第 4 条。
- 18：`'wait'` 首推被拒 → 内存集合 + `releaseClaim`；重启集合丢 → 最多再被拒一次（注释已声明）；`'interrupt'` 二次仍拒 → `failed` ✓｜摘:「a restart costs at most one more refused push」

已核对无问题：zh-CN 补齐上游新增 47 个 key（计划写 46，实为 47，全在）；en/zh 对话框说明 = 上游；docs #3 #11 #12 #16 #23 #25 #29 #30 #31 #32 #33 #34 #39 均有 v1.37.8 段；backlog 已删「定时消息静默丢弃」、加 R-D（未提交，按计划）；决定 4/6/8/9 落地点与计划一致。
