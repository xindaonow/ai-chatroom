import { describe, test, expect } from 'bun:test'
import { coalesceMessages } from './coalesce'

describe('coalesceMessages', () => {
  test('joins consecutive bare-user messages with \\n\\n', () => {
    const out = coalesceMessages([
      { role: 'user', content: 'first' },
      { role: 'user', content: 'second' },
    ])
    expect(out).toEqual([{ role: 'user', content: 'first\n\nsecond' }])
  })

  test('preserves user → assistant alternation', () => {
    const out = coalesceMessages([
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'a' },
      { role: 'user', content: 'q2' },
    ])
    expect(out).toHaveLength(3)
    expect(out[0]).toEqual({ role: 'user', content: 'q' })
    expect(out[1]).toEqual({ role: 'assistant', content: 'a' })
    expect(out[2]).toEqual({ role: 'user', content: 'q2' })
  })

  test('places user question FIRST when peer-bracketed content is adjacent', () => {
    const out = coalesceMessages([
      { role: 'user', content: '[agent-B]: peer reply with\nmultiple lines' },
      { role: 'user', content: '继续' },
    ])
    expect(out).toHaveLength(1)
    const merged = out[0].content
    // User question must come before the peer divider.
    expect(merged.indexOf('继续')).toBeLessThan(merged.indexOf('═══'))
    expect(merged).toContain("OTHER AGENTS' RESPONSES")
    // Peer content survives.
    expect(merged).toContain('[agent-B]: peer reply with\nmultiple lines')
  })

  test('handles peer-only group with explanatory header', () => {
    const out = coalesceMessages([
      { role: 'user', content: '[agent-B]: only peer' },
      { role: 'user', content: '[agent-C]: another peer' },
    ])
    expect(out).toHaveLength(1)
    expect(out[0].content.startsWith('═══')).toBe(true)
    expect(out[0].content).toContain('[agent-B]: only peer')
    expect(out[0].content).toContain('[agent-C]: another peer')
  })

  test('keeps multiple peer entries in original order', () => {
    const out = coalesceMessages([
      { role: 'user', content: 'my question' },
      { role: 'user', content: '[agent-B]: first peer' },
      { role: 'user', content: '[agent-C]: second peer' },
    ])
    const merged = out[0].content
    expect(merged.indexOf('first peer')).toBeLessThan(merged.indexOf('second peer'))
  })
})
