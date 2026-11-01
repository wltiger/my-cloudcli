# PR07：遗留的 `opencode serve` 进程只在 Linux 上清理

**状态：** 不提交——这个 fork 的行为和上游相同，这里没有偏离；本机很少用 OpenCode；证据只来自读代码（2026-11-01）。留档。
**类型：** 如果提交，会是 Issue
**目标：** `siteboon/claudecodeui`
**发现于：** 2026-11-01，这个 fork 同步到 v1.37.7 时的最终审查

## 查重

没做——下面的判断先结束了这件事。重新启用这一条之前要先查。

## 发现

`server/modules/providers/list/opencode/opencode-runtime.provider.ts`（上游 `13e9ef64`，v1.37.7）：OpenCode 每一轮都会起一个自己的 `opencode serve`。`reapOrphanedOpenCodeServers` 负责清理 CloudCLI 死掉后留下的 server，但它要读 `/proc`，所以只要 `process.platform !== 'linux'` 就直接返回 `0`。

预期在 Windows 和 macOS 上的影响：CloudCLI 在某一轮中途被杀，该轮的 server 会留在后台，重启也不会清理。旧的 `opencode run` runtime 没有长期运行的 server，不会留下这种进程。

没有实测：没有复现过。也没查：这些平台上 server 会不会自己退出。

## 决定

没有达到 `docs/upstream-pr.md` 的标准：这个 fork 的行为和上游完全相同，不报告对这里没有成本，而且证据是推断的，不是实测的。
