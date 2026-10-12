# sync/v1.37.4 · 09 code review（合并落点）核验

日期：2026-10-12。STEM `2610120937-claudecodeui-review`。
**审的对象**：`sync/v1.37.4` 上未提交的合并改动（39 个冲突文件去掉 package-lock）。
**方式**：② 合一份（每家跑一次，prompt 含 Standards + Spec 两轴），
3 家 = `sub-opus` / `sub-sonnet` / `sub-fable`。**diff 限定 40 冲突 + 定制触点**（用户指定）。
材料：`work/review-diff.txt`（454KB / 10043 行）+ `06-grill-decisions.md` v6 作 Spec 标准。

## 已核验条目

### R1 · 四条红线 —— **两家独立确认全部落实** ✅

| 红线 | opus 证据 | fable 证据 |
|---|---|---|
| 1 · ledger 改名 | `snapshotSource`(`claude-runtime.provider.js:1431`)、模块级 `backgroundWork`(`:1180`) 不再遮蔽 | ✅ `diff:1431` |
| 2 · 快照 key 用 `summary.id` | `claude-background-work.ts:78-81`，id 不符时 `console.warn`(`:102-108`) | ✅ `:80 task?.id` |
| 3 · 迁移顺序 | `migrations.ts:800-806` = add→copy→widen→DROP，两段都有守卫 | ✅ **验得更细**：widen 早退时 DROP 仍跑、全新库跳过、INSERT 列数匹配 |
| 4 · `createQuery` 只取缝 | `:1456`，未带 `releasePromptStream = heldPrompt.release` | ✅ |

**fable 额外确认的边界**（主会话未验）：
- `copyProviderModelEffortLevels` 有 `AND effort_values IS NULL` ✅
- DROP 有 `columnNames.includes` 守卫 ✅
- `readStoredEffort` 在 `effort_default ∉ values` 时丢弃 default（数据自愈）✅

### R2 · `finally` 第三个条件恒 false —— **两家分歧：must-fix vs advice**

**问题**：`claude-runtime.provider.js:1645`
```js
if (!inputReleased && (heldForBackgroundWork || backgroundWork.hasOutstanding(sessionKey())))
```
`removeSession`(`:431-438`) 按 V12 加了 `backgroundWork.clear(sessionId)`(`:434`)；
而两条主路径（正常 `:1564` / catch `:1596`）进 `finally` 前**都已跑 `removeSession`**
→ **第三个条件恒 false**。

| 家 | 判定 | 理由 |
|---|---|---|
| `sub-opus` | **must-fix** | 后果不止注释过时：**result 还没来就抛错的窄窗**（SDK 断连于 turn 中途）里 `heldForBackgroundWork` 仍 false、tracker 已空 → stdin 被关 → **那轮启动的后台任务被杀**。正是这段 `!inputReleased` 保护当初要挡的事故。单测测不到（现有 'an SDK error mid-hold' 走的是 result 之后的 hold，那时 `heldForBackgroundWork` 已为真） |
| `sub-fable` | **advice** | "不是违反方案，是**方案本身的形态**；`heldForBackgroundWork` 覆盖保护；注释误导但无害" |

**主会话核验**：
- `sed -n '1636,1650p'` → 注释 `:1640-1644` 写"`heldForBackgroundWork` matters as much as the
  tracker here… asking the tracker alone would tear down exactly the work the hold exists to protect"
  —— **与代码不符**（tracker 那一半恒 false）
- `removeSession`(`:431-438`) 的 `backgroundWork.clear(sessionId)`(`:434`) 确认在位
- **主会话倾向 opus**：fable 说"`heldForBackgroundWork` 覆盖保护"，但窄窗里它**还是 false**；
  两个条件是"或"，缺一个就漏
- **两家一致的关键点**：**方案 W13 钦定了这个形态，施工方没做错** —— 是**方案的缺陷**，
  且**注释是主会话写方案时的原话**（当时误以为 tracker 那一半在工作）

**处置待定（须用户决策）**：
- (a) 修注释 + 接受窄窗（最小改动）
- (b) 让第三个条件真正工作：把 `removeSession` 的 `clear` 挪到只在真正结束时做，
  或 `finally` 里先取一次快照值再 `removeSession`
