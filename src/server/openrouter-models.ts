import type { ModelSpec } from '../../agents.config'

/**
 * Fetches the full model catalog from OpenRouter once at startup, caches it
 * in memory. The /api/v1/models endpoint is public — no API key needed.
 *
 * Cache TTL = 1 hour. If a refresh fails we keep serving the cached value;
 * if the very first fetch fails we return [].
 */

let cached: ModelSpec[] | null = null
let fetchedAt = 0
const TTL_MS = 60 * 60 * 1000

type OpenRouterModel = { id: string; name?: string }

export async function getOpenRouterModels(): Promise<ModelSpec[]> {
  const now = Date.now()
  if (cached && now - fetchedAt < TTL_MS) return cached

  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as { data?: OpenRouterModel[] }
    const all = (data.data ?? [])
      .filter((m) => typeof m.id === 'string' && m.id.includes('/'))
      .map<ModelSpec>((m) => ({
        id: m.id.replace(/[^a-z0-9]/gi, '-').toLowerCase(),
        // Keep OpenRouter's "Provider: Model" label — with 200+ models,
        // the provider prefix helps disambiguate at a glance.
        label: m.name ?? m.id,
        model: m.id,
      }))
      .sort((a, b) => a.label.localeCompare(b.label))
    cached = all
    fetchedAt = now
    console.log(`[openrouter-models] loaded ${all.length} models`)
    return all
  } catch (e) {
    console.warn(
      `[openrouter-models] fetch failed: ${(e as Error).message}; serving ${cached?.length ?? 0} cached`,
    )
    return cached ?? []
  }
}

/** Fire-and-forget warm-up. Safe to await. */
export function prefetchOpenRouterModels(): Promise<void> {
  return getOpenRouterModels().then(() => undefined)
}

/**
 * Synchronous snapshot of the cached catalog. Returns [] until the first
 * fetch completes — callers should treat it as best-effort. Useful for
 * label lookups where async wouldn't be ergonomic.
 */
export function getOpenRouterModelsSnapshot(): ModelSpec[] {
  return cached ?? []
}
