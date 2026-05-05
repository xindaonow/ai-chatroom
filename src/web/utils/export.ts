import type {
  ConsensusRunResult,
  DiscussionMode,
  Message,
  Round,
  Session,
} from '@shared/index'
import type { AgentInfo } from '../api'

export function exportAsJson(
  session: Session,
  rounds: Round[],
  messages: Message[],
  agents: AgentInfo[],
  opts?: {
    mode?: DiscussionMode
    consensusRun?: ConsensusRunResult | null
  },
): string {
  const agentMap = Object.fromEntries(agents.map((a) => [a.id, a]))
  const sortedRounds = [...rounds].sort((a, b) => a.index - b.index)

  // Index ConsensusRoundRecord by repo round index for quick join.
  // Note: ConsensusRunResult.rounds use a consensus-internal index that
  // matches repo Round.index when the session is fresh.
  const consensusByIndex: Record<number, NonNullable<ConsensusRunResult['rounds'][number]>> = {}
  if (opts?.consensusRun) {
    for (const cr of opts.consensusRun.rounds) {
      consensusByIndex[cr.roundNumber] = cr
    }
  }

  const data: Record<string, unknown> = {
    exported_at: new Date().toISOString(),
    mode: opts?.mode ?? 'free',
    session: {
      id: session.id,
      created_at: new Date(session.createdAt).toISOString(),
    },
    agents: agents.map((a) => ({
      id: a.id,
      label: a.label,
      model: a.model,
    })),
    rounds: sortedRounds.map((round) => {
      const roundMessages = messages
        .filter((m) => m.roundId === round.id && m.role !== 'system')
        .sort((a, b) => {
          const order = { user: 0, assistant: 1 } as Record<string, number>
          return (order[a.role] ?? 2) - (order[b.role] ?? 2)
        })

      const consensusRecord = consensusByIndex[round.index]

      return {
        index: round.index,
        id: round.id,
        created_at: new Date(round.createdAt).toISOString(),
        ...(consensusRecord && {
          consensus: {
            phase: consensusRecord.phase,
            stopped_after: consensusRecord.stoppedAfter,
            stop_reason: consensusRecord.stopReason,
            orchestrator_state: consensusRecord.orchestratorState,
            agent_signals: consensusRecord.agentSignals,
          },
        }),
        messages: roundMessages.map((m) => {
          if (m.role === 'user') {
            return {
              role: 'user',
              content: m.content,
              created_at: new Date(m.createdAt).toISOString(),
            }
          }
          const agent = m.agentId ? agentMap[m.agentId] : null
          return {
            role: 'assistant',
            agent_id: m.agentId,
            agent_label: agent?.label ?? m.agentId,
            model: agent?.model ?? null,
            content: m.content,
            // Raw [{role, content}, …] payload sent to the LLM API at gen
            // time (post-coalesce). Null for messages generated before this
            // column was added. Restored on import (api.ts).
            prompt: m.prompt,
            created_at: new Date(m.createdAt).toISOString(),
            finalized_at: m.finalizedAt ? new Date(m.finalizedAt).toISOString() : null,
          }
        }),
      }
    }),
  }

  if (opts?.consensusRun) {
    data.consensus_run = {
      total_rounds: opts.consensusRun.totalRounds,
      final_synthesis: opts.consensusRun.finalSynthesis,
      transcript_markdown: opts.consensusRun.transcript,
    }
  }

  return JSON.stringify(data, null, 2)
}

export function downloadText(content: string, filename: string, mimeType = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
