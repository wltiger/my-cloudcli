# Standards 审查 · sub-opus

**结论**：合并提交 26374691 的冲突解决没有违反规范。之后的 4 个 fork 提交里有 3 处明确违规，都很好改；另有 9 条建议。最主要的风险是官方文件 dispatcher 和 composer hook 被大段改写，下次合并官方代码时容易冲突。

## 发现（从重到轻）

1. must-fix · standard · `src/modules/chat/hooks/useChatComposerState.ts:1528`、`:1551` · Surgical changes「删掉这次改动留下的无用变量和 import」· `submitMessage` 里已经不再用后台工作弹窗，但 useCallback 依赖数组里还留着 `askBeforeSendingOverBackgroundWork` 和 `t`。oxlint 对这两处报 warning，dev 和 26374691 都没有这两条 warning。→ 从依赖数组里删掉。原文：「has unnecessary dependency: t」
2. must-fix · standard · `useChatComposerState.ts:121`、`:1427-1430` · Simplicity「不为不可能发生的情况写处理代码」· `presetBackgroundChoice` 的类型里新加了 `'sideQuestion'`，但唯一的调用方 `:1606` 只会传 `'queue' | 'send'`（`:1594` 已经先处理了 sideQuestion），所以 `:1427` 那个分支永远不会执行。→ 类型改回两个值，删掉这个分支。原文：「presetBackgroundChoice: choice」
3. must-fix · standard · `server/shared/types.ts:1222` · SKILL.md「每个 shared type 都要有详细的 doc comment」· 新加的 shared type 没有 doc comment，说明只写在 `waitFor` 字段上。→ 给这个 type 补上 doc comment。原文：「type QueuedMessageWaitFor =」
4. advice · standard · `server/modules/scheduled-messages/services/scheduled-message-dispatcher.service.ts:106-226` · Upstream-merge friendliness · 这个文件属于官方。这次加了约 50 行 wait 模式代码，还把官方的 `sendClaimedMessage` 主体改写成 `send` closure、`const` 改成了 `let`，不是纯新增。→ wait 模式的代码挪到同模块里一个新的 fork 自有文件，dispatcher 里只留调用。原文：「let result = await send(false)」
5. advice · standard · `useChatComposerState.ts:136`、`:1617-1672` · 同上 · 在官方 hook 里新加了 `RefusableSend` 类型和 `handleRefusedSend`，共约 75 行。→ 能拆的部分挪到 fork 自有文件（比如 `backgroundWorkRefusal.ts` 旁边）。原文：「const handleRefusedSend」
6. advice · standard · `server/modules/scheduled-messages/tests/busy-session-sends.test.ts:82`、`:217` · SKILL.md「测试放在所属 feature 的 tests/ 目录」· `:217` 只测 `chatRunRegistry.startRun`，`:82` 只测 `runDetachedChatTurn`，这两个都属于 websocket 模块。→ 挪到 `server/modules/websocket/tests/`。原文：「keeps every tab that watched」
7. advice · smell(Duplicated Code) · `dispatcher:85-86` 和 `:128-130` · 新函数 `holdsBackgroundWork` 的内容，在同一个文件的 `dispatchQueuedMessages` 里又原样写了一遍。→ 那里直接调用这个函数。原文：「const backgroundHeld = runtime」
8. advice · smell(Primitive Obsession) · `dispatcher:185`（照抄官方 `:53` 的写法）· 判断「已有 run」靠比较报错文字，必须和 `chat-websocket.service.ts:952` 的文字一字不差。官方一旦改了这句话，wait 模式的消息会被直接记成失败。→ 让 `runDetachedChatTurn` 返回一个明确的字段，或者导出这个文字常量。原文：「'A run was already in progress」
9. advice · smell(Primitive Obsession) · `server/modules/websocket/services/chat-run-registry.service.ts:142` · `background_work_not_kept` 这个字符串写在 3 个地方：runtime `:1554`、registry、前端 `useChatRealtimeHandlers.ts:315`。而且通用的 run registry 现在要认识 Claude 专用的错误码。→ 至少后端两处改用同一个共享常量。原文：「=== 'background_work_not_kept'」
10. advice · smell(Duplicated Code) · `useChatComposerState.ts:1661-1671` 和 `:1490-1503` · 发送消息的 frame 在这两处各拼了一遍，以后改一处容易漏另一处。→ 写一个用 `RefusableSend` 拼 frame 的函数，两处都用它。原文：「type: sent.frameType,」
11. advice · smell(Shotgun Surgery) · `src/modules/chat/composer/ChatComposer.tsx:114`、`useChatComposerState.ts:1593` 以及两个测试文件 · 加一个 `sendKeep` 要改 4 处一样的 union，而现成的 `ComposerSendMenuChoice` 已经导出了。→ 改用 `Exclude<ComposerSendMenuChoice, 'stop'>`。原文：「'send' | 'sendKeep'」
12. advice · smell(Duplicated Code) · `server/modules/user/user.service.ts:88`、`server/shared/utils.ts:126` · `waitFor` 的合法值检查写了两遍。→ 在 shared/utils 里加一个 `isQueuedMessageWaitFor` 函数，两处共用。原文：「record.waitFor === 'turn' ||」

## 核实方式 / 没覆盖到的
- 文件归属：26 个被改文件都用 `MSYS_NO_PATHCONV=1 git cat-file -e upstream/main:<path>` 查过。fork 自有的只有 `claude-turn-reuse.ts`、`claude-anchors.ts`、`backgroundWorkRefusal.ts`、`claude-custom-endpoint.ts`，其余都属于官方。
- 第 1 条：对工作区、dev、26374691 三个版本都跑了 oxlint 对比。
- 合并 diff 逐个看了冲突区和 `++` 行。测试文件里合并时新加的只是补 `currentProviderSupportsCompact/Clear` 和 `interruptBackground: true`，不算问题。
- `docs/fork-customizations.md` 和它的 zh-CN 版都已同步更新，符合 CLAUDE.md 的要求。
- 没跑测试和 typecheck。
