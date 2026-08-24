# v15 设计记录：能力形态升级（上下文注入 → 工具化查证）

> 状态：**设计讨论记录（非定稿）**。本文件是 2026-08-24 多轮设计讨论的备忘，
> 结论大多为方向性决定，细节（schema、阈值、门控信号、指标）均为**开放问题**，
> 见 §7 清单，后续逐项细化后再升格为实现规格。
> 目标版本：ref-lib v15（能力形态升级；v14 性能与体验先行，见 §8）。
> 上游依据：`docs/插件能力可行性与收益分析报告.md`（S1 检索工具 / S2 查证强制 /
> S3 继承策略 / S4 preset 感知 / S5 探测 TTL）。

## 1. 产品目的与终态定义（先定目标，再拆步骤）

### 1.1 参考库最初目的（2026-08-24 讨论确认，产品定义的源头）

1. **内部资料**（网上没有）→ AI 从对话内容**快速识别**对应参考库，避免盲找/瞎猜
   浪费 token。识别可靠性是核心诉求。
2. **本地资料**（网上有但本地更快更省，web search 单独计费）→ 本地 grep 命中即走；
   **未命中要可靠退回** web search 或向用户提问。
3. **北极星**（用户不提"参考 xxx"也自动按规范开发）→ 从任务内容自动识别涉及哪些
   参考库并按库内规范执行。

**现状差距的重新归因（CSS 案例）**：dsh 插件开发时 CSS 未按规范——"抽签"由三个
环节叠加造成：①**识别**（模型靠提示词+note 判断"该不该查"，概率）；②**检索**
（库是整个 harness 仓库，模型不知道 UI 规范在哪个子目录，几千文件 grep 无头绪而
放弃）；③**服从**（查到也未必照做）。三者分别对应识别层 / 检索层 / 强制层。

### 1.2 识别层设计（2026-08-24 定稿：**挂载即识别**；cwd/映射方案已废弃）

**核心原则：会话挂载即识别——用户显式 add 的目录就是本会话的域；识别环节绝不用
LLM；不做语义索引。**

**2026-08-24 实测修订**：初版实现把 cwd 自动匹配当作"注入开关"（命中才注入），
实测暴露两个问题后废弃：
1. 用户挂库但 cwd 与库无包含关系 → 整轮零注入（政策/清单/nudge 全丢），模型只能
   靠 catalog 自己发现——糟糕体验；
2. 改为"挂载即注入"后，cwd/映射降级为"清单排序"——经评估排序价值有限（单库无感、
   多库时 note 已表达用途、模型反正能看到全部清单），**整个 cwd 自动匹配 + 映射表
   （方案 a+c）移除**。

**最终识别模型**：

| 信号 | 内容 | 确定性 |
|---|---|---|
| 会话挂载（唯一识别机制） | 用户 add 的目录即本会话的域；有可用挂载库 → 注入政策 + 全部库清单（注册顺序） | 确定性 |
| 显式提及 | 用户说"参考 xxx"（模型据此调工具，无需系统识别） | 确定性 |
| 对话语义推断 | 无信号时的猜测 | **明确不做** |

**保留的设计红线**（不变）：
- **识别环节绝不用 LLM**（LLM 识别 = 把抽签提前 + 浪费 token）；LLM 只出现在
  "用不用、怎么用"的低成本决策上。
- **不做语义索引**（embedding/向量检索 = 滑向 RAG/memory）。轻量索引上限：
  文件名/README 标题/note 倒排（KB 级、构建一次、TTL），是索引不是 memory。
  memory 的定义是"自动积累、系统自治"；ref-lib 是"用户手动挂载的权威源 +
  挂载注入 + 字面检索"，三者均手动可控。若真需要语义检索，那是另一个产品。

**承认边界**：未挂载任何库的会话 → 零注入（模型不知道有参考库机制，工具仍注册可
被调用——模型因对话中出现库内特有名词而自行调工具是唯一自发路径）；"任务→库"
的自动关联（北极星目的 3）留待未来（v17 S11 全局默认库/自动挂载，届时可引入
workspace→库 映射配置）。

**职责分工总表**：

| 环节 | 谁做 | 确定性 |
|---|---|---|
| 识别（该不该有库、哪些库） | 系统：会话挂载（用户 add） | 确定性 |
| 检索（具体内容在哪） | 模型调 `reference_lookup`（字面匹配 + 质量排序，代码场景有效） | 模型决策，目标明确 |
| 强制（查了没有） | 覆盖检查 | 确定性 |

**最终目标不是"用工具"（手段），而是三个可验收的行为目标：**

