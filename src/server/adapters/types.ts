export type ProviderMessage = {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export type StreamEvent =
  | { type: 'chunk'; text: string }
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
