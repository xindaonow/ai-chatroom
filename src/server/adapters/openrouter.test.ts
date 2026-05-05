import { describe, test, expect, spyOn } from 'bun:test'
import { createOpenRouterAdapter } from './openrouter'

function fakeChatStream(text: string): Response {
  const body = [
    `data: {"id":"1","object":"chat.completion.chunk","choices":[{"delta":{"content":${JSON.stringify(text)}},"index":0,"finish_reason":null}]}`,
    'data: [DONE]',
    '',
  ].join('\n\n')
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

type CapturedRequest = { url: string; init: RequestInit }

function captureFetch(): {
  calls: CapturedRequest[]
  restore: () => void
  body: () => Record<string, unknown>
} {
  const calls: CapturedRequest[] = []
  const spy = spyOn(globalThis, 'fetch').mockImplementation(
    ((input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: input.toString(), init: init ?? {} })
      return Promise.resolve(fakeChatStream('hello'))
    }) as typeof fetch,
  )
  return {
    calls,
    restore: () => spy.mockRestore(),
    body: () => JSON.parse((calls[0].init.body ?? '{}') as string) as Record<string, unknown>,
  }
}

async function drain(adapter: ReturnType<typeof createOpenRouterAdapter>) {
  for await (const _ of adapter.stream({
    messages: [{ role: 'user', content: 'hi' }],
  })) {
    /* drain */
  }
}