1. **查证可强制**：参考库查证从"模型服从提示词"变成"运行时可感知、可拦截、可审计"
   的动作——未查证时系统能感知并显式提示，而非依赖 MUST/ALWAYS 措辞。
2. **查证可伸缩**：大库（数千文件）查证开销可控——检索是结构化工具调用（schema、
   结果截断、超时、TTL），不是模型自由 grep 探索。
3. **查证成本可接受**：注入 token 常量级（不随库数线性增长），热路径无同步 stat。

**终态形态：三件套，不是"纯工具"——"不依赖提示词"≠"零提示词"。**

| 组成 | 终态内容 | 取代现状 |
|---|---|---|
| 能力（工具） | `reference_lookup`：schema 只收库 id + query，返回**匹配片段**；空 query 返回库目录（catalog，限 top-N，不计入查证动作） | 注入的"路径清单 + 模型自由读取" |
| 政策（提示词） | 保留**常量级**规则段：查证义务、权威性优先、冲突处理、外部来源自报——只留行为规范，不再列路径清单 | 现状约 90 行定稿英文模板（`render.ts` REF_LIB_TEMPLATE） |
| 强制（运行时） | 覆盖检查：本轮相关但未发生任何查证动作时，至多一次轻提示（lenient 骑乘 / strict 唤醒） | MUST/ALWAYS 软约束 |

**职责分离原则**：检索能力搬进工具（可强制、可观测）；行为规范保留在提示词（模型
只能从文字获得"何时查、谁优先"这类准则）；路径清单移出 prompt，由工具 catalog 按需
提供（§7-1 待拍板）。

## 2. agent loop 设计（顶层会话）

### 2.1 介入点总览

```
用户输入
  │
  ▼
① 轮次开始 ── 轮次状态按 sessionId:turn 键控（无需显式复位；turn/start 非总线事件）
  │
  ▼
② 组装提示词（systemPrompt.context 同步回调）
     · 识别信号（cwd/挂载/显式）→ 命中则注入"相关库：X（note）"
     · lenient nudge 在此回调内追加（识别命中 && 本轮未查证 && 未 nudge）
     · 注入瘦身政策（常量）｜TTL 探测｜极简模式：注入面被 persona complete 天然抑制
  │
  ▼
③ agent/pre-step（waterfall，只观察不干预）
     推进轮次状态（session/event 观察 step/start 记账）｜不做 inject
  │
  ▼
④ 模型请求 → 模型决定
      ├─ 调 reference_lookup → ⑤ tools/result 置 queried=true（冻结结果：snippet/No matches）
      └─ 直接答
  │
  ▼
⑥ 覆盖检查触发
     lenient：text() 回调内追加（天然进本次请求，零新通道、无滞留）
     strict ：agent/turn-stopping 里 steer 唤醒，强制再跑一步查证
```

### 2.2 分环节要点

- **① 轮次状态**：进程内 `Map<sessionId:turn, TurnState>`——`sessionId:turn` 键控，
  **无需显式监听 turn/start 复位**：`turn/start` 只是持久会话事件（`SessionEventMap`
  类型），不是 cordis 总线事件，`ctx.on('turn/start')` 会 typecheck 失败；`pre-step`
  payload 自带 `turn` 号（`agent-loop/src/agent.ts:235`），键控即自然隔离轮次，
  连 `session/event` 监听都不需要。按 session 隔离，并行子 agent 无竞态。
- **② 组装**：`text()` 同步回调（`src/index.ts` L141–150 现状）；终态产**常量政策 +
  识别命中注入 + lenient nudge（见 ③⑥）**。识别信号在回调内即可读取：
  `context.agent.session.header.cwd`（确定性、零额外 IO）；命中（cwd/挂载/显式）→
  注入"相关库：X（note）"，未命中 → 不注入。探测结果走 TTL（S5），**TTL 缓存按
  路径跨 session 共享**。**极简模式注入面由框架天然抑制**（persona `complete: true`，
  组装后仅保留 persona 段），S4 的"返回空串"是防御性双保险。
- **③⑥ lenient 覆盖检查（2026-08-24 评审后修正，不走 pre-step inject）**：
  `preStep()` 顺序是 `inbox.claim → systemPrompt.assemble → pre-step waterfall`
  （`agent-loop/src/agent.ts:229-235`）——组装在前，pre-step 里 `inject()` 注定进不了
  本步请求；且末步 inject 会滞留 inbox 污染后续无关唤醒（`inject()` 无撤回 API）。
  **改在 `text()` 回调内追加 nudge**：判断"识别命中 && 本轮未查证 && 未 nudge"后
  在自己的贡献文本里追加一段轻提示——同步执行、零新通道、天然进本次请求、无滞留。
  注意 `AssembleContext` 拿不到 turn 号（`assembleContextFor` 只塞 agent/scope/
  signal），TurnState 的推进由 `session/event`（`step/start` 过滤）或 pre-step 观察
  记账，text() 只消费状态。**识别未命中 → 整轮零干预（防浪费第一道闸）**。
