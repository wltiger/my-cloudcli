# v1.37.8 合并调研：非 Claude 运行时部分（sub-opus）

引用约定：`dev`=cbf3832d，`upstream/main`=2053f3d7，`base`=13e9ef64，`merged`=`git merge-tree --write-tree` 的结果树 `2ff74842`（`.scratch/26110901-sync-v1.37.8/merge-tree.txt:1`，用 `git show 2ff74842:<path>` 读）。证据档位：**实测**＝我跑过只读的 git / node / npm view；**推测**＝按代码推出、没跑；**未核实**＝缺材料。typecheck 和测试都没跑（要把合并结果落到磁盘，本任务禁止写文件），所以所有"测试会过"都是推测。

## 1. 结论摘要

1. `package.json` 取 upstream 的 `^0.3.311`。upstream 已超过 fork 的 `^0.3.295`，#34 里 SDK 这一行可以退役；另外四个包 upstream 还停在旧版本，继续保留 fork 的版本。原文：`claude-agent-sdk": "^0.3.311"`（upstream/main package.json:143）
2. `package-lock.json`：19 个 hunk 全部取 upstream，也就是整份用 upstream 的锁文件，然后跑一次增量 `npm install`。19 个里有 8 个（codex）只是 fork 锁文件里换成了腾讯镜像 URL 造成的噪音。另外，fork 锁文件从 v1.37.3 起少了 179 个非 Windows 平台的条目，换成 upstream 的锁文件正好补回来。原文：`mirrors.cloud.tencent.com`（dev package-lock.json:4694）
3. OpenCode synchronizer 的 1 个 hunk：两边合并，两组方法都保留。冲突的来源是 `dcc0bfbc`（side questions），不是任务里写的 `0bd1b79b`/`b28a767c`。原文：`side questions answered`（`git log base..upstream/main -- <file>` 只返回这一条）
4. `useFileTreeOperations.ts` 的 2 个 hunk：保留 fork 的相对路径功能。`downloadBlob` 加到合并结果里已经有的第 6 行 import 上，**不要**再保留 upstream 的第 11 行，否则 `copyTextToClipboard` 会被重复 import。`triggerBrowserDownload` 删掉。原文：`import { copyTextToClipboard }`（merged:6）
5. ❌ **最大的问题不在任务列出的文件里**：`provider-capabilities.service.ts` 自动合并时，把 upstream 给 **opencode** 新加的两个字段贴到了 **antigravity** 条目下。结果是 opencode 缺字段（typecheck 会报错）；antigravity 变成 `supportsSideQuestions: true`（typecheck 抓不到，UI 会给 agy 显示"旁问"入口，用了必然失败）。原文：`supportsSideQuestions: true,`（merged provider-capabilities.service.ts:216，位于 `provider: 'antigravity'` 条目内）
6. 其余自动合并的文件我都逐个看过语义：sidebar、notifications、agent routes、browser-use、模型目录、Markdown、权限 banner、两个 shared utils、constants、5 个 `settings.json`。没发现重复注册，也没发现只在一边生效的改名。
7. 可以退役：#34 的 SDK 那一行；#12 里剪贴板修复那一半（upstream `1e580f1e` 已经修了 PR02 说的 bug）。
8. 交给 Claude 运行时那位 agent 处理（不在本范围）：MCP elicitation 的审批 metadata 里没有 `_userId`，所以 #16 的"已在别处处理"推送不会发出；#34 的 `createQuery` 类型断言可能可以去掉了（未核实）。

## 2. 冲突 hunk 表