- (c) 不动（方案钦定形态）

### R3 · `hasSnapshot` 死代码 —— **成立（opus）**

- 核验：`grep -rn hasSnapshot server/ src/` → 只有 `claude-background-work.ts:20`（类型声明）
  与 `:111`（实现），**全仓零调用**（fixtures 里的命中是无关 ndjson 内容）
- N1 之后 accessor 已改名为 `snapshotOutstanding`，`hasSnapshot` 无消费者
- **advice**：留着会让下一个人以为快照有"读到过"与"还有活"两种读法

### R4 · i18n 三语言缺 key —— **成立但降级为 advice**

- 核验（python 逐个解析）：`cs` / `pt-BR` / `he` 的 `claudeStatus.backgroundWork` 是**字符串**
  （上游形态），**没有** `backgroundHold`；`backgroundTask` 都有
- fork 代码读的是 `backgroundHold.label` / `.stop` / `.stopHint`
  （`ActivityIndicator.tsx:118/136/138`），**都带 `defaultValue` 兜底**
- **降级理由**：有 `defaultValue` → cs 用户看到英文兜底文案，**不会显示 key 字面量**
- 只改了 `en` / `zh-CN`（fork 的两个语言）

### R5 · 其他 advice（未逐条核验，低风险）

- `agent.routes.ts:388`：`normalizeProjectPath(...) !== finalProjectPath` 纯字符串比较，
  Windows 大小写/斜杠差异可能误判（opus **自己说不确定** `normalizeProjectPath` 是否归一化大小写）
- `sessions.service.ts:3520-3545`：`Math.min(...tasks.map(...))` 无空数组守卫 →
  空时得 `Infinity`（当前 tracker 不会返回空集合，将来别的 provider 会触发）
- `provider-capabilities.service.ts:27` 与 `:44`：`supportsEffort` 与 `effortLevels`
  两个字段表达同一件事（实施者偏离方案"整字段替换"的判断是对的 —— 前端仍读 `supportsEffort`）
- effort 默认值只对 Claude 推导（`provider-models.service.ts:317`）——
  方案 §2 原本是全 provider 派生；实施者缩小到 Claude 是因为其他 provider 推导会与上游测试冲突
- `claude-background-work.test.ts`：fork 的 `'bg-fallback-task-bg'`（名为 `Task` 的工具）与
  `'bg-fallback-monitor'` 两条用例被删 —— V7 说过白名单与 fork 的 `['Bash','Agent','Task']`
  语义相反、**不是等价替换**，删掉后"名为 `Task` 的工具在无 hooks 降级路径下不再 hold"
  没有测试钉住

### R6 · 实施者自报 9 条不确定处 —— opus 逐条判断（全部认可）

1/3/4（i18n 改名、`MarkdownImage` 包装、`modelLabel` 双留）：做法都对
2（`isProcessing` 排除 `background`）：对，是"后台任务不挡 composer"在信号层的落点，也保住 #31
5（`supportsEffort` 并存）：偏离方案但合理（前端仍读它）
6（effort 默认只推 Claude）：可接受，但要知道 codex/opencode 的自定义模型 default 不解析
7（上游重构适配）：`useSlashCommands` → `useProjectSlashCommands`，`dedupeProviderSkills`
  增益未丢；`taskStatus → taskNotificationStatus` 两处成对改名无遗漏；agy 分支在
8（`finally` 第三条件）：怀疑成立 → R2
9（去掉 carried hold）：**对，且去掉是对的** —— tracker 与 `backgroundWorkPending` 覆盖同一场景

### R7 · `sub-fable` 完整报告（已交文件）

**判定：0 must-fix，7 条 advice。四条红线全部复核通过。**

