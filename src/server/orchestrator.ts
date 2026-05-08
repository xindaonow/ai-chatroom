import type { Repo } from './repo'
import type { AgentSpec } from './adapters'
import { buildAgentFromModelId, buildAgentFromSpec } from './adapters'
import { buildContextFor, finalizeRound, initialVisibilityForAssistant, initialVisibilityForUser } from './visibility/resolver'
import { buildRendered } from './visibility/render'
import { newId } from './ids'
import type { Message, Round, Session, ConsensusPhase, OrchestratorState } from '@shared/index'
import { buildBaseSystemPrompt, buildModePrompt, type DiscussionMode } from './modes'
import { coalesceMessages } from './adapters/coalesce'

/**
 * Per-message live state during streaming. Subscribers (SSE handlers) receive
 * chunks as they arrive. After the round is finalized, state is removed.
 */
type MessageStream = {
  messageId: string
  agentId: string
  controller: AbortController
  /** Resolved when streaming completes (with done or error). */
  done: Promise<void>
  /** Subscribers currently consuming this stream. */
  subscribers: Set<(ev: StreamEvent) => void>
  /** Buffered chunks, replayed on new subscribe. */
  bufferedChunks: string[]
  /** Final state once done. */
  state: 'streaming' | 'done' | 'error'
  errorMessage?: string
}

export type StreamEvent =
  | { type: 'chunk'; text: string }
  | { type: 'done' }
  | { type: 'error'; error: string }

