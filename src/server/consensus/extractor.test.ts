import { describe, test, expect } from 'bun:test'
import { parseAgentSignals, shouldStop } from './extractor'
import type { OrchestratorState } from '@shared/index'

describe('parseAgentSignals', () => {
  test('full structured response — all fields parse correctly', () => {
    const text = `CLAIM: TypeScript is the right choice for new web projects.
POSITION_DELTA: CHANGED: agent-B's argument about gradual typing changed my view
CONFIDENCE: 4
CONFIDENCE_DELTA: UP: peer's evidence about JSDoc/JSX interop
NEW_REASONING: I now see the gradual-typing path lets teams adopt incrementally.
PEER_REVIEW_agent-B:
  QUOTE: "JSDoc gives you 80% of TS benefits without a build step"
  STATUS: PARTIAL
  MATERIALITY: HIGH
  REASON: Build-step cost is a real friction in some teams.
UNRESOLVED_DISAGREEMENTS:
- whether build-tool friction outweighs type-safety wins for solo developers
- the specific threshold of project size where TS pays off
EVIDENCE_NEEDED: Empirical study of <5-person teams comparing TS vs JS bug rates.
CONTINUE_NEEDED: YES: still disagree on threshold`

    const sig = parseAgentSignals('agent-A', text)
    expect(sig.agentId).toBe('agent-A')
    expect(sig.positionDelta).toBe('CHANGED')
    expect(sig.changeReason).toContain("agent-B's argument about gradual typing")
    expect(sig.continueNeeded).toBe(true)
    expect(sig.confidenceDelta).toBe('UP')
    expect(sig.unresolvedDisagreements).toHaveLength(2)
    expect(sig.unresolvedDisagreements[0]).toContain('build-tool friction')
    expect(sig.unresolvedDisagreements[1]).toContain('threshold of project size')
  })

  test('UNCHANGED position with NO continue needed', () => {
    const text = `POSITION_DELTA: UNCHANGED
CONFIDENCE_DELTA: SAME
CONTINUE_NEEDED: NO: peers' arguments don't address my core point
UNRESOLVED_DISAGREEMENTS:
- nothing remains in dispute that hasn't been answered`
    const sig = parseAgentSignals('a', text)
    expect(sig.positionDelta).toBe('UNCHANGED')
    expect(sig.changeReason).toBeNull()
    expect(sig.confidenceDelta).toBe('SAME')
    expect(sig.continueNeeded).toBe(false)
    expect(sig.unresolvedDisagreements).toHaveLength(1)
  })

  test('missing fields → null/empty defaults, no crash', () => {
    const sig = parseAgentSignals('a', 'totally unstructured response with no fields')
    expect(sig.positionDelta).toBeNull()
    expect(sig.changeReason).toBeNull()
    expect(sig.confidenceDelta).toBeNull()
    expect(sig.continueNeeded).toBeNull()
    expect(sig.unresolvedDisagreements).toEqual([])
  })

  test('empty string is safe', () => {
    const sig = parseAgentSignals('a', '')
    expect(sig.positionDelta).toBeNull()
    expect(sig.unresolvedDisagreements).toEqual([])
  })

  test('CONFIDENCE_DELTA DOWN parses', () => {
    const sig = parseAgentSignals(
      'a',
      'CONFIDENCE_DELTA: DOWN: peer raised an edge case I had not considered',
    )
    expect(sig.confidenceDelta).toBe('DOWN')
  })

  test('UNRESOLVED_DISAGREEMENTS handles different bullet styles', () => {
    const text = `UNRESOLVED_DISAGREEMENTS:
- first dash bullet describes a meaningful disagreement
* second asterisk bullet also a real disagreement
1. numbered list item still counts as a disagreement
• unicode bullet of moderate length too`
    const sig = parseAgentSignals('a', text)
    expect(sig.unresolvedDisagreements).toHaveLength(4)
  })

  test('UNRESOLVED_DISAGREEMENTS skips items shorter than 11 chars (filler)', () => {
    const text = `UNRESOLVED_DISAGREEMENTS:
- ok
- a longer real disagreement worth tracking
- nope`
    const sig = parseAgentSignals('a', text)
    expect(sig.unresolvedDisagreements).toHaveLength(1)
    expect(sig.unresolvedDisagreements[0]).toContain('longer real disagreement')
  })

  test('case-insensitive field labels', () => {
    const text = `position_delta: changed: lowercase test
continue_needed: yes
confidence_delta: up`
    const sig = parseAgentSignals('a', text)
    expect(sig.positionDelta).toBe('CHANGED')
    expect(sig.continueNeeded).toBe(true)
    expect(sig.confidenceDelta).toBe('UP')
  })
})

