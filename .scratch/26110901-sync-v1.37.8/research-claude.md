# v1.37.8 合并：Claude Steer / 旁问 × fork #29 #30 #31 冲突方案（sub-opus）

范围与证据说明
- refs：`dev` = cbf3832d，`upstream/main` = 2053f3d7，merge base = 13e9ef64（与题述一致，`git rev-parse` / `git merge-base` 实测）。
- `merged:N` = `git merge-tree --write-tree dev upstream/main` 得到的树 2ff74842 里该文件第 N 行；冲突文件的行号与 `.scratch/26110901-sync-v1.37.8/conflict-hunks.txt` 里的标记行号一致。
- 证据分三档：**实测**（读代码 / 跑 git 命令看到的）、**文档**（fork-customizations.md 等写的）、**推测**（推理，未运行）。**本次没有运行任何测试**，所有"会通过 / 会失败"的判断都是推测，标了 `未核实`。
- 每条结论后的「原文」是从所引位置原样摘的片段（≤30 字符）。

---

## 1. 摘要（结论先行）

1. **一个 prompt stream 就能同时服务 steer 和 claim-and-push**：保留 upstream 的"release 后拒收"+ fork 的 `isOpen()`，`push` 统一收数组、返回 boolean。两种写入在时间上互斥（steer 只在 turn 未报 complete 时收，held-turn handle 只在报完 complete 后登记），不会交错。
2. **`releaseHeldSession` 不是 upstream 新加的**：base 13e9ef64 就在 turn 开头调用它，dev 删了；冲突只因 upstream 在它下面加了 `maybeReleasePromptStream`。解 hunk @1361 时删掉那 4 行，只留 `maybeReleasePromptStream`，v1.37.5 的决定不变。
3. **`result` 分支要"把 fork 的逻辑搬进 upstream 的 `settleTurnResult`"**：三信号 hold、`answersFollowUpPrompt`、`registerHeldTurn`、`turnInFlight=false`、`settleFollowUpTurn()` 全进 `settleTurnResult`；循环里只留 upstream 的 steer 分流。`settleFollowUpTurn()` 若留在分流之后，claim 来的 follow-up 遇到未读 steer 会被 gateway 以 exitCode 1 提前结束。
4. **旁问 deferral 与 fork 只有一个真冲突**：release 因旁问被推迟时，held-turn handle 仍可被 claim，之后推迟的 release 会在 follow-up 中途关 stdin。修法：推迟时 `forgetHeldTurn`。
5. **对话框合并为 5 选项** `'send' | 'interrupt' | 'queue' | 'sideQuestion' | 'cancel'`；upstream 新增的发送菜单在后台状态下的 "Send anyway" 必须映射到 fork 的 `'interrupt'`，否则文案说"会停掉"、实际却保留。
6. **能力矩阵有一个 auto-merge 静默错位**：upstream 给 opencode 加的 `supportsSideQuestions/supportsSteering` 落进了 fork 的 antigravity 条目，opencode 缺这两个字段 → server typecheck 失败、opencode 旁问被拒、antigravity 被错误地提供旁问。
7. **#29/#30/#31 都不冗余**：steer 只覆盖"turn 还在跑"，upstream 下一个 turn 仍会停掉后台工作；upstream 的 hold 仍只有两个信号；upstream 没有"后台工作未完成"这一服务端状态。

---

## 2. 逐 hunk 处理表

| # | 文件 | hunk（merged 行 / conflict-hunks.txt 行） | 处理 | 理由（一句） |
|---|---|---|---|---|
| 1 | `server/modules/providers/index.ts` | @21 / txt:9 | combine | 两边都是新增导出，互不相干：保留 `watchHeldTurns` 与 side-questions 导出块。原文：「export { watchHeldTurns }」 |
| 2 | `.../claude/claude-runtime.provider.ts` | @1100 / txt:27 | combine（草图 A） | 两个 `createHeldPromptStream` 改法目的不同但结构可合一。原文：「after `release` is refused」 |
| 3 | 同上 | @1292 / txt:123 | combine（草图 B） | fork 的 `inputReleased` 本地标志与 upstream 的 steer 状态变量都要。原文：「!inputReleased」 |
| 4 | 同上 | @1361 / txt:144 | combine：取 upstream 块但删掉 `releaseHeldSession` 4 行（草图 C） | `releaseHeldSession` 是 base 旧内容，dev 有意删除；`maybeReleasePromptStream` 是新的旁问逻辑。原文：「A new turn supersedes」 |
| 5 | 同上 | @1784 / txt:201 | combine（草图 D） | 保留 fork 的 closure 版 `releasePromptStream`，`pushPromptMessage` 也改成 closure；不能用 upstream 的 `= heldPrompt.release`。原文：「= heldPrompt.release;」 |
| 6 | 同上 | @1814 / txt:216 | keep fork（空） | 草图 D 用 closure 后重试路径无需重新赋值；取 upstream 会覆盖掉设 `inputReleased` 和 `forgetHeldTurn` 的 closure。原文：「= heldPrompt.release;」 |
| 7 | 同上 | @2120 / txt:222（含标记外 merged:2198-2201 三行） | combine（草图 E，最关键） | fork 的 hold/notify/register 逻辑整体移入 `settleTurnResult`（merged:1890-1945 也要改），循环里用 upstream 的 steer 分流。原文：「awaitSteerFollowUp();」 |
| 8 | 同上 | @2334 / txt:301 | combine（草图 F） | 取 upstream 的 steer 计时器清理，保留 `settleFollowUpTurn()`；**不要**取 upstream 末尾无条件 `releasePromptStream()`。原文：「Always close stdin」 |
| 9 | `server/modules/providers/provider.routes.ts` | @14 / txt:454 | combine | 只是 import：`sessionClearService`、`sessionForkService`、`sideQuestionsService` 三行都留。路由表无重复（实测 method+path 去重为空）。原文：「sideQuestionsService,」 |
| 10 | `src/modules/chat/composer/BackgroundSendDialog.tsx` | @66 / txt:462 | combine（草图 G） | 5 个按钮：Cancel · Queue · Side question · Send · Interrupt and send。原文：「'send' \| 'interrupt'」 |
| 11 | `src/modules/chat/composer/ChatComposer.tsx` | @17 / txt:479 | combine | import 并集：`useChatWidthClasses`（#3）+ `MCP_ELICITATION_TOOL_NAME` + type 列表加 `PendingSteer`。原文：「export type PendingSteer = {」 |
| 12 | `src/modules/chat/hooks/useChatComposerState.ts` | @18 / txt:488 | combine | type import 并集（`AntigravityGrantOutcome` + `PendingSteer`/`SteerOutcome`），保留 `CLEAR_COMMAND_NAME` import。原文：「import { CLEAR_COMMAND_NAME }」 |
| 13 | 同上 | @1391 / txt:495 | combine（草图 H，另需改同文件两处非冲突行） | 先处理 `sideQuestion` 早退，再 `interruptBackground = choice === 'interrupt'`。原文：「choice === 'interrupt'」 |
| 14 | `src/modules/chat/hooks/useChatProviderState.ts` | @73 / txt:505 | combine | 类型字段并集：fork 4 个 + upstream 2 个，读取处两边都已在非冲突区。原文：「supportsSteering?: boolean;」 |
| 15 | `src/modules/chat/hooks/useChatRealtimeHandlers.ts` | @4 / txt:516 | combine | type import 并集（`MarkSessionBackgroundWork` + `SideQuestionEvent,SteerOutcome`），保留 `notifyBackgroundWorkRefused` import。原文：「SideQuestionEvent,SteerOutcome」 |
| 16 | `src/modules/chat/transcript/MessageComponent.tsx` | @83 / txt:524 | combine | 留 fork 的 `useChatSpacing()`/`useChatWidthClasses()` 两行，`isGrouped` 取 upstream 带 `sideQuestion` 判断的版本。原文：「!message.sideQuestion」 |
| 17 | `src/modules/i18n/locales/en/chat.json` | @392 / txt:604 | combine | 按 #3 的 i18n 规则两边 key 都留：`send`、`interruptAndSend`、`sendAnyway`（合并后不再被对话框使用，但留着能减少下次冲突）、`sideQuestion`。原文：「keep both sides' keys」 |
| 18 | `src/shared/types.ts` | @900 / txt:613 | combine（草图 I） | 保留 upstream 的 `PendingSteer`、`SteerOutcome`；`BackgroundSendChoice` 取 5 值并集。原文：「send now (stopping that work)」 |