export function createOrchestrator(args: {
  repo: Repo
  agents: AgentSpec[]  // default agents (server startup)
}) {
  const { repo } = args
  const defaultAgents = args.agents

  // Per-session agent registry. On cache miss we rebuild AgentSpec[] from the
  // session's persisted `agents` JSON — this enables cold-start access to old
  // sessions after a server restart.
  const sessionAgentsMap = new Map<string, AgentSpec[]>()

  function agentsFor(sessionId: string): AgentSpec[] {
    const cached = sessionAgentsMap.get(sessionId)
    if (cached) return cached
    const session = repo.getSession(sessionId)
    if (!session) return defaultAgents
    const rebuilt = session.agents.map((spec, i) => buildAgentFromSpec(spec, i))
    sessionAgentsMap.set(sessionId, rebuilt)
    return rebuilt
  }

  // roundId -> agentId -> stream
  const liveStreams = new Map<string, Map<string, MessageStream>>()
  // roundId -> promise that resolves once finalizeRound has flipped statuses.
  // Lets external callers (e.g., the consensus runner) await round completion.
  const roundFinalized = new Map<string, Promise<void>>()

  function getStream(roundId: string, agentId: string): MessageStream | null {
    return liveStreams.get(roundId)?.get(agentId) ?? null
  }

  function waitForRoundFinalized(roundId: string): Promise<void> {
    return roundFinalized.get(roundId) ?? Promise.resolve()
  }

  function createSession(
    modelIds?: string[],
    mode: 'free' | 'brainstorm' | 'consensus' = 'free',
  ): Session {
    const agents = modelIds && modelIds.length >= 2
      ? modelIds.map((m, i) => buildAgentFromModelId(m, i))
      : defaultAgents
    const now = Date.now()
    const s: Session = {
      id: newId('s'),
      agents: agents.map((a) => ({ id: a.id, label: a.label, model: a.model })),
      title: null,
      mode,
      createdAt: now,
      updatedAt: now,
    }
    repo.insertSession(s)
    sessionAgentsMap.set(s.id, agents)
    return s
  }

  function getSession(id: string): Session | null {
    return repo.getSession(id)
  }

  /**
   * Begin a new round: write user message, create N assistant placeholders,
   * kick off N adapter streams in parallel, and register them so SSE
   * subscribers can attach.
   */
  function startRound(args: {
    sessionId: string
    userText: string
    mode?: DiscussionMode
    consensusPhase?: ConsensusPhase
    orchestratorState?: OrchestratorState | null
  }): {
    round: Round
    userMessage: Message
    assistantMessages: Message[]
  } {
    const session = repo.getSession(args.sessionId)
    if (!session) throw new Error(`session not found: ${args.sessionId}`)

    const agents = agentsFor(args.sessionId)
    const agentIds = agents.map((a) => a.id)
    const publicIds: Record<string, string> = Object.fromEntries(
      agents.map((a) => [a.id, a.publicId]),
    )

    const idx = repo.nextRoundIndex(args.sessionId)
    const now = Date.now()
    const round: Round = {
      id: newId('r'),
      sessionId: args.sessionId,
      index: idx,
      status: 'streaming',
      createdAt: now,
    }
    repo.insertRound(round)
    repo.touchSession(args.sessionId, now)
    if (idx === 0) {
      // First round: derive a session title from the user's question.
      repo.setTitleIfMissing(args.sessionId, args.userText.slice(0, 80))
    }

    const userMessage: Message = {
      id: newId('u'),
      sessionId: args.sessionId,
      roundId: round.id,
      roundIndex: round.index,
      role: 'user',
      agentId: null,
      content: args.userText,
      status: 'finalized',
      visibleTo: initialVisibilityForUser(),
      rendered: { '*': { role: 'user', content: args.userText } },
      prompt: null,
      inputTokens: null,
      outputTokens: null,
      createdAt: now,
      finalizedAt: now,
    }
    repo.insertMessage(userMessage)

    const assistantMessages: Message[] = []
    const streams = new Map<string, MessageStream>()
    liveStreams.set(round.id, streams)

    for (const agent of agents) {
      const m: Message = {
        id: newId('a'),
        sessionId: args.sessionId,
        roundId: round.id,
        roundIndex: round.index,
        role: 'assistant',
        agentId: agent.id,
        content: '',
        status: 'streaming',
        visibleTo: initialVisibilityForAssistant(agent.id),
        rendered: null,
        prompt: null,
        inputTokens: null,
        outputTokens: null,
        createdAt: Date.now(),
        finalizedAt: null,
      }
      repo.insertMessage(m)
      assistantMessages.push(m)

      const stream = startAgentStream({
        agent,
        message: m,
        session,
        round,
        mode: args.mode ?? 'free',
        consensusPhase: args.consensusPhase,
        orchestratorState: args.orchestratorState,
        agentIds,
        publicIds,
        allAgents: agents,
      })
      streams.set(agent.id, stream)
    }

    // When all agents finish, finalize the round and resolve the finalized
    // promise so external callers can sequence work after this round.
    const finalizedPromise = new Promise<void>((resolve) => {
      Promise.allSettled(
        [...streams.values()].map((s) => s.done),
      ).then(() => {
        finalizeRound(repo, {
          roundId: round.id,
          allAgentIds: agentIds,
          publicIds,
          now: Date.now(),
        })
        resolve()
        // Keep liveStreams entry briefly so late subscribers can still drain
        // buffered chunks; clean up after a short grace period.
        setTimeout(() => {
          liveStreams.delete(round.id)
          roundFinalized.delete(round.id)
        }, 30_000)
      })
    })
    roundFinalized.set(round.id, finalizedPromise)

    return { round, userMessage, assistantMessages }
  }

  function startAgentStream(opts: {
    agent: AgentSpec
    message: Message
    session: Session
    round: Round
    mode: DiscussionMode
    consensusPhase?: ConsensusPhase
    orchestratorState?: OrchestratorState | null
    agentIds: string[]
    publicIds: Record<string, string>
    allAgents: AgentSpec[]
  }): MessageStream {
    const { agent, message, round, mode, agentIds, publicIds, allAgents } = opts
    const controller = new AbortController()
    const subscribers = new Set<(ev: StreamEvent) => void>()
    const bufferedChunks: string[] = []
    const stream: MessageStream = {
      messageId: message.id,
      agentId: agent.id,
      controller,
      done: Promise.resolve(),
      subscribers,
      bufferedChunks,
      state: 'streaming',
    }

    const selfPublic = publicIds[agent.id]
    const otherPublicIds = allAgents
      .filter((a) => a.id !== agent.id)
      .map((a) => a.publicId)
    const modePrompt = buildModePrompt(mode, selfPublic, otherPublicIds, {
      roundIndex: round.index,
      phase: opts.consensusPhase,
      orchestratorState: opts.orchestratorState,
    })
    const systemMsg = {
      role: 'system' as const,
      content: buildBaseSystemPrompt(selfPublic, otherPublicIds) + modePrompt,
    }
    const history = buildContextFor(repo, {
      sessionId: message.sessionId,
      viewer: agent.id,
      upToRoundIndex: round.index,
      allAgentIds: agentIds,
      publicIds,
      // Drop the current round's assistant placeholders — including the
      // viewer's own empty self-row. Without this filter the prompt ends with
      // a trailing `{ role: 'assistant', content: '' }` that surprises anyone
      // reading the inspector and is at best ignored by providers / at worst
      // rejected (Anthropic strips empty blocks separately, but we don't want
      // to depend on adapter-side cleanup here).
      excludeSameRoundAssistants: true,
    })
    const messages = [systemMsg, ...history]

    // Snapshot the exact payload the LLM API will see (post-coalesce, with
    // peer-aware merging). Persisting this means the prompt inspector,
    // exports, and any future replay see what was actually sent — not a
    // reconstruction that might drift if visibility logic / mode prompts
    // change later. Re-snapshots cleanly on retry (resetMessage clears it).
    const promptForLlm = coalesceMessages(messages)
    repo.setMessagePrompt(message.id, JSON.stringify(promptForLlm))

    // Per-message finalize: stamp THIS message's true completion time and
    // flip its visibility/rendered the moment its own stream ends, instead of
    // waiting for the slowest peer to finish (which used to give every bubble
    // the last-finishing time and briefly flip earlier finishers back to a
    // "connecting" state because their DB status was still 'streaming').
    function finalizeThisMessage() {
      const fresh = repo.getMessage(message.id)
      if (!fresh || fresh.status !== 'streaming') return
      const rendered = buildRendered({
        message: fresh,
        allAgentIds: agentIds,
        publicIds,
      })
      repo.finalizeMessage(message.id, {
        visibleTo: '*',
        rendered,
        finalizedAt: Date.now(),
      })
    }

    stream.done = (async () => {
      try {
        for await (const ev of agent.adapter.stream({
          messages,
          signal: controller.signal,
        })) {
          if (ev.type === 'chunk') {
            bufferedChunks.push(ev.text)
            // Persist chunk to DB immediately. SQLite WAL handles this fast
            // enough for our scale; for higher rate we'd batch.
            repo.appendMessageContent(message.id, ev.text)
            for (const sub of subscribers) sub(ev)
          } else if (ev.type === 'usage') {
            // Provider reported its final token counts. Persist now so
            // the bubble can display them as soon as the next snapshot
            // refresh hits the frontend. Not forwarded to SSE subscribers
            // — the frontend reads `inputTokens`/`outputTokens` from the
            // finalized message row instead.
            repo.setMessageUsage(message.id, ev.inputTokens, ev.outputTokens)
          } else if (ev.type === 'done') {
            stream.state = 'done'
            finalizeThisMessage()
            for (const sub of subscribers) sub(ev)
          } else if (ev.type === 'error') {
            stream.state = 'error'
            stream.errorMessage = ev.error
            repo.setMessageError(message.id, ev.error, Date.now())
            for (const sub of subscribers) sub(ev)
          }
        }
        if (stream.state === 'streaming') {
          // Adapter ended without explicit done; treat as done.
          stream.state = 'done'
          finalizeThisMessage()
          for (const sub of subscribers) sub({ type: 'done' })
        }
      } catch (e) {
        const errMsg = (e as Error).message
        stream.state = 'error'
        stream.errorMessage = errMsg
        repo.setMessageError(message.id, errMsg, Date.now())
        for (const sub of subscribers) sub({ type: 'error', error: errMsg })
      }
    })()

    return stream
  }

  /**
   * Reset an assistant message back to streaming state and re-run the agent
   * with the same context as a fresh call would see. Used for the manual
   * "retry this AI's last response" feature.
   *
   * The retry uses mode='free' (no extra mode prompt) — original consensus
   * phase / orchestrator state aren't preserved per-round, so we just let the
   * agent re-respond against whatever it can see in history. Since other
   * agents in the same round are already finalized (visibleTo='*'), the
   * retried agent CAN now see their answers — this is intentional: it's a
   * "redo with hindsight" rather than a strict re-roll.
   */
  function retryMessage(messageId: string): {
    round: Round
    message: Message
  } {
    const m = repo.getMessage(messageId)
    if (!m) throw new Error('message not found')
    if (m.role !== 'assistant') throw new Error('only assistant messages can be retried')
    if (!m.agentId) throw new Error('assistant message has no agentId')
    if (m.status === 'streaming') throw new Error('message is currently streaming')

    const session = repo.getSession(m.sessionId)
    if (!session) throw new Error('session not found')
    const round = repo.getRound(m.roundId)
    if (!round) throw new Error('round not found')

    const agents = agentsFor(session.id)
    const agent = agents.find((a) => a.id === m.agentId)
    if (!agent) throw new Error('agent not found in session')

    const agentIds = agents.map((a) => a.id)
    const publicIds: Record<string, string> = Object.fromEntries(
      agents.map((a) => [a.id, a.publicId]),
    )

    // Reset row so the retried message starts fresh.
    repo.resetMessage(m.id, { visibleTo: initialVisibilityForAssistant(agent.id) })
    const fresh = repo.getMessage(m.id)!

    // Get or create the round's streams map. Existing peer streams may still
    // be present (brief grace period); leave them alone.
    let streams = liveStreams.get(round.id)
    if (!streams) {
      streams = new Map()
      liveStreams.set(round.id, streams)
    }
    // Replace any stale stream for this same agent.
    const old = streams.get(agent.id)
    if (old) {
      try { old.controller.abort() } catch {}
      streams.delete(agent.id)
    }

    const stream = startAgentStream({
      agent,
      message: fresh,
      session,
      round,
      mode: 'free',
      agentIds,
      publicIds,
      allAgents: agents,
    })
    streams.set(agent.id, stream)

    // Finalize just THIS message when its stream completes — don't touch peers.
    stream.done.then(() => {
      const fm = repo.getMessage(m.id)
      if (!fm) return
      if (fm.status === 'streaming') {
        const rendered = buildRendered({
          message: fm,
          allAgentIds: agentIds,
          publicIds,
        })
        repo.finalizeMessage(m.id, {
          visibleTo: '*',
          rendered,
          finalizedAt: Date.now(),
        })
      }
      setTimeout(() => {
        const map = liveStreams.get(round.id)
        if (map) {
          map.delete(agent.id)
          if (map.size === 0) liveStreams.delete(round.id)
        }
      }, 30_000)
    })

    return { round, message: fresh }
  }

  /**
   * Subscribe an SSE listener to a (roundId, agentId) stream. Replays buffered
   * chunks to catch up, then forwards new events. Returns an unsubscribe fn.
   */
  function subscribe(
    roundId: string,
    agentId: string,
    onEvent: (ev: StreamEvent) => void,
  ): { unsubscribe: () => void } | null {
    const stream = getStream(roundId, agentId)
    if (!stream) return null

    // Replay buffered chunks first.
    for (const text of stream.bufferedChunks) {
      onEvent({ type: 'chunk', text })
    }
    if (stream.state === 'done') {
      onEvent({ type: 'done' })
      return { unsubscribe: () => {} }
    }
    if (stream.state === 'error') {
      onEvent({ type: 'error', error: stream.errorMessage ?? 'unknown' })
      return { unsubscribe: () => {} }
    }

    stream.subscribers.add(onEvent)
    return {
      unsubscribe: () => stream.subscribers.delete(onEvent),
    }
  }

  /**
   * Reconstruct the [system, ...history] payload that would be (or was) sent
   * to a specific assistant message's agent. Used by the debug-mode prompt
   * inspector. Mode is supplied by the caller because we don't persist mode
   * per round; defaults to 'free' which yields just the base system prompt.
   *
   * Same-round assistant messages are excluded so the reconstruction matches
   * what the agent actually saw at gen time (peers were intra-round isolated).
   */
  function promptFor(messageId: string, mode: DiscussionMode): {
    systemContent: string
    messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
    agent: { id: string; label: string; publicId: string; model: string }
    round: { id: string; index: number }
    mode: DiscussionMode
    /** The AI's actual response — what came BACK from the API. Not part of
     *  the prompt itself; included so the inspector can render a labeled
     *  "AI response" block alongside the prompt for full context. */
    responseContent: string
    responseStatus: 'streaming' | 'done' | 'error' | 'finalized'
  } | null {
    const m = repo.getMessage(messageId)
    if (!m || !m.agentId) return null
    const round = repo.getRound(m.roundId)
    if (!round) return null
    const agents = agentsFor(m.sessionId)
    const agent = agents.find((a) => a.id === m.agentId)
    if (!agent) return null

    const agentInfo = {
      id: agent.id,
      label: agent.label,
      publicId: agent.publicId,
      model: agent.model,
    }
    const responseContent = m.content
    const responseStatus = m.status

    // Prefer the persisted snapshot if one exists — that's the byte-for-byte
    // payload the LLM API received. Falls through to a live reconstruction
    // for messages generated before this column was added (or any path that
    // hasn't snapshotted yet).
    if (m.prompt && m.prompt.length > 0) {
      const sysIdx = m.prompt.findIndex((p) => p.role === 'system')
      const systemContent = sysIdx >= 0 ? m.prompt[sysIdx].content : ''
      return {
        systemContent,
        messages: m.prompt,
        agent: agentInfo,
        round: { id: round.id, index: round.index },
        mode,
        responseContent,
        responseStatus,
      }
    }

    const agentIds = agents.map((a) => a.id)
    const publicIds: Record<string, string> = Object.fromEntries(
      agents.map((a) => [a.id, a.publicId]),
    )
    const selfPublic = publicIds[agent.id]
    const otherPublicIds = agents
      .filter((a) => a.id !== agent.id)
      .map((a) => a.publicId)
    const modePrompt = buildModePrompt(mode, selfPublic, otherPublicIds, {
      roundIndex: round.index,
    })
    const systemContent = buildBaseSystemPrompt(selfPublic, otherPublicIds) + modePrompt
    const history = buildContextFor(repo, {
      sessionId: m.sessionId,
      viewer: agent.id,
      upToRoundIndex: round.index,
      allAgentIds: agentIds,
      publicIds,
      excludeSameRoundAssistants: true,
    })
    // Reconstruction fallback: apply the same coalesce step the adapters use
    // so the inspector shows what the LLM API would receive.
    const merged = coalesceMessages([
      { role: 'system', content: systemContent },
      ...history,
    ])
    return {
      systemContent,
      messages: merged,
      agent: agentInfo,
      round: { id: round.id, index: round.index },
      mode,
      responseContent,
      responseStatus,
    }
  }

  return {
    createSession,
    getSession,
    startRound,
    retryMessage,
    subscribe,
    waitForRoundFinalized,
    repo,
    listMessages: (sessionId: string) => repo.listMessages(sessionId),
    listRounds: (sessionId: string) => repo.listRounds(sessionId),
    promptFor,
    defaultAgents,
    agentsFor,
  }
}

export type Orchestrator = ReturnType<typeof createOrchestrator>
