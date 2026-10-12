# sync/v1.37.4 研究记录 · 01 定制清单 #21–#28 摘要

日期：2026-10-10。#1–#20、#29–#39 已在之前会话读过（结论见 03 冲突映射）。

## #21 Markdown 表格横向滚动（bug fix，未上报 PR03）

- 文件：`src/modules/chat/transcript/Markdown.tsx`
- 冲突命名：`conflicts.txt:103` 同文件。
- 解法：取上游 class + 重加 4 个宽度/overscroll class（merge 而非 replace）。
- 上游 v1.37.4 相关：`de0908b0` LaTeX 渲染（同文件 Markdown.tsx？需验证）、
  `d450ed85` compaction row、`4b98d2ea` workspace image paths in markdown。
  → Markdown.tsx 是高碰撞文件，需逐 hunk 看。

## #22 Compact（compact_boundary + supportsCompact + OpenCode side channel）

- 冲突文件：`server/shared/types.ts`(60)、`claude-sessions.provider.ts`(25)、
  `provider-capabilities.service.ts`(31)、`opencode-runtime.provider.js`（无冲突！
  但 clean-merged 需查）、`opencode-sessions.provider.ts`(28)、`useSessionStore.ts`(76)、
  `src/shared/types.ts`(216)、`useChatMessages.ts`(71)、`useChatProviderState.ts`(72)、
  `useChatComposerState.ts`(69)、`useSlashCommands.ts`(77)、`MessageComponent.tsx`(105)、
  `CommandResultModal.tsx`(80)、`en/zh-CN chat.json`(135/153)。
- 上游 v1.37.4 相关：`d450ed85` "say a compaction out loud, as one row with its summary
  folded in" — **上游做了自己的 compaction 可见性！** 必须对比：
  上游是否引入了与 `compact_boundary` 冲突/等价的 message kind？
  若等价 → #22 的 #19 slice 可能可退役（按 upstream-sync 步骤 5.3 走，需用户决策）。
  `d1b09330` Claude resume branch 显示也可能碰 anchor 逻辑。

## #23 Fork/Clear（fork-at-anchor 路由 + anchor 字段）

- 冲突文件：`server/shared/types.ts`、`interfaces.ts`(58)、`server/shared/utils.ts`（无冲突？
  需查 clean-merged）、`claude-sessions.provider.ts`、`opencode-sessions.provider.ts`、
  `provider-capabilities.service.ts`、`sessions.service.ts`（无冲突？需查）、
  `provider.routes.ts`(30)、`src/shared/api.ts`(206)、`ChatInterface.tsx`(62)、
  `useChatMessages.ts`、`useChatProviderState.ts`、`useChatComposerState.ts`、
  `useSlashCommands.ts`、`useSessionStore.ts`、pagination util、MessageComponent、
  ChatMessagesPane、useProjectsState(170)、`en/zh-CN chat.json`。
- 上游 v1.37.4 相关：`80dd5c29` queued message while background work（composer gate，
  碰 useChatComposerState）、`bb81d0b0` first message to one session only（碰 ChatInterface/
  session 建立路径，#23 的 `handleSessionEstablished`/`registerOptimisticSession` 附近）。
- 路由碰撞专项：`provider.routes.ts` 上游 `/fork` vs fork `/fork-at-anchor` 已解耦，
  本次若上游改了路由表需重查 duplicate registration。

## #24 Windows 路径大小写合并（bug fix，未 triage）

- 文件：`server/shared/utils.ts`（无冲突？需查）、`file-tree.service.ts`（无冲突？）、
  `migrations.ts`(18)、`opencode-sessions.test.ts`(43)、`codex-message-editing.test.ts`(41)。
- 上游 v1.37.4 相关：`a6d50c84` codex image-only prompts、
  `5ce8ed45` codex restore prompts from rollout rows — codex 会话/消息路径，
  可能碰 codex-message-editing 测试。

## #25 自定义 Claude 模型 Base URL/API Key（+ effort_levels + context_window）

- 冲突文件：`server/shared/types.ts`、`schema.ts`(21)、`migrations.ts`、
  `provider-models.ts`(19)、`provider-models.service.ts`(32)、`provider.routes.ts`、
  `claude-runtime.provider.js`(24)、`src/shared/types.ts`、`ModelLibraryPanel.tsx`(81)、
  `claude-sessions.provider.ts`、`provider-token-usage.service.ts`(33)。
- 上游 v1.37.4 相关：**`51fb5757` custom models declare reasoning-effort levels** —
  上游做了自定义模型的 effort 声明！必须对比：
  上游的列名/形状 vs fork 的 `effort_levels` 列 + `buildCustomModelEffort`。
  若等价 → 部分退役可能（mutations/validation 仍是 fork 独有？需看 diff）。
  另 `7704a905`（v1.37.3 区间？不，在区间内？需确认）session titles。
  `45677008` permission rules 只读显示 — 碰 ModelLibraryPanel/设置面附近？需看。

## #26 自定义 TTS（streaming/voice-list/instructions）

- 冲突文件：`src/shared/api.ts`、`useTts.ts`(78)、`MessageSpeakControl.tsx`(106)、
  `VoiceSettingsTab.tsx`(181)、`src/modules/chat/index.ts`(79)、`.oxlintrc.json`(1)。
- 上游 v1.37.4 相关：`6f579b5c` Hebrew i18n（无关）、设置面改动 `c6468e13` API key 警告、
  `87c44f58` theme follow OS（碰 ThemeContext，不相关）。
  → 预计按既有 guidance 重贴小 hunk 即可。

## #27 OpenCode Edit（revert-then-resume，supportsMessageEditing=true）

- 冲突文件：`provider-capabilities.service.ts`、`opencode-sessions.provider.ts`、
  `chat-websocket.service.ts`(55)、`ChatComposer.tsx`(65)、`ChatInterface.tsx`、
  `en/zh-CN chat.json`。
- 上游 v1.37.4 相关：`eef9791e` Tab completes slash command（composer）、
  `fce5c2e7` @ file list refetch（useFileMentions 冲突行 75）、`bb81d0b0` first message
  single session。**核心检查：上游是否自己实现了 OpenCode editing**
  （条目说以上游 main 验证过为 false，v1.37.4 需重验：`git show upstream/main:...capabilities`）。

## #28 Composer footer 右簇不换行（纯 class）

- 文件：`ChatComposer.tsx`、`ComposerModelMenu.tsx`(66)。
- #4 也碰 ComposerModelMenu（model label）。两条目同文件，需一起看。
- 上游 v1.37.4 相关：`eef9791e` Tab/slash、`6c8e8be7` lazy rows flicker（transcript）、
  composer 相关改动需在 diff 里确认。
