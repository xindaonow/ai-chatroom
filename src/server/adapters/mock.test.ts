import { describe, test, expect } from 'bun:test'
import { createMockAdapter } from './mock'

describe('mock adapter', () => {
  test('emits chunks then done; output matches reply', async () => {
    const adapter = createMockAdapter({ id: 'a', chunkSize: 4, delayMs: 0 })
    const events: string[] = []
    let assembled = ''
    let saw_done = false

    for await (const ev of adapter.stream({
      messages: [{ role: 'user', content: 'hello world' }],
    })) {
      events.push(ev.type)
      if (ev.type === 'chunk') assembled += ev.text
      if (ev.type === 'done') saw_done = true
    }
    expect(saw_done).toBe(true)
    expect(assembled).toBe('[a] echo: hello world')
    expect(events[events.length - 1]).toBe('done')
  })

  test('respects abort signal mid-stream', async () => {
    const adapter = createMockAdapter({
      id: 'a',
      chunkSize: 1,
      delayMs: 5,
      reply: () => 'aaaaaaaaaaaaaaaaaaaa', // 20 chars
    })
    const ctrl = new AbortController()
    setTimeout(() => ctrl.abort(), 12)

    let saw_error = false
    let chunks = 0
    for await (const ev of adapter.stream({
      messages: [{ role: 'user', content: 'go' }],
      signal: ctrl.signal,
    })) {
      if (ev.type === 'chunk') chunks++
      if (ev.type === 'error') saw_error = true
    }
    expect(saw_error).toBe(true)
    expect(chunks).toBeLessThan(20)
  })
})