### 草图 A — `createHeldPromptStream`（hunk @1100）

两边的 doc 段落都保留（fork 的 "Parking on a queue…" + upstream 的 "While it is parked, `push`…"）。

```ts
function createHeldPromptStream(messages: unknown[]) {
  // Messages pushed after the turn's own prompt: a steer (mid-turn, upstream)
  // or a follow-up turn claimed from a held process (claude-turn-reuse, fork).
  const pending: unknown[] = [];
  let released = false;
  let wake: (() => void) | null = null;
  const resume = () => {
    const pendingWake = wake;
    wake = null;
    pendingWake?.();
  };

  const stream = (async function* () {
    // The turn's own prompt always goes out (upstream).
    for (const message of messages) {
      yield message;
    }
    for (;;) {
      while (pending.length > 0 && !released) {
        yield pending.shift();
      }
      if (released) {
        return;
      }
      await new Promise<void>((resolve) => { wake = resolve; });
    }
  })();

  return {
    stream,
    release: () => { released = true; resume(); },
    // Refused once released: the CLI is on its way out and would never read it.
    push: (pushed: unknown[]) => {
      if (released) {
        return false;
      }
      pending.push(...pushed);
      resume();
      return true;
    },
    // Read by heldTurn.tryAccept before and after adopting settings (fork).
    isOpen: () => !released,
  };
}
```

调用方：
- steer：`steerIntoTurn` 经 `pushPromptMessage(message)` → `heldPrompt.push([message])`，返回 false 即 steer 被拒（upstream 原逻辑不变，upstream/main:1295-1316）。
- claim-and-push：`heldTurn.tryAccept` 照旧先 `isOpen()` → `adopt` → 再 `isOpen()` → 重绑状态 → `heldPrompt.push(followUpMessages)`（dev:1503-1554）。第二次 `isOpen()` 与 `push` 之间没有 await，所以这里 `push` 不会返回 false。

与两边原实现的差别（推测，影响很小）：fork 原实现在 release 后仍会把队列里剩下的消息吐完（dev:1022-1028），合并后改为丢弃（upstream 语义）。tryAccept 的 push 和任何 release 不在同一个同步块里，实际不会命中这个差别。

### 草图 B — 状态变量（hunk @1292）

```ts
  // Closes the held stdin stream so the CLI can wind down. Replaced once the
  // stream exists; the finally block calls it unless work is still outstanding.
  let inputReleased = false;
  let releasePromptStream: () => void = () => { inputReleased = true; };
  // (upstream, unchanged) steering state
  let pushPromptMessage: (message: unknown) => boolean = () => false;
  const steeredMessageIds = new Set<string>();
  const pendingSteerIds = new Set<string>();
  let steerFollowUpTimer: ReturnType<typeof setTimeout> | null = null;
```

fork 的本地 `inputReleased`（dev:1137）和 upstream 的 `ActiveSession.inputReleased`（upstream/main:517）**两个都要**：fork 的 `finally` 在 `removeSession` 之后运行，那时 map 条目已经不在，只有本地标志可靠。原文：「!inputReleased」

### 草图 C — hunk @1361

取 upstream 块，删掉开头 4 行注释+调用：

```diff
-  // A new turn supersedes any earlier one still holding this session's process
-  // open, so held runs cannot stack up across a conversation.
-  if (sessionKey()) {
-    releaseHeldSession(sessionKey()!);
-  }
-
   // Closes the held stdin, going through the activeSessions entry so ...
   const maybeReleasePromptStream = (isIdleCeiling = false) => { /* upstream, unchanged */ };
```

### 草图 D — hunk @1784 / @1814

```ts
    let heldPrompt = createHeldPromptStream(promptMessages);
    // Both read `heldPrompt` through the closure so the retry below can swap
    // the stream without leaving a stale closer or pusher behind.
    releasePromptStream = () => {
      inputReleased = true;
      if (sessionKey()) {
        forgetHeldTurn(sessionKey(), heldTurn);
      }
      heldPrompt.release();
    };
    pushPromptMessage = (message: unknown) => heldPrompt.push([message]);
    try {
      queryInstance = createQuery({ /* unchanged */ });
    } catch (hookError) {
      // ...unchanged...
      heldPrompt.release();
      heldPrompt = createHeldPromptStream(promptMessages);
      // @1814: nothing here, neither of upstream's two reassignments.
      queryInstance = createQuery({ /* unchanged */ });
    }
```

### 草图 E — `result` 分支 + `settleTurnResult`（hunk @2120 + merged:1890-1945 + merged:2198-2201）

`settleTurnResult` 的定义位置用 upstream 的（merged:1888 起），函数体换成 fork 的逻辑：

