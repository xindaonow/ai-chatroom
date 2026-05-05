import type { ProviderAdapter, ProviderMessage, StreamEvent } from './types'

/**
 * Mock adapter — emits a deterministic response derived from the last user
 * message, in `chunkSize` slices with `delayMs` between chunks. Used for
 * verify scripts and unit tests.
 */
export function createMockAdapter(opts: {
  id: string
  chunkSize?: number
  delayMs?: number
  reply?: (messages: ProviderMessage[]) => string
}): ProviderAdapter {
  const chunkSize = opts.chunkSize ?? 6
  const delayMs = opts.delayMs ?? 10
  const reply =
    opts.reply ??
    ((messages) => {
      const lastUser =
        [...messages].reverse().find((m) => m.role === 'user')?.content ?? ''
      return `[${opts.id}] echo: ${lastUser}`
    })

  return {
    id: opts.id,
    async *stream({ messages, signal }): AsyncIterable<StreamEvent> {
      try {
        const text = reply(messages)
        for (let i = 0; i < text.length; i += chunkSize) {
          if (signal?.aborted) {
            yield { type: 'error', error: 'aborted' }
            return
          }
          yield { type: 'chunk', text: text.slice(i, i + chunkSize) }
          if (delayMs > 0) await sleep(delayMs)
        }
        yield { type: 'done' }
      } catch (e) {
        yield { type: 'error', error: (e as Error).message }
      }
    },
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms))
}
