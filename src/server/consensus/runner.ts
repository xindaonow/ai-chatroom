import type { AgentSpec } from '../adapters'
import { getHostAdapter } from '../host'
import { buildFinalSynthesisPrompt, HOST_SYSTEM_PROMPT } from '../modes'
import { parseAgentSignals, buildOrchestratorState } from './extractor'
import type { Orchestrator } from '../orchestrator'
import type {
  Message,
  Round,
  Session,
  ConsensusRunResult,
  ConsensusRoundRecord,
  OrchestratorState,
} from '@shared/index'

export type RoundStartInfo = {
  consensusIdx: number
  phase: 'initial' | 'review'
  round: Round
  userMessage: Message
  assistantMessages: Message[]
}

export type RunConsensusArgs = {
  question: string
  maxRounds: number
  orch: Orchestrator
  onProgress?: (msg: string) => void
  /**
   * Fired right after each round is created server-side (before agents finish
   * streaming). Lets the API endpoint forward round/messages to the client so
   * it can subscribe to per-agent SSE streams and show live bubbles — same UX
   * as Free / Brainstorm modes.
   */
  onRoundStarted?: (info: RoundStartInfo) => void
} & (
  | { sessionId: string }
  | { modelIds: string[] }
)

async function collectStream(
  adapter: AgentSpec['adapter'],
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
): Promise<string> {
  const chunks: string[] = []
  for await (const ev of adapter.stream({ messages })) {
    if (ev.type === 'chunk') chunks.push(ev.text)
    else if (ev.type === 'error') throw new Error(`Adapter error: ${ev.error}`)
  }
  return chunks.join('')
}

function extractField(text: string, field: string): string {
  const m = text.match(new RegExp(`^${field}:\\s*([\\s\\S]*?)(?=\\n[A-Z_]+:|$)`, 'im'))
  return m?.[1]?.trim() ?? ''
}