| 文件 | hunk（merged 行号） | 处理 | 理由 · 原文 |
|---|---|---|---|
| package.json | 143 `claude-agent-sdk` | 取 upstream | upstream 版本更高，按 #34 的规则取 upstream 的那行。原文：`take upstream's line`（dev docs/fork-customizations.md:530） |
| package-lock.json | 13 根依赖 SDK spec | 取 upstream | 和 package.json 保持一致。原文：`"^0.3.311",`（merged:16） |
| package-lock.json | 161 `node_modules/@anthropic-ai/claude-agent-sdk` | 取 upstream | 0.3.311 本体。原文：`"version": "0.3.311",`（merged:166） |
| package-lock.json | 175 SDK 的 `optionalDependencies` | 取 upstream | 8 个平台包都要升到 0.3.311 |
| package-lock.json | 202/221/240/262/284/306/328/347（SDK 的 8 个平台包） | 取 upstream | 同上，每处只差 version/resolved/integrity |
| package-lock.json | 4775 `@openai/codex` | 取 upstream | fork 这里只改了 resolved URL。hunk 外面的 `optionalDependencies` 已经是 upstream 的 0.166.0，如果取 fork 这边，锁文件会自相矛盾。原文：`codex@0.166.0-darwin-arm64`（merged:4792） |
| package-lock.json | 4802/4825/4848/4871/4912/4935（codex 的 6 个平台包） | 取 upstream | fork 和 base 的差别只有 `resolved` 这一行（实测 diff 排除 resolved 后为空） |
| package-lock.json | 4893 `@openai/codex-sdk` | 取 upstream | 0.166.0，hunk 外的 `dependencies` 也已经是 0.166.0 |
| opencode-session-synchronizer.provider.ts | 173–309（唯一的 hunk） | 合并 | fork 的两个方法和 upstream 的三个方法是同一位置的不同插入，彼此不调用、不冲突。原文：`private async pruneDeletedSessions()`（dev:137）；`private hasAgentColumn(`（upstream:170） |
| useFileTreeOperations.ts | 8–12（import） | 合并 | 保留 fork 的 `toProjectRelativePath`。不要保留 upstream 的第 11 行，改成在合并结果第 6 行补上 `downloadBlob`。原文：`, downloadBlob } from`（upstream:7） |
| useFileTreeOperations.ts | 247–299 | 保留 fork，删掉 `triggerBrowserDownload` | fork 的 `copyPathToClipboard` 已经实现了 upstream 的行为（等结果出来才弹 toast），还多了相对路径。合并后两个调用点已经改用 `downloadBlob`。原文：`downloadBlob(blob, item.name);`（merged:312） |

**package-lock 操作步骤**（在 sync 分支的 merge 中，ours=dev，theirs=upstream/main）：
```
git checkout --theirs package-lock.json   # 整份用 upstream 的锁
# package.json 的冲突处手改成 "^0.3.311"；fork 的另外四个版本和 test 脚本已经自动合并进来
npm install                               # 只能增量装；全局 CloudCLI 实例在跑时不要用 npm ci
# 检查：express 4.22.3 / react-router-dom 6.30.6 / dompurify 3.4.16 / tsx 4.23.15 / SDK 0.3.311 / codex 0.166.0
#       grep -c '"node_modules/@rollup/rollup-linux-x64-gnu"' package-lock.json  → 应为 1
```
依据：upstream 锁文件里这四个包还是旧版本（实测：express `4.21.2` upstream:14066，dompurify `3.4.7` upstream:12847，tsx `4.21.0` upstream:24603，react-router-dom `6.30.1` upstream:21519），npm install 会按 package.json 里 fork 的版本把它们升上去（推测，按 npm 常规行为）。CLAUDE.md 原文：`verified safe`（指只做增量 npm install）。

**OpenCode 合并示意**（fork 这一侧在 `pruneRows` 的 catch 块结束处截断，upstream 这一侧在 `return` 处截断，marker 后面共用的那个 `  }` 只能闭合最后一个方法，所以中间要自己补一个 `  }`）：
```ts
  private async pruneDeletedSessions(): Promise<void> { /* fork 原样 */ }
  private pruneRows(sessionIds, databaseModifiedAt, chatRunRegistry): void {
    try { /* fork 原样 */ } catch (error) { /* fork 原样 */ }
  }                                   // ← 手动补这一行
  private hasAgentColumn(db) { /* upstream 原样 */ }
  private registeredForkIdsClause() { /* upstream 原样 */ }
  private pendingForkWindowClause() { /* upstream 原样，最后一句是 return { sql, params } */
  }                                   // ← 来自 marker 后面共用的那一行
```
语义检查：
- fork 的 prune 会读到 `SELECT id FROM session` 里**所有** id，包括 side question 临时 fork 出来的 session。这些临时 session 从来不会有 CloudCLI 的行（upstream 用 SQL 把它们排除了），用完后 upstream 会删掉（`client?.session.delete(`，upstream opencode-runtime.provider.ts:1714）。所以 prune 不会误删，也不会漏删（推测）。
- upstream 新加的 synchronizer 测试在 `synchronize()` 之后断言 `getAllSessions().length, 1`（upstream opencode-side-question.test.ts:634）。fork 的 prune 只删"在 opencode.db 里找不到"的行，而测试里被绑定的那个 parent 在库里，所以这条断言不受影响（推测，未跑）。