- **④ 工具**：`reference_lookup` 注册进 `ctx.tools`，schema 白名单进组装；执行体复用
  `dsh-tool-fs-search` 的 `runRipgrep/resolveRgPath`（或 v15a 先复用整工具，见 §8）；
  参数只收库 id + query（路径围栏天然成立）；`maxResults≤10`、snippet 截断、超时。
- **⑤ 记账**：监听 `tools/result`：reference_lookup（v15a 阶段含 grep/glob + 库路径
  前缀命中）→ 置 queried=true。这是"已查证"的唯一事实来源。
- **⑥ 覆盖检查双策略**：

  | | lenient（默认） | strict（per-library 显式开启） |
  |---|---|---|
  | 触发点 | `text()` 回调（每次组装同步执行） | `agent/turn-stopping` |
  | 动作 | 贡献文本内追加 nudge（天然进本次请求） | `agent.steer(nudge)` 唤醒再跑一步 |
  | 触发条件 | 识别命中 && !queried && !nudged | 同左 |
  | 成本 | 0 次额外请求（随本次请求附带，每轮至多一次） | 至多 1 次请求/轮 |
  | 防死循环 | — | nudged 标记：每轮至多一次，查完/拒绝后不再触发 |

  > 已核验：`agent/turn-stopping` 为 serial，监听器 `steer()` 后机器重读 inbox
  > 再跑一步（官方"强制继续"通道）；pre-step 里 `inject()` 进不了本步（组装在前，
  > 见 §6-18），故 lenient 改走 `text()` 回调。
- **⑦ 降级路径**：not-found 是**常规路径**——工具空结果返回一行 "No matches for X"，
  模型直接退回记忆/外网；插件不再介入。

### 2.3 防浪费对照表

| 担心 | 拦截环节 | 机制 |
|---|---|---|
| 每次每步都查 | ②识别未命中零干预 + ⑥频率预算 | 环境信号未命中 → 整轮静默；命中才管 + 每轮 ≤1 次 |
| 拉全量目录应付 | ④工具 schema | 空 query 不计入查证，catalog 限 top-N |
| 查不到反复查 | ⑦降级 + ⑥nudged | 空结果一行话；每轮一次后不再触发 |
| 强制拖死循环 | ⑥双策略 | lenient 零唤醒；strict 唤醒一次且必终结 |
| 无关任务被干预 | ②识别未命中零干预 | 环境信号未命中 → 整轮静默，无 nudge |

### 2.4 逃逸机制（预算三层，2026-08-24 新增）

**原则：任何强制/检查机制都必须有"正常结束"的逃逸路径——预算耗尽即放行，绝不卡死、绝不无限循环。**

| 层 | 预算 | 超限行为 | 防什么 |
|---|---|---|---|
| 工具调用预算 | per-turn `reference_lookup` ≤3 次（可配） | 工具拒绝执行，返回"查证预算已用尽（本轮 N/3），建议直接作答或转 web" | 模型疯狂重试同一/无关查询 |
| strict steer 预算 | per-turn ≤1（nudged）+ per-session 强制轮 ≤2（可配） | 预算耗尽自动放行，降级为 lenient 行为 | 强制检查把轮次/会话拖死 |
| nudge 预算 | 每轮 ≤1 次（text() 追加） | 本轮不再追加 | 无（文本不阻塞、不唤醒，天然逃逸） |

- 实现：工具 `execute` 前查 TurnState 计数；steer 前查 nudged + per-session 计数；
  预算计算为纯函数（L0 可测）。
- 用户级逃逸：`Agent.cancel()` 是框架已有的用户打断通道，不依赖插件预算。
- **逃逸测试（L2 harness 边界，2026-08-24 新增）**：
  - 用例 1：模拟模型循环调 `reference_lookup` 超预算 → 第 4 次被拒，流程正常结束；
  - 用例 2：strict 模式模拟模型始终不查 → steer 一次（nudged）后放行，turn 正常结束；
    per-session 预算耗尽后不再 steer；
  - 用例 3：nudge 连续多轮 → 每轮至多一次，轮次正常结束；
  - 断言：无无限循环（预算上限 + 轮次推进）、无卡死、预算触发可观测（日志/事件）。

### 2.5 预算统计与调参闭环（2026-08-24 新增）

**目的**：预算默认值（工具 ≤3 / strict ≤2 / nudge ≤1）先定住，但**每个值都必须有
统计数据支撑后期调整**，不拍脑袋定死。

