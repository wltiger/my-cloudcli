# PR09：测试 `cursor: a cancelled run is reported as stopped/aborted` 在 Windows 上永远跑不完，导致 `npm test` 卡死

**状态：** 不提交——fork 用 `--test-skip-pattern="cursor: a cancelled run"` 绕开；修法（测试在 Windows 上怎么杀掉假 CLI 的进程树）由上游决定（2026-11-09）。留档备查。
**类型：** 本来会是 Issue
**目标：** `siteboon/claudecodeui`
**发现：** 2026-11-09，fork 同步 v1.37.8 时

## 重复检查

没做——下面的筛选先结束了它。重新启用前要先做。

## 发现

上游 `2053f3d7`（v1.37.8）的 `server/modules/providers/tests/provider-abort-notifications.test.ts`：`installFakeCli` 在 Windows 上写一个 `.cmd` 包装去运行 `node <name>.cjs`，取消用例的假 CLI 会一直空转（`setInterval`）直到被杀。终止时只杀掉了 `cmd.exe` 包装，里面的 `node` 子进程还活着，所以 run 永远结束不了，这个测试文件也永远不退出。在 Windows 11 上实测：单跑这个文件 150 秒超时；按名字单独跑这个文件的其他 4 个用例都通过；完整的 `npm test` 跑了 30 多分钟，直到被强制结束。

## 决定（2026-11-09）

不满足 `docs/upstream-pr.md` 的门槛：这里的代价只是一个跳过参数，修法需要上游做设计选择（在测试辅助函数里杀进程树，或者换一种不用包装的假 CLI）。以后如果要跳过的测试越来越多，再重新考虑。
