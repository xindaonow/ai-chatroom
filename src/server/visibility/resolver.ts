import type { AgentId, Message, Visibility } from '@shared/index'
import type { Repo } from '../repo'
import { buildRendered, pickRendered, type PublicIdMap } from './render'

/**
 * Visibility rules — soul layer.
 *
 * Default rule (MVP): cross-round transparent, intra-round isolated.
 *
 * Encoding:
 *  - user/system messages: visibleTo = '*' on insert (always public)
 *  - assistant messages while streaming: visibleTo = [self] (intra-round isolation)
 *  - on round finalize: ALL streaming assistant messages flip to visibleTo = '*'
 *    AND get a frozen `rendered` snapshot per viewer
 *
 * Context assembly: sql `WHERE visible_to='*' OR visible_to LIKE '%agentId%'`
 *  (encoded in repo.listVisibleMessages — a single linear pass).
 */

export function initialVisibilityForUser(): Visibility {
  return '*'
}

export function initialVisibilityForAssistant(self: AgentId): Visibility {
  return [self]
}

/**
 * Finalize all streaming assistant messages in a round.
 *  - flip visibleTo to '*'
 *  - build & freeze `rendered` per viewer
 *  - mark round.status = 'finalized'
 */
export function finalizeRound(
  repo: Repo,
  args: {
    roundId: string
    allAgentIds: AgentId[]
    publicIds: PublicIdMap
    now: number
  },
): void {
  const messages = repo.listMessagesByRound(args.roundId)
  for (const m of messages) {
    if (m.role !== 'assistant') continue
    if (m.status !== 'streaming') continue
    const rendered = buildRendered({
      message: m,
      allAgentIds: args.allAgentIds,
      publicIds: args.publicIds,
    })
    repo.finalizeMessage(m.id, {
      visibleTo: '*',
      rendered,
      finalizedAt: args.now,
    })
  }
  for (const m of messages) {
    if (m.role === 'user' || m.role === 'system') {
      if (!m.rendered) {
        const rendered = buildRendered({
          message: m,
          allAgentIds: args.allAgentIds,
          publicIds: args.publicIds,
        })
        repo.finalizeMessage(m.id, {
          visibleTo: '*',
          rendered,
          finalizedAt: args.now,
        })
      }
    }
  }
  repo.updateRoundStatus(args.roundId, 'finalized')
}

/**
 * Build the prompt context for a given agent at a given round boundary.
 *
 * - Reads only finalized messages with rendered snapshots, OR (if not yet finalized)
 *   live content from messages that pass the visibility filter for this viewer.
 * - For round N, we only include messages with roundIndex < N (history) plus
 *   the current round's user message (which is always visible).
 *
 * Returns the array of {role, content} pairs ready to feed an LLM.
 */
export function buildContextFor(
  repo: Repo,
  args: {
    sessionId: string
    viewer: AgentId
    upToRoundIndex: number
    allAgentIds: AgentId[]
    publicIds: PublicIdMap
    /**
     * For prompt-debug reconstruction. When true, drops any assistant message
     * whose roundIndex equals upToRoundIndex — i.e., excludes peers and self
     * for the round currently being generated. At gen time those peers had
     * visibleTo=[peerSelf] and were filtered out naturally, but after finalize
     * they flip to '*' and would otherwise leak into the reconstructed prompt.
     */
    excludeSameRoundAssistants?: boolean
  },
): Array<{ role: 'user' | 'assistant' | 'system'; content: string }> {
  let visible = repo.listVisibleMessages(args.sessionId, args.viewer, {
    upToRoundIndex: args.upToRoundIndex,
  })
  if (args.excludeSameRoundAssistants) {
    visible = visible.filter(
      (m) => !(m.role === 'assistant' && m.roundIndex === args.upToRoundIndex),
    )
  }

  // Reorder within each round so the viewer's own assistant comes right after
  // the user message, before any peer assistants. The DB returns rows in
  // insertion order (created_at ASC), but in startRound peer placeholders are
  // inserted in iteration order — which puts peers BEFORE the viewer's own
  // assistant when the viewer is later in the agents array. After role
  // mapping, peers render as user-role with `[publicId]:` prefix; if they sit
  // between the round's user message and the viewer's own assistant, the
  // coalesce step merges them with the WRONG user turn (the previous round's
  // question) instead of the next round's user query. Sorting (user → self →
  // peers) within each round restores the intended chat shape:
  //
  //   user: Q_R
  //   assistant: viewer's a_R          ← own answer first
  //   user: peer-A bracketed | peer-B bracketed | … | Q_{R+1}   ← coalesce groups peers with NEXT user
  visible = [...visible].sort((a, b) => {
    if (a.roundIndex !== b.roundIndex) return a.roundIndex - b.roundIndex
    const priority = (m: Message) => {
      if (m.role === 'user' || m.role === 'system') return 0
      if (m.agentId === args.viewer) return 1
      return 2
    }
    const p = priority(a) - priority(b)
    if (p !== 0) return p
    return a.createdAt - b.createdAt
  })

  return visible.map((m) =>
    renderForViewer(m, args.viewer, args.allAgentIds, args.publicIds),
  )
}

function renderForViewer(
  m: Message,
  viewer: AgentId,
  allAgentIds: AgentId[],
  publicIds: PublicIdMap,
): { role: 'user' | 'assistant' | 'system'; content: string } {
  if (m.rendered) {
    const r = pickRendered(m.rendered, viewer)
    if (r) return r
  }
  const live = buildRendered({ message: m, allAgentIds, publicIds })
  const r = pickRendered(live, viewer)
  if (r) return r
  return { role: m.role, content: m.content }
}