**useFileTreeOperations 合并示意**：
```ts
import { api } from '@/shared/api';
import { copyTextToClipboard, downloadBlob } from '@/shared/utils';      // 改 merged:6
import type { FileTreeNode,Project } from '@/shared/types';
import { toProjectRelativePath } from '@/modules/file-tree/utils/fileTreeUtils';
// hunk 2：留 copyPathToClipboard / handleCopyPath / handleCopyRelativePath；删 const triggerBrowserDownload ...
```
`copyTextToClipboard` 只在一个地方定义：merged src/shared/utils.ts:80（dev:80，upstream:66）。`downloadBlob` 是 upstream `ca95ec4c` 新加的，在 merged src/shared/utils.ts:107。upstream 新增的测试要求剪贴板写入在点击处理函数内**同步**开始，原文：`start inside the click handler`（upstream copyPathToast.test.ts:137）。fork 的 async 包装函数在第一个 `await` 之前就同步调用了 `copyTextToClipboard`，后者又同步调用了 `writeText`，所以能满足这个要求（推测）。

## 3. 自动合并文件

| 文件 | 涉及的 fork 条目 | 结论 | 证据 · 原文 |
|---|---|---|---|
| src/modules/sidebar/Sidebar.tsx | #2 | ✅ | fork 加的 favorites（dev:93-94、301-302）和 upstream 加的 `onArchiveSession`（upstream:226）不在同一位置，没有重复注册 |
| src/modules/sidebar/hooks/useSidebarController.ts | #2、#23 | ✅ | upstream 去掉了 `showDeleteSessionConfirmation` 的 `isArchived` 参数，也把 `confirmDeleteSession(hardDelete)` 改成了无参。我 grep 了 dev 的 src：唯一的 `{ isArchived: true }` 调用在 Sidebar.tsx:315，而 upstream 自己就改掉了这一行，没有 fork 自己写的调用。原文：`removeSession(sessionId, true)`（upstream:964） |
| sidebar 的组件链和测试 | #1、#2 | ✅ | fork 的 SidebarContent 把 `projectListProps` 整个往下传，upstream 新加的 prop 会自动带上。原文：`sessionActions={projectListProps`（dev SidebarContent.tsx:395）。fork 自己的 `sidebarFavoritesFilter.test.ts` 只测纯函数。fork 改过的 `recentConversationTitleSync.test.ts`（多传一个 `backgroundSessionIds`）upstream 这次没动 |
| sidebar 和 #33/#36（agy 的删除语义） | #33、#36 | ✅ | 菜单里的"Delete session"现在一定是永久删除，走 `force`，于是会调到 agy 的 artifact 清理；归档仍然只改 `isArchived`。这和 §5 的规则一致。原文：`query({ force: hardDelete })`（dev api.ts:274）；`permanent delete removes them`（dev docs/agents/antigravity-provider-implementation.md:401） |
| notification-orchestrator.service.js | #16 | ✅ | upstream 新加的 webhook channel 会绕过去重，但它只处理 run 生命周期事件。fork 的 `permission.resolved` 在 webhook 那边返回 null，被忽略。合并后 tag 表达式、`notifyPermissionResolved` 的导出各只有一份（merged:177、319、340）。原文：`notification are not lifecycle`（upstream webhook-notifications.service.ts:349） |
| 通知设置 UI（NotificationsSettingsTab 等） | #16 | ✅ | 这次只有 upstream 改了，fork 没碰这些文件，不会出问题 |
| server/modules/agent/agent.routes.ts + 测试 | #33 | ✅ | upstream 只在 Claude 分支加了 `unattended: true`（upstream:1052）；fork 加的 antigravity 分支在 dev:1087。options 的类型是 `options: AnyRecord,`（merged server/shared/types.ts:859）。upstream 的新测试用的是 `createDependencies`，里面已经带了 fork 加的 `queryAntigravity`（dev 测试:54） |
| server/modules/browser-use/browser-use.service.ts | #14 | ✅ | upstream 加了 `agentUploadFiles`（upstream:804），但没碰 install 和 resolve 那一对函数。合并后三处 `runCommand` 都带了 `runtimeRoot`（merged:352/356/360）。upstream 的 install bug 还在，原文：`cwd: process.cwd(),`（upstream:265） |
| provider-models.service.ts + 测试 | #25、#38（#4、#19 没碰） | ✅ | upstream 用 `!builtInIds.has(option.value)`（upstream:120）把"id 后来变成内置模型 id 的自定义行"从列表里隐藏。fork 的 `toCustomProviderModelOption` 原样保留（merged:68-85）。有一个边角情况：带 endpoint 的 Claude 自定义行如果 id 撞上内置模型，现在会被隐藏，但运行时本来就先命中内置模型，原文：`OPTIONS?.find((option) =>`（dev claude-custom-endpoint.ts:26），所以这不是新问题。fork 的"unknown effort"测试（dev:380）用的是 `'ultra'`，Claude 的 effortLevels 里没有它（merged provider-capabilities:107），测试仍然有效 |
| src/modules/chat/transcript/Markdown.tsx | #21、#3、#35 | ✅ | upstream 只改了链接解码（merged:46），表格的 class 和 prose 这个 hook 都还在。原文：`w-max min-w-full`（merged:263） |
| PermissionRequestsBanner.tsx（MCP elicitation） | #11、#32 | ✅（有一个功能空缺） | `McpElicitationPanel` 用的是同一个 registry（merged:21），会收到 fork 透传的 `sessionTitle={sessionTitle}`（merged:88），但它不读这个值，原文：`({ request, onDecision })`（upstream McpElicitationPanel.tsx:249）。所以 elicitation 面板没有 #11 的全屏，也没有 #32 的多行输入。AskUserQuestionPanel 这次没被改 |
| server/shared/utils.ts | #23、#24 | ✅ | upstream 新加了 `errorMessage`、`SIDE_*` 常量；导出名没有重复（实测 `uniq -d` 结果为空）。原文：`export function errorMessage`（merged:172） |
| src/shared/utils.ts | #1、#6、#12 | ✅ | `COMPACT_MOBILE_SIDEBAR`（merged:26）、`DEFAULT_PAGE_TITLE = 'CloudCLI'`（merged:231）、`downloadBlob`（merged:107）各只有一份 |
| src/shared/constants.ts | #33 | ✅ | upstream 新加的 `MCP_ELICITATION_TOOL_NAME`（merged:152）是在两个 map 之间插入的，antigravity 的四个 map 条目都还在。原文：`antigravity: true,`（merged:160） |
| i18n settings.json（en/es/fr/ko/zh-CN） | #3、#26、#33 | ✅ | 实测：5 个文件都能解析，没有重复 key；合并结果的 key 集合正好等于 base＋fork 新增＋upstream 新增（`overlap=0`，`merged mismatch=0 extra=0`）。upstream 只加了 `notifications.webhook.*` |
| ❌ provider-capabilities.service.ts（+测试）**超出任务列表** | #33 | ❌ 字段贴错条目 | merged:166-189 的 opencode 条目在 `supportsSessionForking: false,` 之后就结束了，**缺了两个必填字段**；merged:216-217 的 antigravity 条目却**多了** `supportsSideQuestions: true,`。opencode 缺字段 typecheck 会抓到，antigravity 的 true 抓不到：前端拿它开入口，后端会报 `has no side questions.`（upstream provider-runtime.service.ts:149）。upstream 新测试里的 `Record<LLMProvider, boolean>`（upstream 测试:43）漏了 antigravity，按 fork 的 LLMProvider 类型 typecheck 也会失败。改法见下 |

