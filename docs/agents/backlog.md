# CloudCLI 需求 / BUG 收集

只收集,不自动开工。开工时从这里取待办。

## 条目格式

- `- YYYY-MM-DD 【bug|需求】一句话摘要` · 移交(进 issue tracker)或做完即删除
- bug 补三行:`复现:`(怎么操作出来的)/ `现象:`(实际发生什么、报错信息)/ `期望:`(应该是什么样)
- 需求补一行:`期望:`(希望能干什么)
- 只记现象和期望,不写「怎么修」—— 方案开工时定

## 需求

- 2026-09-28 【需求】压缩上下文后,压缩出来的内容能折叠显示
  - 期望:压缩后的内容默认收起(折叠),不再作为一长段历史消息全部铺开;需要时可点开查看
- 2026-09-28 【需求】左侧 panel 支持拖拽调整宽度
  - 期望:宽度可拖拽调整;当前跨屏下默认太窄,session 标题只能显示一部分
- 2026-09-28 【需求】左侧 panel 增加「关注」视图,只看活跃 sessions
  - 期望:除 Projects / Conversations 外加一个视图,只列当前活跃 sessions;Conversations 太长且不想 archive 时用它
- 2026-09-28 【需求】左侧 panel 过滤/自动树形折叠 /dispatch-agent 派出去的 agent session
  - 期望:待讨论 —— 过滤掉,或自动树形折叠到父 session 下面
- 2026-09-28 【需求】插件显示顺序可调整
  - 期望:用户能自定义插件的显示顺序
- 2026-09-28 【需求】自定义模型的排序 / 开关 / 复制(配置着但不显示)
  - 期望:① 能调整自定义模型的显示顺序;② 能单独启用/禁用某个自定义模型 —— 现在配置了却不显示,需要一个开关(或明确的失效提示);③ 能复制一份现有模型配置(改参数用,避免重填)
  - 现状:ModelLibraryPanel 已有编辑 + 删除(带二次确认);内置模型区是只读列表,不能排序/开关
- 2026-09-28 【需求】额度 widget:展示 claude / codex / antigravity 的 5h / 周额度剩余
  - 期望:展示 claude / codex / antigravity 的 5h / 周额度剩余;具体形式待讨论
- 2026-09-28 【需求】做一个 Antigravity Usage 的 plugin
  - 期望:以插件形式展示 Antigravity 的 Usage
- 2026-10-03 【需求】claude session 支持以指定的主线程 agent 启动(等价 claude --agent)
  - 期望:claude session 能选主线程 agent(每会话选、会话内可切换);选项来自项目 .claude/agents/ 与 ~/.claude/agents/ 的 agent 定义,默认标准 Claude Code
- 2026-10-09 【需求】实测 Claude Code SDK 自己的默认 reasoning effort
  - 期望:测出 SDK 在不传 effort 时实际用的档位。这决定 fork 里 opus → medium、sonnet → xhigh 到底是升还是降(官方目录那个 high 从没生效过,真正基准是 SDK 默认值),不测出来无法判断改动是否合理
- 2026-10-09 【需求】真机确认 Haiku 5.5 支持的 effort 档位
  - 期望:确认 Haiku 5.5 是否真支持 low/medium/high/xhigh/max 以及 ultracode(展开成 xhigh + enableWorkflows)。当前 fork 按「支持完整档位」配了目录,但依据来自仓库外,代码里无模型能力门控,不支持的档位会照发出去由 CLI 拒绝或忽略
- 2026-10-09 【需求】opusplan 档位下发 effort 后 SDK 如何分配给两个阶段
  - 期望:opusplan 的语义是「planning 用 Opus、执行用 Sonnet」,现在 fork 会真的把 effort: high 下发给 SDK。确认 SDK 收到单一 effort 时是怎么分给两个阶段的,还是根本忽略
- 2026-10-09 【需求】模型菜单里「Default」档位显示不出实际生效的档位
  - 期望:选 Default 时,菜单只显示字面量 "Default",看不出它实际会解析成哪一档(如 opus 是 medium)。想看到 "Default (medium)" 这类提示
- 2026-10-09 【需求】Claude 目录档位的实际值缺测试覆盖
  - 期望:现有 3 个 effort 解析测试全用自定义模型夹具,目录里的真实档位(opus / haiku 等)没有测试守住。补一组针对目录值的断言,改动目录时能立刻发现解析结果变了

- 2026-10-18 【需求】补两个测试断言：排队附件不重复上传；没有后台任务时中断与普通发送一致
  - 期望:① 排队消息的附件只上传一次，不重复上传；② 会话没有后台任务时，「中断并发送」与普通发送行为一致。这两条是 v1.37.5 计划里写过的测试要求，目前没有覆盖

## BUG

