# code review 汇总（v1.37.7 sync，remerge-diff 9361b4df）

## Standards 轴
### 共识（g38f + ds41f）
- `chat-websocket.service.ts:371-374` 注释仍写 OpenCode / `opencode run` 走 rewind，已过时（低）
- 冲突解决本身正确；删除文件无悬空引用；i18n JSON 合法无重复键
### 单家（ds41f）
- `ChatComposer.tsx:376` 同一段过时说法（低）
- `docs/fork-customizations*.md` #27 正文 "On upstream conflict: Keep mine ... reapply supportsMessageEditing: true" 没改，按它做会把退役功能装回去（低）
- `docs/adr/0011`（无 Status 行）、`docs/adr/0009`（Status: in force，说 OpenCode rewindSession throws）过时；先例：ADR 0008 写 superseded（低）
- `/fork-at-anchor` 路由 + session-fork.service 现在没有产出方；E2 决定保留，但 ADR 没同步（低）
- #22 Files 行仍列 opencode-runtime.provider.js 等（低）
- `AskUserQuestionPanel.tsx:450` 全屏 Other 标签 text-[18px] 与其他选项 fontClasses 不一致（ds41f 说"细微"）
### 无法判断
- CRLF/LF：两家都看不到

## Spec 轴
### 共识
- 决定 1-7 都做到了（g38f 判全部无问题；ds41f 逐条 ✅）
### 单家（ds41f）
- `AskUserQuestionPanel.tsx:513` E4：agentLabel = providerLabel，可能显示小写 "opencode needs your input"（低）
- 决定 8：plan 里没有逐项核对 fork 定制是否被上游静默覆盖的记录（中，缺证据）
- `opencode-runtime.provider.test.js` 整份删除不在决定 1 点名内（低，ds41f 自己判无实际损失）
- #22/#23 Files 行仍列已删文件（低，与 Standards 单家重叠）
- `chat-websocket.service.ts:701` 不确定是上游还是手改（范围外）
### 分歧
- g38f："无遗漏、无范围蔓延、无实现错误" vs ds41f：上面 4 条