**统计指标**（每项对应一个可调参数）：

| 指标 | 含义 | 调什么 |
|---|---|---|
| 工具调用分布 | per-turn 调用次数直方图（0/1/2/3/超限） | 工具预算值（若大量 2–3 次 → ≤3 太紧） |
| 超限次数与场景 | 预算拒绝发生的位置（query 摘要） | 拒绝措辞 / 预算值 |
| **nudge→补查转化率** | nudged 轮次中后续发生查证的比例 | **最关键**：转化率低 → nudge 措辞无效或该升 strict |
| steer 触发与降级 | strict 触发次数、per-session 强制轮分布、降级 lenient 次数 | strict 预算与默认策略 |
| 预算触发率 × token 开销 | 触发率与 usage（§4.1）联动曲线 | 查证收益/成本比 |

**存储与导出**：
- 运行期：内存聚合（按 sessionId:turn 键控，随轮次推进结算）；
- 持久化：独立 JSONL（dsh home 下 ref-lib 目录，如 `budget-stats.jsonl`）——
  **绝不写会话日志**（v3 事故红线：白名单外事件拒读）；
- 导出：经 `/api/ref-lib/*` 路由（UI 面板可看）或直接读文件分析。

**配置与调参**：
- 预算值走 **plugin config**（`cordis.patch.yml` 可覆盖）：
  `budgets: { toolCallsPerTurn: 3, strictTurnsPerSession: 2, nudgePerTurn: 1 }`；
- 调参闭环：改配置 → 重启（node 改动需重启，AGENTS.md 约定）→ 重跑基准任务集
  （§4.1）→ 看统计 + token 对比 → 再调；后期可加 UI"预算设置"页（经 webServer 路由）。

## 3. subagent 职责划分（能力继承、强制收拢）

**原则：能力向下继承，强制向上收拢。** 强制检查只对顶层（主）会话生效；子 agent
默认只继承"能力"不继承"强制"。

| 会话类型 | 政策注入 | 库清单 | reference_lookup 工具 | 覆盖检查 |
|---|---|---|---|---|
| 顶层会话（主） | ✅ | ✅ | ✅ | ✅ |
| 子 agent（默认 inherit-lite） | ✅（一行） | ✅ | ✅ | ❌ |
| 子 agent（none 策略） | ❌ | ❌ | ❌（ToolRestriction deny） | ❌ |

依据：所有子 agent（spawn/fork/continuable，含 workflow 扇出）都带
`parentSession` + `origin:'subagent'`（`childSessionMeta()` 统一设置）→
`session/created` 全局钩子对每个子 agent 物化继承（现状）；若再叠加轮次内覆盖
检查，就是"双重强制 + 职责错位"（父已承担查证义务，子多为纯执行角色）。

**创建时种子告知（替代子 agent 侧强制）**：监听 `agent/created`，对
`origin:'subagent'` 会话自动 `agent.inject()` 一条指引（一行政策 + 库清单引用），
在**首轮之前**完成告知，100% 覆盖所有子 agent，不依赖父 agent 自觉
（`send_message` 只留给父 agent 传达任务级上下文，是补充通道）。注入消息以
owned `user/message` 写日志，符合"模型可见即已记录"。

**识别层对子 agent 同样生效**：子 agent 的 `header.cwd` 继承自父（childSessionMeta
透传），cwd→库映射命中 → 子 agent 组装时同样注入"相关库"；inherit-lite/none 策略
控制清单与工具可见性，识别注入只对已继承的库生效。

## 4. 版本路线（v15a 探针 → v15b 终态）

- **v15a（探针，非交付物）**：复用 `dsh-tool-fs-search` 的 grep/glob + ToolRestriction
  作用域化 + 覆盖检查记账（tools/result 观察）+ **遥测模块（token 对比）**。唯一目的：
  验证"模型在工具化形态下是否主动走查证路径 + 成本是否可控"，产出**行为数据**：
  - nudge 触发率（识别命中但未查证的轮次比例；目标低频）；
  - 无谓查询率（触发查证但结果未被使用的比例；目标低）；
  - **token 对比**（见下"token 用量对比测试"）。
  若采纳度差 → 问题在强制机制而非工具形态，v15b 前先做强 S2。
- **v15b（终态）**：专用 `reference_lookup`（库 id schema + snippet 返回）+ 规则瘦身 +
  覆盖检查定稿 + 子 agent 种子告知 + 逃逸预算（§2.4）。

### 4.1 token 用量对比测试（2026-08-24 新增）

