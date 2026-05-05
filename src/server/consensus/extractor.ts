import type { AgentSignal, OrchestratorState, DisagreementRecord } from '@shared/index'
import { getHostAdapter } from '../host'
import { HOST_SYSTEM_PROMPT } from '../modes'

// ── Signal parsing from raw agent response text ───────────────────────────────

export function parseAgentSignals(agentId: string, text: string): AgentSignal {
  const positionLine = text.match(/^POSITION_DELTA:\s*(.+)/im)?.[1]?.trim() ?? ''
  let positionDelta: AgentSignal['positionDelta'] = null
  let changeReason: string | null = null
  if (/^UNCHANGED/i.test(positionLine)) {
    positionDelta = 'UNCHANGED'
  } else if (/^CHANGED/i.test(positionLine)) {
    positionDelta = 'CHANGED'
    changeReason = positionLine.replace(/^CHANGED[:\s]*/i, '').trim() || null
  }

  const continueLine = text.match(/^CONTINUE_NEEDED:\s*(YES|NO)/im)?.[1]?.toUpperCase()
  const continueNeeded = continueLine === 'YES' ? true : continueLine === 'NO' ? false : null

  const deltaLine = text.match(/^CONFIDENCE_DELTA:\s*(.+)/im)?.[1]?.trim().toUpperCase() ?? ''
  let confidenceDelta: AgentSignal['confidenceDelta'] = null
  if (deltaLine.startsWith('SAME')) confidenceDelta = 'SAME'
  else if (deltaLine.startsWith('UP')) confidenceDelta = 'UP'
  else if (deltaLine.startsWith('DOWN')) confidenceDelta = 'DOWN'

  // Capture the body of UNRESOLVED_DISAGREEMENTS block until either the next
  // FIELD_NAME: header or the true end of input. The `m` flag makes `$` match
  // end-of-line, which would clip the block to a single bullet — so we use
  // `(?![\s\S])` as a real end-of-string lookahead instead.
  const unresolvedBlock =
    text.match(/^UNRESOLVED_DISAGREEMENTS:\s*\n([\s\S]*?)(?=\n[A-Z_]+:|(?![\s\S]))/im)?.[1] ?? ''
  const unresolvedDisagreements = unresolvedBlock
    .split('\n')
    .map((l) => l.replace(/^[-*•\d.)\s]+/, '').trim())
    .filter((l) => l.length > 10)

  return { agentId, positionDelta, changeReason, continueNeeded, confidenceDelta, unresolvedDisagreements }
}

// ── Orchestrator-state summarizer ─────────────────────────────────────────────

