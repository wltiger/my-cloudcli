# PR04：Browser runtime 装到了永远解析不到的位置

**状态：** 不提交 —— 上游已经有三个 PR 报过了，且都还开着
**类型：** —（本来会是 PR）
**目标仓库：** `siteboon/claudecodeui`
**发现于：** 2026-08-21 查重时，v1.37.2 同步期间（问题本身更早，见 fork 定制 #14）

## 查重（这条的全部内容就是查重结果）

2026-08-21 搜 `siteboon/claudecodeui`：

- PRs `playwright install` → **#995**、**#1000**、**#917**
- PRs `browser runtime` → **#995**、**#917**
- PRs `install runtime` → **#1000**、**#917**
- PRs `browser use` → **#995**、**#1000**、**#917**，外加 #889（加这个功能的已合并 PR）和 #921（无关的 noVNC viewer）
- issues，四种说法都搜了 → 没有

三个都读了全文：

| PR | 开的时间 | 状态 | 提了什么 |
|---|---|---|---|
| [#995](https://github.com/siteboon/claudecodeui/pull/995) `fix: install browser runtime outside process cwd` | 2026-07-11 | 开着 | 装到 `~/.cloudcli/browser-use/runtime`；先解析包内依赖、再看这个目录；npm 也从这个目录跑；锁定 Playwright 1.61.1；保留 Windows `npm.cmd` 处理；加了测试。 |
| [#1000](https://github.com/siteboon/claudecodeui/pull/1000) `fix(browser): install Playwright runtime in package dir, not cwd` | 2026-07-11 | 开着 | 同一个根因、同一套诊断（`runCommand` 的 `cwd: process.cwd()` vs `createRequire(import.meta.url)` 解析），改成装到包目录。 |
| [#917](https://github.com/siteboon/claudecodeui/pull/917) `Fix Windows browser-runtime install and Claude Code SDK spawn failures` | 2026-06-24 | 开着 | 三个 Windows 专有故障，包含这一个；另外还修了 `shell: false` 下 `npm.cmd` 的 `spawn EINVAL`。 |

**#995 和本 fork 的定制 #14 在功能上完全一样** —— 同一个 `~/.cloudcli/browser-use/runtime` 目录，同样是"先解析包内依赖、再查 runtime 目录"的顺序。提交者是另一位贡献者，他明确说是把 #917 的方案对着 main 重做了一遍。

三个 PR 官方**一句话都没回**。所有 PR 里唯一的人类评论在 #917 下面，是 #995 的作者过来交叉引用自己的 PR。其余全是 CodeRabbit 机器人。

## 确认在上游 HEAD 仍然存在

对着 `677b7ba`（v1.37.2）核过，所以那三个 PR 还没过时：

- `browser-use.service.ts` 第 247 行 —— `runCommand()` 用 `cwd: process.cwd()` spawn
- 141–147 行 —— `getPlaywright()` 是通过 `createRequire(import.meta.url)` 的 `require('playwright')`，即从模块自身位置解析
- 第 305 行 —— `installRuntime()` 通过上面那个 `runCommand` 跑 `npm install --no-save --no-package-lock playwright`

全局安装的 CloudCLI 只要不是从安装目录启动，这两个就是两个不同的地方：装是装成功了，Settings 里照样显示 Playwright missing。

v1.37.2 确实动过这个文件 —— 但只是把 `getBrowserUseRuntime()` 抽到了 `browser-use-runtime.ts`，安装/解析错位没碰。

## 结论

**不提交。** 一个已经有三个 open PR 的 bug（其中一个提的方案跟本 fork 一模一样），再报第四次只是噪音，不增加信息。上游的瓶颈是 review 精力，不是不知情。

fork 定制 #14 原样保留。以后同步时如果 #995 / #1000 / #917 任何一个合并了，就采用官方版本并退休 #14（那条的"冲突怎么办"里已经写了"官方解决了就删掉这条"—— 现在应该把这几个 PR 号写进去，省得下次同步重新推一遍）。

只有在三个都被关闭未合并、且问题依然存在时才重新考虑 —— 那时候开一个 issue 问"为什么"，跟再提一个重复 PR 就是两回事了。

## 需要你定的

1. 同意不提交吗？
2. 要不要在 #995 下面留一句"v1.37.2 仍可复现"，给官方一个"这个 bug 还活着"的信号？还是这也算噪音？