它做了一次**全量逐项复核**（比另两家更细），确认落实的项包括：
`holdForTurn` 真 OR 两分支都含快照(`:1586-1588`) · 早释放 hunk 含 `turnInFlight` 守卫且 `observe` 在判定前(`:1520-1545`) ·
notify 门用同一布尔(`:1605`) · `turnInFlight` 读 SDK 原始 `parent_tool_use_id`、`tryAccept` 手动置 true、
result 清零(`:1499/:1517/:1565`) · `:942` 维持 `releaseInput` 直调、**`releaseHeldSession` grep 零命中** ·
task 判定三件套/`outstandingReason`/`endedMidToolCall` 全无残留 · `sessionHistoryCache` 接线齐 ·
D2 建表并集/repository 5 处/两列排最后/新校验两处接上 · D3 上游块替换旧分支 + `appendCompactionRow` 在 switch 前 +
`compact`/`isCompactBoundary` 互斥并存 + 测试改 `.compact` · D4 scheduled-messages 测试改写为 fork 断言 ·
G3 具名 false 常量 + `backgroundHold` 新名 + 测试断言 confirm 零调用 · **cron 快照用例（`bg-cron`/`bg-stopped-cron`）保留** ·
`taskStatus→taskNotificationStatus` 无残留 · **carried hold 已无** · 上游重构适配正常

**fable 独家 advice（已核验）**：
- `useChatComposerState.ts:915`：弹窗注释块仍按上游语义写，紧贴恒假守卫 → 后人可能"修"守卫让弹窗复活
- `ChatInterface.tsx:499`：`turnInFlight: Boolean(sessionActivity)` —— 上游 background 条目使其为真，
  变量名与 `indicatorVisibility` 注释的"turn-in-flight 单独信号"不符。**效果正确**，但后人可能据名改成
  排除 background 导致后台条消失（**主会话已核实**：`:499` 确实这么写）
- `modelLabel.ts:77`：`ANSWERING_MODEL_FAMILIES` 宽松 `includes` + 含 `fable`，
  与 `MODEL_FAMILY_LABELS` 的严格 `claude-` 前缀匹配**两套语义**（**主会话已核实**）
- `provider-capabilities.service.ts:158`：`opencode.supportsMessageEditing` 为 `true`，
  与 06 D5"仍为 false"字面不符 —— **它自己指出**：HEAD(`ac05aeb5`) 本来就是 true（#27 的改动），
  diff 无此行变更，**D5 指的是上游的值**（上游仍 false）

**fable 的「最担心」（与 opus 殊途同归）**：
"finally 的 tracker 条件恒 false 意味着异常路径的后台保护**完全依赖 `heldForBackgroundWork` 这一布尔**，
而它是内存态、随 run 闭包销毁…**整个 D1 保护链里没有任何持久化或测试能证明'异常时进程真的被 hold 住'**
（验收 W6 只覆盖正常路径，单测 mock 不调 hooks）。哪天有人动了 `heldForBackgroundWork` 的置位/清零顺序，
后台任务会在异常时被静默杀掉，**且所有现有测试照样全绿**。
建议给 finally 的 hold 分支补一条**直接断言 `heldForBackgroundWork`** 的用例，而不是只测 tracker。"

→ **两家分歧收敛为**：opus 说"窄窗里 `heldForBackgroundWork` 还是 false → 任务会被杀"（must-fix）；
fable 说"形态是方案钦定的、不算违规，但**测试覆盖为零**"（advice + 补测试建议）。
**两家的共同结论**：这个条件的**保护能力被高估了**，且**没有测试兜住**。

### R8 · `assertEffortLevelsSupported` 是不是上游函数 —— **fable 的担心不成立（主会话已核）**

fable 原话："`assertEffortLevelsSupported` 为本地新建而非'上游函数'，与 06 X5'替换为上游'字面不符…
请实施者确认上游有无该函数"。

核验：
- 上游 `provider-models.service.ts:102` **有定义**，`:207`/`:235` **有调用**
- fork 当前 `:121` 定义，`:226`/`:254` 调用（行号偏移是合并后文件变长的正常结果）
- **函数名、签名、调用点数量一致** → **X5 已落实**（用的是上游那个函数）

### R9 · 其他 advice（fable 补充）

### R10 · `agy-g38f` 结果 —— **发现"SDK error"测试组被整组删除（本次最重）**

**agy 判定：2 条 must-fix（都是 `finally` 那条链）+ 8 条 advice。**

