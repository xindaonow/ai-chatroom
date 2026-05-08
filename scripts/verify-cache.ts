/**
 * Prompt-cache prefix-stability verification.
 *
 * Approach: simulate two consecutive rounds and assert that the messages
 * fed to each agent in round N+1 STARTS WITH the exact byte sequence
 * (JSON-stringified) that was fed to that same agent in round N — i.e.
 * the rendered snapshots of all finalized messages are reused verbatim.
 *
 * If this holds, prompt cache (Claude/OpenAI/Gemini) can hit on the prefix.
 * Run: bun run scripts/verify-cache.ts
 */
import { openDb } from '../src/server/db'
import { createRepo } from '../src/server/repo'
import {
  buildContextFor,
  finalizeRound,
  initialVisibilityForAssistant,
  initialVisibilityForUser,
} from '../src/server/visibility/resolver'
import { newId } from '../src/server/ids'
import type { Message, Round, Session } from '../src/shared/index'

const AGENTS = ['flash', 'pro']
const PUBLIC_IDS = { flash: 'flash', pro: 'pro' }

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`)
  process.exit(1)
}
function assert(cond: unknown, msg: string) {
  if (!cond) fail(msg)
}

const db = openDb(':memory:')
const repo = createRepo(db)
const session: Session = {
  id: newId('s'),
  agents: AGENTS.map((id) => ({ id, label: id, model: id })),
  title: null,
  mode: 'free',
  createdAt: 1,
  updatedAt: 1,
}
repo.insertSession(session)

let now = 100
function ts() {
  return ++now
}

function addRound(text: string, idx: number) {
  const round: Round = {
    id: newId('r'),
    sessionId: session.id,
    index: idx,
    status: 'streaming',
    createdAt: ts(),
  }
  repo.insertRound(round)

  const userMsg: Message = {
    id: newId('u'),
    sessionId: session.id,
    roundId: round.id,
    roundIndex: idx,
    role: 'user',
    agentId: null,
    content: text,
    status: 'finalized',
    visibleTo: initialVisibilityForUser(),
    rendered: { '*': { role: 'user', content: text } },
    prompt: null,
    inputTokens: null,
    outputTokens: null,
    createdAt: ts(),
    finalizedAt: ts(),
  }
  repo.insertMessage(userMsg)

  for (const agentId of AGENTS) {
    const m: Message = {
      id: newId('a'),
      sessionId: session.id,
      roundId: round.id,
      roundIndex: idx,
      role: 'assistant',
      agentId,
      content: `${agentId}-answer-r${idx}`,
      status: 'streaming',
      visibleTo: initialVisibilityForAssistant(agentId),
      rendered: null,
      prompt: null,
      inputTokens: null,
      outputTokens: null,
      createdAt: ts(),
      finalizedAt: null,
    }
    repo.insertMessage(m)
  }

  finalizeRound(repo, {
    roundId: round.id,
    allAgentIds: AGENTS,
    publicIds: PUBLIC_IDS,
    now: ts(),
  })
  return round
}

// Round 1: build flash's context BEFORE any answers (mid-streaming would
// be a different test). For "request prefix" we need to rebuild the prompt
// the way the orchestrator would for round 1 (no priors, just user q1).
// Then for round 2, rebuild for round 2 (priors + new user q2). Compare
// JSON-encoded byte prefix.
addRound('q1', 0)
const ctxR1ForFlash = buildContextFor(repo, {
  sessionId: session.id,
  viewer: 'flash',
  upToRoundIndex: 0,
  allAgentIds: AGENTS,
  publicIds: PUBLIC_IDS,
})
const r1Bytes = JSON.stringify(ctxR1ForFlash)

addRound('q2', 1)
const ctxR2ForFlash = buildContextFor(repo, {
  sessionId: session.id,
  viewer: 'flash',
  upToRoundIndex: 1,
  allAgentIds: AGENTS,
  publicIds: PUBLIC_IDS,
})
const r2Bytes = JSON.stringify(ctxR2ForFlash)

// The round-2 byte sequence must contain the round-1 byte sequence as a
// proper prefix when serialized as a JSON array. Because both serialize
// as `[<entry>,<entry>,...]`, we need to compare element-by-element rather
// than raw string prefix.
assert(
  ctxR2ForFlash.length > ctxR1ForFlash.length,
  'round 2 has more entries than round 1',
)
for (let i = 0; i < ctxR1ForFlash.length; i++) {
  const a = JSON.stringify(ctxR1ForFlash[i])
  const b = JSON.stringify(ctxR2ForFlash[i])
  assert(
    a === b,
    `entry ${i} drifted between rounds: r1=${a} r2=${b}`,
  )
}

// Sanity: rendered snapshots are non-null after finalize.
const allFlashMsgs = repo.listMessages(session.id)
const finalizedAsst = allFlashMsgs.filter(
  (m) => m.role === 'assistant' && m.status === 'finalized',
)
assert(
  finalizedAsst.every((m) => m.rendered !== null),
  'all finalized assistant messages have rendered snapshots',
)

console.log(
  `[verify-cache] r1.len=${ctxR1ForFlash.length}entries r2.len=${ctxR2ForFlash.length}entries r1.bytes=${r1Bytes.length} r2.bytes=${r2Bytes.length}`,
)
console.log(`[verify-cache] r1 prefix matches in r2 element-by-element ✓`)
console.log('[verify-cache] PASS')