**capability 的改法**（opencode 对齐 upstream:143-144；antigravity 没有 `askSideQuestion`/`steer` facet，所以两项都填 false）：
```ts
  opencode: { /* ... */ supportsSessionForking: false,
    supportsSideQuestions: true,
    supportsSteering: false,
  },
  antigravity: { /* ... */ supportsSessionForking: false,
    supportsSideQuestions: false,
    supportsSteering: false,
  },
// provider-capabilities.service.test.ts 的 expected 里补上：antigravity: false,
```

**两种失败形态的总结**：重复注册，在上面所有文件里都没发现。单边改名：upstream 这次的改名有 `triggerBrowserDownload`→`downloadBlob`、`PendingSidebarDeletion.isArchived` 被删、sidebar 的 3 个 i18n key 被删、codex 默认模型 `gpt-5.4`→`gpt-5.6-sol`。我 grep 了 dev，残留的引用都在 upstream 自己改的行上，或者在冲突 hunk 里，没有 fork 自己写的旧名残留。唯一的"错位"就是上面 capability 那一处，它不是改名，而是 hunk 被贴到了错误的条目上。

## 4. 退役 / 调整候选

| 条目 | upstream 现在的做法 | 去掉 fork 版本会损失什么 | 建议 |
|---|---|---|---|
| #34 SDK 那一行 | 已经是 `^0.3.311`，比 fork 的 `^0.3.295` 高。原文：`claude-agent-sdk": "^0.3.311"`（upstream package.json:143） | 没有损失 | 退役这一行；express/react-router-dom/dompurify/tsx 四行继续保留。原文：`"express": "^4.18.2",`（upstream:176） |
| #34 的 `createQuery` 类型断言 | upstream 没有断言，原文：`context.createQuery ?? query;`（upstream claude-runtime:1514） | 没有 | 候选。条目原话是"等 upstream 版本追上就删"；能不能删要等合并后跑 typecheck 才知道（**未核实**，而且是 claude-runtime 的文件，归另一位 agent） |
| #34 的 `allowedTools` 代码块 | upstream 还是没有显式列出任务类工具，原文：`'TaskCreate', 'TaskGet'` 只出现在 dev:400 | 去掉的话清单 UI 可能又不显示了 | 保留。SDK 0.3.311 有没有把这些工具恢复成默认，**无法判断**（仓库里没有 0.3.311 的 changelog） |
| #12 的剪贴板那一半 | `1e580f1e` 已经改用共享的 `copyTextToClipboard`，并且只弹一次 toast。原文：`exactly one toast must follow`（upstream copyPathToast.test.ts:13） | 没有 | 退役这部分"bug 修复"的说法，PR02 标成 upstream 已修。触屏菜单和相对路径两部分继续保留，upstream 没有对应功能 |
| #39 | upstream 只排除 side-question fork，没有"删除后清理" | 去掉的话，在 OpenCode 里删掉的 session 会一直留在列表里 | 保留，按第 2 节的方式合并 |
| #14、#10、#16、#21 | 都还没被 upstream 解决。原文：`noreply@claudecodeui.local`（upstream vapid-keys.service.ts:31）；`cwd: process.cwd(),`（upstream browser-use:265） | — | 保留 |

