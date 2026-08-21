# PR02：文件树"Copy Path"会同时弹出成功和失败两个 toast

**状态：** 不提交 —— 维护者决定不为此花上游的 review 精力（2026-08-21）。保留验证记录；不管上游动不动，本 fork 靠定制 #12 已经走共享 helper 了。
**类型：** —（本来会是 PR）
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

**实测，2026-08-21 —— 并且纠正了本文件早先的一个错误说法。** 本文件早先的版本写的是"明文 HTTP 下用户只看到成功 toast，剪贴板是空的"。**这是错的。** 在 Chromium 里对着一个真实的非安全源（`http://192.168.15.110:8099`，`window.isSecureContext === false`）跑上游 `handleCopyPath` 的原样结构，实测：

| 环境 | `navigator.clipboard` | 上游代码的真实行为 |
|---|---|---|
| HTTPS / `localhost` | 有 | 一个成功 toast，路径已复制 —— 正确 |
| 剪贴板权限被拒 | 有，promise reject | **两个 toast 同时出** —— 双 toast bug |
| 局域网 IP + 明文 HTTP | **`undefined`** | `.writeText` 取属性时抛 `TypeError`，**发生在成功 toast 那行之前**，所以**一个 toast 都不出**，点击完全没反应 |

所以明文 HTTP 局域网部署下的失效模式不是"toast 撒谎"，而是**菜单项彻底死掉 + 控制台一个未捕获的 `TypeError`**。同一次实测确认 `document.execCommand` 在那个上下文里**是可用的**，所以上游自己的 `copyTextToClipboard` 兜底确实能让它工作。

这改变了整条的定性：双 toast 是观感的那一半；实质的那一半是"任何在局域网明文 HTTP 上自托管的人，Copy Path 都是静默失效的"—— 而 `.env.example` 默认 `HOST=0.0.0.0`，这是一种很正常的部署方式。

## 草稿标题 / 正文

见英文版 `PR02-file-tree-copy-path-double-toast.md` 的 "Draft title" / "Draft body" —— 那是实际提交内容，不翻译。

## 提交理由

- 查重覆盖 4 种说法、issues 和 PRs 都搜了。唯一接近的 #1104 是另一个文件、另一个功能，且因无关原因关闭。
- 除明确标注的明文 HTTP 同步抛错那一点外，全部是针对 `677b7ba` 的直接代码引用。
- 这正是 `CONTRIBUTING.md` 说可以直接提 PR 的类型（"Bug fixes are always welcome … feel free to open a PR directly"）：没有新行为、没有设计取舍，而且是把调用点挪到**官方自己已有的** helper 上，不是引入 fork 的主张。
- 关联：这是 fork 定制 #12 的一半。#12 的另一半（触屏菜单入口、"复制相对路径"）是 fork 偏好，**故意**不放进这个 PR —— 两个搅在一起会把一个干净的 bug 修复变成功能讨论。

## 结论（2026-08-21）

**不提交。** 按"非必要不给上游提 PR"这条标准，没过线。上游的瓶颈明显是 review 精力而不是不知情（#995、#1000、#917 从 6–7 月挂到现在没人回），每提一次都在消耗稀缺资源。

决定性的一点：实质影响只打到**局域网明文 HTTP** 的装机，而本 fork 早就走共享 helper 了。在 HTTPS 和 localhost 上 —— 也就是大多数人的跑法 —— 上游代码的行为是正确的。

上面的验证记录保留，因为可复用（尤其是那张三种上下文的实测表）。什么时候重新考虑：上游开始正常回应 PR 了，或者这件事开始在同步时给本 fork 造成成本。
