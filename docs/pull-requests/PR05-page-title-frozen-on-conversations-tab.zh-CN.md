# PR05：切到 Conversations / Archive 侧边栏标签后，浏览器标签页标题就不再更新

**状态：** 不提交 —— 维护者决定不为此花上游的 review 精力（2026-08-21）。保留是因为诊断可复用，而且本 fork 也继承了这个行为。
**类型：** —（本来会是 Issue）
**目标仓库：** `siteboon/claudecodeui`
**发现于：** 2026-08-21，v1.37.2 合并后在浏览器里做走查时发现的 —— 不是看 diff 看出来的

## 查重

**没做。** 决定不提交是在查重之前就定了，所以这份是诊断记录，不是可直接提交的草稿。**以后谁要重启这件事，必须先查重**（见 `docs/upstream-pr.md` 的"动手写之前"）—— 这个问题在上游只有三天大，有重复很正常。

## 背景

按合并后的走查清单在浏览器里逐条验证时发现：从侧边栏 **Conversations** 列表里点一个会话，浏览器标签页标题**停在上一个值**不动。把侧边栏切回 **Projects**，标题立刻就对了。

一开始怀疑是合并搞坏的。不是 —— 见下。

## 证据

**代码引用 #1 —— effect 在哪。** `SidebarProjectList.tsx`（`677b7ba`，97 行和 111–113 行）：

```jsx
const pageTitle = getPageTitle(selectedProject, selectedSession);
...
useEffect(() => { document.title = pageTitle; }, [pageTitle]);
```

整个项目/会话命名相关的 `document.title` 写入，只有这一处，就住在 `SidebarProjectList` 里。

**代码引用 #2 —— 这个组件什么时候挂载。** `SidebarContent.tsx`（`677b7ba`）在同一条条件链里只有两个分支渲染它：

- 429 行 —— `searchMode === 'running'`
- 689 行 —— 最后的 `else`，即 `searchMode === 'projects'`

`searchMode === 'conversations'`（384 行）渲染的是 `SidebarRecentConversations`，`searchMode === 'archived'`（432 行）渲染归档列表。这两种情况下 `SidebarProjectList` 被卸载、effect 被销毁，在用户切回 Projects 或 Running 之前没有任何东西写 `document.title`。

**代码引用 #3 —— 不是本 fork 合并造成的。** 在 merge base（上游 `v1.37.1`，`9c48092`）同一个文件里，同样的 effect 就已经在同一个组件里了：

```js
useEffect(() => {
  let baseTitle = 'CloudCLI UI';
  const displayName = selectedProject?.displayName?.trim();
  if (displayName) baseTitle = `${displayName} - ${baseTitle}`;
  document.title = baseTitle;
}, [selectedProject]);
```

`SidebarContent` 的条件结构在上游版本和本 fork 版本之间逐字节相同。fork 在这里唯一的改动是 App 名字那个字符串（定制 #6）。纯净的上游 v1.37.2 装机可复现。

**实测，2026-08-21**（Chromium，合并版本的本地 dev build —— 这条路径上就是上游的代码）：

| 操作 | `document.title` | 页面头部标题 |
|---|---|---|
| Conversations 标签 → 点会话 "Greeting message" | `claudecodeui - CloudCLI`（陈旧） | `Greeting message` |
| 只把侧边栏切到 Projects，不做别的 | `Greeting message` | `Greeting message` |
| Projects 标签 → 点会话 | 立刻更新 | 一致 |

**这段是我的推断。** 这是**早就存在的放置问题**，被 v1.37.2 放大了，不是 v1.37.2 引入的回归。v1.37.2 之前 effect 只依赖 `selectedProject`，所以要看到陈旧标题得先"停在 Conversations 标签上再切项目"，很少见。v1.37.2 的 #1153 把选中**会话**的名字加进了标题 —— 而 Conversations 列表正是切会话的主要入口，于是这个新功能恰好在最该生效的界面上完全不起作用。

Archive 标签我没有实际验证，是从同一条条件链推出来的。

## 真要修的话涉及什么

**不是一行能了的**，这也是不提交的原因之一。effect 需要挪到一个"切侧边栏标签时不会被卸载"的地方 —— 比如 `App`/`AppContent` 层的 `useDocumentTitle(selectedProject, selectedSession)` hook，或者 session store。这属于上游自己的架构决定，所以本来也只会开 issue 描述问题，而不是提 PR 替他们定方案。

## 结论（2026-08-21）

**不提交。** 按"非必要不给上游提 PR"这条标准衡量：

- 症状纯观感 —— 标签页标题陈旧。不丢数据、不影响任何操作、不需要绕过。
- **对本 fork 零成本。** 跟第 10、12、21 条不一样，这里**没有分歧要维护**：本 fork 的行为和上游一模一样。上游修不修，这个仓库都不受影响。
- 修它需要上游做架构决定（effect 该放哪层），所以对他们来说是 triage 负担，不是一条一行的 bug 报告。
- 它在被发现前三天才发布；上游自己很可能会注意到。
- 上游的稀缺资源是 review 精力（#995、#1000、#917 从 6–7 月挂到现在没人回）。花在这里性价比太低。

什么时候重新考虑：日常使用中陈旧标题真的造成了麻烦，或者本 fork 自己想修 —— 那时它就变成一条 fork 定制，"对我们零成本"这个论据也就不成立了。