**观测可行性已核验**：`assistant/message` 会话事件自带 `usage?: TokenUsage`
（`core/session/src/types.ts:277`，`{ inputTokens, outputTokens, cacheRead?,
reasoning? }`）——**token 用量随会话日志持久化**，可实时监听（`session/event`）也可
事后离线导出对比；另有官方 `ctx.tokenMeter` 服务（按会话聚合 + sessionProjections）。

**方法**：固定基准任务集 × 双形态对比。

| 项 | 内容 |
|---|---|
| 基准任务集 | 典型场景各若干条：①库命中应查证（"dsh 的 tools/pre-execute 事件签名"）②不相关不应查（"写首诗"）③复杂开发任务（CSS 案例类，如"给 dock 加胶囊"）④库内无答案应退回（"该查 web 的问题"） |
| 双形态 | 基线 = v13 形态（全量模板注入，无工具）；对照 = v15 形态（瘦身注入 + reference_lookup + 覆盖检查）。每任务各跑 N 次取均值（降随机性） |
| 指标 | 总 input/output/cache tokens（usage 汇总，持久化可导出）；注入 token（ref-lib 自控统计：政策+清单+nudge 字符数）；工具调用次数与结果 token；轮次数 |
| 观测实现 | v15a 遥测模块：监听 `session/event` 的 assistant/message 按 turn 聚合 usage；注入侧 text() 内自记字符数；输出 per-task 对比表 |
| 判定 | 对照形态在①③上的查证命中率提升可测、④上退回动作出现；总 token 相对基线不劣化（或劣化幅度小于查证收益）；注入 token 显著下降 |

**逃逸测试**（§2.4 三用例）与 token 观测回路均为 L2 harness 边界层测试
（真实 SessionStore 写→冷加载→断言），对齐 AGENTS.md 测试标准。

架构上专用工具几乎是必须的（非可选项），两个已核验的硬约束：
- `dsh-tool-fs-search` 文档声明返回路径**仅在 search root 与 workspace read root
  同域时**模型可 follow-up 读取；参考库在 workspace 外 → 通用 grep 返回的路径
  模型读不了，必须由工具直接返回片段；
- `ToolRestriction`（`allow/deny`）只能按**工具名**过滤，做不到路径级围栏；专用
  工具的库 id schema 天然锁死范围。

## 5. 与现有机制的承接关系

| 现状（v13） | v15 变化 |
|---|---|
| `reference-libs:policy` 注入完整模板 + 路径清单 | 注入瘦身政策（常量），清单移出（待定） |
| 无 tools 注册 | 注册 `reference_lookup`（v15a：先复用 grep/glob） |
| 无运行时强制 | 覆盖检查（lenient/strict 双策略） |
| `session/created` 继承物化（现状） | 保留 + 新增 `agent/created` 种子告知 |
| 每次注入 statSync 探测 | TTL 化（v14 S5 先行） |
| 极简模式照常注入 | preset 感知空串（S4） |

## 6. 已核验事实清单（2026-08-24，源码路径为核验时点）

