/**
 * Final live demo verification: hits the running server (port 3000) with real
 * Gemini, runs the exact two-round flow the user wants:
 *   - q1 → both models reply
 *   - q2 → both models reply with full context
 *
 * Asserts both responses are non-empty and the round-2 context contains the
 * round-1 user message + both round-1 answers.
 *
 * Run while `bun run dev:server` is up.
 */
const base = 'http://localhost:3000'

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`)
  process.exit(1)
}
function assert(cond: unknown, msg: string) {
  if (!cond) fail(msg)
}

async function consume(url: string, maxMs: number) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), maxMs)
  try {
    const res = await fetch(url, {
      headers: { Accept: 'text/event-stream' },
      signal: ctrl.signal,
    })
    const reader = res.body!.getReader()
    const dec = new TextDecoder()
    let buf = ''
    let chunks = ''
    let terminal: 'done' | 'error' | null = null
    let errorText: string | undefined
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let idx
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const block = buf.slice(0, idx)
        buf = buf.slice(idx + 2)
        let event = ''
        let data = ''
        for (const ln of block.split('\n')) {
          if (ln.startsWith('event:')) event = ln.slice(6).trim()
          else if (ln.startsWith('data:')) data += ln.slice(5).trim()
        }
        if (event === 'chunk') chunks += JSON.parse(data).text
        else if (event === 'done') terminal = 'done'
        else if (event === 'error') {
          terminal = 'error'
          errorText = JSON.parse(data).error
        }
        if (terminal) {
          try {
            reader.cancel()
          } catch {}
          return { chunks, terminal, errorText }
        }
      }
    }
    return { chunks, terminal: terminal ?? 'error', errorText }
  } finally {
    clearTimeout(t)
  }
}

async function main() {
  const session = await fetch(`${base}/api/sessions`, { method: 'POST' }).then(
    (r) => r.json(),
  )
  console.log(`session ${session.id}`)

  // Round 1
  const r1 = await fetch(`${base}/api/rounds`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sessionId: session.id,
      userText: 'In one short sentence, what is the capital of France?',
    }),
  }).then((r) => r.json())
  const r1res = await Promise.all(
    r1.assistantMessages.map((m: any) =>
      consume(`${base}/api/rounds/${r1.round.id}/stream/${m.agentId}`, 60_000),
    ),
  )
  for (let i = 0; i < r1res.length; i++) {
    const a = r1.assistantMessages[i]
    console.log(`R1 ${a.agentId}: terminal=${r1res[i].terminal} chunks=${r1res[i].chunks.length}b`)
    console.log(`  → "${r1res[i].chunks.slice(0, 200)}"`)
    assert(r1res[i].terminal === 'done', `R1 ${a.agentId} not done`)
    assert(r1res[i].chunks.length > 0, `R1 ${a.agentId} empty`)
  }

  await new Promise((r) => setTimeout(r, 200))

  // Round 2 — refer back to R1 to prove context is shared
  const r2 = await fetch(`${base}/api/rounds`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sessionId: session.id,
      userText: 'And what about Germany? Just the capital, one word.',
    }),
  }).then((r) => r.json())
  const r2res = await Promise.all(
    r2.assistantMessages.map((m: any) =>
      consume(`${base}/api/rounds/${r2.round.id}/stream/${m.agentId}`, 60_000),
    ),
  )
  for (let i = 0; i < r2res.length; i++) {
    const a = r2.assistantMessages[i]
    console.log(`R2 ${a.agentId}: terminal=${r2res[i].terminal} chunks=${r2res[i].chunks.length}b`)
    console.log(`  → "${r2res[i].chunks.slice(0, 200)}"`)
    assert(r2res[i].terminal === 'done', `R2 ${a.agentId} not done`)
    assert(r2res[i].chunks.length > 0, `R2 ${a.agentId} empty`)
    // Must reference Berlin — proof of context comprehension
    assert(
      /berlin/i.test(r2res[i].chunks),
      `R2 ${a.agentId} did not mention Berlin (got: ${r2res[i].chunks})`,
    )
  }

  // Context Lens for an R2 message — must include R1's q1 + both R1 answers
  await new Promise((r) => setTimeout(r, 300))
  const fresh = await fetch(`${base}/api/sessions/${session.id}`).then((r) =>
    r.json(),
  )
  const r2Asst = fresh.messages.find(
    (m: any) =>
      m.roundId === r2.round.id && m.role === 'assistant' && m.agentId === 'flash',
  )
  const lens = await fetch(`${base}/api/messages/${r2Asst.id}/context`).then(
    (r) => r.json(),
  )
  const visible = lens.filter((e: any) => e.visible)
  const sawR1User = visible.some(
    (e: any) => e.message.role === 'user' && e.message.roundIndex === 0,
  )
  const sawR1OtherAgent = visible.some(
    (e: any) =>
      e.message.role === 'assistant' &&
      e.message.agentId === 'lite' &&
      e.message.roundIndex === 0,
  )
  assert(sawR1User, 'lens: R1 user message visible')
  assert(sawR1OtherAgent, "lens: R1 other agent's answer visible")

  console.log('\nFINAL_DEMO_PASS')
  console.log('→ open http://localhost:5173/ in a browser to use the demo')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

export {}