```ts
    const settleTurnResult = () => {
      const abortPending = sessionKey() ? abortedSessionIds.has(sessionKey()) : false;
      // Read here, not at the raw result: the follow-up turn the CLI runs for
      // a steered message still answers the same pushed prompt.
      const answersFollowUpPrompt = followUpPromptPending;
      followUpPromptPending = false;
      turnInFlight = false;
      const stillOutstanding = backgroundWork.hasOutstanding(sessionKey());
      const snapshotOutstanding = snapshotSource.snapshotOutstanding();
      const holdForTurn = sawTaskEventThisTurn
        ? (stillOutstanding || snapshotOutstanding)
        : (backgroundWorkPending || stillOutstanding || snapshotOutstanding);
      if (holdForTurn) {
        console.log(/* unchanged fork log line */);
      }
      backgroundWorkPending = false;
      sawTaskEventThisTurn = false;
      if (!turnCompleteSent && !abortPending) {
        turnCompleteSent = true;
        ws.send(createCompleteMessage({ provider: 'claude', sessionId: capturedSessionId || sessionId || null, exitCode: 0 }));
        notifyRunStopped({ /* unchanged */ stopReason: 'completed' });
      } else if (heldForBackgroundWork && !answersFollowUpPrompt && !abortPending && !holdForTurn) {
        notifyBackgroundWorkCompleted({ /* unchanged */ });
      }
      if (holdForTurn) {
        heldForBackgroundWork = true;
        scheduleRelease();
        if (sessionKey()) {
          registerHeldTurn(sessionKey(), heldTurn);
        }
      } else {
        heldForBackgroundWork = false;
        maybeReleasePromptStream();
        // Deferred for a pending native side question: stdin stays open, but
        // the hold for background work is over. Unpublish the handle so no
        // follow-up turn can be pushed into a process whose deferred release
        // would close stdin under it (see section 3, Q4).
        if (!inputReleased && sessionKey()) {
          forgetHeldTurn(sessionKey(), heldTurn);
        }
      }
      // Only now is the run over for the client. Resolving the invocation of a
      // pushed turn earlier lets dispatchRun complete its run with exitCode 1.
      settleFollowUpTurn();
    };
```

循环内（替换 merged:2119-2201）：

```ts
      if (message.type === 'result') {
        warnOnContextWindowMismatch(message);
        const abortPending = sessionKey() ? abortedSessionIds.has(sessionKey()) : false;
        if (pendingSteerIds.size > 0 && !abortPending) {
          // turnInFlight stays true: the CLI starts the follow-up turn at once.
          awaitSteerFollowUp();
        } else {
          settleTurnResult();
        }
      } else if (idleReleaseTimer) {
        scheduleRelease();
      }
```

同理，auto-merge 后的"stopped 最后一个任务提前释放"分支（merged:2106-2117，已自动变成 `maybeReleasePromptStream()`）也要在其后加同样的 `if (!inputReleased && sessionKey()) forgetHeldTurn(...)`。

### 草图 F — `finally` 末尾（hunk @2334）

```ts
    } else {
      if (idleReleaseTimer) { clearTimeout(idleReleaseTimer); idleReleaseTimer = null; }
      releasePromptStream();
    }
    if (steerFollowUpTimer) {
      clearTimeout(steerFollowUpTimer);
      steerFollowUpTimer = null;
    }
    // A follow-up turn still in flight when this loop ended ... (fork comment)
    settleFollowUpTurn();
```

upstream 的 `finally` 是无条件关 stdin（upstream/main:1857-1868，原文：「Always close stdin」）。fork 文档把这块定为 **"single most dangerous block"**（docs/fork-customizations.md:452，原文：「single most dangerous block」）：取 upstream 那一行会让每次瞬时错误都杀掉后台工作。

### 草图 G — `BackgroundSendDialog.tsx`（hunk @66）

```tsx
          <Button type="button" variant="outline" onClick={() => onResolve('cancel')}>…Cancel…</Button>
          <Button type="button" variant="outline" onClick={() => onResolve('queue')}>…Queue…</Button>
          {supportsSideQuestions && hasText && (
            <Button type="button" variant="outline" onClick={() => onResolve('sideQuestion')}>
              {t('claudeStatus.backgroundTask.prompt.sideQuestion', { defaultValue: 'Side question' })}
            </Button>
          )}
          <Button type="button" variant="default" onClick={() => onResolve('send')}>
            {t('claudeStatus.backgroundTask.prompt.send', { defaultValue: 'Send' })}
          </Button>
          <Button type="button" variant="destructive" onClick={() => onResolve('interrupt')}>
            {t('claudeStatus.backgroundTask.prompt.interruptAndSend', { defaultValue: 'Interrupt and send' })}
          </Button>
```

props（`supportsSideQuestions`、`hasText`）已自动合入（merged BackgroundSendDialog.tsx:6-13），描述文案自动取了 fork 版（merged:55）。顶部 doc 注释建议补一句 side question。

### 草图 H — `useChatComposerState.ts`（hunk @1391 + 同文件两处非冲突行）

```ts
        if (choice === 'cancel') {
          return;
        }
        if (choice === 'sideQuestion') {
          askSideQuestionAndClear(targetSessionId, currentInput);
          return;
        }
        interruptBackground = choice === 'interrupt';
        if (choice === 'queue') { /* unchanged */ }
```

非冲突但必须改：
- merged:122 `presetBackgroundChoice?: 'queue' | 'send';` → `'queue' | 'send' | 'interrupt'`（upstream/main:110，原文：「'queue' | 'send';」）。
- merged:1558 `handleSendMenuChoice` 里 `{ presetBackgroundChoice: choice }` → `{ presetBackgroundChoice: choice === 'send' ? 'interrupt' : choice }`（upstream/main:1493，原文：「presetBackgroundChoice: choice」）。理由见 §4 决定 1。

### 草图 I — `src/shared/types.ts`（hunk @900）

```ts
export type PendingSteer = { /* upstream, unchanged */ };
export type SteerOutcome = 'accepted' | 'refused' | 'delivered';

/** The answer to the prompt shown when sending over a session's background work: send and keep that work running, stop that work and send, queue the message until the work finishes, ask a side question instead, or do nothing. */
export type BackgroundSendChoice = 'send' | 'interrupt' | 'queue' | 'sideQuestion' | 'cancel';
```

---

## 3. 七个问题逐条回答

### Q1 Prompt stream：能共用一个实现

