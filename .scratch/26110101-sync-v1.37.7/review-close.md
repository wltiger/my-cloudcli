# v1.37.7 合并终审（9361b4df）

仓根 `D:/code/opensource/claudecodeui` 存在，已确认。

## 结论

手工合并的代码是对的，可以落地：冲突解决正确，没有 fork 定制被悄悄撤销，也没有运行时缺陷。「Scoped to the run」。遗留问题全是文档和注释仍说 OpenCode 能 Edit/Fork，另有 3 个读取/输入侧的小副作用没写进文档。无 high/medium 代码问题。我没跑测试、没启动应用，「没有运行时缺陷」来自读代码和 git 比对。

## 早先发现复核

| 发现 | 判定 | 理由 | 摘录 |
|---|---|---|---|
| `chat-websocket:371` 注释过时 | ✅ 成立（低） | 实际行 370-371 | 「`opencode run` only」 |
| `ChatComposer:376` | ⚠️ 成立但行号错 | :376 无此内容，实际在 :90；范围更大，见 N2 | 「OpenCode replaces a message」 |
| #27 冲突指引 | ✅ 成立（低） | 按它做会装回退役功能 | 「`supportsMessageEditing: true`」 |
| ADR 0009 过时 | ✅ 成立（低） | 仍标生效；0008 有 superseded 先例 | 「Status: in force」 |
| ADR 0011 过时 | ✅ 成立（低） | 无 Status 行，分支已无产出方 | 「forks through a branch」 |
| `/fork-at-anchor` 无产出方 | ⚠️ 降级：非缺陷 | E2 决定保留；调用 OpenCode 返回 400 | 「kept but has no producer」 |
| #22/#23 Files 行 | ⚠️ 降级（极低） | 顶部已声明下文是历史 | 「about OpenCode is history」 |
| `Panel:450` 字号 | ❌ 驳回 | 全屏 18px 与 :400 一致；行内 13px 是 fork 原有，非合并引入 | 「'text-[18px]' : 'text-[13px]'」 |
| E4 小写 opencode | ❌ 驳回 | 见问题 1 | 「"opencode": "OpenCode",」 |
| 决定 8 无核对记录 | ⚠️ 当时成立，现已补 | 见问题 2；结果无丢失 | 「typecheck ✓ lint ✓」 |
| 删 `runtime.provider.test.js` 算越界 | ❌ 驳回 | 上游已删被测文件。ds41f「只剩注释路径修正」也错：fork 加了 612 行共 8 个测试，全是 Compact/Fork | 「the exact /compact command」 |
| `:701` 来源 | ✅ 已定 | 见问题 6 | 「completeRunIfCurrent(activeRun」 |
| g38f「无遗漏」 | ⚠️ 说得过满 | 决定 1-8 成立；决定 9 只做到加退役说明，#27 正文仍误导 | 「check the flag first」 |

## 新发现

**N1 · `CONTEXT.md:54,:70-73` · 低（文档里最该改）**
领域术语表仍说 OpenCode 靠 revert 做 Edit、`anchor` 用于 OpenCode Fork。两个 Anchor 现在都没有 OpenCode 产出方。后续 agent 读它，会以为 revert 路径还在。此前无人提到。「only OpenCode works this way」

**N2 · `ChatComposer:90`、`ChatInterface:244,:638`、`useChatProviderState:307`、`useSessionFork:17-19,:57-58` · 低**
注释仍按现在时描述 OpenCode 的 Edit/Fork。比早先报告的范围大。无运行影响。「which today means OpenCode」

**N3 · `opencode-sessions.provider.ts` · 低（文档缺口）**
原来的 revert 过滤没了。场景：session 的 `revert` 列已写入但还没提交（比如 Edit 中途断掉），已回退的消息会重新显示。与上游行为相同，但 #23/#27 的退役说明没写。OpenCode TUI 的 `/undo` 会不会触发：无法判断。「its own read API still returns」

**N4 · `opencode-sessions.provider.ts` · 低（文档只写了一半）**
`compaction` 分支删了，OpenCode 自己触发的 auto 压缩也不再有边界标记。#22 只写了删分支，没写这个可见影响。「OpenCode persists a compaction」

**N5 · `useChatComposerState:993` → `opencode-runtime.provider.ts:1272` · 低**
菜单和按钮已正确隐藏，但手打 `/compact` 仍会当普通文本发给模型，消耗一轮。与上游相同。「parts: [{ type: 'text'」

**已查、不是问题：** fork 文档警告过 Windows 上 `.kill()` 会留下孤儿 server。SDK 1.19.5 的 `stop()` 已用 `taskkill /T /F`，退役不会带回这个问题。「"/T", "/F"」

## 六个问题

**1. E4：** 到面板的是显示名，不是小写。链路：`ChatInterface:511-512` 的 `t('messageTypes.opencode', …)` → `:627` → `ChatComposer:326` → `PermissionRequestsBanner:83`。en/zh-CN 都是 OpenCode；缺 key 的语言有 defaultValue 兜底。「"opencode": "OpenCode",」

**2. 决定 8：** 没有被悄悄撤销的定制。比对全部 33 个双方都改过的文件（fork 新增行在 HEAD 缺失、fork 删除行重新出现）：自动合并的文件 `lost=0`；有 lost 的只有手工解决的 5 个（sessions provider 及其测试、capabilities、chat-websocket、Panel），都能解释（退役内容或注释/缩进改写）。reappeared 是通用行造成的假阳性（`claude-runtime` 相对 fork 只多 1 行，`package-lock` 只变 14 行，`browser-use` 3 行都是通用语法）。点名的 9 个文件都读了 a18a4701→HEAD 的 diff，都只是上游新增（`browser-use`、`PermissionRequestsBanner` 只读了前段，其余靠比对）。#24 还在：`opencode-sessions.test.ts` 相对上游只多 #24 那两行。局限：行级比对查不出语义冲突。「lost=0 reappeared=0」

**3. sessions provider：** fork 的 diff 逐段都归属 #22/#23/#27，没有其他功能。只有两个读取侧副作用超出「按钮消失」，即 N3、N4。OpenCode 目录相对上游只差 #39 的 synchronizer，它相对 fork 无变化。「OpenCode persists a compaction」

**4. 还有依赖吗：** 没有。全仓搜已删文件和函数名，代码零引用（`opencode-runtime.provider.js` 的命中是指向 `.ts` 的 ESM 路径）。Antigravity 只有两处注释提到 OpenCode，无 import；`compact_boundary` 唯一产出方是 `antigravity-sessions:361`。入口都有拦截：Edit 返回 `EDIT_NOT_SUPPORTED`，Fork 返回 `FORK_NOT_SUPPORTED`，Compact 按钮按能力位隐藏。「cursor and opencode runtimes」

**5. 换行：** 都保持住了。按字节比对父提交与 HEAD：49 个修改文件 + 9 个新增文件，blob 全是 LF，文件末尾换行无变化。工作区 CRLF 来自 `core.autocrlf=true`。「i/lf    w/crlf」

**6. `:701`：** 上游的。上游 :647 同样写法自动合入，不在 remerge-diff 里，非手改。「completeRunIfCurrent(activeRun」

## 修复建议

**现在做（落 dev 前，只改文档）：**
1. `docs/fork-customizations.md` + zh-CN：#27 的 On upstream conflict 改成「已退役，不要重装」。
2. `CONTEXT.md:54,:70-73` 改为现状。
3. ADR 0009、0011 标 `Status: superseded (v1.37.7)`。
4. #23/#27 的退役说明各加一句，写明 N3、N4、N5 的可见影响。

**可以等（下次碰到时顺手）：**
- N2 的 5 处注释和 `chat-websocket:370`。其中 `useSessionFork` 的注释配合 E2 改写。
- #22/#23 的 Files 行。

**不用做：** `Panel:450`、E4、`/fork-at-anchor`、N5 的代码拦截（等 OpenCode v2）。