describe('shouldStop', () => {
  function makeState(overrides: Partial<OrchestratorState> = {}): OrchestratorState {
    return {
      roundNumber: 2,
      agreedClaims: [],
      openDisagreements: [],
      supersededClaims: [],
      confidenceByAgent: {},
      continueNeededByAgent: {},
      summaryText: '',
      ...overrides,
    }
  }

  test('round 0 never stops', () => {
    const result = shouldStop({ state: makeState(), roundIndex: 0, maxRounds: 5 })
    expect(result.stop).toBe(false)
  })

  test('reaching maxRounds-1 forces stop with reason "max_rounds"', () => {
    const result = shouldStop({ state: makeState(), roundIndex: 4, maxRounds: 5 })
    expect(result.stop).toBe(true)
    expect(result.reason).toBe('max_rounds')
  })

  test('all agents say CONTINUE_NEEDED:NO → stop with "all_agents_done"', () => {
    const state = makeState({
      continueNeededByAgent: { 'a-A': false, 'a-B': false, 'a-C': false },
      openDisagreements: [
        {
          description: 'still some disagreement',
          materiality: 'MEDIUM',
          firstSeenRound: 1,
          lastSeenRound: 2,
        },
      ],
    })
    const result = shouldStop({ state, roundIndex: 2, maxRounds: 5 })
    expect(result.stop).toBe(true)
    expect(result.reason).toBe('all_agents_done')
  })

  test('mixed continue votes → no stop on this rule', () => {
    const state = makeState({
      continueNeededByAgent: { 'a-A': true, 'a-B': false },
      openDisagreements: [
        {
          description: 'unresolved disagreement here',
          materiality: 'HIGH',
          firstSeenRound: 1,
          lastSeenRound: 2,
        },
      ],
    })
    const result = shouldStop({ state, roundIndex: 2, maxRounds: 5 })
    expect(result.stop).toBe(false)
  })

  test('no open disagreements at all → stop with "no_open_disagreements"', () => {
    const state = makeState({ openDisagreements: [] })
    const result = shouldStop({ state, roundIndex: 2, maxRounds: 5 })
    expect(result.stop).toBe(true)
    expect(result.reason).toBe('no_open_disagreements')
  })

  test('all disagreements MEDIUM/LOW (no HIGH) AND zero count → stop', () => {
    // Note: current implementation requires both `!hasHigh` AND `length === 0`
    const state = makeState({ openDisagreements: [] })
    const result = shouldStop({ state, roundIndex: 2, maxRounds: 5 })
    expect(result.stop).toBe(true)
  })

  test('a HIGH disagreement keeps the loop going', () => {
    const state = makeState({
      openDisagreements: [
        {
          description: 'critical claim is in dispute',
          materiality: 'HIGH',
          firstSeenRound: 2,
          lastSeenRound: 2,
        },
      ],
    })
    const result = shouldStop({ state, roundIndex: 2, maxRounds: 5 })
    expect(result.stop).toBe(false)
  })

  test('stuck loop: same disagreement persisting 2+ rounds → stop', () => {
    const state = makeState({
      openDisagreements: [
        {
          description: 'same fight, different round',
          materiality: 'HIGH',
          firstSeenRound: 1,
          lastSeenRound: 3,
        },
      ],
    })
    const result = shouldStop({ state, roundIndex: 3, maxRounds: 10 })
    expect(result.stop).toBe(true)
    expect(result.reason).toBe('stuck_loop')
  })
})
