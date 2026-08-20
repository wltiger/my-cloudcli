# PR02：文件树"Copy Path"会同时弹出成功和失败两个 toast

**状态：** 草稿 — 待审阅
**类型：** PR
**目标仓库：** `siteboon/claudecodeui`
**发现于：** 2026-08-21，同步 v1.37.2 时（问题本身更早，见 fork 定制 #12）

## 查重

2026-08-21 在 `siteboon/claudecodeui` 的 issues 和 PRs 里搜过：

- PRs `copy path` → #1104（`feat(editor): add copy button for file path with non-secure context fallback`，**已关闭未合并**）、#444/#434/#436（引入这段文件树代码的功能 PR）、#519、#1040
- issues/PRs `clipboard` → #1006/#1007（终端粘贴，无关）、#767（终端粘贴，无关）、#490、#1157
- issues/PRs `toast` → 没有跟剪贴板相关的
- issues `file tree context menu` → 没有

没人报过这个双 toast。#1104 挨得近但不是一回事：它是在**代码编辑器**里加一个新的复制按钮 + 非安全上下文兜底，作者没回评审意见就被关了，从没碰过 `useFileTreeOperations.ts`。值得注意的是，v1.37.2 官方自己做了编辑器复制按钮，而且**用对了共享 helper**（见证据）。

## 背景

给本 fork 做文件树菜单触屏可达时顺带细读了复制那几个 handler。触屏可达那部分是 fork 偏好，**不**打算提给官方；这条只提剪贴板 bug，那不是偏好问题。

## 证据

**代码引用 #1 —— bug 本体。** `src/components/file-tree/hooks/useFileTreeOperations.ts`（`677b7ba`，242–249 行）：

```js
const handleCopyPath = useCallback((item: FileTreeNode) => {
  navigator.clipboard.writeText(item.path).catch(() => {
    showToast(t('fileTree.toast.copyFailed', 'Failed to copy path'), 'error');
    return;
  });
  showToast(t('fileTree.toast.pathCopied', 'Path copied to clipboard'), 'success');
}, [showToast, t]);
```

`writeText()` 返回 promise。`.catch()` 里那个 `return` 退出的是**回调**，不是 `handleCopyPath`，所以最后一行的成功 toast 每次都会跑，而且是在 promise 还没 settle 之前同步跑。失败时两个 toast 一起出来。

**代码引用 #2 —— 官方已经有正确的 helper。** `src/utils/clipboard.ts` 导出 `copyTextToClipboard(text): Promise<boolean>`：await 异步 API，不可用时退回隐藏 textarea + `document.execCommand('copy')`（正好就是上面注释里担心的非 HTTPS 场景），返回是否真的复制成功。

**代码引用 #3 —— 而且官方就在隔壁目录用了它。** `CodeEditorHeader.tsx`（v1.37.2 新增）第 4 行 import 了 `copyTextToClipboard`，它自己的 `handleCopyPath`（70 行）是 `async` 的。所以正确写法本来就是官方自己的，只是文件树这个调用点漏了。

**代码引用 #4 —— 它在自己文件里也是唯一的异类。** `useFileTreeOperations.ts` 里其他所有操作 —— rename(129)、delete(164)、create(215)、download(273) —— 全是 `async` + `try/catch` + 按真实结果 toast。只有 `handleCopyPath` 不知道结果就先 toast。

**代码引用 #5 —— 调用点。** 文件树的 `handleCopyPath` 以 `onCopyPath` 暴露，只在 `FileContextMenu.tsx` 的 115 和 165 行被调用，两处都是 `onSelect: () => onCopyPath?.(item)`，都不用返回值。所以改成 `async` 对调用方不是破坏性变更，只需要把 hook 结果类型里 54 行的 `=> void` 改成 `=> Promise<void>`。

**这段是我的推断。** 除了双 toast 这个观感问题，现在的代码在非安全上下文里是彻底放弃的：明文 HTTP 下 `navigator.clipboard` 是 `undefined`，`.writeText` 在取属性时就同步抛错、不是返回 rejected promise，`.catch` 根本不会跑，用户只看到成功 toast 而剪贴板是空的。走共享 helper 两个问题一起解决（helper 有 `execCommand` 兜底）。我**没有**在真实明文 HTTP 部署上实测过；同步抛错这一点是从规范推出来的，加上 #1104 的存在本身就说明编辑器那边也需要这个兜底。

## 草稿标题 / 正文

见英文版 `PR02-file-tree-copy-path-double-toast.md` 的 "Draft title" / "Draft body" —— 那是实际提交内容，不翻译。

## 提交理由

- 查重覆盖 4 种说法、issues 和 PRs 都搜了。唯一接近的 #1104 是另一个文件、另一个功能，且因无关原因关闭。
- 除明确标注的明文 HTTP 同步抛错那一点外，全部是针对 `677b7ba` 的直接代码引用。
- 这正是 `CONTRIBUTING.md` 说可以直接提 PR 的类型（"Bug fixes are always welcome … feel free to open a PR directly"）：没有新行为、没有设计取舍，而且是把调用点挪到**官方自己已有的** helper 上，不是引入 fork 的主张。
- 关联：这是 fork 定制 #12 的一半。#12 的另一半（触屏菜单入口、"复制相对路径"）是 fork 偏好，**故意**不放进这个 PR —— 两个搅在一起会把一个干净的 bug 修复变成功能讨论。

## 提交前需要你定的

1. 标题/正文照发，还是要改？
2. 直接提 PR（建分支 + `gh pr create`），还是先开 issue？按 `CONTRIBUTING.md` 提 PR 合适，但 #995/#1000/#917 从 6–7 月开到现在官方零回应。
3. 用 `wltiger` 提，还是别的身份？
4. 正文里现在点出了"同文件其他 handler 都写对了"这一点 —— 留着（显得这个修复是显而易见的一致性工作），还是删掉？
