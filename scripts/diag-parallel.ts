/**
 * Diagnostic: are flash and pro truly streaming in parallel, or sequentially?
 *
 * Connects to BOTH SSE streams concurrently and records the wall-clock time
 * of each agent's first chunk and last chunk. If first-chunk timestamps
 * are within ~1s of each other, the apparent left-then-right behavior is
 * just model latency, not server-side serialization.
 *
 * Run: bun run scripts/diag-parallel.ts (server must be on :3000)
 */
const base = 'http://localhost:3000'

type Trace = {
  agentId: string
  startMs: number
  firstChunkMs: number | null
  lastChunkMs: number | null
  chunkCount: number
  bytes: number
  terminal: 'done' | 'error' | null
}

async function trace(roundId: string, agentId: string, t0: number): Promise<Trace> {
  const out: Trace = {
    agentId,
    startMs: Date.now() - t0,
    firstChunkMs: null,
    lastChunkMs: null,
    chunkCount: 0,
    bytes: 0,
    terminal: null,
  }
  const res = await fetch(`${base}/api/rounds/${roundId}/stream/${agentId}`, {
    headers: { Accept: 'text/event-stream' },
  })
  const reader = res.body!.getReader()
  const dec = new TextDecoder()
  let buf = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let idx
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const block = buf.slice(0, idx)
      buf = buf.slice(idx + 2)
      let event = '',
        data = ''
      for (const ln of block.split('\n')) {
        if (ln.startsWith('event:')) event = ln.slice(6).trim()
        else if (ln.startsWith('data:')) data += ln.slice(5).trim()
      }
      if (event === 'chunk') {
        const text = JSON.parse(data).text as string
        const now = Date.now() - t0
        if (out.firstChunkMs === null) out.firstChunkMs = now
        out.lastChunkMs = now
        out.chunkCount++
        out.bytes += text.length
      } else if (event === 'done') {
        out.terminal = 'done'
        try {
          reader.cancel()
        } catch {}
        return out
      } else if (event === 'error') {
        out.terminal = 'error'
        try {
          reader.cancel()
        } catch {}
        return out
      }
    }
  }
  return out
}

async function main() {
  const session = await fetch(`${base}/api/sessions`, { method: 'POST' }).then(
    (r) => r.json(),
  )
  const round = await fetch(`${base}/api/rounds`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sessionId: session.id,
      userText:
        'Write exactly two short sentences about the ocean. No more, no less.',
    }),
  }).then((r) => r.json())

  const t0 = Date.now()
  // Kick BOTH subscriptions in the same JS tick, just like the browser does.
  const traces = await Promise.all(
    round.assistantMessages.map((m: any) => trace(round.round.id, m.agentId, t0)),
  )

  console.log('--- timing (ms relative to t0 = both subscribes kicked off) ---')
  for (const t of traces) {
    console.log(
      `  ${t.agentId.padEnd(6)} subscribe→${t.startMs}ms  firstChunk→${t.firstChunkMs}ms  lastChunk→${t.lastChunkMs}ms  chunks=${t.chunkCount}  bytes=${t.bytes}  end=${t.terminal}`,
    )
  }

  const sorted = [...traces].sort(
    (a, b) => (a.firstChunkMs ?? 0) - (b.firstChunkMs ?? 0),
  )
  const firstGap =
    (sorted[sorted.length - 1].firstChunkMs ?? 0) - (sorted[0].firstChunkMs ?? 0)
  console.log(`\nfirstChunk spread across agents: ${firstGap}ms`)
  if (firstGap < 1500) {
    console.log(
      'VERDICT: streams started in parallel; visual order is just model speed.',
    )
  } else {
    console.log(`VERDICT: spread > 1.5s — model TTFT differs significantly.`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

export {}
