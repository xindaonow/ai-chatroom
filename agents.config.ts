/**
 * Agent configuration.
 *
 * `presets` are user-facing model bundles (one-click in the UI's model picker).
 * `agentsConfig` is the server startup default — used only when a session is
 * created without modelIds. Per-session selections override this.
 *
 * The model picker fetches OpenRouter's full catalog (~370 models) at startup,
 * so there's no curated `availableModels` list — anything OpenRouter exposes
 * is searchable. Direct (non-OpenRouter) models like Doubao must be entered
 * by typing the full ID (`doubao/...`) in the custom-ID field, OR placed in
 * a preset here so they appear with a one-click button.
 *
 * API keys: OPENROUTER_API_KEY (required), ARK_API_KEY (only for `doubao/`).
 */

export type ModelSpec = {
  id: string    // URL-safe key, unique within a preset
  label: string // display name (used in MessageBubble headers)
  model: string // provider/model string
}

export const presets: Record<string, ModelSpec[]> = {
  pro: [
    { id: 'claude',   label: 'Claude Opus 4.7',   model: 'anthropic/claude-opus-4.7' },
    { id: 'gemini',   label: 'Gemini 3.1 Pro',    model: 'google/gemini-3.1-pro-preview' },
    { id: 'gpt',      label: 'GPT-5.5',           model: 'openai/gpt-5.5' },
    { id: 'deepseek', label: 'DeepSeek V4 Pro',   model: 'deepseek/deepseek-v4-pro' },
  ],
  flash: [
    { id: 'claude',   label: 'Claude Sonnet 4.6', model: 'anthropic/claude-sonnet-4.6' },
    { id: 'gemini',   label: 'Gemini 3 Flash',    model: 'google/gemini-3-flash-preview' },
    { id: 'gpt',      label: 'GPT-5.4 mini',      model: 'openai/gpt-5.4-mini' },
    { id: 'deepseek', label: 'DeepSeek V4 Flash', model: 'deepseek/deepseek-v4-flash' },
  ],
}

// Server startup default. UI picker overrides per-session.
const activePreset: keyof typeof presets = 'pro'
export const agentsConfig: ModelSpec[] = presets[activePreset]

/**
 * Picker entries the server should expose in addition to OpenRouter's catalog.
 * Use for direct-API providers whose models OpenRouter doesn't list (e.g.,
 * Volcengine ARK / Doubao). Each entry's `model` should be the routing key
 * the adapters layer recognizes (e.g., `doubao/...` → direct Volcengine).
 */
export const extraModels: ModelSpec[] = [
  { id: 'doubao-seed-2-pro', label: 'Doubao Seed 2.0 Pro', model: 'doubao/doubao-seed-2-0-pro-260215' },
]