| # | 事实 | 证据 |
|---|---|---|
| 1 | ref-lib 仅用 `systemPrompt.context`，无 tools 注册 | `src/index.ts` L141–150；全库 grep 无 tools 注册 |
| 2 | `text()` 为同步回调；`list()` → `refreshAvailability` → 逐条 statSync | `src/service.ts` L48 注释、L255–272 |
| 3 | 注入模板为固定英文常量（约 90 行） | `src/render.ts` REF_LIB_TEMPLATE L29–~120 |
| 4 | `agent/pre-step` waterfall（payload messages/turn/step/signal，可 reject/替换） | `packages/core/agent/src/runtime-types.ts` L231 |
| 5 | `agent/turn-stopping` serial；steer 后机器重读 inbox 再跑一步 | 同 L278 注释 |
| 6 | `Agent.inject()` 不唤醒、骑乘最近 step boundary；`Agent.steer()` 唤醒 | 同 L130–143 |
| 7 | `assembleContextFor(agent)` 同时携带 agent + scope | `packages/core/agent/src/dispatch.ts` L174–176 |
| 8 | 工具流水线（pre-execute/单调守卫/execute/post-execute/result）与 ToolRestriction（按工具名） | `packages/core/tools/src/index.ts` L152–197、L680–685 |
| 9 | 四种 preset（标准/PTC/极简/创造；目录 code/cordis/minimal/standard） | `apps/cli/config/agent-presets/*/preset.yml` |
| 10 | 框架内置 `dsh-tool-fs-search`（glob+grep，ripgrep 二进制，spawn 固定 argv，base bundle 内置） | `packages/fs/tool-fs-search/src/index.ts` |
| 11 | tool-fs-search 返回路径仅同域部署可 follow-up 读取 | 同上文档注释 |
| 12 | 所有子 agent 带 `parentSession` + `origin:'subagent'` | `packages/subagent/subagent/src/child-agent.ts` childSessionMeta |
| 13 | workflow fanout 经 `subagents.start()`（宿主进程可见 agent 事件） | `packages/workflow/workflow-worker-thread/src/host.ts` L352 |
| 14 | 创建序列：插入 → session/created + agent/created → agent/session-start → 启动 loop；session-start 官方种子注入时机 | `packages/core/agent/src/index.ts` L188；runtime-types L207–217 |
| 15 | `send_message` = `ctx.subagents.followup()` 模型层适配 | `packages/subagent/tool-subagent-control/src/index.ts` |
| 16 | cwd 是会话持久字段（`header.cwd`，sessionQuery 观测可得，ref-lib 已在用）；子 agent 透传父 cwd | `src/logic.ts` attachSessionMeta、`src/index.ts` L77；`packages/subagent/subagent/src/child-agent.ts` |
| 17 | 框架无"工具空结果自动退回另一工具"的编排层（单调守卫/pre·post-execute 是策略不是调度器）；`additionalContexts` 可把"未命中→建议下一步"确定性注入下一轮 | `packages/core/tools/src/index.ts` L598–600、L1585；`apps/cli/config/agent-presets/standard/agent.cordis.yml`（tool-web） |
| 18 | `turn/start` 无 cordis Events 声明（仅 `SessionEventMap` + `KNOWN_SESSION_EVENT_TYPES`）；session 总线事件仅 created/disposed/event/flush；`pre-step` payload 自带 turn | `core/session/src/types.ts` L243、`known-event-types.ts` L65、`core/session/src/index.ts` Events、`agent-loop/src/agent.ts` L235 |
| 19 | `preStep()` 顺序：inbox.claim → assemble（text() 在此执行）→ pre-step waterfall；turn-stopping 仅在 turnEnds && nextStep 空时触发 | `agent-loop/src/agent.ts` L229-235、L295-298 |
| 20 | `tools.restrict()` 在无 scope 上下文直接抛错（"would mask every agent"）；`Agent.ctx` 即 agent scoped context（贡献随 disposal unwind） | `core/tools/src/index.ts` L1072-1075；`core/agent/src/runtime-types.ts` L76 |
| 21 | 工具视图 global layer 是 inherited 的最远祖先：**全局注册工具对无 restriction 的任意 agent（含极简 preset）默认可见**；极简"双工具"靠 scope 链上只注册 bash/editor 实现，未屏蔽全局 | `core/tools/src/index.ts` view() L1152-1190；`apps/cli/config/agent-presets/minimal/agent.cordis.yml` |
| 22 | 极简 persona `complete: true` → 组装后仅保留 persona 段，context 注入文本被框架天然抑制 | `minimal/agent.cordis.yml`；`core/system-prompt/src/index.ts` L69-74 |
| 23 | `ToolExecution` 无 turn 字段（仅 callId/rootCallId/name/arguments/agent）→ queried 的轮次归属须由轮次推进记账结算 | `core/tools/src/index.ts` L307-325 |
| 24 | 官方 `ctx.tokenMeter` 服务：按会话聚合 usage + `tokenUsageProjection` / `contextPressureProjection` | `packages/llm/token-meter/src/index.ts` L82、L87 |
| 25 | `assistant/message` 会话事件带 `usage?: TokenUsage`（input/output/cacheRead/reasoning），**随日志持久化**——token 对比可实时监听亦可事后离线导出 | `packages/core/session/src/types.ts` L277、L269-271 |
| 26 | `llm/stream` 为 waterfall（可拦截流）；usage 延迟到 `[DONE]` sentinel | `packages/llm/llm/src/index.ts` L65；`llm-deepseek/src/translate.ts` L82、L106 |

## 7. 开放问题（待细致讨论，本次记录不拍板）

1. **终态下库清单去留**：prompt 保留每库一行（token 随库数线性）vs 完全移出由
   catalog 按需提供（恒定 token，代价是模型需主动查 catalog）——倾向后者，用 v15a
   数据验证。
2. **strict/lenient 默认值**：默认 lenient；strict 仅对显式标注库（如合规审计）开启
   ——per-library 策略位，复用 S3 的配置位。
3. **cwd→库映射的配置形态**：自动按 cwd 匹配已挂载库？per-session 显式关联？
   全局映射表（workspace → 库）？映射来源（用户配置 / README 目录名约定）？
4. **命中注入的形态与频率**：注入"库名+note"还是"命中片段"？命中后每轮都注入
   还是注入一次？与 `reference_lookup` 调用的衔接（注入后模型先调工具做具体检索）？