**must-fix ②（主会话已独立核实，证据链完整）**：
`server/modules/providers/tests/claude-background-work.test.ts` 里，
**fork 原有的"SDK error"子测试组（dev 分支 `:334-378` 共 4 条）全部被删**：

| dev 上的测试 | 现状 |
|---|---|
| `an SDK error mid-hold does not kill outstanding background work`(`:334`) | ❌ 已删 |
| **`an SDK error before any Stop hook still protects a backgrounded Bash`**(`:348`) | ❌ **已删（agy 点名）** |
| `an SDK error mid-hold does not kill work the fallback is holding`(`:361`) | ❌ 已删 |
| `an SDK error with nothing outstanding still releases the process`(`:378`) | ❌ 已删 |

核验命令与结果：
- `grep -rn "an SDK error before any Stop hook" server/` → **零命中**
- `grep -c "^test(" 当前文件` → 19 条，`grep -i error/throw` → **零命中**
- `git show 6ef663ba:...claude-background-work.test.ts | grep "t.test("` → dev 上确有此组

**为什么被删（实施者自述）**："上游的单测全收；fork 的快照用例改走 `createQuery` 缝驱动；
**删掉了只测已退役 task 判定的用例**" —— 它把这组**误判**为"只测已退役的 task 判定"。
**实际上这 4 条测的是 `finally` 的 hold 保护（`!inputReleased`）+ "result 前抛错"窄窗**，
与 task 判定无关。

**后果（与 R2 是同一件事的两面）**：
- `finally` 第三条件恒 false（R2）→ 该窄窗只剩 `heldForBackgroundWork` 一个来源
- 而该窄窗里 `heldForBackgroundWork` **尚未置 true** → **后台任务被静默杀死**
- **唯一守护此场景的测试被删 → 缺陷在所有自动化测试中隐形**

**三家交叉印证**：
- `sub-opus` R2 判 must-fix（窄窗里任务被杀）
- `sub-fable` 判 advice，但"最担心"是"**异常路径保护测试覆盖为零**"
- `agy-g38f` 判 2 条 must-fix，并**找到被删的就是守护测试** → 解释了"为什么测不出来"

### R11 · agy 的其他 advice（与另两家重叠，已核）

`hasSnapshot` 死代码 · `Math.min` 空数组 → `Infinity`（**agy 补充**：序列化成 JSON 变 `null`，
破坏数字类型契约）· `useChatComposerState.ts:915` 注释反向 · `ChatInterface.tsx:499` 语义失真 ·
i18n 三语言缺 key（有 `defaultValue` 兜底）· `modelLabel.ts:101` 宽松 `includes` ·
effort 默认只推 Claude · `supportsEffort`/`effortLevels` 双字段

## 修复（2026-10-12，用户选 A）

### 步骤 2（先验证诊断）：恢复被删的测试 → **它红了 → 诊断确认**

**主会话修正了自己的一次误判**：先前用 `grep -c "^test("` 数出"19 条、4 条 SDK error 全删"是**错的** ——
该文件用嵌套 `await t.test(...)`，`^test(` 只匹配顶层。**准确结论**：

- 当前 **17 条 `t.test`**，其中 SDK error **还剩 3 条**
  （`:543` mid-hold / `:557` fallback / `:574` clean）
- **只有 1 条被删**：`an SDK error before any Stop hook still protects a backgrounded Bash`
  → **agy 报的 must-fix ② 准确**（它说的是这一条）

**用新夹具（`startTurn` / `FakeQuery` / `live.emit` / `live.fail`）重写回来**，
放在 `:557` 之前 → **跑出红灯**：
```
not ok 11 - an SDK error before any Stop hook still protects a backgrounded Bash
  expected: false   ← 期望 stdin 不关
  actual: true      ← 实际关了
```

**这同时证明了三件事**：
1. 该测试确实被删（agy 对）
2. 删它的真实原因**不是**"只测已退役的 task 判定"（实施者自述），而是**它在合并后真的会失败**
3. **`finally` 的守卫漏了 `backgroundWorkPending`** —— 主会话的诊断正确

### 根因（比 opus/agy 的描述更精确）

**不是**"`hasOutstanding` 恒 false"这么简单 —— 是 **`finally` 的条件清单漏了一项**：