其他条目（#1–#3、#11、#19、#22–#26、#28、#32、#33、#35–#38），我拿这次 upstream 的提交逐个对照过，**没有**一条被 upstream 完全或部分替代。#28、#3 里涉及 ChatComposer.tsx 的部分不在我的范围内，没有核对。

## 5. 需要维护者决定的事

| # | 问题 | 选项 | 建议与代价 |
|---|---|---|---|
| D1 | 锁文件以哪份为底 | A：整份用 upstream 的锁＋`npm install`；B：用 fork 的锁＋`npm install` | **选 A**。A 能补回 179 个平台条目，SDK 也会锁在 upstream 测过的 0.3.311。B 下，fork 锁里的 0.3.295 不满足 `^0.3.311`，npm 会重新解析到镜像上最新的 0.3.319（实测 `npm view` 返回 `0.3.319`；会升到这个版本是推测），而且平台条目的缺口还在。A 的代价：和 dev 比，锁文件 diff 会比较大 |
| D2 | 锁文件里的镜像 URL | A：保留腾讯镜像；B：重新生成时用 registry.npmjs.org | **倾向 B，前提是本机能连上 npmjs**。这次 8 个 codex hunk 全是 URL 造成的噪音，B 能让以后的同步少出这类冲突。本机 npm 的 registry 设置是 `mirrors.cloud.tencent.com/npm/`。代价：可能装得慢、连不上 |
| D3 | #12 的 `handleCopyPath` 写法 | A：保留 fork 的 `copyPathToClipboard` 包装函数；B：改成 upstream 的 `.then` 写法，相对路径另写一份 | **选 A**，diff 最小，相对路径也要用它。代价：和 upstream 的写法不一样，以后还可能在这里冲突 |
| D4 | agy 的 side questions | A：`supportsSideQuestions: false`；B：给 agy 实现 `askSideQuestion` | **选 A**（这次必须改，不改就是坏的）。B 是新功能，不属于合并的工作 |
| D5 | #11 全屏要不要扩展到 `McpElicitationPanel` | A：先不做，在文档里记一笔；B：这次顺便做 | **选 A**，没人提过这个需求。代价：手机上表单比较长的 elicitation 只能在窄栏里填 |
| D6 | #16：elicitation 被回答后，别的设备上的推送清不掉 | A：在 claude-runtime 的 elicitation `waitForToolApproval` metadata 里补上 `_userId`/`_sessionName`；B：先不管 | **选 A**，大约改 2 行，但文件归另一位 agent。依据：fork 的 `resolveToolApproval` 读的是 `resolver._userId`（dev claude-runtime:296），通知函数开头会检查 `if (!userId`（dev notification-orchestrator:229），而 upstream 的 elicitation metadata 只有 `_toolName: MCP_ELICITATION_TOOL`（upstream claude-runtime:1409），没有 `_userId`。fork 自己的 canUseTool 是带了的，原文：`_userId: ws?.userId`（dev claude-runtime:1425） |