5. **显式提及探测**：对话中"参考 xxx"/库名出现时的识别（关键词匹配？）。
6. **reference_lookup schema 细节**：maxResults、snippet 长度、catalog top-N、
   超时/并发安全、presentCall/presentResult 卡片形态。
7. **外部驱动子 agent 边界**：ACP/codex/claude-code 的轮次不在宿主 loop 跑，
   覆盖检查对其不适用——需限定"仅宿主 loop 驱动 agent"并文档化。
8. **TTL 缓存粒度**：按路径跨 session 共享缓存的值（5s？）、失效条目的重新探测
   时机。
9. **v15a 具体形态**：ToolRestriction 按工具名 deny/allow 的粒度是否够用；grep/glob
   对库目录的路径参数如何约束（工具参数校验兜底）。
10. **子 agent 种子注入内容**：inherit-lite 一行政策的措辞、库清单引用形式
    （名称+note？路径？）、none 策略下工具 deny 的联动。
11. **探测/检索的失败语义**：库目录瞬断（网络挂载）时工具返回错误 vs 降级
    "unavailable"，与 v9 失效语义如何衔接。
12. **退回提示的触发**：not-found 时 additionalContexts 注入"未命中→可转 web/问
    用户"；strict 双轨检查（既未查参考库也未查 web 的事实性回答）的判定信号。
13. **极简模式工具面（2026-08-24 评审 P4）**：`reference_lookup` 全局注册对极简
    agent **默认可见**（§6-21）——S4 范围须从"注入面"扩到"注入面 + 工具面"：
    `agent/created` 时对极简 preset agent 调 `agent.ctx.tools.restrict({ deny:
    ['reference_lookup'] })`（§6-20 解法；preset 判断用 `agentPresets.composedPreset`）。
14. **轮次推进记账（2026-08-24 评审 P1/P2）**：queried 与 nudged 的轮次归属统一由
    `session/event`（`step/start` 过滤）或 pre-step 观察推进结算（`tools/result`
    的 exec 与 `AssembleContext` 均无 turn 号，§6-23）；text() 只消费状态。待
    v15a 确认记账时机的具体形态。
15. **逃逸预算默认值（2026-08-24 新增）**：默认已定（工具 per-turn ≤3、strict
    每会话 ≤2、nudge ≤1），配置面走 plugin config（§2.5）；**具体数值待统计
    （§2.5 指标）上线后按数据调整**，不先行拍死；拒绝措辞待定。
16. **基准任务集定义（2026-08-24 新增）**：4 类场景（命中应查/不相关不应查/复杂开发/
    库内无答案应退回）的题目清单、N 次采样数、对比口径（同会话 vs 不同会话、
    prompt 缓存对 cacheRead 的影响）——v15a 开工前定稿。

## 8. 路线与优先级（沿用报告的 v14→v17 骨架）

- **v14（先行，低风险）**：S5 探测 TTL、S8 目录选择器默认值、S6 模板折叠首版。
- **v15（本记录）**：v15a 探针 → v15b 终态。
- **v16+**：S3 继承策略（本记录的 subagent 职责划分落地）、S7 导入订阅、S10 标签/
   优先级、S11 全局默认库、S12 结构化输出。

## 变更记录

- 2026-08-24：初稿（设计讨论记录 #1）：终态定义、loop 设计、subagent 职责划分、
  种子告知、v15a/v15b 拆分、已核验事实清单、开放问题。
- 2026-08-24：#2 并入"最初目的"讨论——三点产品目的、CSS 案例三环节归因（识别/
  检索/服从）、**识别层设计**（环境信号三层：cwd/挂载/显式；识别环节绝不用 LLM；
  不做语义索引、不滑向 memory；承认无信号边界）、dsh 退回机制结论（框架无 fallback
  编排，插件用 additionalContexts + 双轨检查补偿）、开放问题扩至 12 项。
- 2026-08-24：#3 外部评审四问题全部核验成立并合入——P1（turn/start 非总线事件，
  改为 sessionId:turn 键控）、P2（pre-step inject 时序缺陷，lenient 改走 text() 回调
  追加）、P3（restrict 需 agent.ctx，`Agent.ctx` 即解法）、P4（极简模式工具面默认
  可见，S4 扩为注入面+工具面）；§6 事实清单扩至 23 条；开放问题扩至 14 项。
- 2026-08-24：#4 确认注入形态（方案 B：路径告知 + 工具化 + 覆盖检查兜底；catalog
  降级为 fallback，清单保留 prompt；映射 a+c）与端到端链路（add → 会话生命周期 →
  首次对话），并新增两项硬需求——**token 用量对比测试**（`assistant/message` usage
  持久化 + `ctx.tokenMeter` 可观测；基准任务集 × 双形态对比，§4.1）与**逃逸机制**
  （预算三层：工具每轮 ≤3 / strict 每会话 ≤2 / nudge 每轮 ≤1，超限放行不卡死；
  L2 三用例，§2.4）；§6 事实清单扩至 26 条；开放问题扩至 16 项。