describe('openrouter adapter', () => {
  test('hits /chat/completions endpoint, not Responses API /responses', async () => {
    const fx = captureFetch()
    try {
      await drain(
        createOpenRouterAdapter({ id: 't', model: 'some/model', apiKey: 'k' }),
      )
    } finally {
      fx.restore()
    }
    expect(fx.calls[0].url).toContain('/chat/completions')
    expect(fx.calls[0].url).not.toContain('/responses')
  })

  test('sends Authorization: Bearer <key> header', async () => {
    const fx = captureFetch()
    try {
      await drain(
        createOpenRouterAdapter({ id: 't', model: 'some/model', apiKey: 'sk-or-foo' }),
      )
    } finally {
      fx.restore()
    }
    const headers = fx.calls[0].init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer sk-or-foo')
  })

  test('default body has reasoning.effort=xhigh, verbosity=low, max_tokens=32000, stream=true', async () => {
    const fx = captureFetch()
    try {
      await drain(
        createOpenRouterAdapter({ id: 't', model: 'some/model', apiKey: 'k' }),
      )
    } finally {
      fx.restore()
    }
    const body = fx.body() as {
      stream?: boolean
      max_tokens?: number
      verbosity?: string
      reasoning?: { effort?: string }
    }
    expect(body.stream).toBe(true)
    expect(body.max_tokens).toBe(32000)
    expect(body.verbosity).toBe('low')
    expect(body.reasoning?.effort).toBe('xhigh')
  })

  test('reasoning effort can be overridden via opts', async () => {
    const fx = captureFetch()
    try {
      await drain(
        createOpenRouterAdapter({
          id: 't',
          model: 'some/model',
          apiKey: 'k',
          reasoningEffort: 'low',
        }),
      )
    } finally {
      fx.restore()
    }
    expect((fx.body() as { reasoning: { effort: string } }).reasoning.effort).toBe('low')
  })

  test('Anthropic models get cache_control marker on the last non-empty message', async () => {
    const fx = captureFetch()
    try {
      const adapter = createOpenRouterAdapter({
        id: 't',
        model: 'anthropic/claude-opus-4.7',
        apiKey: 'k',
      })
      for await (const _ of adapter.stream({
        messages: [
          { role: 'system', content: 'system prompt' },
          { role: 'user', content: 'first' },
          { role: 'assistant', content: 'reply' },
          { role: 'user', content: 'last user msg' },
        ],
      })) {
        /* drain */
      }
    } finally {
      fx.restore()
    }
    type Block = { type: string; text: string; cache_control?: { type: string } }
    type Msg = { role: string; content: Block[] }
    const body = fx.body() as { messages: Msg[] }

    // Messages should be in structured-content form for Anthropic.
    expect(Array.isArray(body.messages)).toBe(true)
    expect(body.messages[0].content[0].type).toBe('text')

    // Cache control on the last block only.
    const last = body.messages[body.messages.length - 1]
    expect(last.content[0].cache_control).toEqual({ type: 'ephemeral' })

    // Earlier messages do NOT have cache_control.
    for (let i = 0; i < body.messages.length - 1; i++) {
      expect(body.messages[i].content[0].cache_control).toBeUndefined()
    }
  })

  test('Anthropic path filters out empty trailing assistant placeholder', async () => {
    const fx = captureFetch()
    try {
      const adapter = createOpenRouterAdapter({
        id: 't',
        model: 'anthropic/claude-opus-4.7',
        apiKey: 'k',
      })
      for await (const _ of adapter.stream({
        messages: [
          { role: 'user', content: 'q' },
          { role: 'assistant', content: '' }, // empty placeholder, should be dropped
        ],
      })) {
        /* drain */
      }
    } finally {
      fx.restore()
    }
    const body = fx.body() as { messages: Array<{ role: string }> }
    // Empty assistant trailer is filtered out for Anthropic.
    expect(body.messages).toHaveLength(1)
    expect(body.messages[0].role).toBe('user')
  })

  test('non-Anthropic models keep plain string content (no cache_control gymnastics)', async () => {
    const fx = captureFetch()
    try {
      const adapter = createOpenRouterAdapter({
        id: 't',
        model: 'openai/gpt-5.5',
        apiKey: 'k',
      })
      for await (const _ of adapter.stream({
        messages: [{ role: 'user', content: 'q' }],
      })) {
        /* drain */
      }
    } finally {
      fx.restore()
    }
    const body = fx.body() as { messages: Array<{ content: unknown }> }
    expect(typeof body.messages[0].content).toBe('string')
  })

  test('coalesces consecutive same-role messages with \\n\\n separator', async () => {
    const fx = captureFetch()
    try {
      await drain(
        createOpenRouterAdapter({ id: 't', model: 'openai/gpt-5.5', apiKey: 'k' }),
      )
      // Drain second adapter call with same-role consecutive messages
      fx.calls.length = 0
      const adapter = createOpenRouterAdapter({
        id: 't',
        model: 'openai/gpt-5.5',
        apiKey: 'k',
      })
      for await (const _ of adapter.stream({
        messages: [
          { role: 'user', content: 'first' },
          { role: 'user', content: 'second' },
        ],
      })) {
        /* drain */
      }
    } finally {
      fx.restore()
    }
    const body = JSON.parse(fx.calls[0].init.body as string) as {
      messages: Array<{ role: string; content: string }>
    }
    expect(body.messages).toHaveLength(1)
    expect(body.messages[0].content).toBe('first\n\nsecond')
  })

  test('error response surfaces a useful error event', async () => {
    const spy = spyOn(globalThis, 'fetch').mockImplementation((async () => {
      return new Response('quota exceeded', { status: 429 })
    }) as unknown as typeof fetch)
    try {
      const adapter = createOpenRouterAdapter({
        id: 't',
        model: 'openai/gpt-5.5',
        apiKey: 'k',
      })
      const events: Array<{ type: string }> = []
      for await (const ev of adapter.stream({
        messages: [{ role: 'user', content: 'q' }],
      })) {
        events.push(ev)
      }
      const err = events.find((e) => e.type === 'error') as
        | { type: 'error'; error: string }
        | undefined
      expect(err).toBeDefined()
      expect(err!.error).toContain('429')
      expect(err!.error.toLowerCase()).toContain('quota')
    } finally {
      spy.mockRestore()
    }
  })

  test('throws if no API key is provided and env is empty', () => {
    const prev = process.env.OPENROUTER_API_KEY
    delete process.env.OPENROUTER_API_KEY
    try {
      expect(() =>
        createOpenRouterAdapter({ id: 't', model: 'openai/gpt-5.5' }),
      ).toThrow(/OPENROUTER_API_KEY/)
    } finally {
      if (prev !== undefined) process.env.OPENROUTER_API_KEY = prev
    }
  })
})
