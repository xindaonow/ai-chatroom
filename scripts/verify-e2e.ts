/**
 * End-to-end verification: spin up server with mock adapters, drive a
 * 2-round conversation through HTTP+SSE, assert DB state.
 *
 * Catches wiring bugs the unit tests can't see — orchestrator ↔ API ↔
 * repo ↔ SSE plumbing.
 *
 * Run: USE_MOCK_ADAPTERS=1 DB_PATH=:memory: bun run scripts/verify-e2e.ts
 */
import { openDb } from '../src/server/db'
import { createRepo } from '../src/server/repo'
import { buildAgents } from '../src/server/adapters'
import { createOrchestrator } from '../src/server/orchestrator'
import { createApi } from '../src/server/api'

process.env.USE_MOCK_ADAPTERS = '1'

const db = openDb(':memory:')
const repo = createRepo(db)
const agents = buildAgents()
const orch = createOrchestrator({ repo, agents })
const app = createApi(orch)

// Probe a free port via node:net (Bun.serve's `port: 0` doesn't reliably bind
// ephemerally on every Bun build). Override with VERIFY_PORT if needed.
import { findFreePort } from './_helpers'
const PORT = process.env.VERIFY_PORT
  ? Number(process.env.VERIFY_PORT)
  : await findFreePort()
const server = Bun.serve({ port: PORT, fetch: app.fetch, idleTimeout: 60 })

