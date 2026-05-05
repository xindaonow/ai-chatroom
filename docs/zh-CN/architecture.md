# 架构

## 代码结构

```
src/
├── server/                    Bun + Hono 后端（端口 3000）
│   ├── index.ts               服务启动；启动时调 repairOrphanStreams
│   ├── api.ts                 HTTP / SSE 端点
│   ├── orchestrator.ts        rounds、per-agent 流式 pubsub、per-message finalize
│   ├── modes.ts               各模式的 system prompt + Host system prompt
│   ├── host.ts                固定 Host adapter（Gemini 3 Flash，lazy-init）
│   ├── repo.ts                SQLite 持久化层
│   ├── ids.ts                 短 ID 生成器
│   ├── openrouter-models.ts   OpenRouter 完整模型列表（1 小时缓存）
│   ├── visibility/            跨轮透明 / 同轮隔离的可见性规则
│   │   ├── resolver.ts        finalizeRound、buildContextFor
│   │   └── render.ts          per-viewer 消息渲染
│   ├── consensus/             consensus 模式内部
│   │   ├── runner.ts          多轮主循环（用 orchestrator + Host adapter）
│   │   └── extractor.ts       parseAgentSignals、buildOrchestratorState、shouldStop
│   └── adapters/              LLM 服务商客户端
│       ├── openrouter.ts      direct fetch；reasoning.effort=xhigh、verbosity=low、
│       │                      max_tokens=32000；Anthropic 上加 cache_control
│       ├── doubao.ts          直连火山方舟 ARK（Chat Completions）
│       ├── coalesce.ts        合并同 role 消息；user-role 内 peer-aware 排序
│       ├── mock.ts            离线测试 adapter（确定性回复）
│       └── index.ts           routing + AgentSpec 构造
│
├── shared/
│   └── schema.ts              前后端共用类型
│
└── web/                       React + Vite 前端（端口 5173）
    ├── App.tsx                根组件：启动时加载最近 session，重连 in-progress streams
    ├── store.ts               zustand：agents、session、streaming map、
    │                          summary、consensusRun、presets、debugMode
    ├── api.ts                 fetch 封装、SSE 解析
    ├── theme.ts               每个 agent 的主色
    ├── utils/export.ts        JSON 快照格式
    ├── index.css / index.html Atelier 主题引导
    └── components/
        ├── Timeline           rounds + agent 列布局
        ├── MessageBubble      bubble + 状态徽章 + 重试按钮 + debug 图标
        ├── Composer           输入框 + Send + SummarizeButton +（consensus 时）轮数输入
        ├── ModeSelector       3 模式 pill 切换
        ├── ModelPicker        可搜索的 picker，含 preset 和"已选置顶"
        ├── SessionsSidebar    浏览 / 切换 / 删除历史 session
        ├── PromptInspector    侧栏：完整 [system, …history] payload（每条消息）
        ├── ConsensusProgress  consensus 跑的时候的悬浮进度
        ├── FinalSynthesis     consensus 跑完的综合卡片
        ├── SummarizeButton    composer 上方的临时 summary 弹窗
        ├── SummaryPanel       composer 上方的流式 summary 卡片
        └── ImportButton       JSON 文件 → 恢复 session

agents.config.ts               presets（pro / flash）+ extraModels（非 OpenRouter）
```

## 后端路由

```
GET    /api/sessions             session 列表（按 updated_at 排）
GET    /api/sessions/:id         session + rounds + messages + consensusRun + summary
POST   /api/sessions             创建 session
DELETE /api/sessions/:id         级联删除 rounds、messages、consensus_runs、summaries
POST   /api/sessions/import      恢复一个 export 的 JSON，replay 所有轮次为 finalized
POST   /api/sessions/:id/summarize  SSE —— Host 模型针对全 transcript 生成（持久化）
POST   /api/rounds               free / brainstorm —— 一次一轮
GET    /api/rounds/:rid/stream/:aid  SSE —— per-agent chunks
POST   /api/consensus/run        consensus —— 多轮主循环，SSE 推回（持久化 synthesis）
POST   /api/messages/:id/retry   单条 assistant message 原地重跑
GET    /api/models               硬编码 extras + 动态 OpenRouter 列表
GET    /api/presets              命名 preset（pro / flash）
GET    /api/messages/:id/prompt  发给这个 agent 的完整 [system, …history] payload
```

## 关键约定

- **模型 ID** 格式 `provider/model`（与 OpenRouter 一致）。`doubao/` 前缀走直连 Volcengine；其他都走 OpenRouter。
- **OpenRouter 默认参数**：`reasoning.effort: 'xhigh'`、`verbosity: 'low'`、`max_tokens: 32000`。GPT-5.5 / Claude 4.7+ / Gemini 3 推理模型遵循；其他模型忽略。
- **可见性模型**：assistant message 在 streaming 期间只对作者可见（`visibleTo: [self]`）；该 agent 流结束的瞬间，这条消息单独翻成 `visibleTo: '*'` 并冻结一份 `rendered` 快照——*不等*整轮 finalize。每个 bubble 显示自己的 elapsed 时间，先完成的不会因为别人没好而退回 "connecting"。
- **Consensus 阶段**：round 0 = `initial`（CLAIM/CONFIDENCE/REASONING/ASSUMPTIONS/...）；round 1+ = `review`（POSITION_DELTA/PEER_REVIEW_*/CONTINUE_NEEDED）。Final synthesis 是单独一次对 Host adapter 的调用，不算一轮。
- **Host 模型**（`src/server/host.ts`）：一个共享 lazy-init 的 OpenRouter adapter，固定指向 `google/gemini-3-flash-preview`。被 consensus 的轮间 recap、consensus 的 final synthesis、手动 Summarize 三处共用。和用户选了哪些参与者无关。
- **Coalesce + peer-aware 合并**（`src/server/adapters/coalesce.ts`）：相邻同 role 消息合并；user-role 组内，bare-user（用户的真实问题）置顶，bracketed `[publicId]: …` peer 回复在分隔条下方。base system prompt 教模型识别这个布局。同一个函数也供 prompt inspector 使用，所以 Debug 视图 = LLM API 实际收到的 payload。
- **Anthropic prompt 缓存**：在最后一条非空消息上打 cache_control 标记；rendered 快照 byte-stable，所以后续轮次能命中缓存前缀。
- **崩溃恢复**：服务器启动时跑 `repairOrphanStreams`，把上次崩溃残留的 `streaming` 行翻成 `finalized`（保留 partial 内容），所以重启后 UI 不会显示幽灵 "streaming" bubble。

## 持久化

`./data/dev.db` 的 SQLite。Sessions、rounds、messages、consensus runs、summaries 全部跨重启保留。`DB_PATH=...` 可覆盖路径。

每个 session 最近的一次 consensus run 和 summary 都和 messages 一起持久化，重新打开 session 时会自动恢复 synthesis 卡片和 summary 面板。
