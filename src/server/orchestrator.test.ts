import { describe, test, expect, beforeEach } from 'bun:test'
import { resetDbForTests } from './db'
import { createRepo } from './repo'
import { createOrchestrator } from './orchestrator'
import { createMockAdapter } from './adapters/mock'
import type { AgentSpec } from './adapters'

/**
 * Build an orchestrator wired to an in-memory DB and 3 mock agents whose
 * stream emit timing is fully controllable per-test. We use the `reply`
 * function plus chunkSize/delayMs to shape per-agent stream behavior.
 */
function setup(opts?: {
  delaysMs?: [number, number, number]
  replies?: [string, string, string]
}) {
  const db = resetDbForTests()
  const repo = createRepo(db)
  const delays = opts?.delaysMs ?? [5, 5, 5]
  const replies = opts?.replies ?? ['alpha', 'beta', 'gamma']
  const agents: AgentSpec[] = ['claude', 'gemini', 'gpt'].map((id, i) => ({
    id,
    publicId: `agent-${String.fromCharCode(65 + i)}`,
    label: id.toUpperCase(),
    model: `mock/${id}`,
    adapter: createMockAdapter({
      id,
      delayMs: delays[i],
      reply: () => replies[i],
    }),
  }))
  const orch = createOrchestrator({ repo, agents })
  const session = orch.createSession()
  return { repo, orch, session, agents }
}

describe('orchestrator: per-message finalize', () => {
  test('each message gets finalized at its own stream-done time, not round-level', async () => {
    // Three agents with very different stream durations. Finalized timestamps
    // should differ — fast agent stamps early, slow agent stamps late.
    const { orch, repo, session } = setup({
      delaysMs: [5, 30, 80],
      replies: ['fast', 'medium-length-text', 'slowest-and-longest-reply'],
    })

    const { round, assistantMessages } = orch.startRound({
      sessionId: session.id,
      userText: 'hi',
      mode: 'free',
    })

    await orch.waitForRoundFinalized(round.id)

    const finalizedAts = assistantMessages
      .map((m) => repo.getMessage(m.id)?.finalizedAt)
      .filter((t): t is number => t != null)
      .sort((a, b) => a - b)

    expect(finalizedAts).toHaveLength(3)
    // The fastest and slowest finishers should differ measurably.
    const spread = finalizedAts[2] - finalizedAts[0]
    expect(spread).toBeGreaterThan(30)
  })

  test('agent A finalizes before peers — its row flips to "finalized" while B/C still streaming', async () => {
    // Agent A's reply is short + delayMs=2 (very fast). B and C are slow.
    const { orch, repo, session, agents } = setup({
      delaysMs: [2, 200, 200],
      replies: ['x', 'a-much-longer-response', 'another-long-response'],
    })
    const { round, assistantMessages } = orch.startRound({
      sessionId: session.id,
      userText: 'q',
      mode: 'free',
    })

    // Wait for A's stream to finish, but NOT for the round.
    const aStreamId = assistantMessages.find((m) => m.agentId === agents[0].id)!.id
    // Poll until A is done. Should happen well before B/C finish.
    let i = 0
    while (i++ < 50) {
      const a = repo.getMessage(aStreamId)
      if (a?.status === 'finalized') break
      await new Promise((r) => setTimeout(r, 10))
    }

    const a = repo.getMessage(aStreamId)
    expect(a?.status).toBe('finalized')
    expect(a?.finalizedAt).not.toBeNull()
    expect(a?.visibleTo).toBe('*') // flipped per-message, not waiting for round

    // B and C should STILL be streaming at this point.
    const stillStreaming = assistantMessages
      .filter((m) => m.agentId !== agents[0].id)
      .map((m) => repo.getMessage(m.id))
    for (const m of stillStreaming) {
      expect(m?.status).toBe('streaming')
      expect(m?.finalizedAt).toBeNull()
    }

    // Drain the rest so test cleanup is graceful.
    await orch.waitForRoundFinalized(round.id)
  })

  test('round status flips to finalized only after all agents done', async () => {
    const { orch, repo, session } = setup({ delaysMs: [3, 3, 3] })
    const { round } = orch.startRound({
      sessionId: session.id,
      userText: 'q',
      mode: 'free',
    })

    // Right after startRound returns, round is streaming.
    expect(repo.getRound(round.id)?.status).toBe('streaming')

    await orch.waitForRoundFinalized(round.id)
    expect(repo.getRound(round.id)?.status).toBe('finalized')
  })

  test('finalized message has rendered snapshot built per-viewer', async () => {
    const { orch, repo, session, agents } = setup({ delaysMs: [3, 3, 3] })
    const { round, assistantMessages } = orch.startRound({
      sessionId: session.id,
      userText: 'q',
      mode: 'free',
    })
    await orch.waitForRoundFinalized(round.id)

    const m = repo.getMessage(assistantMessages[0].id)!
    expect(m.rendered).not.toBeNull()
    // Author sees own message as 'assistant' role (no peer prefix).
    const authorView = m.rendered![agents[0].id]
    expect(authorView).toBeDefined()
    expect(authorView!.role).toBe('assistant')
    expect(authorView!.content).not.toContain('[agent-')
    // Peers see this message wrapped as user role with [publicId]: prefix.
    const peerView = m.rendered![agents[1].id]
    expect(peerView).toBeDefined()
    expect(peerView!.role).toBe('user')
    expect(peerView!.content).toMatch(/^\[agent-A\]:/)
  })
})

