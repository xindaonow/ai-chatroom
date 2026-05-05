# 使用方式

一个典型 session 的完整流程：

**1. 选模型（可选）。** 第一次打开默认是 `pro` preset（4 个前沿模型）。点 header 的 **Models** —— 要么点 `Pro` / `Flash` 一键 preset，要么搜目录（`gpt55`、`claude opus`、`deepseek v4 pro` —— subsequence 匹配，不要求严格连续）。点模型切换勾选，然后 **Apply** —— 创建一个绑定你选项的新 session。

**2. 选模式。** 点 header 的 **Free / Brainstorm / Consensus**。Free 是默认安全选项。Consensus 模式下，Send 旁边会出现 `[N] rounds` 输入框 —— N 是精确轮数，没有提前结束。

**3. 提问。** 在底部文本框输入，⌘↵（或点 Send）。N 个 agent 并行开始流式回复。每个 bubble 一个颜色条 + 进度徽章。

**4. 迭代。** 一轮跑完后能做两件事：
- **追问** —— agent 能看到所有过去轮次。Brainstorm 模式下这是结构发挥价值的地方（同伴的回答喂给下一轮 prompt）。
- **点 bubble header 的 `↻`** —— 单独重跑这个 AI，不动其他人。失败响应或不满意时用。

**5. 总结。** 对话长了之后，点 Send 旁边的 **Summarize**。输入指令（"用中文提取每个 AI 的核心立场" / "extract action items" / "对比每个人的立场"）。Host 模型（Gemini 3 Flash）拿到完整 transcript + 你的指令，流式输出到 composer 上方的面板。每个 session 各自持久化。

**6. 浏览 / 切换 session。** 点 header 的 **Sessions ▾**。按今天 / 昨天 / 更早分组。点一行就切到那个 session（加载它的所有轮次、synthesis、最新 summary）。点 **+ New chat** 开新 session。

**7. 关 tab。** 还在 streaming？服务器照样继续生成。后面再打开：最近 session 自动加载，仍在 streaming 的 bubble 自动恢复 SSE 接收。服务器中途崩溃下次启动会修复（partial 内容保留，状态翻成 finalized）。

**8. Export / Import。** 点 **Export**（header）下载 JSON 快照。**Import**（在 Export 旁边）能把这样的 JSON 加载回来。导入会拿到全新的内部 ID 但历史 + synthesis 完整恢复。分享或者做对话种子用。

## 怎么选模式

| 目标 | 模式 |
|---|---|
| "每个模型对 X 是怎么说的？" | **Free** |
| "生成尽可能多的想法" | **Brainstorm** |
| "经 N 轮讨论得到经过校准的结论" | **Consensus** |

## 模式细节

| 模式 | 何时用 | 怎么跑 |
|---|---|---|
| **Free** | 快速对比模型风格，无结构 | 走 `POST /api/rounds` per-round 流式，每轮一条用户消息 |
| **Brainstorm** | 想要多样化的发散想法 + 在同伴想法上接龙 | 走同一 per-round 流，模式 prompt 强制 `NEW_IDEAS` / `BUILDS_ON_PEER` / `CROSS_POLLINATIONS` 结构 |
| **Consensus** | 难题想要校准过的共识 | 服务器侧多轮 runner。每轮 SSE emit `round-started`，bubble 仍是实时流式。轮间固定用 Gemini 3 Flash 作为 Host 生成 3 句话 recap（已确认共识 / 开放分歧 / 需要的证据）注入下一轮 system prompt。N 轮跑完，同一个 Host 输出 final synthesis 卡片（`consensusFindings / remainingDisagreements / confidenceRange / practicalImplications`） |

Consensus 的 `maxRounds` 是**精确轮数**（无自动早停）—— 设 3 就是每个 AI 跑 3 轮 + 一次 synthesis。

## Debug 模式

点 header 的 **Debug** 切换。开启后，每条 AI 回答上会出现一个 `</>` 图标，点开会打开 **Prompt Inspector**，显示发送给 LLM API 的完整 `[system, …history]` payload —— 包括所有合并后的 peer-context 块。用来理解某个回答为什么这么生成、或者调某个 mode prompt 时非常有用。
