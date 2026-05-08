import type { ProviderAdapter, StreamEvent } from './types'
import { coalesceMessages } from './coalesce'

/**
 * OpenRouter adapter — direct fetch (no @ai-sdk/openai wrapper) so we can send
 * OpenRouter's nested `reasoning: { effort, max_tokens, exclude }` body field,
 * which the SDK doesn't expose typed-passthrough for.
 *
 * Defaults applied for ALL models (informed by GPT-5.5 best-practice doc):
 *
 *   - `reasoning.effort: 'xhigh'` — deepest reasoning available. OpenRouter
 *     normalizes across providers: GPT-5.5 and Claude Opus 4.7+ honor xhigh
 *     natively; Gemini 3 maps `effort` to `thinkingLevel` and silently caps at
 *     its own max. For non-reasoning models the field is ignored.
 *
 *   - `verbosity: 'low'` — OpenRouter top-level field. Originally OpenAI
 *     Responses-API, also honored by Anthropic Claude. Concise output keeps
 *     structured fields (CLAIM / REASONING / etc.) tight without padding.
 *     Ignored by providers that don't support it.
 *
 *   - `temperature` / `top_p` — intentionally NOT set. OpenAI's reasoning
 *     best-practice doc explicitly says reasoning models are insensitive to
 *     these; letting the provider default through avoids surprises across
 *     vendors (Anthropic / Gemini have different defaults from OpenAI).
 *
 * Anthropic-specific: prompt caching via `cache_control: { type: 'ephemeral' }`.
 * For `anthropic/*` models we convert messages to structured content blocks
 * and mark the last block as a cache breakpoint. Across rounds, the prefix
 * (system + frozen rendered history) is byte-stable thanks to the visibility
 * resolver's per-viewer rendered snapshots — so the cache hits naturally on
 * subsequent rounds. OpenRouter forwards `cache_control` faithfully; other
 * providers don't see this field (we only emit it for Anthropic).
 */
export function createOpenRouterAdapter(opts: {
  id: string
  model: string
  apiKey?: string
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  verbosity?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  maxTokens?: number
}): ProviderAdapter {
  const apiKey = opts.apiKey ?? process.env.OPENROUTER_API_KEY
  if (!apiKey) throw new Error('OPENROUTER_API_KEY missing')

  const effort = opts.reasoningEffort ?? 'xhigh'
  const verbosity = opts.verbosity ?? 'low'
  const maxTokens = opts.maxTokens ?? 32000

  const isAnthropic = opts.model.startsWith('anthropic/')

  return {
    id: opts.id,
    async *stream({ messages, signal }): AsyncIterable<StreamEvent> {
      const coalesced = coalesceMessages(messages)
      const body = {
        model: opts.model,
        messages: isAnthropic ? withCacheControl(coalesced) : coalesced,
        stream: true,
        // Required for OpenAI-compatible providers to include the `usage`
        // object on the terminal SSE event. Anthropic via OpenRouter sends
        // it by default; this flag is harmless for them.
        stream_options: { include_usage: true },
        max_tokens: maxTokens,
        verbosity,
        reasoning: { effort },
      }

      let res: Response
      try {
        res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal,
        })
      } catch (e) {
        yield { type: 'error', error: signal?.aborted ? 'aborted' : (e as Error).message }
        return
      }

      if (!res.ok || !res.body) {
        const errBody = await res.text().catch(() => '')
        yield {
          type: 'error',
          error: `openrouter HTTP ${res.status}${errBody ? `: ${errBody.slice(0, 300)}` : ''}`,
        }
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      try {
        while (true) {
          if (signal?.aborted) {
            yield { type: 'error', error: 'aborted' }
            return
          }
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })

          // SSE events delimited by blank lines.
          const events = buffer.split('\n\n')
          buffer = events.pop() ?? ''

          for (const ev of events) {
            for (const line of ev.split('\n')) {
              const trimmed = line.trimStart()
              if (!trimmed.startsWith('data:')) continue
              const data = trimmed.slice(5).trim()
              if (data === '[DONE]') {
                yield { type: 'done' }
                return
              }
              if (!data) continue
              try {
                const parsed = JSON.parse(data)
                const text: string =
                  parsed.choices?.[0]?.delta?.content ?? ''
                if (text.length > 0) yield { type: 'chunk', text }
                // The terminal SSE event carries `usage` (with
                // stream_options.include_usage on OpenAI-compatible
                // providers). Yield exactly once so consumers can
                // persist the token counts.
                const usage = parsed.usage
                if (
                  usage &&
                  typeof usage.prompt_tokens === 'number' &&
                  typeof usage.completion_tokens === 'number'
                ) {
                  yield {
                    type: 'usage',
                    inputTokens: usage.prompt_tokens,
                    outputTokens: usage.completion_tokens,
                  }
                }
              } catch {
                // ignore malformed event
              }
            }
          }
        }
        yield { type: 'done' }
      } catch (e) {
        yield {
          type: 'error',
          error: signal?.aborted ? 'aborted' : (e as Error).message,
        }
      }
    },
  }
}

/**
 * Convert plain string messages to Anthropic's structured content format and
 * mark the last non-empty block as a cache breakpoint. The TTL defaults to
 * 5 minutes (`type: 'ephemeral'`) which is enough for typical multi-round
 * pacing; for slower flows you'd switch to `{ type: 'ephemeral', ttl: '1h' }`
 * (more expensive cache write, longer reuse window).
 *
 * We also drop empty messages — Anthropic rejects `{type: 'text', text: ''}`,
 * and the trailing-empty assistant placeholder we send to other providers
 * isn't useful for them (Anthropic happily starts a fresh assistant turn).
 */
function withCacheControl(
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
) {
  type Block = {
    type: 'text'
    text: string
    cache_control?: { type: 'ephemeral' }
  }
  const structured = messages
    .filter((m) => m.content.length > 0)
    .map((m) => ({
      role: m.role,
      content: [{ type: 'text', text: m.content }] as Block[],
    }))
  if (structured.length > 0) {
    const last = structured[structured.length - 1]
    last.content[0].cache_control = { type: 'ephemeral' }
  }
  return structured
}