- 2026-09-28 【bug】聊天输入有序列表时起始编号不是 1(如 "3. xxxxx"),历史里显示成 "1. xxxx"
  - 复现:发消息时输入 "3. xxxxx"
  - 现象:历史消息显示为 "1. xxxx";用户怀疑是 markdown 格式化问题
  - 期望:编号按用户输入原样显示("3. xxxxx")
- 2026-09-28 【bug】滚动聊天记录视图抖动/跳动(手机上明显),难以上下翻查
  - 复现:滚动历史记录,手机(触屏)上尤其明显
  - 现象:滚动时视图抖动,甚至反复停留跳动在同一个位置
  - 期望:滚动平滑稳定,能正常翻查历史记录
- 2026-09-28 【bug】CLAUDE_CODE_MAX_CONTEXT_TOKENS 未生效:"glm-5.3-flash[1m]" 实际窗口与声明值不符,readout 仍显示声明值
  - 复现:用自定义模型 "glm-5.3-flash[1m]"(声明 1048576 context)跑 Claude Code
  - 现象:错误原文 — Claude Code is running "glm-5.3-flash[1m]" with a 1000000-token context window, not the 1048576 tokens this model declares. CLAUDE_CODE_MAX_CONTEXT_TOKENS was not honored — either the installed Claude Code is too old to know it, or Claude Code recognizes this model name and uses its own window. The context readout still shows the declared value.
  - 期望:readout 与实际窗口一致(或 CLAUDE_CODE_MAX_CONTEXT_TOKENS 生效);具体在哪一侧修,开工时定
- 2026-09-28 【bug】自定义模型的 Reasoning 选项排序混乱,且没有「默认档位」可选
  - 复现:打开自定义模型的 Reasoning 下拉
  - 现象:选项顺序混乱,如出现 Default / Low / Max / High;且无法为自定义模型指定「默认用哪一档」
  - 期望:选项按强度合理顺序排列;并支持指定默认 effort —— 即本次给内置模型加的能力(目录 `effort.default` + 运行时把 `'default'` 哨兵解析成它)也要适用于自定义模型,让其默认档位可配、可选
- 2026-09-28 【bug】antigravity provider 的 tool use 渲染不如 Claude Code 美观
  - 复现:用 antigravity provider 发消息,触发 tool use
  - 现象:tool use 的渲染效果不太美观,与 Claude Code provider 的不一致
  - 期望:对齐 Claude Code provider 的 tool use 渲染效果
- 2026-09-30 【bug】上下文压缩后,似乎无法对压缩之前的对话 Edit and resend
  - 复现:发生一次上下文压缩后,对压缩之前的消息点 Edit and resend
  - 现象:待补 —— 用户说「好像不能」,具体表现/报错尚未确认,开工时查
  - 期望:压缩前的消息仍能被 Edit and resend(行为与压缩前一致)
- 2026-09-30 【bug】上下文压缩后,聊天框里的上下文数量没刷新
  - 复现:发生一次上下文压缩后,看聊天框显示的上下文占用数量
  - 现象:数量还是压缩前的值,没跟着压缩结果更新
  - 期望:压缩后上下文数量刷新为当前实际值
- 2026-10-09 【bug】后端下线/网络中断时前端仍能提交提示词,界面一直显示「工作中」但其实没提交
  - 复现:断开网络或把后端停掉,在前端聊天框里发送提示词
  - 现象:提示词照样能发出去,界面一直停在「工作中」状态;实际并没有提交成功,用户看不出是失败了
  - 期望:检测到网络中断/后端不可达时给出明确提示或状态指示(如「连接已断开」「后端不可达」),不要让界面停在假的「工作中」;并说明重连后如何处理那条消息
  - 待补:WebSocket 断线时的表现(是否有重连、是否静默失败)尚未确认,开工时查
- 2026-10-04 【bug】外部删除 session 后,claude 侧同步清除但 agy(antigravity)侧没清
  - 复现:在 CloudCLI 外(原生 CLI/文件)删除一个 antigravity session,回 UI 看同步结果
  - 现象:claude 的 session 同步后清掉了,agy 的还在
  - 期望:外部删除后 agy session 也被清除,与 claude 行为一致
- 2026-10-18 【bug】定时消息到点时若会话有后台任务,消息可能被静默丢弃(显示已发送但未送达)
  - 复现:会话里有后台任务在跑(如后台 Bash、子代理),且定时消息的设置(model / effort 等)与该会话持有的进程不一致,到点发送
  - 现象:消息没有送达;定时列表里该条显示「已发送」;界面没有任何提示。v1.37.5 合并(73721fdb)引入,dev 上同样场景能送达
  - 期望:到点时有后台任务也要送达,或明确告知没送达(标记失败并通知用户);具体怎么做开工时定
