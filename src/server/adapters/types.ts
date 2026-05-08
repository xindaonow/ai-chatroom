export type ProviderMessage = {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export type StreamEvent =
  | { type: 'chunk'; text: string }
  /** Final token counts from the provider. Yielded once per stream, just
   *  before `done`. Consumers persist this to the message row so the UI
   *  can display per-bubble token usage. */
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'done' }
  | { type: 'error'; error: string }

export interface ProviderAdapter {
  /** Display id, e.g. 'flash' or 'pro'. */
  id: string
  /** Stream a completion. AbortSignal cancels the underlying call. */
  stream(args: {
    messages: ProviderMessage[]
    signal?: AbortSignal
  }): AsyncIterable<StreamEvent>
}