## 6. 要更新的 fork-customizations 条目（.md 和 .zh-CN.md 都要改）

- **#34**：SDK 那一行标为退役（upstream 在 v1.37.8 是 `^0.3.311`）。把"Upstream still declares the old spec for all five"改成"其余四个"，并把检查点改成 `2053f3d7`。在 On upstream conflict 里加一句：先整份用 upstream 的锁再 `npm install`，不要以 fork 的锁为底（fork 的锁从 v1.37.3 起缺非 Windows 平台条目，URL 是腾讯镜像）。`createQuery` 断言的说明改成"upstream 已追平，合并后用 typecheck 确认能不能删"。原文：`old spec for all five`（dev:522）
- **#12**：剪贴板那一半写成"v1.37.8 由 upstream `1e580f1e` 修复（#1642）"，PR02 的状态同步改掉。记一条合并经验：import 要合进已有的那一行，不能两行都保留；`triggerBrowserDownload` 已经被 upstream 的 `downloadBlob` 取代。原文：`deliberately not reported`（dev:121）
- **#39**：加一条 v1.37.8 备注：`dcc0bfbc` 在同一位置插入了三个 side-question 方法，两边都保留，中间要补一个 `}`；prune 会读到临时 fork 出来的 id，但没有影响。原文：`take theirs and retire this entry`（dev:609）
- **#33**：在 On upstream conflict 里加两点。一是 upstream 往 `ProviderCapabilities` 加必填字段时，agy 条目要补上，而且要检查 git 有没有把相邻 provider 的新字段贴到 agy 条目里（这次就贴错了）。二是 upstream 新测试里的 `Record<LLMProvider, …>` 要补 `antigravity`。`docs/agents/antigravity-provider-implementation.md` §10 的表也要补 `supportsSideQuestions`/`supportsSteering` = `false` 两行
- **#23**：Files 里的 `provider-capabilities.service.test.ts` 应该改标为 upstream-owned。实测 `git cat-file -e upstream/main:<path>` 成功，upstream 在 `51fb5757` 新建了这个文件，原文：`let custom models declare`。现在文档写的是 `*Fork-owned (pre-existing):*`（dev:241）
- **#16**（可选）：记一笔"v1.37.8 已核对 webhook channel，不影响本条"，以及 D6 说的 elicitation 空缺
- **#14**（可选）：记一笔"v1.37.8 已复查，upstream 只加了上传功能，install 的 bug 还在"

## 附：过程说明

- 除了这份报告，仓库和工作区我都没有改。有一处违规要说明：中途我误把 4 个临时 key 列表写进了 Git Bash 的 `/tmp`（`/tmp/k_*.txt`），随后马上删除，之后都改成纯内存计算。
- 没有跑：`npm run typecheck`、`npm test`、`npm run test:client`。第 2、3 节里"能编译、测试能过"的判断都是推测。合并之后应该先跑 typecheck，capability 那处缺字段会直接报出来，可以拿来验证第 1 条第 5 点。