- upstream 的 `push` 收一条消息，release 后返回 false（upstream/main:1057-1064）。原文：「after `release` is refused」
- fork 的 `push` 收一个数组、无返回值，另有 `isOpen()`（dev:1033-1037）。原文：「isOpen: () => !released」
- fork 改成队列的目的就是把下一 turn 推进 held 进程（dev:995）。原文：「Parking on a queue rather than」
- steer 写入带 `priority: 'next'` 和客户端 uuid（upstream/main:1310）。原文：「priority: 'next'」
- **两种写入时间上互斥（推测，依据如下）**：
  - steer 只在 `turnCompleteSent` 为 false 时收（upstream/main:1296）。原文：「if (turnCompleteSent) {」
  - handle 只在 complete 之后的 hold 分支登记（dev:1751-1756）。原文：「registerHeldTurn(sessionKey()」
  - claim 时 handle 立即删除（claude-turn-reuse.ts:352）。原文：「heldTurns.delete(sessionKey);」
  - tryAccept 把 `turnCompleteSent` 重置为 false（dev:1529）。
  - 所以 held 期间 steer 被拒，steer 待读期间没有可 claim 的 handle；而 claim 之后的 follow-up turn 里可以正常 steer。fork 文档里"两套机制推同一个 stdin 会交错"的担忧（fork-customizations.md:430）在这个合并方案下不成立。
- 合并 API：`push(messages: unknown[]): boolean` + `release()` + `isOpen()`，见草图 A；`pushPromptMessage` 用 closure 包一层，见草图 D。

### Q2 turn 开头的 `releaseHeldSession`

- **dev 现状**：turn 开头不调用。
  - 只在 `options.interruptBackground` 时调用（dev:1284-1288）。原文：「options.interruptBackground」
  - claim 失败且 tracker 有任务时，拒绝发送并返回 `background_work_not_kept`（dev:1312-1333）。
  - claim 失败且没有任务时，只关 stdin（dev:1334）。原文：「?.releaseInput?.()」
- **upstream 并没有"重新加"**：base 13e9ef64:1070-1074 本来就有这段，upstream/main:1219-1223 原样保留，diff 里它只是上下文。原文：「A new turn supersedes」。dev 删掉它，upstream 在紧下方加了 `maybeReleasePromptStream`，所以两边落在同一个 hunk。
- **怎么保住 fork 的决定又拿到 deferral**：按草图 C 删掉那 4 行，保留 `maybeReleasePromptStream`。fork 的决定见 fork-customizations.md:434，原文：「The default send is unchanged」。
- fork 的 release 点都要走 `maybeReleasePromptStream`：
  - 空闲上限：auto-merge 已改好（merged:1425）。原文：「maybeReleasePromptStream(true)」
  - stopped 提前释放：auto-merge 已改好（merged:2116）。
  - `result` 不 hold 的分支：在草图 E 里改。
- `finally` 里直接调 `releasePromptStream()` 不用改，upstream 也是这样。
- claim 失败路径的 `getSession(...)?.releaseInput?.()` 不走 deferral：它会让正在等的原生旁问被 CLI 取消，然后在只读 fork 上重问一次。这和 upstream 里"新 turn 用 `releaseHeldSession` 顶替旧 run"的效果一致（upstream/main:2111-2128）。原文：「!session.inputReleased」

### Q3 `result` 分支合并

- upstream 把 `result` 分成两路：有未读 steer 就等后续 turn，否则 `settleTurnResult`（upstream/main:1757-1767）。原文：「awaitSteerFollowUp();」
- upstream 的 `settleTurnResult` 只有两个信号（upstream/main:1587，原文：「? stillOutstanding :」）；fork 是三个（dev:1717-1719，原文：「|| snapshotOutstanding」）。**合并时必须用 fork 的版本替换 upstream 的函数体**，否则 30 秒宽限期超时那条路径（upstream/main:1608-1619）会丢掉 snapshot 信号和 `registerHeldTurn`。
- **顺序要求**：
  - `warnOnContextWindowMismatch` 每个 result 都调用，放在循环里。
  - `answersFollowUpPrompt`、`turnInFlight=false`、hold 判定、complete/notify、register 或 release、`settleFollowUpTurn` 全部放进 `settleTurnResult`。
  - 也就是只有"run 对客户端真正结束"那一刻才结算。
- **为什么 `settleFollowUpTurn()` 必须进 `settleTurnResult`（推测，代码依据如下）**：
  - follow-up 自己那次 `queryClaudeSDK` 在 `accepted.settled` 上等待（dev:1309）。
  - 它一返回，`dispatchRun` 的 finally 就调 `completeRunIfCurrent(run, { exitCode: 1 })`（merged chat-websocket.service.ts:333）。原文：「{ exitCode: 1 }」
  - 该函数会对仍在 running 的 run 发 complete（chat-run-registry.service.ts:391）。原文：「run.writer.sendComplete(opts);」
  - merged 文件里 `settleFollowUpTurn();` 在分流之后（merged:2201）。照抄的话，steer 还没读的 follow-up 会以 exitCode 1 提前结束。
  - 客户端随后还会把那条"已接受未读"的 steer 文本塞回输入框（upstream useChatComposerState.ts:1079）。
- **steer 待读 + 后台工作未完成**：
  - result 时 `pendingSteerIds>0` → `awaitSteerFollowUp()`：不 complete，不做 hold 判定，不登记 handle。
  - `turnInFlight` 保持 true，这样 stopped 提前释放不会在两个 turn 之间关 stdin（dev:1677）。原文：「&& !turnInFlight」
  - CLI 跑 steer 的后续 turn，读到 steer 后回显，从 pendingSteerIds 删掉（upstream/main:1653-1656）。
  - 后续 turn 的 result → `settleTurnResult` → 三信号判定 hold → 登记 → 只发一次 complete。
  - 两个 turn 的 per-turn 信号累计到第二个 result 才清空，偏向 hold，与 #30 的保守方向一致。upstream 原注释：「over for the client yet」
- **steer 待读时往 held 进程推 follow-up**：按 Q1 的分析不可能发生（steer 待读期间 handle 未登记）。反过来，"向 claim 来的 follow-up turn 里 steer"可以发生，由上面的 `settleFollowUpTurn` 位置保证正确。
- **abort**：
  - `abortClaudeSDKSession` 先 interrupt 再 `session.releaseInput?.()`（merged:2370-2374），会把本地 `inputReleased` 和 handle 一起清掉。原文：「session.releaseInput?.();」
  - abort 期间到达的 result 走 `settleTurnResult`（`!abortPending` 不成立），不发 complete。
  - `finally` 清 steer 计时器（草图 F）。
  - 遗留问题（fork 原有，不是本次引入，`未核实`）：被 interrupt 的 CLI 若还吐出一个 result，而 snapshot 或 `backgroundWorkPending` 仍为真，`registerHeldTurn` 会在 release 之后再登记一次（dev:1751-1756），UI 的"后台工作"标志会卡在 true。可选加固：hold 分支加 `&& !inputReleased`。未确认 CLI 在 interrupt 后是否还会发 result。

### Q4 原生旁问与 fork 的 hold / release

- **upstream 的机制**：
  - 原生旁问的前提是该 session 的 stdin 还没关（upstream/main:2097）。原文：「!session.inputReleased」
  - release 被请求时若还有旁问在等，就推迟 release 并重新武装 30 分钟上限（upstream/main:1252-1258）。原文：「entry.releaseDeferred = true;」
  - 旁问结束时再补做 release（upstream/main:2153-2155）。原文：「entry.releaseInput?.();」
- **`inputReleased` 两个标志**：
  - entry 上的标志只在走 entry 包装器时设置（upstream/main:533-538）。
  - fork 的 closure 会设本地标志并 `forgetHeldTurn`（dev:1469-1475）。原文：「forgetHeldTurn(sessionKey(),」
  - addSession 传入的 `releaseInput` 就是这个 closure（merged:1885），所以走 `maybeReleasePromptStream` → `entry.releaseInput()` 时两个标志都会设上。
- **唯一的真冲突（`forgetHeldTurn`）**：
  - 场景：handle 还登记着（之前 hold 过），后台任务回报的 turn 结束后不再 hold → `maybeReleasePromptStream()` 因旁问推迟 → closure 没跑 → handle 还在。
  - 此时用户发 follow-up 会 claim 成功并推入进程。tryAccept 的 `addSession` 会把 `releaseDeferred=true` 原样带过去（upstream/main:526）。原文：「carried?.releaseDeferred」
  - 旁问一答完，推迟的 release 就在 follow-up 中途关 stdin。fork 自己的注释也说中途关 stdin 会截断回复（dev:1671-1674）。
  - **修法**：推迟时立即 `forgetHeldTurn`（草图 E，以及 merged:2116 那处）。UI 的后台标志也会随之正确熄灭。
  - 备选：在 tryAccept 里清掉 `releaseDeferred`。代码更多，见 §4 决定 2。
- **`settleFollowUpTurn`**：与旁问无直接关系。推迟只是让循环继续活着，`settleFollowUpTurn` 在 `settleTurnResult` 里照常结算。
- **空闲上限**：上限触发时强制 release、不再推迟（upstream/main:1280）。在 fork 的 `finally` 保活路径里，map 条目已被 `removeSession` 删掉，`maybeReleasePromptStream` 会落到 `releasePromptStream()` 这个 closure（upstream/main:1267-1268），一样能放掉。
- **跨 claim 的计数**：tryAccept 用同一实例重新注册，`pendingNativeSideQuestions` 会带过去（upstream/main:522），claim 不会打断正在等的原生旁问。
- **SDK 版本（实测，读 node_modules）**：当前装的 SDK 是 0.3.295，`sdk.mjs` 里已有 `askSideQuestion`。原文：「async askSideQuestion(e,t)」。即使 package.json 冲突保留 fork 的 pin，原生路径也可用。package.json 冲突由另一个 agent 负责。

### Q5 后台工作对话框与 steer 在 #31 里的位置

- 两边 `'send'` 的意思相反：
  - upstream 的 `'send'` 是"停掉后台工作再发"（upstream/main src/shared/types.ts:857）。原文：「send now (stopping that work)」
  - fork 的 `'send'` 是保留后台工作（dev src/shared/types.ts:858-859）。原文：「'send' | 'interrupt'」
- **合并后的选项和走向**：

| choice | 按钮（英文） | 走向 |
|---|---|---|
| `cancel` | Cancel | 不发 |
| `queue` | Queue | `queueMessage` → dispatcher 等 `isProcessing \|\| hasBackgroundWork`（dev scheduled-message-dispatcher.service.ts:70，原文：「\|\| runtime.hasBackgroundWork(」） |
| `sideQuestion` | Side question（仅 `supportsSideQuestions && hasText` 时显示） | `askSideQuestionAndClear` → `chat.side_question`，不开 turn |
| `send` | Send（default 样式） | `chat.send` → claim-and-push；claim 不成且有任务时返回 `background_work_not_kept` |
| `interrupt` | Interrupt and send（destructive，放最后） | `chat.send` 顶层 `interruptBackground: true`（dev chat-websocket.service.ts:162-166，原文：「interruptBackground === true」）→ `releaseHeldSession` |

- **英文文案**：
  - 标题保持 "This session still has background work running"。
  - 描述保持 fork 版："Send keeps that work running. Interrupt and send stops it first, and anything it has not reported yet is lost. Queue sends the message when the work finishes."（auto-merge 已是此版，merged BackgroundSendDialog.tsx:55）。
  - 新增按钮用 upstream 的 "Side question"。
  - 可选：描述末尾加 "Side question asks on the side; the session never sees it."。但按钮是有条件显示的，建议不加。
- **发送菜单（upstream 新文件，auto-merge，未冲突）**：
  - 后台状态下最后一行是 `'send'`，文案写明会停掉后台工作（ComposerSendMenu.tsx:78-79）。原文：「this stops the background work」
  - 这个选择经 `presetBackgroundChoice` 透传（upstream useChatComposerState.ts:1493）。
  - 在 fork 里 `'send'` 意思是"保留"，不映射就会出现"文案说停、实际不停"。
  - 按草图 H 把菜单的 `'send'` 映射成 `'interrupt'`，文案就准确了。"保留后台工作的发送"仍可用 Enter → 对话框 → Send。
- **steer 与 #31 的两种状态**：steer 严格属于"turn 进行中"。
  - 服务端：`run?.status === 'running'` 才转给 runtime（upstream chat-websocket.service.ts:628）。原文：「run?.status === 'running'」
  - runtime：`turnCompleteSent` 时拒收。
  - 菜单：只在 `responding` 状态显示 Steer 行。
  - composer：只在 `isLoading` 分支里走 steer（merged useChatComposerState.ts:1225-1255）。
  - 后台状态从不 steer，与 #31 "只有 turn-in-flight 能挡 prompt" 的规则一致。
  - 新变化（推测）：steer 待读会**延长** turn-in-flight（steer 的后续 turn 结束才 complete），"后台工作"状态要到那之后才可能出现。
- **steer 与 fork 的队列**：
  - Enter 在 turn 进行中仍是排队（commit 624da21b 正文）。原文：「stays the default (Enter)」
  - steer 被拒（turn 刚结束）时客户端改为排队（upstream useChatComposerState.ts:1074）。原文：「fromComposer: false」
  - 排队后进入同一个 dispatcher，会等后台工作结束。这和 v1.37.5 "排队等后台" 的决定一致，代价见 §4 决定 3。
- **dispatcher 不用改（推测）**：
  - steer 待读期间 run 不 complete，`isProcessing` 为真，dispatcher 自然会等。
  - 旁问不调用 `startRun`（upstream chat-websocket.service.ts:367），不影响 `isProcessing`。原文：「Unlike `chat.send`, it never」
  - `hasBackgroundWork` 只读 tracker，也不受旁问影响。
  - 若一条排队消息恰好在"旁问推迟 release"期间发出，会走 claim 失败 → `releaseInput` → 旁问在 fork 上重问。这与 upstream 行为相同。

### Q6 能力标志

- **服务端（实测，严重）**：
  - merged provider-capabilities.service.ts 中，opencode 条目（merged:165-189）没有 `supportsSideQuestions/supportsSteering`。
  - antigravity 条目（merged:190-218）末尾多了 upstream 原本给 opencode 的两行（merged:216-217，对照 upstream/main:143-144 属于 opencode）。原文：「supportsSideQuestions: true,」
  - 原因：upstream 这处改动的后文上下文是 `},\n};`，而 fork 的最后一个条目是 antigravity（dev:170-197）。git 认为这是干净合并。
  - 后果1：类型 `ProviderCapabilities` 要求这两个字段，opencode 缺字段 → `npm run typecheck` 报错（推测，未运行）。
  - 后果2：`handleChatSideQuestion` 按能力拦截，opencode 旁问会被拒（推测）。
  - 后果3：antigravity runtime 没有 `askSideQuestion`（merged 树里只有 opencode-runtime 有，实测 grep），UI 却会给它显示旁问入口，用户提问后只会得到 "has no side questions" 错误。
  - 修法：opencode 补 `supportsSideQuestions: true, supportsSteering: false`；antigravity 改为 `supportsSideQuestions: false, supportsSteering: false`。
- **服务端测试**：
  - upstream 新测试用 `Record<LLMProvider, boolean>`，但没有列 antigravity（upstream/main provider-capabilities.service.test.ts:43）。原文：「Record<LLMProvider, boolean>」
  - server tsconfig 包含测试文件（server/tsconfig.json:38），所以会报类型错误（推测）。原文：「"./**/*.ts"」
  - 修复上面的错位前，运行时 opencode 断言也会失败（推测）。
  - 修法：加 `antigravity: false`，测试名同步改。
- **fork 的标志不受影响**：
  - `supportsCompact/supportsFork/supportsClear/rewindRestoresFiles` 在 merged:29-40，与新字段并存。
  - 客户端 getter 仍是 `=== true` 无回退（merged useChatProviderState.ts:297-319）。原文：「?.supportsFork === true」
  - upstream 的两个新字段用 `Boolean(...)` 读（merged:507-508），也是"未加载时为 false"，两种写法一致。
- **客户端**：hunk @73 取并集即可。

### Q7 有没有可以退役的

- **#29 不能退役**：
  - steer 在 turn 报完 complete 后就拒收（upstream/main:1296）。
  - upstream 下一个 turn 照旧先 `releaseHeldSession`（upstream/main:1219-1223）。upstream 对话框自己也说新消息会停掉工作（upstream BackgroundSendDialog.tsx 描述）。原文：「which stops that work」
  - 旁问能在 held 进程上原生回答，但只是"问"，不开 turn，模型不会照着做事。
  - fork 文档写的退役条件是 upstream 自己做 follow-up reuse（fork-customizations.md:430），steer 不满足这个条件。原文：「follow-up reuse itself」
  - **丢掉的代价**：后台工作进行中，任何新指令都只能排队等到工作结束，或者停掉工作。
- **#30 不能退役**：
  - upstream 的 hold 仍是两信号（upstream/main:1587）。
  - 退役条件是 tracker 同时看见 cron 和不发 task 事件的工具（fork-customizations.md:448），这次没有变化。原文：「crons alone is not enough」
  - **丢掉的代价**：早先 turn 建的 cron 会在 result 时被杀。
- **#31 不能退役**：
  - upstream 仍没有服务端的"后台工作未完成"状态。
  - steer 和旁问都没有引入"busy"合并标志：steer 读 run.status，旁问不碰 run。
  - upstream 的发送菜单分 `responding`/`background` 两态，方向与 #31 一致，但只是客户端显示。
  - fork 文档要求不要把后台工作并进 busy（fork-customizations.md:470）。原文：「fold background work into it」
  - **丢掉的代价**：result 后 Stop 消失，无法从 UI 停后台工作。
- **可以收敛的部分**：fork 自己的队列版 `createHeldPromptStream` 并入共用实现（草图 A）。#29 在这一点上从"fork 独有"变成"与 upstream 共享"。
- **可选改进（推测，未核实）**：
  - upstream 默认开启 `--replay-user-messages`（upstream/main:1339）。原文：「'replay-user-messages': null」
  - CLI 读到 stdin 消息时会回显，循环对非 steer 的回显直接 `continue`（upstream/main:1653-1670）。原文：「message.isReplay === true」
  - 所以 fork 推入的 follow-up 也会被回显并被丢弃，无害。
  - fork 可以借这个回显把 `answersFollowUpPrompt` 做准：给推入的消息带 uuid，回显到达后才算"在回答 follow-up"。这样能修掉"CLI 自己的回报 turn 被当成 follow-up 的回答"这个老问题。
  - 没有验证 CLI 对非 steer 推入消息的回显行为，不建议在本次合并里做。
  - 另外 tryAccept 里的注释已过时（dev:1535）。原文：「Without replayed user messages」

---

## 4. 需要维护者拍板的决定

**决定 1：对话框与发送菜单的选项集**
- 背景：fork 的 `'send'` 意思是保留后台工作，upstream 的意思是停掉。upstream 新增的发送菜单在后台状态下显示 "Send anyway — this stops the background work"。
- 选项：
  - (a) 对话框 5 选项 + 菜单 `'send'`→`'interrupt'` 映射。只改冲突文件 useChatComposerState.ts，不碰 upstream 的 ComposerSendMenu.tsx。
  - (b) 在 (a) 基础上，往 ComposerSendMenu 加一行 "Send (keeps the work running)"。
  - (c) 对话框不加 side question，保持 4 选项。
- **推荐 (a)**。代价：菜单里没有"保留工作"的发送，只能按 Enter 走对话框。(b) 会给 upstream 文件增加 fork 改动面，下次合并多一个冲突点。(c) 会丢掉 upstream 功能。

**决定 2：旁问推迟 release 时如何处理 held-turn handle**
- 选项：
  - (a) 推迟时 `forgetHeldTurn`（草图 E）。
  - (b) tryAccept 里清掉 entry 的 `releaseDeferred`，让 follow-up 继续用这个进程。
- **推荐 (a)**：改动小，UI 后台标志也随之正确熄灭。代价：旁问还在等时发 follow-up 会开新进程，旁问在只读 fork 上重问。upstream 实测 fork 中位 5016 ms，原生 2141 ms（upstream/main:2061-2064 注释，后台状态那一行）。

**决定 3：steer 被拒（turn 刚结束、后台工作仍在）后的去向**
- 选项：
  - (a) 照 upstream 排队，等后台工作结束。
  - (b) fork 特有：改成立即普通发送，走 claim-and-push。
- **推荐 (a)**：零额外代码，与 v1.37.5 "排队等后台" 一致。代价：用户点的是 Steer（想马上送达），结果可能等很久；可以编辑或删除排队卡片。

**决定 4：历史里 steer 消息上的 Fork 按钮**
- 背景：
  - upstream 把 `queued_command` attachment 行渲染成用户消息，并故意不给 `transcriptAnchorId`（upstream/main claude-sessions.provider.ts:1253）。原文：「raw?.type !== 'attachment'」
  - fork 的 anchor 打标循环会给任何有 uuid 的行打 `anchor`（dev claude-sessions.provider.ts:1857-1867）。原文：「message.anchor = anchor;」
  - `canForkFromMessage` 读 `transcriptAnchorId || anchor`（dev MessageComponent.tsx:108）。
  - 结果：steer 消息会出现 Fork 按钮，并以 attachment 行 uuid 调用 upstream 的 fork 路由。SDK 能否在 attachment uuid 处 fork：`未核实`。
- 选项：
  - (a) 打标循环跳过 `raw.type === 'attachment'`。
  - (b) 不改。
- **推荐 (a)**。代价：在 fork 已改过的循环里加 1 行。

**决定 5（低优先）：zh-CN 文案**
- upstream 只加了 en/de。fork 的 zh-CN 缺 `prompt.sideQuestion`、`sendMenu.*`、`input.steer.*` 等，会回退到英文默认值。
- 推荐本次至少补对话框的 `sideQuestion`，其他随后补。

---

## 5. auto-merge 文件的语义风险

| 风险 | 位置（ref） | 说明 |
|---|---|---|
| 能力条目错位 ❌ | provider-capabilities.service.ts merged:165-218（对照 dev:145-197、upstream/main:123-144） | 见 Q6，必修。原文：「supportsSideQuestions: true,」 |
| 能力测试类型/断言 ❌ | provider-capabilities.service.test.ts merged:197-211（upstream/main:40-53） | 缺 antigravity key；opencode 断言受上一条影响。原文：「Record<LLMProvider, boolean>」 |
| `settleTurnResult` 自动取了 upstream 两信号版 ❌ | claude-runtime.provider.ts merged:1890-1945 | 不随 hunk @2120 一起改，宽限期超时路径会丢 snapshot 信号、`registerHeldTurn`、`settleFollowUpTurn`。原文：「? stillOutstanding :」 |
| stopped 提前释放已改走 deferral ⚠️ | merged:2106-2117 | 方向正确，但要加推迟时的 `forgetHeldTurn`（Q4）。原文：「&& !turnInFlight」 |
| 空闲上限改走 `maybeReleasePromptStream(true)` ✅ | merged:1418-1429 | 正确，保留。原文：「maybeReleasePromptStream(true)」 |
| `--replay-user-messages` 全局开启 ⚠️ | merged:1524、1997-2014 | fork 推入的 follow-up 也会被回显并被 `continue` 丢掉，无害；`turnInFlight` 由 tryAccept 自己置位，不受影响。tryAccept 注释过时（merged:1862-1864）。原文：「Without replayed user messages」 |
| tryAccept 重新注册不带 steerInput ✅ | merged:1870 vs upstream/main:529 | 同实例不算顶替，`steerInput` 会被带过去；`inputReleased` 重置为 false 也正确（此时 stream 还开着）。原文：「carried?.releaseDeferred」（同一处 carry 逻辑） |
| 发送菜单 "Send anyway" 语义 ❌ | ComposerSendMenu.tsx（upstream 新文件）:78-79；merged useChatComposerState.ts:1558 | 不映射就会"说停实际不停"，见决定 1。原文：「this stops the background work」 |
| 历史 steer 消息出现 Fork 按钮 ⚠️ | claude-sessions.provider.ts（upstream/main:1253、1289）+ dev:1857-1867 | 见决定 4，`未核实`。原文：「raw?.type !== 'attachment'」 |
| SteeredMessageCard 列宽写死 ⚠️ | upstream 新文件 SteeredMessageCard.tsx 外层 div | 不跟随 #3 的内容宽度设置（QueuedMessageCard 用 `widthClasses.column`），Wide/Full 下与输入框对不齐。原文：「max-w-[54.25rem]」 |
| 旁问 aside 不跟随 #3 字号/间距 ⚠️ | merged MessageComponent.tsx:172、201 | 显式 `prose-sm` 会赢过 `useChatProseClassName` 的设置；`px-3 sm:px-0` 不读 `spacingClasses`。原文：「prose prose-sm max-w-none」 |
| chat.steer 的门槛 = turn-in-flight ✅ | merged chat-websocket.service.ts:642 | 与 #31 一致。原文：「run?.status === 'running'」 |
| chat.abort 的后台工作分支保留 ✅ | merged chat-websocket.service.ts:693-694（= dev:451-452） | auto-merge 没有动 fork 的 `holdsBackgroundWork` 分支。原文：「has no running turn to send」（steer 的拒绝文案，与 abort 分支互不干扰） |
| useChatSessionState / useSessionStore / ChatMessagesPane / api.ts / server types & interfaces ✅ | merged 各文件 | 只看了 upstream 的新增是否完整、顺序是否合理（如 `hasMoreMessages` 在 merged useChatSessionState.ts:217 定义，早于 :446 使用），均为纯新增，未见语义冲突。`GatewayEventKind` 同时含 `'session_background_work'` 和 `'side_question'`（merged server/shared/types.ts:276、279）。原文：「!message.sideQuestion」 |
| 范围外线索 | upstream claude-side-question.provider.ts:224 | Claude 旁问的 fork 路径只传 `model`，不带 fork #25 的自定义 endpoint 环境变量；对自定义 endpoint 模型可能打到订阅端。`未核实`，不属本任务范围。原文：「model: request.model」 |

---

## 6. 测试

**未运行任何测试。** 下面是覆盖关系和预计需要改的地方（推测）。

覆盖这些路径的现有测试（owner 由 `git cat-file -e upstream/main:<path>` 实测）：
- fork 自有（server）：
  - `server/modules/providers/tests/claude-held-turn-reuse.test.ts`（claim-and-push、拒绝发送）
  - `claude-turn-compatibility.test.ts`（fingerprint）
  - `claude-subagent-survival.test.ts`（集成）
  - `claude-background-work-signal.test.ts`（watchHeldTurns 状态边）
  - `claude-runtime.test.ts`
  - `server/modules/websocket/tests/chat-background-work-state.test.ts`
- upstream 拥有、fork 改过：
  - `server/modules/providers/tests/claude-runtime-hold.test.ts`（dev 有 +159/-68 行改动，含"新 turn 推进 held 进程"用例）
  - `claude-background-work.test.ts`（add/add 手工合并过）
  - `server/modules/scheduled-messages/tests/scheduled-messages.test.ts`
  - `src/modules/chat/tests/backgroundSendDialog.test.tsx`（原文：「['send'], ['interrupt']」）
  - `src/modules/chat/tests/composerSendOverBackgroundWork.test.ts`
  - `src/modules/chat/tests/composerQueuedFollowUps.test.ts`
- fork 自有（client）：
  - `src/modules/chat/tests/backgroundWorkState.test.tsx`
  - `activityIndicatorVisibility.test.ts`
- upstream 新增（本次合入）：
  - server：`claude-steer.test.ts`、`claude-side-question-hold.test.ts`、`claude-native-side-question.test.ts`、`claude-side-question.test.ts`、`provider-runtime-side-question.test.ts`、`server/modules/websocket/tests/chat-steer.test.ts`、`chat-side-question.test.ts`、`side-questions*.test.ts`、`provider-capabilities.service.test.ts`（+16 行）
  - client：`backgroundSendDialogSideQuestion.test.tsx`、`backgroundSendDialogReviewFixes.test.tsx`、`composerSideQuestionRouting.test.ts`、`composerSteering.test.ts`、`composerSendMenu*.test.tsx`、`chatComposerSendMenu.test.tsx`、`chatProviderStateSideQuestions.test.ts`

预计需要改的：
1. `claude-side-question-hold.test.ts` 的 "a superseded run's late task-stopped notification…"（upstream/main:348 起）。
   - 第一次 run 留有后台 Agent 并 hold，第二次 `queryClaudeSDK('continue', …)`（:373）在 fork 里会 **claim 并推入**，而不是顶替旧进程。
   - `first.script.released()` 的断言（:375）会失败，`second.createQuery` 也不会被调用。原文：「superseded process is let go」
   - 改法：第二次调用带 `interruptBackground: true`，测试意图不变。
   - :299 和 :429 两个用例里第一次 run 没有 hold，fork 走 claim 失败 → `releaseInput`，预计仍通过（`未核实`）。
2. `backgroundSendDialogSideQuestion.test.tsx:42`、`backgroundSendDialogReviewFixes.test.tsx:30`：按钮名期望是 upstream 的 4 个（原文：「'Side question', 'Send anyway'」）。改成 `['Cancel','Queue','Side question','Send','Interrupt and send']`，过滤名单同步改。
3. `composerSideQuestionRouting.test.ts:231-241` "Send anyway from the send menu…"：映射后仍是一条 `chat.send`，预计通过。建议补断言 `interruptBackground: true`，把决定 1 的语义钉住。
4. `provider-capabilities.service.test.ts`：加 `antigravity: false`（类型）；修好能力错位后 opencode 断言才会通过。
5. 建议新增（fork 自有测试里）：
   - claim 来的 follow-up turn 留下未读 steer 时，`settled` 要到后续 turn 的 result 才 resolve（钉住 Q3 的顺序）。
   - 旁问推迟 release 时 handle 已撤销，新的 send 不会推进该进程（钉住 Q4）。
   - `finally` 保活路径不被 upstream 的无条件 release 覆盖。#30 文档说这条路径目前没有自动测试（fork-customizations.md:452）。
6. fork 的 `claude-held-turn-reuse.test.ts` 用的假 query 不发 replay 回显（dev 该文件:73-129），push 改成返回 boolean 也不影响它对 `prompts` 的断言。预计不需要改（`未核实`）。

---

## 7. `docs/fork-customizations.md` 需要更新的条目（及 `.zh-CN.md` 同步）

- **#29**（:414-434）：
  - "five places" 改写：`createHeldPromptStream` 现在与 upstream steering **共用一个实现**（`push(messages[]) → boolean` + `isOpen()`）。
  - "`result` handler's park/release decision" 现在在 `settleTurnResult` 里，`settleFollowUpTurn()` 也在里面，并说明原因（未读 steer + gateway 的 exitCode 1 兜底）。
  - 增加 v1.37.8 更新块：
    1. hunk @1361 删掉 turn 开头的 `releaseHeldSession`，那不是 upstream 新加的；
    2. 不要取 upstream 的 `releasePromptStream = heldPrompt.release` 两处赋值；
    3. steer 与 claim-and-push 时间上互斥的论证；
    4. "If upstream ever implements follow-up reuse…" 一句补充：steering 不算 follow-up reuse。原文：「follow-up reuse itself」
- **#30**（:436-452）：
  - "the two places the reading is consulted" 改为 `settleTurnResult`（steer 宽限期超时也走这里）+ stopped 提前释放分支。
  - `finally` 段补一句：v1.37.8 的 upstream 在同一位置加了 steer 计时器清理，并保留无条件 `releasePromptStream()`，只取前者。原文：「single most dangerous block」
- **#31**（:454-480）：增加 v1.37.8 更新块。
  - 对话框变为 5 选项，`BackgroundSendChoice` 加 `'sideQuestion'`。
  - upstream 发送菜单在后台状态下的 `'send'` 映射为 `'interrupt'`。
  - steer 只属于 turn-in-flight，且待读 steer 会延长它。
  - 旁问两种状态都不碰。
  - 旁问推迟 release 时要 `forgetHeldTurn`，否则后台标志不熄、handle 可被 claim。
  - "Files" 增列 `useChatComposerState.ts` 的映射行。
  - v1.37.5 块里的 "four choices" 改为 five。
- **#23**（:237-354）：
  - Files 行把 `server/modules/providers/tests/provider-capabilities.service.test.ts` 标成 "Fork-owned (pre-existing)"（:241）。原文：「Fork-owned (pre-existing):」
  - 但实测 `git cat-file -e upstream/main:…` 成功，base 13e9ef64 里也有，upstream 在 51fb5757 加入。**这是错标，应改为 upstream-owned。**
  - `provider-capabilities.service.ts` 那条要写明：upstream 新字段 `supportsSideQuestions`/`supportsSteering` 排在 `supportsSessionForking` 之后，与 fork 的四个字段并存。
  - 同一条记下"静默错位"陷阱：antigravity 是最后一个条目，下次 upstream 改 opencode 字段还会再错。
  - 若采纳决定 4，在 `claude-sessions.provider.ts` 那条注明 anchor 打标跳过 attachment 行。
- **#3**（:29-45）：
  - MessageComponent 段注明 `isGrouped` 现取 upstream 带 `sideQuestion` 的表达式，fork 只保留两行 hook。
  - "column `max-w` is duplicated across…" 增列 `SteeredMessageCard.tsx`（upstream 文件，写死 `max-w-[54.25rem]`），并决定是否接入 `widthClasses.column`。
  - 记一笔：旁问 aside 显式 `prose-sm`，不跟随阅读字号设置。

---

### 附：本次操作说明
- 只读调研，没有改仓库里的任何文件。
- 除本报告外，还在会话 scratchpad（仓库外的临时目录）里写了几份中间文件（三方版本的 runtime、diff、merged 文件），用来对照阅读。
- 运行过 `git merge-tree --write-tree dev upstream/main` 来读合并后的文件内容。它可能往 `.git/objects` 写入未被引用的对象（得到的树 id 与生成 conflict-hunks.txt 时一致，大概率已存在），没有改任何 ref、index 或工作区。
