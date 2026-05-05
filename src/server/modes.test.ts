import { describe, test, expect } from 'bun:test'
import { buildModePrompt, buildFinalSynthesisPrompt } from './modes'

describe('buildModePrompt', () => {
  const SELF = 'agent-A'
  const PEERS = ['agent-B', 'agent-C']

  test('free mode returns empty string regardless of round', () => {
    expect(buildModePrompt('free', SELF, PEERS)).toBe('')
    expect(buildModePrompt('free', SELF, PEERS, { roundIndex: 0 })).toBe('')
    expect(buildModePrompt('free', SELF, PEERS, { roundIndex: 5 })).toBe('')
  })

  describe('brainstorm', () => {
    test('round 0 produces initial NEW_IDEAS prompt', () => {
      const prompt = buildModePrompt('brainstorm', SELF, PEERS, { roundIndex: 0 })
      expect(prompt).toContain('divergent brainstorming session')
      expect(prompt).toContain('NEW_IDEAS:')
      expect(prompt).toContain('CONTRARIAN_OPTIONS:')
      expect(prompt).toContain('DELIBERATE_GAPS:')
      // No build-on field in round 0 — that's a follow-up concept.
      expect(prompt).not.toContain('BUILDS_ON_PEER:')
      expect(prompt).not.toContain('CROSS_POLLINATIONS:')
    })

    test('follow-up rounds add BUILDS_ON_PEER and CROSS_POLLINATIONS', () => {
      const prompt = buildModePrompt('brainstorm', SELF, PEERS, { roundIndex: 1 })
      expect(prompt).toContain('NEW_IDEAS:')
      expect(prompt).toContain('BUILDS_ON_PEER:')
      expect(prompt).toContain('CROSS_POLLINATIONS:')
    })

    test('hard rule "NO CRITIQUE" present in both phases', () => {
      const r0 = buildModePrompt('brainstorm', SELF, PEERS, { roundIndex: 0 })
      const r1 = buildModePrompt('brainstorm', SELF, PEERS, { roundIndex: 1 })
      expect(r0).toContain('NO CRITIQUE')
      expect(r1).toContain('NO CRITIQUE')
    })
  })

  describe('consensus', () => {
    test('initial phase has CLAIM/CONFIDENCE/REASONING structured fields', () => {
      const prompt = buildModePrompt('consensus', SELF, PEERS, { roundIndex: 0 })
      expect(prompt).toContain('CLAIM:')
      expect(prompt).toContain('CONFIDENCE:')
      expect(prompt).toContain('REASONING:')
      expect(prompt).toContain('ASSUMPTIONS:')
      expect(prompt).toContain('NUMERIC_ESTIMATES:')
      expect(prompt).toContain('WHAT_WOULD_CHANGE_MY_MIND:')
    })

    test('review phase has POSITION_DELTA + per-peer review blocks + CONTINUE_NEEDED', () => {
      const prompt = buildModePrompt('consensus', SELF, PEERS, { roundIndex: 1 })
      expect(prompt).toContain('POSITION_DELTA:')
      expect(prompt).toContain('PEER_REVIEW_agent-B')
      expect(prompt).toContain('PEER_REVIEW_agent-C')
      expect(prompt).toContain('CONTINUE_NEEDED:')
    })

    test('review phase injects orchestrator state when provided', () => {
      const state = {
        roundNumber: 2,
        agreedClaims: ['x is true'],
        openDisagreements: [
          {
            description: 'whether y',
            materiality: 'HIGH' as const,
            firstSeenRound: 1,
            lastSeenRound: 2,
          },
        ],
        supersededClaims: [],
        confidenceByAgent: {},
        continueNeededByAgent: {},
        summaryText: 'all agents agree on x; disagree on y',
      }
      const prompt = buildModePrompt('consensus', SELF, PEERS, {
        roundIndex: 2,
        phase: 'review',
        orchestratorState: state,
      })
      expect(prompt).toContain('all agents agree on x')
      expect(prompt).toContain('x is true')
      expect(prompt).toContain('whether y')
      expect(prompt).toContain('[HIGH]')
    })

    test('review phase notes missing orchestrator state gracefully', () => {
      const prompt = buildModePrompt('consensus', SELF, PEERS, {
        roundIndex: 1,
        phase: 'review',
        orchestratorState: null,
      })
      expect(prompt).toContain('Not available')
    })

    test('explicit phase: "initial" overrides roundIndex>0 → still initial', () => {
      const prompt = buildModePrompt('consensus', SELF, PEERS, {
        roundIndex: 5,
        phase: 'initial',
      })
      // Phase is checked first
      expect(prompt).toContain('You cannot see their responses yet')
      expect(prompt).not.toContain('POSITION_DELTA:')
    })
  })

  describe('hard rules across modes', () => {
    test('all modes ban absolute language without proof', () => {
      const consensus = buildModePrompt('consensus', SELF, PEERS, { roundIndex: 0 })
      expect(consensus).toContain('ABSOLUTE LANGUAGE')
    })

    test('consensus and brainstorm ban social/praise opening', () => {
      const c = buildModePrompt('consensus', SELF, PEERS, { roundIndex: 0 })
      const b = buildModePrompt('brainstorm', SELF, PEERS, { roundIndex: 0 })
      expect(c).toContain('NO SOCIAL LANGUAGE')
      expect(b).toContain('NO SOCIAL LANGUAGE')
    })

    test('numeric tagging required in consensus', () => {
      const prompt = buildModePrompt('consensus', SELF, PEERS, { roundIndex: 0 })
      expect(prompt).toContain('[CALCULATED]')
      expect(prompt).toContain('[CITED]')
      expect(prompt).toContain('[SPECULATIVE]')
    })
  })
})

describe('buildFinalSynthesisPrompt', () => {
  test('contains all 4 required output fields', () => {
    const prompt = buildFinalSynthesisPrompt(
      'What is the best way to learn TypeScript?',
      ['agent-A', 'agent-B'],
      '## Round 1\n…transcript…',
    )
    expect(prompt).toContain('CONSENSUS_FINDINGS:')
    expect(prompt).toContain('REMAINING_DISAGREEMENTS:')
    expect(prompt).toContain('CONFIDENCE_RANGE:')
    expect(prompt).toContain('PRACTICAL_IMPLICATIONS:')
  })

  test('embeds question and transcript verbatim', () => {
    const prompt = buildFinalSynthesisPrompt(
      'How does X work?',
      ['agent-A'],
      'TRANSCRIPT_BODY_42',
    )
    expect(prompt).toContain('How does X work?')
    expect(prompt).toContain('TRANSCRIPT_BODY_42')
    expect(prompt).toContain('agent-A')
  })

  test('forbids meta-commentary on the debate process', () => {
    const prompt = buildFinalSynthesisPrompt('q', ['a-A'], '...')
    expect(prompt).toContain('No praise, no padding, no meta-commentary')
  })
})
