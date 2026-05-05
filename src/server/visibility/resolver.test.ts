import { describe, test, expect, beforeEach } from 'bun:test'
import { resetDbForTests } from '../db'
import { createRepo, type Repo } from '../repo'
import {
  buildContextFor,
  finalizeRound,
  initialVisibilityForAssistant,
  initialVisibilityForUser,
} from './resolver'
import { buildRendered } from './render'
import type { Message, Round, Session } from '@shared/index'

const AGENTS = ['flash', 'pro']
const PUBLIC_IDS = { flash: 'flash', pro: 'pro' } // identity in tests for clarity
let repo: Repo
let now = 1_000

function nextTs() {
  return ++now
}

function newSession(): Session {
  const ts = nextTs()
  const s: Session = {
    id: 's1',
    agents: AGENTS.map((id) => ({ id, label: id, model: id })),
    title: null,
    createdAt: ts,
    updatedAt: ts,
  }
  repo.insertSession(s)
  return s
}

function newRound(sessionId: string, idx: number): Round {
  const r: Round = {
    id: `r${idx}`,
    sessionId,
    index: idx,
    status: 'streaming',
    createdAt: nextTs(),
  }
  repo.insertRound(r)
  return r
}

function insertUserMsg(round: Round, text: string): Message {
  const m: Message = {
    id: `u-${round.id}`,
    sessionId: round.sessionId,
    roundId: round.id,
    roundIndex: round.index,
    role: 'user',
    agentId: null,
    content: text,
    status: 'streaming',
    visibleTo: initialVisibilityForUser(),
    rendered: null,
    prompt: null,
    createdAt: nextTs(),
    finalizedAt: null,
  }
  repo.insertMessage(m)
  return m
}

function insertAsstPlaceholder(round: Round, agentId: string): Message {
  const m: Message = {
    id: `a-${round.id}-${agentId}`,
    sessionId: round.sessionId,
    roundId: round.id,
    roundIndex: round.index,
    role: 'assistant',
    agentId,
    content: '',
    status: 'streaming',
    visibleTo: initialVisibilityForAssistant(agentId),
    rendered: null,
    prompt: null,
    createdAt: nextTs(),
    finalizedAt: null,
  }
  repo.insertMessage(m)
  return m
}

beforeEach(() => {
  const db = resetDbForTests()
  repo = createRepo(db)
  now = 1_000
})

describe('Visibility — intra-round isolation while streaming', () => {
  test('round 1: A cannot see B streaming message and vice versa', () => {
    const s = newSession()
    const r1 = newRound(s.id, 0)
    insertUserMsg(r1, 'q1')
    const aMsg = insertAsstPlaceholder(r1, 'flash')
    const bMsg = insertAsstPlaceholder(r1, 'pro')

    repo.appendMessageContent(aMsg.id, 'partial-a')
    repo.appendMessageContent(bMsg.id, 'partial-b')

    const ctxA = buildContextFor(repo, {
      sessionId: s.id,
      viewer: 'flash',
      upToRoundIndex: 0,
      allAgentIds: AGENTS,
      publicIds: PUBLIC_IDS,
    })
    const ctxB = buildContextFor(repo, {
      sessionId: s.id,
      viewer: 'pro',
      upToRoundIndex: 0,
      allAgentIds: AGENTS,
      publicIds: PUBLIC_IDS,
    })

    // A sees: user q1 + own streaming partial; NOT B's content
    const aContents = ctxA.map((m) => m.content).join('\n')
    expect(aContents).toContain('q1')
    expect(aContents).toContain('partial-a')
    expect(aContents).not.toContain('partial-b')

    const bContents = ctxB.map((m) => m.content).join('\n')
    expect(bContents).toContain('q1')
    expect(bContents).toContain('partial-b')
    expect(bContents).not.toContain('partial-a')
  })
})

