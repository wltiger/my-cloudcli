# PR08：服务端自己代发的回复（排队或定时消息）不会实时推到已打开该会话的页面

**状态：** 不提交——fork 已经修好（定制 #31，v1.37.8）；证据是读代码加单元测试，没有在浏览器里实测；修法要改上游运行注册表的结构，这是上游的设计选择（2026-11-09）。留档备查。
**类型：** 本来会是 Issue
**目标：** `siteboon/claudecodeui`
**发现：** 2026-11-09，fork 同步 v1.37.8 时

## 重复检查

没做——下面的筛选先结束了它。重新启用前要先做。

## 发现

上游 `2053f3d7`（v1.37.8）：页面只有在发 `chat.subscribe` 时才会挂到 run 上（`chat-websocket.service.ts` 的 `chatRunRegistry.attachConnection`），而 `chatRunRegistry.startRun` 只给新 run 挂上发起它的那个连接。排队消息和定时消息的 dispatcher 用的 `runDetachedChatTurn` 开 run 时传的是 `connection: null`。所以已经打开着这个会话的页面，在这个 run 输出时没有挂在任何地方，回复要刷新或重连（都会重新订阅）后才出现。另一个标签页发起的回合也一样。

没在浏览器里实测；是读代码得出的，并由 fork 的 `server/modules/websocket/tests/detached-runs.test.ts` 固定。

## fork 的处理

注册表记住每个订阅过某会话的 socket（`watchSession`，在 `chat.subscribe` 时调用），每个新 run 都带上这批观众。

## 决定（2026-11-09）

不满足 `docs/upstream-pr.md` 的门槛：fork 已经修好，分歧只是两个上游文件里大约 25 行，证据是推断。以后如果每次同步 `watchSession` 都要冲突，或者在未改动的安装上做了浏览器复现，再重新考虑。