const base = `http://localhost:${server.port}`

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`)
  server.stop(true)
  process.exit(1)
}

function assert(cond: unknown, msg: string) {
  if (!cond) fail(msg)
}

async function consumeStream(
  url: string,
): Promise<{ chunks: string[]; terminal: 'done' | 'error'; errorText?: string }> {
  const res = await fetch(url, {
    headers: { Accept: 'text/event-stream' },
  })
  if (!res.body) throw new Error('no body')
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const chunks: string[] = []
  let terminal: 'done' | 'error' | null = null
  let errorText: string | undefined

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx: number
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)
      const event = parseSseBlock(block)
      if (!event) continue
      if (event.event === 'chunk') {
        chunks.push(JSON.parse(event.data).text)
      } else if (event.event === 'done') {
        terminal = 'done'
      } else if (event.event === 'error') {
        terminal = 'error'
        errorText = JSON.parse(event.data).error
      }
      if (terminal) {
        try {
          reader.cancel()
        } catch {}
        return { chunks, terminal, errorText }
      }
    }
  }
  if (!terminal) throw new Error('stream ended without terminal event')
  return { chunks, terminal, errorText }
}

function parseSseBlock(block: string): { event: string; data: string } | null {
  let event = ''
  let data = ''
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) data += line.slice(5).trim()
  }
  if (!event) return null
  return { event, data }
}

async function run() {
  // 1. Health check
  const health = await fetch(`${base}/api/health`).then((r) => r.json())
  assert(health.ok === true, 'health check')

  // 2. Create session — endpoint returns { session, agents }
  const created = await fetch(`${base}/api/sessions`, { method: 'POST' }).then(
    (r) => r.json(),
  )
  const session = created.session
  assert(session?.id, 'session created')
  console.log(`[verify-e2e] session ${session.id}`)

  // 3. Round 1: ask q1, stream from both agents in parallel
  const r1 = await fetch(`${base}/api/rounds`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: session.id, userText: 'q1' }),
  }).then((r) => r.json())
  assert(r1.round?.id, 'round 1 started')
  assert(
    r1.assistantMessages?.length === agents.length,
    `${agents.length} assistant placeholders`,
  )

  const [r1a, r1b] = await Promise.all(
    agents.map((a) =>
      consumeStream(`${base}/api/rounds/${r1.round.id}/stream/${a.id}`),
    ),
  )
  assert(r1a.terminal === 'done', `agent A round 1 done (got ${r1a.terminal})`)
  assert(r1b.terminal === 'done', `agent B round 1 done (got ${r1b.terminal})`)
  const r1aText = r1a.chunks.join('')
  const r1bText = r1b.chunks.join('')
  console.log(`[verify-e2e] round 1: A="${r1aText}" B="${r1bText}"`)
  assert(r1aText.includes('q1'), 'agent A response references q1')
  assert(r1bText.includes('q1'), 'agent B response references q1')

  // Wait briefly so the orchestrator's allSettled-then-finalize fires.
  await new Promise((r) => setTimeout(r, 100))

  // 4. Verify DB state after round 1 finalize
  const fetched1 = await fetch(`${base}/api/sessions/${session.id}`).then(
    (r) => r.json(),
  )
  const round1 = fetched1.rounds.find((r: any) => r.id === r1.round.id)
  assert(round1?.status === 'finalized', 'round 1 finalized in DB')

  const r1Messages = fetched1.messages.filter(
    (m: any) => m.roundId === r1.round.id,
  )
  const r1Asst = r1Messages.filter((m: any) => m.role === 'assistant')
  assert(
    r1Asst.length === agents.length,
    `${agents.length} assistant messages in DB`,
  )
  for (const m of r1Asst) {
    assert(m.status === 'finalized', `assistant ${m.agentId} finalized`)
    assert(m.visibleTo === '*', `assistant ${m.agentId} visibleTo='*'`)
    assert(m.rendered != null, `assistant ${m.agentId} rendered set`)
  }

  // 5. Round 2: ask q2, both agents should now have full history
  const r2 = await fetch(`${base}/api/rounds`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: session.id, userText: 'q2' }),
  }).then((r) => r.json())
  assert(r2.round?.id, 'round 2 started')

  const [r2a, r2b] = await Promise.all(
    agents.map((a) =>
      consumeStream(`${base}/api/rounds/${r2.round.id}/stream/${a.id}`),
    ),
  )
  const r2aText = r2a.chunks.join('')
  const r2bText = r2b.chunks.join('')
  console.log(`[verify-e2e] round 2: A="${r2aText}" B="${r2bText}"`)
  assert(r2a.terminal === 'done', 'agent A round 2 done')
  assert(r2b.terminal === 'done', 'agent B round 2 done')
  // Mock adapter echoes the latest user message; both agents see q2.
  assert(r2aText.includes('q2'), 'agent A round 2 references q2')
  assert(r2bText.includes('q2'), 'agent B round 2 references q2')

  await new Promise((r) => setTimeout(r, 100))

  // Confirm round-2 history persisted: GET /api/sessions/:id should return
  // both rounds finalized with the agent replies we observed via SSE.
  const fetched2 = await fetch(`${base}/api/sessions/${session.id}`).then(
    (r) => r.json(),
  )
  const r2Asst = fetched2.messages.filter(
    (m: any) => m.roundId === r2.round.id && m.role === 'assistant',
  )
  const firstAgentId = agents[0].id
  const aMsg = r2Asst.find((m: any) => m.agentId === firstAgentId)
  assert(aMsg, `found ${firstAgentId}'s round-2 message`)
  assert(aMsg.status === 'finalized', `${firstAgentId}'s round-2 message finalized`)
  assert(
    String(aMsg.content).includes('q2'),
    `${firstAgentId}'s round-2 reply references q2`,
  )

  // Persisted prompt snapshot: round-2 prompt for agent A must include q1
  // (prior user turn) AND q2 (current user turn merged with peer block).
  const promptResp = await fetch(
    `${base}/api/messages/${aMsg.id}/prompt`,
  ).then((r) => r.json())
  const promptStr = JSON.stringify(promptResp.messages)
  assert(promptStr.includes('q1'), 'prompt: q1 present in history')
  assert(promptStr.includes('q2'), 'prompt: q2 present in current turn')

  console.log('[verify-e2e] PASS')
  server.stop(true)
  process.exit(0)
}

run().catch((e) => {
  console.error(e)
  server.stop(true)
  process.exit(1)
})