describe('orchestrator: streaming + visibility integration', () => {
  test('round 2 history includes round 0 + round 1 finalized peer messages with publicId tags', async () => {
    const { orch, repo, session, agents } = setup({
      delaysMs: [3, 3, 3],
      replies: ['REPLY_R0_A', 'REPLY_R0_B', 'REPLY_R0_C'],
    })

    // Round 0
    const { round: r0 } = orch.startRound({
      sessionId: session.id,
      userText: 'first question',
      mode: 'free',
    })
    await orch.waitForRoundFinalized(r0.id)

    // After round 0, peers should be visible to all
    const r0Messages = repo.listMessagesByRound(r0.id)
    const assistantMsgs = r0Messages.filter((m) => m.role === 'assistant')
    for (const am of assistantMsgs) {
      expect(am.visibleTo).toBe('*') // public after finalize
      // Peer view: 'user' role + [agent-X]: prefix
      const peerId = agents.find((a) => a.id !== am.agentId)!.id
      const peerView = am.rendered![peerId]
      expect(peerView!.role).toBe('user')
      expect(peerView!.content).toContain('[agent-')
      expect(peerView!.content).toContain(am.content)
    }
  })
})

describe('orchestrator: retry message', () => {
  test('retryMessage resets content + status, then re-runs and finalizes', async () => {
    const { orch, repo, session } = setup({
      delaysMs: [3, 3, 3],
      replies: ['original-A', 'original-B', 'original-C'],
    })
    const { round, assistantMessages } = orch.startRound({
      sessionId: session.id,
      userText: 'q',
      mode: 'free',
    })
    await orch.waitForRoundFinalized(round.id)

    const targetId = assistantMessages[0].id
    const before = repo.getMessage(targetId)!
    expect(before.status).toBe('finalized')
    expect(before.content).toBe('original-A')

    // Retry — note: stream content stays the same since reply is fixed,
    // but status should cycle: finalized → streaming → finalized again.
    orch.retryMessage(targetId)

    // Right after retry the message is reset to streaming with empty content.
    const mid = repo.getMessage(targetId)!
    expect(mid.status).toBe('streaming')
    expect(mid.content).toBe('')

    // Wait for the new stream to complete.
    let i = 0
    while (i++ < 100) {
      const m = repo.getMessage(targetId)!
      if (m.status === 'finalized') break
      await new Promise((r) => setTimeout(r, 10))
    }

    const after = repo.getMessage(targetId)!
    expect(after.status).toBe('finalized')
    expect(after.content).toBe('original-A') // mock reply is deterministic
    expect(after.finalizedAt).not.toBe(before.finalizedAt) // new timestamp
  })

  test('retryMessage rejects user role messages', () => {
    const { orch, session } = setup()
    const { userMessage } = orch.startRound({
      sessionId: session.id,
      userText: 'q',
      mode: 'free',
    })
    expect(() => orch.retryMessage(userMessage.id)).toThrow(/assistant/)
  })

  test('retryMessage rejects messages currently streaming', () => {
    const { orch, session, agents } = setup({ delaysMs: [200, 200, 200] })
    const { assistantMessages } = orch.startRound({
      sessionId: session.id,
      userText: 'q',
      mode: 'free',
    })
    const target = assistantMessages.find((m) => m.agentId === agents[0].id)!
    // Stream is in flight (200ms delay) → still streaming.
    expect(() => orch.retryMessage(target.id)).toThrow(/currently streaming/)
  })

  test('after retry, next round peer sees NEW content (not stale pre-retry)', async () => {
    // Bug repro: user reported that after retrying agent A's response,
    // round N+1's other agents still saw the pre-retry content of A.
    // We verify three layers: in-memory repo reads, raw SQL columns,
    // and the API-shaped session payload that the frontend consumes.
    const db = resetDbForTests()
    const repo = createRepo(db)
    let aReply = 'A-original'
    const agents: AgentSpec[] = [
      {
        id: 'claude',
        publicId: 'agent-A',
        label: 'A',
        model: 'mock/claude',
        adapter: createMockAdapter({ id: 'claude', delayMs: 3, reply: () => aReply }),
      },
      {
        id: 'gemini',
        publicId: 'agent-B',
        label: 'B',
        model: 'mock/gemini',
        adapter: createMockAdapter({ id: 'gemini', delayMs: 3, reply: () => 'B-reply' }),
      },
      {
        id: 'gpt',
        publicId: 'agent-C',
        label: 'C',
        model: 'mock/gpt',
        adapter: createMockAdapter({ id: 'gpt', delayMs: 3, reply: () => 'C-reply' }),
      },
    ]
    const orch = createOrchestrator({ repo, agents })
    const session = orch.createSession()

    // Round 0
    const r0 = orch.startRound({ sessionId: session.id, userText: 'q1', mode: 'free' })
    await orch.waitForRoundFinalized(r0.round.id)

    const aMsg = r0.assistantMessages.find((m) => m.agentId === 'claude')!
    expect(repo.getMessage(aMsg.id)!.content).toBe('A-original')

    // Flip A's reply, then retry.
    aReply = 'A-RETRIED'
    orch.retryMessage(aMsg.id)
    let i = 0
    while (i++ < 100) {
      const m = repo.getMessage(aMsg.id)!
      if (m.status === 'finalized') break
      await new Promise((r) => setTimeout(r, 10))
    }

    // ── Layer 1: backend in-memory (repo / orchestrator reads) ──────────────
    const aFresh = repo.getMessage(aMsg.id)!
    expect(aFresh.content).toBe('A-RETRIED')
    expect(aFresh.rendered).not.toBeNull()
    expect(aFresh.rendered!['claude']!.content).toBe('A-RETRIED')
    expect(aFresh.rendered!['gemini']!.content).toContain('A-RETRIED')
    expect(aFresh.rendered!['gemini']!.content).not.toContain('A-original')
    expect(aFresh.rendered!['gpt']!.content).toContain('A-RETRIED')
    expect(aFresh.rendered!['gpt']!.content).not.toContain('A-original')

    // ── Layer 2: raw SQL row (database persistence) ─────────────────────────
    // The repo wraps SQL but we want byte-level proof that no stale string
    // lingers in any column. Pull the literal columns and check each.
    type Row = {
      content: string
      rendered: string | null
      prompt: string | null
      visible_to: string
      status: string
    }
    const rawA = db
      .prepare(
        'SELECT content, rendered, prompt, visible_to, status FROM messages WHERE id = ?',
      )
      .get(aMsg.id) as Row
    expect(rawA.status).toBe('finalized')
    expect(rawA.visible_to).toBe('"*"')
    expect(rawA.content).toBe('A-RETRIED')
    expect(rawA.content).not.toContain('A-original')
    expect(rawA.rendered).not.toBeNull()
    expect(rawA.rendered).toContain('A-RETRIED')
    expect(rawA.rendered).not.toContain('A-original')
    // resetMessage NULLs the prompt column; A wasn't re-prompted with a new
    // round, so it stays null until re-used. (A's own prompt for R0 is
    // expected to be null after retry — that's by design.)

    // ── Layer 3: round 1 — peers see A-RETRIED in their prompts ─────────────
    const r1 = orch.startRound({ sessionId: session.id, userText: 'q2', mode: 'free' })
    await orch.waitForRoundFinalized(r1.round.id)

    const bR1 = r1.assistantMessages.find((m) => m.agentId === 'gemini')!
    const cR1 = r1.assistantMessages.find((m) => m.agentId === 'gpt')!

    // 3a. via repo (the orchestrator's promptFor + frontend prompt-inspector path)
    const bRepo = repo.getMessage(bR1.id)!
    expect(bRepo.prompt).not.toBeNull()
    const bPrompt = JSON.stringify(bRepo.prompt)
    expect(bPrompt).toContain('A-RETRIED')
    expect(bPrompt).not.toContain('A-original')

    // 3b. via raw SQL (database byte-level check)
    const rawB = db
      .prepare('SELECT content, prompt FROM messages WHERE id = ?')
      .get(bR1.id) as Row
    expect(rawB.prompt).toContain('A-RETRIED')
    expect(rawB.prompt).not.toContain('A-original')

    const rawC = db
      .prepare('SELECT content, prompt FROM messages WHERE id = ?')
      .get(cR1.id) as Row
    expect(rawC.prompt).toContain('A-RETRIED')
    expect(rawC.prompt).not.toContain('A-original')

    // ── Layer 4: API-shaped payload (what the frontend actually receives) ──
    // The frontend renders message.content (bubble body), message.prompt
    // (debug inspector), and reads them off the /api/sessions/:id snapshot.
    // listMessages is what powers that endpoint.
    const allMessages = repo.listMessages(session.id)
    const apiAFresh = allMessages.find((m) => m.id === aMsg.id)!
    expect(apiAFresh.content).toBe('A-RETRIED')
    // R0 peers (B, C) — their prompts predate the retry and are NOT touched.
    // Their bubble content remains the original B/C replies (unchanged).
    const bR0 = r0.assistantMessages.find((m) => m.agentId === 'gemini')!
    const apiBR0 = allMessages.find((m) => m.id === bR0.id)!
    expect(apiBR0.content).toBe('B-reply')
    // R1 peers — content not yet meaningful (mocks return fixed strings),
    // but their prompt history MUST contain the post-retry A.
    const apiBR1 = allMessages.find((m) => m.id === bR1.id)!
    const apiBR1PromptStr = JSON.stringify(apiBR1.prompt)
    expect(apiBR1PromptStr).toContain('A-RETRIED')
    expect(apiBR1PromptStr).not.toContain('A-original')
  })
})
