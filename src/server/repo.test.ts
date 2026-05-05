import { describe, test, expect, beforeEach } from 'bun:test'
import { resetDbForTests } from './db'
import { createRepo, type Repo } from './repo'
import type { Message, Round, Session } from '@shared/index'

let repo: Repo
beforeEach(() => {
  const db = resetDbForTests()
  repo = createRepo(db)
})

function makeSession(overrides: Partial<Session> = {}): Session {
  const now = Date.now()
  return {
    id: 's1',
    agents: [
      { id: 'a-A', label: 'Agent A', model: 'mock/a' },
      { id: 'a-B', label: 'Agent B', model: 'mock/b' },
    ],
    title: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function makeRound(sessionId: string, idx: number): Round {
  return {
    id: `r-${idx}`,
    sessionId,
    index: idx,
    status: 'streaming',
    createdAt: Date.now() + idx,
  }
}

function makeMessage(
  sessionId: string,
  roundId: string,
  roundIndex: number,
  partial: Partial<Message> = {},
): Message {
  return {
    id: `m-${Math.random().toString(36).slice(2, 9)}`,
    sessionId,
    roundId,
    roundIndex,
    role: 'assistant',
    agentId: 'a-A',
    content: 'hello',
    status: 'streaming',
    visibleTo: ['a-A'],
    rendered: null,
    prompt: null,
    createdAt: Date.now(),
    finalizedAt: null,
    ...partial,
  }
}

describe('listSessions', () => {
  test('returns empty when no sessions', () => {
    expect(repo.listSessions()).toEqual([])
  })

  test('orders by updated_at descending', () => {
    const s1 = makeSession({ id: 's1', createdAt: 100, updatedAt: 100 })
    const s2 = makeSession({ id: 's2', createdAt: 200, updatedAt: 200 })
    const s3 = makeSession({ id: 's3', createdAt: 300, updatedAt: 50 }) // older active despite recent created
    repo.insertSession(s1)
    repo.insertSession(s2)
    repo.insertSession(s3)
    const list = repo.listSessions()
    expect(list.map((s) => s.id)).toEqual(['s2', 's1', 's3'])
  })

  test('roundCount accurately reflects rounds inserted', () => {
    const s = makeSession()
    repo.insertSession(s)
    repo.insertRound(makeRound(s.id, 0))
    repo.insertRound(makeRound(s.id, 1))
    repo.insertRound(makeRound(s.id, 2))
    const list = repo.listSessions()
    expect(list[0].roundCount).toBe(3)
  })

  test('exposes title and agents to caller', () => {
    const s = makeSession({ title: 'my chat' })
    repo.insertSession(s)
    const list = repo.listSessions()
    expect(list[0].title).toBe('my chat')
    expect(list[0].agents).toEqual(s.agents)
  })
})

describe('deleteSession (cascade)', () => {
  test('removes session row', () => {
    const s = makeSession()
    repo.insertSession(s)
    expect(repo.getSession(s.id)).not.toBeNull()
    repo.deleteSession(s.id)
    expect(repo.getSession(s.id)).toBeNull()
  })

  test('removes all rounds + messages of the session', () => {
    const s = makeSession()
    repo.insertSession(s)
    const r0 = makeRound(s.id, 0)
    const r1 = makeRound(s.id, 1)
    repo.insertRound(r0)
    repo.insertRound(r1)
    repo.insertMessage(makeMessage(s.id, r0.id, 0))
    repo.insertMessage(makeMessage(s.id, r0.id, 0))
    repo.insertMessage(makeMessage(s.id, r1.id, 1))

    expect(repo.listMessages(s.id)).toHaveLength(3)
    expect(repo.listRounds(s.id)).toHaveLength(2)

    repo.deleteSession(s.id)

    expect(repo.listMessages(s.id)).toHaveLength(0)
    expect(repo.listRounds(s.id)).toHaveLength(0)
  })

  test('removes consensus_runs + summaries belonging to the session', () => {
    const s = makeSession()
    repo.insertSession(s)
    repo.insertConsensusRun({
      id: 'cr-1',
      sessionId: s.id,
      result: {
        sessionId: s.id,
        question: 'q',
        modelIds: ['m'],
        rounds: [],
        finalSynthesis: {
          consensusFindings: '',
          remainingDisagreements: '',
          confidenceRange: '',
          practicalImplications: '',
          rawText: '',
        },
        totalRounds: 0,
        transcript: '',
      },
      createdAt: Date.now(),
    })
    repo.insertSummary({
      id: 'sum-1',
      sessionId: s.id,
      prompt: 'q',
      agentLabel: 'A',
      content: '',
      status: 'streaming',
      error: null,
      createdAt: Date.now(),
      finalizedAt: null,
    })

    expect(repo.getLatestConsensusRun(s.id)).not.toBeNull()
    expect(repo.getLatestSummary(s.id)).not.toBeNull()

    repo.deleteSession(s.id)

    expect(repo.getLatestConsensusRun(s.id)).toBeNull()
    expect(repo.getLatestSummary(s.id)).toBeNull()
  })

  test('does not affect other sessions', () => {
    const s1 = makeSession({ id: 's1' })
    const s2 = makeSession({ id: 's2' })
    repo.insertSession(s1)
    repo.insertSession(s2)
    repo.insertRound(makeRound(s2.id, 0))
    repo.insertMessage(makeMessage(s2.id, 'r-0', 0))

    repo.deleteSession(s1.id)

    expect(repo.getSession(s2.id)).not.toBeNull()
    expect(repo.listRounds(s2.id)).toHaveLength(1)
    expect(repo.listMessages(s2.id)).toHaveLength(1)
  })
})

describe('touchSession + setTitleIfMissing', () => {
  test('touchSession updates updated_at', () => {
    const s = makeSession({ updatedAt: 100 })
    repo.insertSession(s)
    repo.touchSession(s.id, 999)
    const reloaded = repo.getSession(s.id)!
    expect(reloaded.updatedAt).toBe(999)
  })

  test('setTitleIfMissing sets title only when null', () => {
    const s = makeSession({ title: null })
    repo.insertSession(s)
    repo.setTitleIfMissing(s.id, 'first try')
    expect(repo.getSession(s.id)!.title).toBe('first try')

    // Second call should NOT overwrite.
    repo.setTitleIfMissing(s.id, 'second attempt')
    expect(repo.getSession(s.id)!.title).toBe('first try')
  })

  test('setTitleIfMissing on already-titled session is a no-op', () => {
    const s = makeSession({ title: 'preset' })
    repo.insertSession(s)
    repo.setTitleIfMissing(s.id, 'override')
    expect(repo.getSession(s.id)!.title).toBe('preset')
  })
})

describe('repairOrphanStreams', () => {
  test('flips streaming messages to finalized with the supplied timestamp', () => {
    const s = makeSession()
    repo.insertSession(s)
    repo.insertRound({ ...makeRound(s.id, 0), status: 'streaming' })
    repo.insertMessage(makeMessage(s.id, 'r-0', 0, { status: 'streaming' }))
    repo.insertMessage(
      makeMessage(s.id, 'r-0', 0, { status: 'finalized', finalizedAt: 1 }),
    )

    const result = repo.repairOrphanStreams(9999)

    expect(result.messages).toBe(1) // only the streaming one was repaired
    expect(result.rounds).toBe(1)

    const all = repo.listMessages(s.id)
    expect(all.every((m) => m.status === 'finalized')).toBe(true)
    expect(repo.getRound('r-0')!.status).toBe('finalized')
    // The repaired message has the supplied timestamp; the originally finalized one keeps its own.
    const repairedTimestamps = all.map((m) => m.finalizedAt).sort()
    expect(repairedTimestamps).toContain(1)
    expect(repairedTimestamps).toContain(9999)
  })

  test('repairs orphan summaries (mark "done" with timestamp)', () => {
    const s = makeSession()
    repo.insertSession(s)
    repo.insertSummary({
      id: 'sum-streaming',
      sessionId: s.id,
      prompt: 'p',
      agentLabel: 'A',
      content: 'partial',
      status: 'streaming',
      error: null,
      createdAt: 1,
      finalizedAt: null,
    })

    const result = repo.repairOrphanStreams(123)
    expect(result.summaries).toBe(1)

    const sum = repo.getLatestSummary(s.id)!
    expect(sum.status).toBe('done')
    expect(sum.finalizedAt).toBe(123)
    // Partial content is preserved.
    expect(sum.content).toBe('partial')
  })

  test('on a clean DB returns zero counts', () => {
    const result = repo.repairOrphanStreams(123)
    expect(result).toEqual({ messages: 0, rounds: 0, summaries: 0 })
  })
})