describe('Visibility — finalize promotes to all-visible', () => {
  test('after finalize: both A and B see each other in next-round context', () => {
    const s = newSession()
    const r1 = newRound(s.id, 0)
    insertUserMsg(r1, 'q1')
    const aMsg = insertAsstPlaceholder(r1, 'flash')
    const bMsg = insertAsstPlaceholder(r1, 'pro')
    repo.setMessageContent(aMsg.id, 'ans-a')
    repo.setMessageContent(bMsg.id, 'ans-b')

    finalizeRound(repo, {
      roundId: r1.id,
      allAgentIds: AGENTS,
      publicIds: PUBLIC_IDS,
      now: nextTs(),
    })

    // Round 2 starts
    const r2 = newRound(s.id, 1)
    insertUserMsg(r2, 'q2')

    const ctxA = buildContextFor(repo, {
      sessionId: s.id,
      viewer: 'flash',
      upToRoundIndex: 1,
      allAgentIds: AGENTS,
      publicIds: PUBLIC_IDS,
    })
    const aContents = ctxA.map((m) => `${m.role}|${m.content}`).join('\n')
    expect(aContents).toContain('q1')
    expect(aContents).toContain('ans-a') // own message
    expect(aContents).toContain('ans-b') // other agent's, exposed via rendered
    expect(aContents).toContain('q2')

    // B's perspective: same content visibility, but ans-a appears via [flash]: tag
    const ctxB = buildContextFor(repo, {
      sessionId: s.id,
      viewer: 'pro',
      upToRoundIndex: 1,
      allAgentIds: AGENTS,
      publicIds: PUBLIC_IDS,
    })
    const bRendered = ctxB.map((m) => m.content).join('\n')
    expect(bRendered).toContain('[flash]: ans-a') // wrapped with source tag
    expect(bRendered).toContain('ans-b') // own (no wrap)
  })

  test("within a round: viewer's own assistant comes BEFORE peer assistants", () => {
    // Regression: peers were inserted before viewer when viewer was later in
    // the agents iteration order, so listVisibleMessages returned them in the
    // wrong chat order — peer answers ended up coalescing with the WRONG
    // user turn (the previous round's question instead of the next round's).
    const s = newSession()
    const r1 = newRound(s.id, 0)
    insertUserMsg(r1, 'q1')
    // Peer 'flash' inserted FIRST, then viewer 'pro' — exactly the case that
    // used to misorder the rendered output for viewer 'pro'.
    const flashMsg = insertAsstPlaceholder(r1, 'flash')
    const proMsg = insertAsstPlaceholder(r1, 'pro')
    repo.setMessageContent(flashMsg.id, 'ans-flash')
    repo.setMessageContent(proMsg.id, 'ans-pro')
    finalizeRound(repo, {
      roundId: r1.id,
      allAgentIds: AGENTS,
      publicIds: PUBLIC_IDS,
      now: nextTs(),
    })

    const ctx = buildContextFor(repo, {
      sessionId: s.id,
      viewer: 'pro',
      upToRoundIndex: 0,
      allAgentIds: AGENTS,
      publicIds: PUBLIC_IDS,
    })
    // Expected order:
    //   [0] user            "q1"
    //   [1] assistant       "ans-pro"            ← viewer's own, immediately after user
    //   [2] user (peer)     "[flash]: ans-flash" ← peer comes AFTER own
    expect(ctx[0].role).toBe('user')
    expect(ctx[0].content).toBe('q1')
    expect(ctx[1].role).toBe('assistant')
    expect(ctx[1].content).toBe('ans-pro')
    expect(ctx[2].role).toBe('user')
    expect(ctx[2].content).toBe('[flash]: ans-flash')
  })
})