async function callHost(userPrompt: string): Promise<string> {
  const chunks: string[] = []
  for await (const ev of getHostAdapter().stream({
    messages: [
      { role: 'system', content: HOST_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
  })) {
    if (ev.type === 'chunk') chunks.push(ev.text)
    else if (ev.type === 'error') throw new Error(`Host model error: ${ev.error}`)
  }
  return chunks.join('')
}

export async function buildOrchestratorState(args: {
  roundNumber: number
  agentSignals: AgentSignal[]
  rawResponsesByAgentId: Record<string, string>
  previousState: OrchestratorState | null
  publicIds: Record<string, string>
}): Promise<OrchestratorState> {
  const { roundNumber, agentSignals, rawResponsesByAgentId, previousState, publicIds } = args

  // Confidence per agent
  const confidenceByAgent: Record<string, number> = { ...(previousState?.confidenceByAgent ?? {}) }
  for (const sig of agentSignals) {
    const m = rawResponsesByAgentId[sig.agentId]?.match(/^CONFIDENCE:\s*([1-5])/im)
    if (m) confidenceByAgent[sig.agentId] = parseInt(m[1], 10)
  }

  // Continue-needed per agent
  const continueNeededByAgent: Record<string, boolean> = {}
  for (const sig of agentSignals) {
    if (sig.continueNeeded !== null) continueNeededByAgent[sig.agentId] = sig.continueNeeded
  }

  // Track disagreements: carry forward previous + add new
  const openDisagreements: DisagreementRecord[] = []
  const newClaims = agentSignals.flatMap((s) => s.unresolvedDisagreements)

  for (const prev of previousState?.openDisagreements ?? []) {
    const stillMentioned = newClaims.some((c) =>
      c.toLowerCase().includes(prev.description.toLowerCase().slice(0, 40)),
    )
    if (stillMentioned) openDisagreements.push({ ...prev, lastSeenRound: roundNumber })
  }
  for (const claim of newClaims) {
    const tracked = openDisagreements.some((d) =>
      d.description.toLowerCase().includes(claim.toLowerCase().slice(0, 40)),
    )
    if (!tracked) {
      openDisagreements.push({
        description: claim,
        materiality: 'MEDIUM',
        firstSeenRound: roundNumber,
        lastSeenRound: roundNumber,
      })
    }
  }

  // Full untruncated responses — Gemini Flash has plenty of context budget
  // and the recap quality improves materially when it can read the actual
  // arguments rather than 1200-char excerpts.
  const agentBlocks = Object.entries(rawResponsesByAgentId)
    .map(([id, text]) => `[${publicIds[id] ?? id}]:\n${text}`)
    .join('\n\n---\n\n')

  const signalLines = agentSignals
    .map(
      (s) =>
        `- ${publicIds[s.agentId] ?? s.agentId}: delta=${s.positionDelta ?? '?'} conf_delta=${s.confidenceDelta ?? '?'} continue=${s.continueNeeded ?? '?'}`,
    )
    .join('\n')

  const priorSummaryBlock = previousState?.summaryText
    ? `Your recap from the previous round (round ${previousState.roundNumber}):
"""
${previousState.summaryText}
"""

`
    : ''

  const summarizerPrompt = `${priorSummaryBlock}Round ${roundNumber} just finished. Below are the participants' full responses and the parsed structural signals from each.

PARTICIPANT RESPONSES (round ${roundNumber}):
---
${agentBlocks}
---

PARSED SIGNALS:
${signalLines}

Write a fresh recap for the upcoming round, in EXACTLY 3 sentences:
1. What all participants now agree on (if anything new this round). If nothing confirmed, write "No confirmed agreement yet."
2. The single most material open disagreement — name the specific claim and which participants hold which positions, by public ID.
3. What specific evidence, argument, or test would most likely resolve that disagreement next round.

No preamble. No meta-commentary. Specific claims, not topic areas.`

  // Orchestrator summary is a "nice-to-have" — if the call fails (bad key,
  // model rename, transient 5xx), we still want the consensus loop to
  // continue with the structured fields above. Log and degrade to a
  // placeholder summary.
  let summaryText: string
  try {
    summaryText = await callHost(summarizerPrompt)
  } catch (e) {
    console.error('[consensus] orchestrator-state model call failed:', (e as Error).message)
    summaryText = `(Orchestrator summary unavailable for round ${roundNumber}: ${(e as Error).message})`
  }

  return {
    roundNumber,
    agreedClaims: previousState?.agreedClaims ?? [],
    openDisagreements,
    supersededClaims: previousState?.supersededClaims ?? [],
    confidenceByAgent,
    continueNeededByAgent,
    summaryText,
  }
}

// ── Auto-stop decision ────────────────────────────────────────────────────────

export function shouldStop(args: {
  state: OrchestratorState
  roundIndex: number
  maxRounds: number
}): { stop: boolean; reason: string | null } {
  const { state, roundIndex, maxRounds } = args

  if (roundIndex < 1) return { stop: false, reason: null }
  if (roundIndex >= maxRounds - 1) return { stop: true, reason: 'max_rounds' }

  const continueVotes = Object.values(state.continueNeededByAgent)
  if (continueVotes.length > 0 && continueVotes.every((v) => v === false)) {
    return { stop: true, reason: 'all_agents_done' }
  }

  const hasHigh = state.openDisagreements.some((d) => d.materiality === 'HIGH')
  if (!hasHigh && state.openDisagreements.length === 0) {
    return { stop: true, reason: 'no_open_disagreements' }
  }

  // Stuck: any disagreement persisted 2+ rounds without new arguments
  const stuck = state.openDisagreements.some((d) => d.lastSeenRound - d.firstSeenRound >= 2)
  if (stuck) return { stop: true, reason: 'stuck_loop' }

  return { stop: false, reason: null }
}
