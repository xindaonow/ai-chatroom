# Extending

## Add a new model

### Through OpenRouter (typical)

Nothing to do — every OpenRouter model (~370) is already searchable in the picker. Type any id in the search box and pick it. To make a model show as a one-click button, add it to a preset in `agents.config.ts`:

```ts
pro: [
  { id: 'claude',   label: 'Claude Opus 4.7',  model: 'anthropic/claude-opus-4.7' },
  { id: 'gemini',   label: 'Gemini 3.1 Pro',   model: 'google/gemini-3.1-pro-preview' },
  { id: 'gpt',      label: 'GPT-5.5',          model: 'openai/gpt-5.5' },
  { id: 'deepseek', label: 'DeepSeek V4 Pro',  model: 'deepseek/deepseek-v4-pro' },
  { id: 'mistral',  label: 'Mistral Large',    model: 'mistralai/mistral-large' }, // new
]
```

### Direct API (e.g., Doubao via Volcengine ARK)

When a provider is OpenAI-compatible but isn't on OpenRouter, add a dedicated adapter:

1. Copy `src/server/adapters/doubao.ts` as a template (~100 lines, direct fetch + SSE parse).
2. Define a unique model-id prefix (e.g., `doubao/`) and add routing in `src/server/adapters/index.ts`:
   ```ts
   if (modelId.startsWith('doubao/')) { return createDoubaoAdapter(...) }
   ```
3. Add an env var (e.g., `ARK_API_KEY`) for the new provider.
4. Place the model in `extraModels` in `agents.config.ts` so the picker shows it (since OpenRouter's catalog won't list it):
   ```ts
   export const extraModels: ModelSpec[] = [
     { id: 'doubao-seed-2-pro', label: 'Doubao Seed 2.0 Pro', model: 'doubao/doubao-seed-2-0-pro-260215' },
   ]
   ```

## Tune a conversation mode

All mode-specific behaviour lives in `src/server/modes.ts` as small builder functions:

- `buildModePrompt(mode, selfPublicId, otherPublicIds, opts)` — main dispatcher.
- `buildBrainstormInitial` / `buildBrainstormFollowup` — Brainstorm structure (NEW_IDEAS / BUILDS_ON_PEER / etc.).
- `buildInitialRoundPrompt` / `buildReviewRoundPrompt` — Consensus initial vs review-round structure.
- `buildFinalSynthesisPrompt` — final synthesis prompt (used by the Host adapter).
- `buildBaseSystemPrompt` — the shared "how to read the conversation history" preamble.
- `HOST_SYSTEM_PROMPT` — persona used by both consensus recap and synthesis calls.

Editing any of these is a one-file change. Tests in `src/server/modes.test.ts` pin the structural invariants — if you change a builder, run `bun test src/server/modes.test.ts` to see what assumptions are wired up.

## Swap the Host model

`src/server/host.ts` exports `getHostAdapter()` and `HOST_LABEL`. Both the orchestrator-state recap (`consensus/extractor.ts`) and the final-synthesis + Summarize endpoints import from here. Changing the Host model is a one-line edit:

```ts
// src/server/host.ts
const HOST_MODEL = 'google/gemini-3-flash-preview'   // ← change here
```

If the new Host has different capabilities (e.g., much longer context), you can also drop the `.slice(0, 1200)` truncation in `consensus/extractor.ts` (already removed) or pass more context to the recap call.

## Change the OpenRouter defaults

Reasoning effort, verbosity, and max-tokens are hardcoded defaults in `src/server/adapters/openrouter.ts` constructor:

```ts
const effort = opts.reasoningEffort ?? 'xhigh'
const verbosity = opts.verbosity ?? 'low'
const maxTokens = opts.maxTokens ?? 32000
```

Override per-adapter via the constructor args, or change the defaults if you want the whole project to behave differently.
