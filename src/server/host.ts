import { createOpenRouterAdapter } from './adapters/openrouter'

/**
 * "Host" model — a fixed external adapter, distinct from the user's chosen
 * debate participants. Used in three places:
 *
 *   1. Per-round orchestrator-state recap (consensus/extractor.ts)
 *   2. Final synthesis at end of a consensus run (consensus/runner.ts)
 *   3. Manual Summarize button (api.ts /api/sessions/:id/summarize)
 *
 * Keeping the model fixed means the user's model picker never affects the
 * style or quality of these meta-summaries. Pair it with HOST_SYSTEM_PROMPT
 * in modes.ts for a consistent voice across all three call sites.
 *
 * Lazy-init so module load doesn't require OPENROUTER_API_KEY (matters for
 * tests that import downstream files without ever invoking the host).
 */
const HOST_MODEL = 'google/gemini-3-flash-preview'
export const HOST_LABEL = 'Gemini 3 Flash (Host)'

let adapter: ReturnType<typeof createOpenRouterAdapter> | null = null

export function getHostAdapter() {
  if (!adapter) {
    adapter = createOpenRouterAdapter({
      id: 'gemini-flash-host',
      model: HOST_MODEL,
    })
  }
  return adapter
}
