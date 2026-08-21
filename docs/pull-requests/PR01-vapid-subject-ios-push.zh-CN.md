# PR01：VAPID `sub` 用了保留 TLD `.local`，APNs 拒收所有 iOS 推送

**状态：** 不提交 —— 维护者决定不为此花上游的 review 精力（2026-08-21）。保留验证记录；不管上游动不动，本 fork 靠定制 #10 已经修好了。
**类型：** —（本来会是 Issue）
**目标仓库：** `siteboon/claudecodeui`
**发现于：** 2026-08-21，同步 v1.37.2 时（问题本身更早就发现了，见 fork 定制 #10）

## 查重

2026-08-21 在 `siteboon/claudecodeui` 的 issues 和 PRs 里搜过：

- `vapid` → 只有 #858（`[Refactor] chat adapters`，无关）和 #450（引入通知系统那个 PR，已合并）
- `mailto` → 只有 #450
- `ios notification`、`safari push`、`notification not received`、`web push BadJwtToken`、`notifications iphone` → 都没有

没人报过。#450 是这个值被写进去的地方，不是被质疑的地方。`wltiger` 这个账号在该仓库没有任何历史提交。

## 背景

把本 fork 装成 iOS 主屏 Web App 用的时候发现的：iPhone 上推送一条都收不到，同一台服务器推 Android Chrome 和桌面 Firefox 都正常。前端没报错，UI 里也看不出任何异常。

## 证据

**直接代码引用。** `server/modules/notifications/vapid-keys.service.ts`（upstream/main @ `677b7ba`，28–36 行）：

```js
webPush.setVapidDetails(
  'mailto:noreply@claudecodeui.local',
  keys.publicKey,
  keys.privateKey
);
```

这个字符串会成为 `web-push` 给每一条推送签的 VAPID JWT 里的 `sub` claim，对所有推送服务都一样。

**客观事实。** `.local` 被 [RFC 6762 §3](https://www.rfc-editor.org/rfc/rfc6762#section-3) 保留给 mDNS，不可全局路由，所以 `noreply@claudecodeui.local` 不是一个能联系到的邮箱。

**实测，不是推断。** 在一个真实安装、真实 iOS 主屏 Web App 订阅上测的 —— 同一个订阅、同一对 VAPID 密钥，两次之间只改了 `sub`：

| `sub` 取值 | APNs 返回 |
|---|---|
| `mailto:noreply@claudecodeui.local` | `403 BadJwtToken` |
| `https://cloudcli.ai` | `201 Created` |
| 一个可路由的 `mailto:` | `201 Created` |

**这部分是我的推断，不是代码追踪。** 之所以一直没人发现：另外两家推送服务不校验这个 claim —— Chrome 的 FCM 和 Mozilla 的 Autopush 都照收不误。Apple 在 [Sending web push notifications in web apps and browsers](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers) 里明确要求是 `mailto:` 或 `https:` URL。所以只有 iOS 挂，而 iOS 恰恰是最需要推送的平台（装成 Web App 后没有别的后台通道）。

**影响范围。** 这个 subject 是模块级常量、对所有订阅生效，所以不是个别设备/个别用户的问题 —— **未经修改的 CloudCLI，任何 iOS 设备从来没有收到过一条推送**。

## 草稿标题

见英文版（提交时用英文）。

## 草稿正文

见英文版 `PR01-vapid-subject-ios-push.md` 的 "Draft body" 一节 —— 那才是实际提交的内容，故不翻译。

要点：现象 → 根因（代码 + RFC + Apple 文档）→ 实测三行对照表 → 一行修复建议（值由官方自己定）→ 主动提出"需要的话我可以提 PR"。

## 提交理由

- 查重覆盖 6 种说法、issues 和 PRs 都搜了，没有重复。
- 每条断言要么是代码引用，要么是 RFC/Apple 文档，要么是明确标注的实测数据。唯一的推断（为什么一直没被发现）已标注。
- 写成"报告 + 建议"，不是"要求"。值选哪个是官方的产品决定，所以走 issue 而不是直接 PR（`CONTRIBUTING.md`："Discuss first for new features"）。
- 关联：这是 fork 定制 #10。官方只要换成任意可路由的值，这条定制就可以退休 —— 具体字符串对本 fork 无所谓。
- 前车之鉴：`#1132` 也是看起来纯粹的修复，最后因设计取向被拒。这条在**行为**上没有取舍空间（现值对某个平台就是不工作），唯一的选择是换成什么，所以 issue 里把这个决定交还给官方。

## 结论（2026-08-21）

**不提交。** 本 fork 的既定标准是"非必要不给上游提 PR"，按这个标准它没过线。上游的瓶颈明显是 review 精力而不是不知情 —— #995、#1000、#917 从 2026 年 6–7 月挂到现在没人回 —— 所以每提一次都在消耗稀缺资源。

决定性的一点：影响确实又真又大（未经修改的装机，任何 iOS 设备从来没收到过一条推送），**但它对本 fork 零成本** —— 定制 #10 在这边早就修好了，上游动不动都一样。

上面的验证记录保留，因为可复用。什么时候重新考虑：上游开始正常回应 PR 了，或者这件事不再只是上游的问题、开始在同步时给本 fork 造成成本。