- 旧 ledger 用 `outstandingReason()` 返回 `'snapshot' | 'observed-start' | null`，**一个函数涵盖三者**
- 新代码把它拆成 `heldForBackgroundWork || hasOutstanding` 时**漏掉了 `backgroundWorkPending`**
- `backgroundWorkPending` 在 `:1439` 由 `startsBackgroundWork(message)` 置位，
  **只在 result 分支(`:1508`)参与 `holdForTurn`，`finally` 里根本没读**
- → "观测到后台启动、快照尚未到达"的窗口里抛错（无 result）→ 两个条件都 false → **关 stdin → 任务被杀**

### 修复

`claude-runtime.provider.js:1645`：
```js
// 原来
if (!inputReleased && (heldForBackgroundWork || backgroundWork.hasOutstanding(sessionKey()))) {
// 现在（加第三项 + 注释改写成实话）
if (
  !inputReleased
  && (heldForBackgroundWork || backgroundWorkPending || backgroundWork.hasOutstanding(sessionKey()))
) {
```
注释重写：说明**三个信号各覆盖不同的窗口**（跨 turn 的 held / 快照未到时的 observed-start / 更早 turn 留下的工作），
而不是原来那句"tracker 与 held 同等重要"（与代码不符）。

### 验证（主会话独立跑）

| 测试 | 结果 |
|---|---|
| `claude-background-work.test.ts`（含恢复的那条） | **37/37 绿** |
| `claude-runtime-hold.test.ts` | 6/6 绿 |
| `claude-subagent-survival.test.ts` | 5/5 绿 |
| `claude-background-work-signal.test.ts` | 5/5 绿 |
| **`npm test` 全量** | **1033 pass / 25 fail** |
| → 25 条失败逐条核对 | **全在既有基线内**（11 `checkCredentials` + 2 `buildClaudeUserContent` + 3 `createProject` + 3 symlink + 1 POSIX 路径 + 1 per-turn 兼容 + 1 codex 版本 + 2 `agent.routes` 偶发） |
| → `agent.routes.test.ts` 单独跑 | **6/6 绿** → 确认那 2 条是并发偶发（CLAUDE.md 明列 "load-flaky (heavy rounds only)"） |

**零回归。**

## 三家汇总（code review 终版）

| 项 | opus | fable | agy | 主会话核验 |
|---|---|---|---|---|
| 四条红线 | ✅ | ✅ | ✅ | ✅ 全部落实 |
| **`finally` 第三条件恒 false** | **must-fix** | advice | **must-fix** | ✅ **成立** |
| **"SDK error"测试组被删** | 未报 | "测试覆盖为零" | **must-fix** | ✅ **成立（本次最重）** |
| `hasSnapshot` 死代码 | advice | — | advice | ✅ 成立 |
| i18n 三语言 | advice | — | advice | ✅ 成立（有 defaultValue，降级） |
| `agent.routes.ts` 路径比较 | advice(不确定) | — | — | ❌ **丢弃**（`normalizeProjectPath` 本就 lowercase） |
| `Math.min` 空数组 | advice | — | advice | ✅ 成立但当前不触发 |
| `Task` fallback 用例被删 | advice | — | — | ✅ 成立（`Task` 是旧名） |
| `assertEffortLevelsSupported` | — | 担心 | — | ❌ **fable 担心不成立**（确是上游函数） |
| `ChatInterface:499` 命名 | — | advice | advice | ✅ 成立 |
| `modelLabel` 两套匹配 | — | advice | advice | ✅ 成立 |
| effort 默认只推 Claude | advice | — | advice | ✅ 成立（实施者有意为之） |
| `supportsEffort` 双字段 | advice | — | advice | ✅ 成立（前端仍读） |

**共识 must-fix（2/3 家 + 主会话核实）：2 条，实为同一件事**
1. `finally` 第三个条件恒 false（`:1645` × `removeSession:434`）
2. 守护该场景的 4 条测试被删（`claude-background-work.test.ts`）

**两家一致的关键判断**：**方案 W13 钦定了这个形态 → 施工方没做错 → 是方案缺陷**