export async function runConsensus(args: RunConsensusArgs): Promise<ConsensusRunResult> {
  const { question, maxRounds, orch, onProgress, onRoundStarted } = args
  const log = onProgress ?? ((s: string) => console.log(`[consensus] ${s}`))

  let session: Session
  let agents: AgentSpec[]
  let modelIds: string[]

  if ('sessionId' in args) {
    const existing = orch.repo.getSession(args.sessionId)
    if (!existing) throw new Error(`session not found: ${args.sessionId}`)
    session = existing
    agents = orch.agentsFor(args.sessionId)
    modelIds = agents.map((a) => a.model)
  } else {
    modelIds = args.modelIds
    session = orch.createSession(modelIds)
    agents = orch.agentsFor(session.id)
  }

  const publicIds: Record<string, string> = Object.fromEntries(
    agents.map((a) => [a.id, a.publicId]),
  )

  const roundRecords: ConsensusRoundRecord[] = []
  let orchestratorState: OrchestratorState | null = null
  const transcriptParts: string[] = [
    `# Consensus Run\n\n**Question**: ${question}\n\n**Models**: ${modelIds.join(', ')}\n\n**Date**: ${new Date().toISOString()}\n\n**Max Rounds**: ${maxRounds}\n`,
  ]

  for (let consensusIdx = 0; consensusIdx < maxRounds; consensusIdx++) {
    // No early stop — maxRounds is treated as an exact count, not a cap.
    // Each agent gets exactly maxRounds replies, then a final synthesis.
    const phase: 'initial' | 'review' = consensusIdx === 0 ? 'initial' : 'review'
    const userText =
      consensusIdx === 0
        ? question
        : `Review round ${consensusIdx}: see your system prompt for the structured format and the orchestrator state injected there.`

    log(`Starting round ${consensusIdx} (${phase})…`)

    // Hand off to the orchestrator — same path the per-round flow uses.
    // This means chunks flow through the orchestrator's pubsub, the
    // standard /api/rounds/:roundId/stream/:agentId SSE works, and the
    // frontend can subscribe and show live bubbles.
    const { round, userMessage, assistantMessages } = orch.startRound({
      sessionId: session.id,
      userText,
      mode: 'consensus',
      consensusPhase: phase,
      orchestratorState,
    })

    onRoundStarted?.({ consensusIdx, phase, round, userMessage, assistantMessages })

    // Wait until all agent streams finish AND finalizeRound has flipped
    // visibility. Critical: next round's history must include these.
    await orch.waitForRoundFinalized(round.id)

    // Read accumulated content from the repo (chunks were appended during streaming).
    const agentResponses: Record<string, string> = {}
    for (const m of assistantMessages) {
      const final = orch.repo.getMessage(m.id)
      agentResponses[m.agentId!] = final?.content ?? ''
    }
    for (const agent of agents) {
      const len = agentResponses[agent.id]?.length ?? 0
      log(`  ${publicIds[agent.id]} done (${len} chars)`)
    }

    // Parse structured signals from raw text.
    const agentSignals = agents.map((agent) =>
      parseAgentSignals(agent.id, agentResponses[agent.id] ?? ''),
    )

    // Orchestrator-state summary (review rounds only). Same fixed external
    // model as final synthesis — see getSynthesisAdapter() above.
    if (consensusIdx > 0) {
      log(`  Building orchestrator state (Gemini 3 Flash)…`)
      orchestratorState = await buildOrchestratorState({
        roundNumber: consensusIdx,
        agentSignals,
        rawResponsesByAgentId: agentResponses,
        previousState: orchestratorState,
        publicIds,
      })
      log(`  State: ${orchestratorState.summaryText.slice(0, 120)}…`)
    }

    roundRecords.push({
      roundNumber: consensusIdx,
      phase,
      orchestratorState: orchestratorState ? { ...orchestratorState } : null,
      agentSignals,
      stoppedAfter: false,
      stopReason: null,
    })

    transcriptParts.push(
      `\n---\n\n## Round ${consensusIdx} — ${phase === 'initial' ? 'Initial Positions' : `Review ${consensusIdx}`}\n`,
    )
    if (orchestratorState && consensusIdx > 0) {
      transcriptParts.push(`**Orchestrator State**: ${orchestratorState.summaryText}\n\n`)
    }
    for (const agent of agents) {
      transcriptParts.push(
        `### ${publicIds[agent.id]} (${agent.model})\n\n${agentResponses[agent.id]}\n\n`,
      )
    }
  }

  // Final synthesis runs on the shared Host adapter (see src/server/host.ts)
  // — same fixed external model used for the per-round recap and the manual
  // Summarize button. Decouples the synthesizer from debate participants and
  // keeps output style stable across runs.
  log(`Running final synthesis (Gemini 3 Flash)…`)
  const synthesisTranscript = transcriptParts.join('')
  const synthesisPrompt = buildFinalSynthesisPrompt(
    question,
    agents.map((a) => publicIds[a.id]),
    synthesisTranscript,
  )
  const synthText = await collectStream(getHostAdapter(), [
    { role: 'system', content: HOST_SYSTEM_PROMPT },
    { role: 'user', content: synthesisPrompt },
  ])

  const finalSynthesis = {
    consensusFindings: extractField(synthText, 'CONSENSUS_FINDINGS'),
    remainingDisagreements: extractField(synthText, 'REMAINING_DISAGREEMENTS'),
    confidenceRange: extractField(synthText, 'CONFIDENCE_RANGE'),
    practicalImplications: extractField(synthText, 'PRACTICAL_IMPLICATIONS'),
    rawText: synthText,
  }

  transcriptParts.push(`\n---\n\n## Final Synthesis\n\n${synthText}\n`)
  log(`Done. ${roundRecords.length} rounds completed.`)

  return {
    sessionId: session.id,
    question,
    modelIds,
    rounds: roundRecords,
    finalSynthesis,
    totalRounds: roundRecords.length,
    transcript: transcriptParts.join(''),
  }
}
