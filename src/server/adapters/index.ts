import { createMockAdapter } from './mock'
import { createOpenRouterAdapter } from './openrouter'
import { createDoubaoAdapter } from './doubao'
import type { ProviderAdapter } from './types'
import { agentsConfig, presets, extraModels, type ModelSpec } from '../../../agents.config'
import { getOpenRouterModelsSnapshot } from '../openrouter-models'

export type { ProviderAdapter, ProviderMessage, StreamEvent } from './types'
export { createMockAdapter, createOpenRouterAdapter, createDoubaoAdapter }

/**
 * Models prefixed with `doubao/` route to the direct Volcengine ARK adapter
 * (uses ARK_API_KEY). Everything else goes through OpenRouter.
 */
function isDoubaoDirect(modelId: string): boolean {
  return modelId.startsWith('doubao/')
}

export type AgentSpec = {
  id: string
  publicId: string
  label: string
  model: string  // OpenRouter model ID, e.g. "anthropic/claude-opus-4.7"
  adapter: ProviderAdapter
}

function modelIdToKey(modelId: string): string {
  // e.g. "anthropic/claude-opus-4.7" → "anthropic-claude-opus-4-7"
  return modelId.replace(/[^a-z0-9]/gi, '-').toLowerCase()
}

/**
 * Pick a display label for a raw model id. Order:
 *   1. Curated presets (short, hand-written labels like "Claude Opus 4.7")
 *   2. extraModels (non-OpenRouter providers like Doubao)
 *   3. OpenRouter catalog snapshot (e.g. "Anthropic: Claude Opus 4.7")
 *   4. Fall back to the bare model id
 */
function labelForModel(modelId: string): string {
  for (const preset of Object.values(presets)) {
    const found = preset.find((m) => m.model === modelId)
    if (found) return found.label
  }
  const extra = extraModels.find((m) => m.model === modelId)
  if (extra) return extra.label
  const dynamic = getOpenRouterModelsSnapshot()
  return dynamic.find((m) => m.model === modelId)?.label ?? modelId
}

export function buildAgentFromSpec(spec: ModelSpec, index: number): AgentSpec {
  const publicId = `agent-${String.fromCharCode(65 + index)}`
  if (process.env.USE_MOCK_ADAPTERS === '1') {
    return {
      id: spec.id,
      publicId,
      label: `Mock-${spec.label}`,
      model: spec.model,
      adapter: createMockAdapter({ id: spec.id, delayMs: 8 + index * 4 }),
    }
  }
  if (isDoubaoDirect(spec.model)) {
    return {
      id: spec.id,
      publicId,
      label: spec.label,
      model: spec.model,
      adapter: createDoubaoAdapter({ id: spec.id, model: spec.model }),
    }
  }
  return {
    id: spec.id,
    publicId,
    label: spec.label,
    model: spec.model,
    adapter: createOpenRouterAdapter({ id: spec.id, model: spec.model }),
  }
}

export function buildAgentFromModelId(modelId: string, index: number): AgentSpec {
  return buildAgentFromSpec(
    { id: modelIdToKey(modelId), label: labelForModel(modelId), model: modelId },
    index,
  )
}

export function buildAgents(): AgentSpec[] {
  return agentsConfig.map((cfg, i) => buildAgentFromSpec(cfg, i))
}
