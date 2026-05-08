import type { ProviderAdapter, StreamEvent } from './types'
import { coalesceMessages } from './coalesce'

/**
 * Doubao adapter — direct fetch to Volcengine ARK's OpenAI-compatible Chat
 * Completions endpoint. Model IDs in our app use the convention
 * `doubao/<bare-model>`, e.g. `doubao/doubao-seed-2-0-lite-260215`. The
 * `doubao/` prefix is stripped before sending to Volcengine.
 *
 * Auth: ARK_API_KEY env var (Volcengine ARK key, distinct from OpenRouter).
 *
 * Note: we use Chat Completions (not Volcengine's Responses API) to match the
 * rest of our pipeline — streaming works, and our consensus runner sends full
 * history each round, so we don't benefit from Responses' `previous_response_id`.
 */
export function createDoubaoAdapter(opts: {
  id: string
  model: string
  apiKey?: string
}): ProviderAdapter {
  const apiKey = opts.apiKey ?? process.env.ARK_API_KEY
  if (!apiKey) throw new Error('ARK_API_KEY missing')

  // Strip our `doubao/` prefix if present; Volcengine wants the bare name.
  const model = opts.model.startsWith('doubao/')
    ? opts.model.slice('doubao/'.length)
    : opts.model

  return {
    id: opts.id,
    async *stream({ messages, signal }): AsyncIterable<StreamEvent> {
      const body = {
        model,
        messages: coalesceMessages(messages),
        stream: true,
        stream_options: { include_usage: true },
      }

      let res: Response
      try {
        res = await fetch(
          'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
            signal,
          },
        )
      } catch (e) {
        yield {
          type: 'error',
          error: signal?.aborted ? 'aborted' : (e as Error).message,
        }
        return
      }

      if (!res.ok || !res.body) {
        const errBody = await res.text().catch(() => '')
        yield {
          type: 'error',
          error: `volcengine HTTP ${res.status}${errBody ? `: ${errBody.slice(0, 300)}` : ''}`,
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
                const text: string = parsed.choices?.[0]?.delta?.content ?? ''
                if (text.length > 0) yield { type: 'chunk', text }
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

