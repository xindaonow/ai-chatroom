import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { streamText, type ModelMessage } from 'ai'
import type { ProviderAdapter, StreamEvent } from './types'
import { coalesceMessages } from './coalesce'

/**
 * Gemini adapter via Vercel AI SDK.
 * Uses GEMINI_API_KEY from env.
 */
export function createGeminiAdapter(opts: {
  id: string
  model: string // e.g. 'gemini-2.5-flash' or 'gemini-2.5-pro'
  apiKey?: string
}): ProviderAdapter {
  const apiKey = opts.apiKey ?? process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY missing')
  }
  const google = createGoogleGenerativeAI({ apiKey })
  const model = google(opts.model)

  return {
    id: opts.id,
    async *stream({ messages, signal }): AsyncIterable<StreamEvent> {
      try {
        // Map our ProviderMessage[] to ai SDK CoreMessage[].
        // We must merge consecutive same-role messages because some providers
        // (Gemini included) reject patterns like user→user with strict role
        // alternation. We coalesce adjacent same-role entries.
        const merged = coalesceMessages(messages)

        const result = streamText({
          model,
          messages: merged as ModelMessage[],
          abortSignal: signal,
        })

        for await (const chunk of result.textStream) {
          if (signal?.aborted) {
            yield { type: 'error', error: 'aborted' }
            return
          }
          if (chunk.length > 0) {
            yield { type: 'chunk', text: chunk }
          }
        }
        yield { type: 'done' }
      } catch (e) {
        yield { type: 'error', error: (e as Error).message }
      }
    },
  }
}