describe('Visibility — rendered snapshot is byte-stable', () => {
  test('rendered written once, reads return identical bytes', () => {
    const s = newSession()
    const r1 = newRound(s.id, 0)
    insertUserMsg(r1, 'q1')
    const aMsg = insertAsstPlaceholder(r1, 'flash')
    repo.setMessageContent(aMsg.id, 'hello world')

    finalizeRound(repo, {
      roundId: r1.id,
      allAgentIds: AGENTS,
      publicIds: PUBLIC_IDS,
      now: nextTs(),
    })

    const m1 = repo.getMessage(aMsg.id)!
    const m2 = repo.getMessage(aMsg.id)!
    expect(JSON.stringify(m1.rendered)).toBe(JSON.stringify(m2.rendered))
    expect(m1.rendered).not.toBeNull()
    expect(m1.rendered!['flash']).toEqual({
      role: 'assistant',
      content: 'hello world',
    })
    expect(m1.rendered!['pro']).toEqual({
      role: 'user',
      content: '[flash]: hello world',
    })
  })

  test('two-round sequence: first round messages produce identical context bytes across calls', () => {
    const s = newSession()
    const r1 = newRound(s.id, 0)
    insertUserMsg(r1, 'q1')
    const a1 = insertAsstPlaceholder(r1, 'flash')
    const b1 = insertAsstPlaceholder(r1, 'pro')
    repo.setMessageContent(a1.id, 'ans-a')
    repo.setMessageContent(b1.id, 'ans-b')
    finalizeRound(repo, {
      roundId: r1.id,
      allAgentIds: AGENTS,
      publicIds: PUBLIC_IDS,
      now: nextTs(),
    })

    const ctx_first = buildContextFor(repo, {
      sessionId: s.id,
      viewer: 'flash',
      upToRoundIndex: 0,
      allAgentIds: AGENTS,
      publicIds: PUBLIC_IDS,
    })

    // Add round 2 (does not change finalized round 1 messages)
    const r2 = newRound(s.id, 1)
    insertUserMsg(r2, 'q2')
    insertAsstPlaceholder(r2, 'flash')
    insertAsstPlaceholder(r2, 'pro')

    const ctx_second_prefix = buildContextFor(repo, {
      sessionId: s.id,
      viewer: 'flash',
      upToRoundIndex: 1,
      allAgentIds: AGENTS,
      publicIds: PUBLIC_IDS,
    }).slice(0, ctx_first.length)

    expect(JSON.stringify(ctx_first)).toBe(JSON.stringify(ctx_second_prefix))
  })
})

describe('Visibility — manual override (future-proof)', () => {
  test('setting visibleTo to exclude an agent hides the message from them', () => {
    const s = newSession()
    const r1 = newRound(s.id, 0)
    insertUserMsg(r1, 'q1')
    const aMsg = insertAsstPlaceholder(r1, 'flash')
    const bMsg = insertAsstPlaceholder(r1, 'pro')
    repo.setMessageContent(aMsg.id, 'ans-a-secret')
    repo.setMessageContent(bMsg.id, 'ans-b')
    finalizeRound(repo, {
      roundId: r1.id,
      allAgentIds: AGENTS,
      publicIds: PUBLIC_IDS,
      now: nextTs(),
    })

    // Now manually hide ans-a from pro (only visible to flash)
    repo.setVisibility(aMsg.id, ['flash'])

    const ctxPro = buildContextFor(repo, {
      sessionId: s.id,
      viewer: 'pro',
      upToRoundIndex: 0,
      allAgentIds: AGENTS,
      publicIds: PUBLIC_IDS,
    })
    const proContent = ctxPro.map((m) => m.content).join('\n')
    expect(proContent).not.toContain('ans-a-secret')
    expect(proContent).toContain('ans-b')

    const ctxFlash = buildContextFor(repo, {
      sessionId: s.id,
      viewer: 'flash',
      upToRoundIndex: 0,
      allAgentIds: AGENTS,
      publicIds: PUBLIC_IDS,
    })
    const flashContent = ctxFlash.map((m) => m.content).join('\n')
    expect(flashContent).toContain('ans-a-secret')
  })
})

describe('Visibility — buildRendered structural correctness', () => {
  test('user message is viewer-agnostic', () => {
    const r = buildRendered({
      message: { role: 'user', agentId: null, content: 'hi' },
      allAgentIds: AGENTS,
      publicIds: PUBLIC_IDS,
    })
    expect(r['*']).toEqual({ role: 'user', content: 'hi' })
  })

  test('assistant message: self sees role=assistant, others see role=user with tag', () => {
    const r = buildRendered({
      message: { role: 'assistant', agentId: 'flash', content: 'foo' },
      allAgentIds: AGENTS,
      publicIds: PUBLIC_IDS,
    })
    expect(r['flash']).toEqual({ role: 'assistant', content: 'foo' })
    expect(r['pro']).toEqual({ role: 'user', content: '[flash]: foo' })
  })
})
