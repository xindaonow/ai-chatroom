# 扩展

## 加新模型

### 通过 OpenRouter（最常见）

什么都不用做——OpenRouter 的全部 ~370 个模型在 picker 里直接搜得到。在搜索框里输任何 ID 都能选。如果想让某个模型出现在一键 preset 按钮里，去 `agents.config.ts` 加：

```ts
pro: [
  { id: 'claude',   label: 'Claude Opus 4.7',  model: 'anthropic/claude-opus-4.7' },
  { id: 'gemini',   label: 'Gemini 3.1 Pro',   model: 'google/gemini-3.1-pro-preview' },
  { id: 'gpt',      label: 'GPT-5.5',          model: 'openai/gpt-5.5' },
  { id: 'deepseek', label: 'DeepSeek V4 Pro',  model: 'deepseek/deepseek-v4-pro' },
  { id: 'mistral',  label: 'Mistral Large',    model: 'mistralai/mistral-large' }, // 新加
]
```

### 直连 API（比如火山方舟豆包）

服务商是 OpenAI-compatible 但 OpenRouter 没收录时，加一个专用 adapter：

1. 复制 `src/server/adapters/doubao.ts` 当模板（约 100 行，direct fetch + SSE 解析）。
2. 定义一个唯一前缀（如 `doubao/`）并在 `src/server/adapters/index.ts` 加 routing：
   ```ts
   if (modelId.startsWith('doubao/')) { return createDoubaoAdapter(...) }
   ```
3. 加一个环境变量（如 `ARK_API_KEY`）。
4. 在 `agents.config.ts` 的 `extraModels` 里写一项，让 picker 显示它（OpenRouter 列表不会有）：
   ```ts
   export const extraModels: ModelSpec[] = [
     { id: 'doubao-seed-2-pro', label: 'Doubao Seed 2.0 Pro', model: 'doubao/doubao-seed-2-0-pro-260215' },
   ]
   ```

## 调整某个模式

所有模式行为都在 `src/server/modes.ts` 的几个小 builder 函数里：

- `buildModePrompt(mode, selfPublicId, otherPublicIds, opts)` —— 主 dispatcher
- `buildBrainstormInitial` / `buildBrainstormFollowup` —— Brainstorm 结构（NEW_IDEAS / BUILDS_ON_PEER 等）
- `buildInitialRoundPrompt` / `buildReviewRoundPrompt` —— Consensus 初始轮 vs review 轮的结构
- `buildFinalSynthesisPrompt` —— final synthesis 的 prompt（被 Host adapter 调用）
- `buildBaseSystemPrompt` —— 共用的"如何解读对话历史"的开篇
- `HOST_SYSTEM_PROMPT` —— consensus recap 和 synthesis 共用的 Host 人设

改任意一个都是单文件改动。`src/server/modes.test.ts` 锁住了结构性 invariants —— 改了 builder 跑一下 `bun test src/server/modes.test.ts` 看看哪些假设被覆盖到。

## 换 Host 模型

`src/server/host.ts` 暴露 `getHostAdapter()` 和 `HOST_LABEL`。consensus 轮间 recap（`consensus/extractor.ts`）、final synthesis 和 Summarize 端点都从这里 import。换 Host 模型一行就够：

```ts
// src/server/host.ts
const HOST_MODEL = 'google/gemini-3-flash-preview'   // ← 改这里
```

如果新 Host 能力不一样（比如上下文更长），也可以在 `consensus/extractor.ts` 里给 recap 调用喂更多上下文（已经移除了 `.slice(0, 1200)` 截断）。

## 改 OpenRouter 默认参数

reasoning effort、verbosity、max-tokens 是 `src/server/adapters/openrouter.ts` 构造时的默认值：

```ts
const effort = opts.reasoningEffort ?? 'xhigh'
const verbosity = opts.verbosity ?? 'low'
const maxTokens = opts.maxTokens ?? 32000
```

per-adapter 可以通过构造参数覆盖，或者直接改默认值让全项目走另一套。