- 2026-08-24：#5 逃逸默认值确认（≤3/≤2/≤1），新增 **§2.5 预算统计与调参闭环**——
  统计指标（工具调用分布、超限场景、**nudge→补查转化率**、steer 触发与降级、
  触发率×token 曲线）、存储（内存聚合 + 独立 JSONL，**绝不写会话日志**）、导出
  （webServer 路由/文件）、配置（plugin config `budgets`，后期按数据调参）。
- 2026-08-24：**实现完成（v15 首版落地）**——新模块 `src/identify.ts`（识别层
  cwd/映射 a+c）、`src/search.ts`（受限检索 + snippet）、`src/tool.ts`
  （reference_lookup：库 id schema / catalog 不计查证 / 预算拒绝）、`src/coverage.ts`
  （TurnState + TurnTracker：sessionId:turn 键控、nudge/steer/预算、统计钩子）、
  `src/metrics.ts`（budget-stats.jsonl + usage 聚合）；index.ts 装配（工具注册 /
  text() 识别命中注入 + lenient nudge / pre-step 观察 / tools/result 记账 /
  turn-stopping strict / agent/created 种子 + 极简 restrict）；render.ts 新增
  `renderRefLibsV15`；新增 peerDeps dsh-tools/dsh-agent/dsh-llm/dsh-agent-presets
  （`^0.1.1-rc.2`）；**269 测试全过**（identify/coverage/search/tool/metrics L0
  套件 + render v15 + L2 v15 零污染用例 + 逃逸三用例），typecheck/lint/build 全过。
  实现偏差记录：①检索为自实现受限 grep（未依赖 dsh-tool-fs-search 的 rg 二进制，
  零新运行时依赖，后续可按性能换 runRipgrep）；②catalog 渲染经 canonical
  `message` 字段承载（schema 保持简单）；③strict 为全局开关（per-library 待
  v16）。未完成：S5 TTL（v14 主题）、inherit none 策略、映射表 UI、token 对比
  基准任务集（§7-16）。
- 2026-08-24：**实测修复轮（3090 隔离实例 + 会话轨迹分析）**——①注入开关语义
  修正：识别命中才注入 → **挂载即注入**（用户 add 即域声明），cwd 只影响排序；
  ②检索质量：多词 OR 匹配（中文整句中的英文标识符仍命中）、工具描述/政策强化
  英文标识符指引、无匹配提示增强；③**序列化 bug**：canonical 值显式 `message:
  undefined` 键触发 `INVALID_TOOL_OUTPUT`（lossless JSON 红线）——条件省略修复；
  ④**遍历 bug**：`.pnpm-store`（8349 文件）不在忽略列表且排在根文件前，耗尽
  `maxFiles` 预算导致 README 等根本没被扫到——忽略大目录 + 文件优先遍历 + 命中
  质量排序（注释降权/行长升序/每文件上限/收集缓冲）；⑤**识别层定稿**：cwd 自动
  匹配 + 映射表（方案 a+c）经评估价值有限**整体移除**，识别 = 会话挂载（§1.2 重写）；
  ⑥新增调试工具 `scripts/analyze-session.mjs` / `dump-grep.mjs`（只读冷加载会话
  日志，`workspace-write` 模式即可运行）；⑦新增 AGENTS.md 约定：**工具 canonical
  值必须为纯 lossless JSON（禁 undefined 键/函数/符号/循环引用）**。
- 2026-08-24：**形态收敛（用户定稿：提醒式 + 自主检索）**——实测暴露政策
  "BEFORE answering"诱导模型每次必查（静态审查任务一次 step 并行 4 次
  reference_lookup，后 2 次被预算截断、模型绕道 grep）；用户决定**移除覆盖检查
  （lenient nudge / strict steer / 记账）与逃逸预算（三层 + budget-stats 统计）**
  观察裸效果：注入改为提醒式政策（库清单+根路径+规范使用指引，不诱导必查）、
  工具降为按需定位（描述收窄、无预算无记账）、模型自主选择用工具/读文件/grep。
  删除 `src/coverage.ts` / `src/metrics.ts`（git 历史可恢复），233 测试全过；
  剩余机制：挂载注入 + reference_lookup（纯检索）+ 子 agent 种子 + 极简 restrict +
  检索质量改进。**覆盖检查/逃逸如需恢复**：从 git 历史取回模块并按需接线。
