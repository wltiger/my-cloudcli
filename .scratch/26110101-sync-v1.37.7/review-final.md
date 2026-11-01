**结论:可以落地。** 手工合并部分没有发现高或中严重度的缺陷,面板、Stop、OpenCode 对齐都符合 spec。需要改的只有 3 处低严重度的文档或注释,不挡合入。以下全部靠读代码得出,测试和程序都没跑,也没改任何文件。摘录:「must not be silently undone」

## 真缺陷(都是低严重度)

**1. `docs/fork-customizations.md:226`、`:228`、`:232`、`:353`:正文仍指示保留或重做 OpenCode 功能**
- **问题:** 第 22、23 条开头虽有"下文是历史",但第 226 行还写着必须保留 OpenCode 这一半,第 228 行写着 `supportsCompact` 翻成 `true`。第 353 行还写着 Edit 覆盖所有 provider。第 27 条的这段已重写,这两条没有;`zh-CN` 同段也没改。
- **场景:** 下次同步时照 "On upstream conflict" 操作 → 又把 `supportsCompact` 翻回 `true` → 菜单和按钮重新出现,但 SDK runtime 没有 Compact,`/compact` 只会当普通文字发给模型。
- **把握:** 高。摘录:「OpenCode's whole side」

**2. `CONTEXT.md:54`:"没有 provider 用 Rewind"与代码不符**
- **问题:** Codex 实现了 `rewindSession`(`codex-sessions.provider.ts:1985`),`providerRewindsForEdit` 对它返回 true(`sessions.service.ts:505`)。
- **场景:** 有人据此把这条分支当死代码删掉 → Codex 的 Edit 不再回退对话。
- **把握:** 高。摘录:「No provider works this way」

**3. `provider-capabilities.service.ts:70`:合并时手改的注释说 Codex 永远不能 Fork**
- **问题:** ADR 0008 已写明 Codex 有 Fork,代码里 `supportsSessionForking` 也是 true(`:141`)。
- **场景:** 读注释的人会误判 Codex 的能力,不影响运行。
- **把握:** 高。摘录:「for why Codex never will」

**4. `docs/adr/0004-no-codex-compact-via-sdk.md:5`:没有状态说明**
- **问题:** 仍写着 side channel 已被 OpenCode 采用,没注明已退役。
- **场景:** 读者以为 OpenCode 还有 Compact。
- **把握:** 高。摘录:「adopted for OpenCode」

## 不是这次合并造成的

**5. `AskUserQuestionPanel.tsx:84`(fork 原有):切全屏后 "Other" 输入框丢焦点、高度复位**
- **问题:** 切全屏会重新挂载面板,但这个 effect 不依赖 `isFullscreen`。
- **场景:** "Other" 已激活且答案有多行 → 切入或退出全屏 → 输入框缩回一行且没有焦点,快捷键要点击后才恢复。
- **严重度与把握:** 低;把握中(只读代码,未实际运行)。摘录:「re-parents the panel」

**6. `opencode-runtime.provider.ts:570`(上游代码,影响本机):Windows 上不清理遗留的 `opencode serve`**
- **问题:** 清理函数只在 Linux 上生效。
- **场景:** Windows 上 CloudCLI 被强杀 → 该轮的 server 留在后台占端口,重启也不清理。旧的 `opencode run` 不会这样。
- **严重度与把握:** 低;把握中(只读代码,未实际运行)。摘录:「never exits by itself」

## 属于口味

`docs/fork-customizations.md:213`:英文提示段和 `**Files:**` 之间缺空行,渲染时会并成一段,`zh-CN` 没这个问题。摘录:「about OpenCode is history」

## 查过没问题

- **问题面板:** 和两边父版本对比,只多了对方的改动。submit 和 skip 都先退全屏;`custom:false` 的按钮、输入框和 `0` 键都已守住;Submit 的禁用条件两边相同。全屏下 Esc 只关全屏,不会误触 Dismiss。摘录:「Capture phase so Escape closes」
- **Stop:** run 已结束或已被新 run 取代时,`completeRunIfCurrent` 不做任何事,所以不会杀掉新 run;只剩后台任务时的 Stop 也保留了。摘录:「Scoped to the run」
- **OpenCode 对齐:** `opencode-sessions.provider.ts` 和上游逐字相同;`list/opencode/` 只有 #39 的同步器不同;能力开关符合 spec,Clear 仍保留。摘录:「109 insertions(+), 1 deletion」
- **退役功能的入口:**
  - 按钮和菜单都已隐藏。
  - 直接发 Edit 帧 → `EDIT_NOT_SUPPORTED`。
  - 直接调 Fork 路由 → `FORK_NOT_SUPPORTED`。
  - 手打 `/compact` 确实按普通文字发送。

  摘录:「cannot fork a session」
- **刷新后的权限请求:** 实时 `permission_request` 带 `context`;`chat_subscribed` 也整条保留,所以 label-list 问题刷新后格式不变。摘录:「context: msg.context,」
- **文档说法核对为真:**
  - `compact_boundary` 只有 Antigravity 产出,Claude 输出的是 `text`。
  - `fork-at-anchor` 确实没有调用方。
  - #1602 只改主输入框。
  - Clear 不含 OpenCode 代码。
  - 第 11、22、23、27、32 条的英中说明一致。

  摘录:「kind: 'compact_boundary',」
- **自动合并:** fork 代码不读 entrypoint;#1683、#1693、#1597 和 fork 定制没有冲突;文档和代码里没有残留冲突标记;i18n 的手工结果结构正确。摘录:「sessions as claudecodeui」

## 无法验证

- **测试和实际运行:** 全部没跑,结论都来自读代码。摘录:「You cannot run tests」
- **`claude.exe` 对 `CLAUDE_CODE_ENTRYPOINT=claudecodeui` 的行为:** 只读了 SDK 的 JS(未设置时才给默认值);搜二进制的命令需要审批,没有执行。无法判断。
- **只剩后台任务时 Stop 的竞态:** 中止等待期间若有新 run 进来,它的结束事件和 exit code 是否正确,没有追完。无法判断。
- **SDK runtime 在 Windows 上的实际运行:** 只确认 SDK 关闭时用 `taskkill` 杀进程树,没实测。无法判断。
