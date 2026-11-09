# Spec 审查 · sync/v1.37.8 · sub-opus

结论：计划大体已落地（方案 1–4、6–11、13–15、17、19–20 与代码一致）；must-fix 2 条，advice 6 条；没发现计划外行为。摘录：「固定点 cbf3832d..435e359b = review 范围」

## 问题（按严重度）

1. must-fix · missing · V4.1「claim 来的 follow-up 留有未读 steer」、V4.2「旁问推迟 release 时 handle 已撤销」· `server/modules/providers/tests/`（没有对应用例；`claude-side-question-hold.test.ts` 对上游只改了 V3.1 那一处，`claude-steer.test.ts` 与上游相同）· 按推演代码是对的（`claude-runtime.provider.ts:1940` 的 `settleFollowUpTurn()` 在 `settleTurnResult` 内；`:1375-1379` 的 `unpublishDeferredHold`），但方案 5 里下次合并最容易改坏的两处没有测试钉住；「执行」也没把 V4.1/V4.2 分给任何单元。摘录：「验证 V0 V1 V3.1–3.3」
2. must-fix · partial · R-B「已打开该会话的页面能不能实时看到后台代发的回复」· `server/modules/websocket/services/chat-run-registry.service.ts:277`、`:51`；`server/modules/websocket/services/chat-websocket.service.ts:833` · 只继承仍在 `runs` 里的上一个 run 的观众。没有后台任务时，run 完成 5 分钟后就被逐出；会话空闲时打开或刷新的页面也不会挂到任何 writer。推演：一小时后到点的定时消息 → `existing` 为空 → 新 run 没有观众 → 要刷新才看到。排队的 'turn' 消息（30 秒内发出）不受影响。
3. advice · partial · R-E「该会话在 `heldTurns` 里还有登记」· `server/modules/providers/list/claude/claude-runtime.provider.ts:1535`、`claude-turn-reuse.ts:352` · claim 成功、`adopt` 失败时，句柄已被 claim 删掉，`hasHeldTurn` 为假；tracker 若也为空（cron、只观察到启动）→ 走 `:1561` 直接释放，不问用户就杀掉后台工作。`claude-turn-compatibility.test.ts:571-583` 把这个行为钉成预期。backlog 里的 R-D 只记了“之后一直被拒”，没记这条。
4. advice · wrong · 方案 12「收到本记录对应会话的拒绝」· `src/modules/chat/hooks/useChatComposerState.ts:368` · 记录只按 sessionId 匹配，而 R-B 让同会话各标签互相收到对方的拒绝。推演：标签 B 的 Y 先到服务端被拒，标签 A 的 X 还在路上（A 在上一个 run 的观众里）→ A 把这次拒绝当成 X 的，弹框；选 Send anyway 会带 `interruptBackground` 停掉后台工作；X 自己的拒绝随后到达时记录已空，被忽略。
5. advice · wrong · 方案 12「排队 → `queueMessage`」「取消 → 字放回输入框」（对 `chat.edit-send`）· `useChatComposerState.ts:1640`、`:1504` · 被拒的编辑选「排队」→ 存成普通排队消息，后台结束后作为新回合追加到末尾，不再替换原消息；选「取消」→ `editingAnchorId` 发送时已清空、没有恢复，再按 Enter 就成了普通 `chat.send`，被 held 进程接收 → 编辑悄悄变成追加。计划没写编辑的这两条路径。
6. advice · partial · 「等待期间条目留在定时横幅里，可删可改」· `src/modules/chat/composer/ScheduledMessageList.tsx:56` · 横幅只有取消按钮，没有修改入口。
7. advice · partial · 「加只读的 `listDue(now)`」· `server/modules/scheduled-messages/services/scheduled-message-dispatcher.service.ts:219` · 没加 `listDue`/`claimOne`，改成 `claimDue` 全部认领后对 'wait' 立即 `releaseClaim`。行为等价（同步执行，无交错），但这个偏离没记进「执行」。
8. advice · partial · 方案 21「`.zh-CN.md` 更新 #3 #11 #12 #16」· `docs/fork-customizations.md:478` · #31 的 Files 仍写 dispatcher “comment only”；本次改到的上游文件 `ComposerSendMenu.tsx`、`ScheduleMessagePopover.tsx`、`scheduled-messages.db.ts`、`session-drafts.db.ts`、`chat-session-writer.service.ts`、`user.service.ts`、`src/shared/chatDrafts.ts` 全文都没列出，下次合并查冲突面时找不到。

## 已推演、没发现问题

- 方案 5 决定 2：不 hold 分支和 stopped 提前释放分支释放后都调 `unpublishDeferredHold`（`claude-runtime.provider.ts:1934`、`:2113`），新 send 不会再推进。摘录：「因旁问推迟时立刻 `forgetHeldTurn`」
- 方案 10/11/14：Enter 和菜单「发送」走普通 `chat.send`；对话框和 en 文案与 `upstream/main` 无差异；`refused` 经 registry 带出。摘录：「没有 preset（Enter、菜单「发送」）→ 不弹框」
- 方案 13/15：'turn' 与 'background' 合并为 'background'（`session-drafts.db.ts:62-64`）；被拒后恢复与之后新排的合并同理，之后不再推。摘录：「任一方 `'background'` → `'background'`」
- 方案 18：steer 未读时 run 不发 complete，`isProcessing` 为真，'wait' 留在 pending。摘录：「回合在跑 → 不认领」
- 计划外行为：没发现；edit-send 转发 `interruptBackground` 已在「执行」记录。摘录：「edit-send 补转发 interruptBackground」
- 「执行」已记录的两处偏离（被拒气泡未删、R-D 推迟）未计入。
