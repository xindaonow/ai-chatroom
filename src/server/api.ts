import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { streamSSE } from 'hono/streaming'
import type { Orchestrator } from './orchestrator'
import { getHostAdapter, HOST_LABEL } from './host'
import { presets, extraModels } from '../../agents.config'
import { getOpenRouterModels } from './openrouter-models'
import { newId } from './ids'
import {
  finalizeRound,
  initialVisibilityForAssistant,
  initialVisibilityForUser,
} from './visibility/resolver'
import type {
  AgentSignal,
  ConsensusFinalSynthesis,
  ConsensusRoundRecord,
  ConsensusRunResult,
  DiscussionMode,
  Message,
  OrchestratorState,
  Round,
} from '@shared/index'

export function createApi(orch: Orchestrator) {
  const app = new Hono()

  // CORS: restrict to localhost dev origins by default. Override with a
  // comma-separated CORS_ORIGINS env var if you reverse-proxy from another
  // host. NEVER set CORS_ORIGINS=* on a public deployment — generation
  // endpoints spend the server's OPENROUTER_API_KEY / ARK_API_KEY budget.
  // This server has no auth or rate-limit; treat it as a single-user
  // local-only service unless you've added those layers yourself.
  const allowedOrigins = (
    process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173'
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  app.use('*', cors({ origin: allowedOrigins }))

  app.get('/', (c) =>
    c.text(
      [
        'AI Chatroom — API server',
        '',
        'This is the backend on :3000. The web UI is on http://localhost:5173/',
        '',
        'Endpoints:',
        '  GET  /api/health',
        '  GET  /api/agents',
        '  POST /api/sessions',
        '  GET  /api/sessions/:id',
        '  POST /api/rounds          { sessionId, userText }',
        '  GET  /api/rounds/:roundId/stream/:agentId   (SSE)',
        '  GET  /api/messages/:id/prompt',
      ].join('\n'),
    ),
  )

  app.get('/api/health', (c) => c.json({ ok: true }))

  app.get('/api/agents', (c) =>
    c.json(orch.defaultAgents.map((a) => ({ id: a.id, label: a.label, model: a.model }))),
  )

  app.get('/api/presets', (c) => c.json(presets))

  app.get('/api/models', async (c) => {
    // OpenRouter's full catalog (~370 models) + extras (direct-API providers
    // OpenRouter doesn't list, e.g. Doubao). Extras come first so they're
    // visible when the user opens the picker without searching.
    const dynamic = await getOpenRouterModels()
    const seen = new Set(extraModels.map((m) => m.model))
    return c.json([
      ...extraModels,
      ...dynamic.filter((m) => !seen.has(m.model)),
    ])
  })

  app.post('/api/sessions', async (c) => {
    let modelIds: string[] | undefined
    try {
      const body = await c.req.json()
      if (Array.isArray(body?.modelIds) && body.modelIds.length >= 2) {
        modelIds = body.modelIds.map(String)
      }
    } catch {}
    const s = orch.createSession(modelIds)
    const agents = orch.agentsFor(s.id).map((a) => ({ id: a.id, label: a.label, model: a.model }))
    return c.json({ session: s, agents })
  })

  app.get('/api/sessions', (c) => {
    return c.json(orch.repo.listSessions())
  })

  app.get('/api/sessions/:id', (c) => {
    const s = orch.getSession(c.req.param('id'))
    if (!s) return c.json({ error: 'not found' }, 404)
    const messages = orch.listMessages(s.id)
    const rounds = orch.listRounds(s.id)
    const consensusRun = orch.repo.getLatestConsensusRun(s.id)
    const summary = orch.repo.getLatestSummary(s.id)
    return c.json({ session: s, rounds, messages, consensusRun, summary })
  })

  app.delete('/api/sessions/:id', (c) => {
    const id = c.req.param('id')
    const s = orch.getSession(id)
    if (!s) return c.json({ error: 'not found' }, 404)
    orch.repo.deleteSession(id)
    return c.json({ ok: true })
  })

  /**
   * Import a previously-exported JSON snapshot. Creates a fresh session with
   * matching agents (by `model` string), replays all rounds + messages as
   * already-finalized history, and returns the rebuilt state. The user can
   * then continue the conversation from where it left off.
   */
  app.post('/api/sessions/import', async (c) => {
    let body: Record<string, unknown>
    try {
      body = (await c.req.json()) as Record<string, unknown>
    } catch {
      return c.json({ error: 'invalid JSON' }, 400)
    }

    const exportedAgents = Array.isArray(body.agents)
      ? (body.agents as Array<Record<string, unknown>>)
      : []
    if (exportedAgents.length < 2) {
      return c.json({ error: 'JSON must contain at least 2 agents' }, 400)
    }
    const modelIds = exportedAgents.map((a) => String(a.model ?? '')).filter(Boolean)
    if (modelIds.length !== exportedAgents.length) {
      return c.json({ error: 'each agent entry must have a "model" field' }, 400)
    }

    // Create a fresh session with the same models. orch.createSession assigns
    // new IDs deterministically; we pair them by position with the exported
    // agents to remap historical agent_id references.
    const session = orch.createSession(modelIds)
    const newAgents = orch.agentsFor(session.id)
    const agentIdMap: Record<string, string> = {}
    for (let i = 0; i < exportedAgents.length; i++) {
      agentIdMap[String(exportedAgents[i].id ?? '')] = newAgents[i].id
    }
    const publicIds: Record<string, string> = Object.fromEntries(
      newAgents.map((a) => [a.id, a.publicId]),
    )
    const newAgentIds = newAgents.map((a) => a.id)

    const exportedRounds = Array.isArray(body.rounds)
      ? (body.rounds as Array<Record<string, unknown>>)
      : []
    const now = Date.now()
    const parseDate = (v: unknown): number | null => {
      if (typeof v !== 'string') return null
      const t = Date.parse(v)
      return Number.isNaN(t) ? null : t
    }

    // Derive a title from the first user message in the export, if any.
    const firstUserContent = (() => {
      for (const r of exportedRounds) {
        const msgs = Array.isArray(r.messages) ? (r.messages as Array<Record<string, unknown>>) : []
        for (const m of msgs) {
          if (m.role === 'user' && typeof m.content === 'string' && m.content.length > 0) {
            return m.content
          }
        }
      }
      return null
    })()
    if (firstUserContent) {
      orch.repo.setTitleIfMissing(session.id, firstUserContent.slice(0, 80))
    }

    // Replay every round → insert as if streaming, then call finalizeRound to
    // flip visibility to '*' and freeze rendered snapshots. Same path real
    // rounds go through, so behavior is consistent.
    const sortedRounds = [...exportedRounds].sort(
      (a, b) => Number(a.index ?? 0) - Number(b.index ?? 0),
    )
    for (const r of sortedRounds) {
      const idx = Number(r.index ?? 0)
      const roundCreatedAt = parseDate(r.created_at) ?? now
      const round: Round = {
        id: newId('r'),
        sessionId: session.id,
        index: idx,
        status: 'streaming',
        createdAt: roundCreatedAt,
      }
      orch.repo.insertRound(round)

      const msgs = Array.isArray(r.messages)
        ? (r.messages as Array<Record<string, unknown>>)
        : []
      for (const m of msgs) {
        const role = String(m.role ?? '')
        const content = String(m.content ?? '')
        const createdAt = parseDate(m.created_at) ?? roundCreatedAt
        if (role === 'user') {
          const userMsg: Message = {
            id: newId('u'),
            sessionId: session.id,
            roundId: round.id,
            roundIndex: idx,
            role: 'user',
            agentId: null,
            content,
            status: 'streaming',
            visibleTo: initialVisibilityForUser(),
            rendered: null,
            prompt: null,
            createdAt,
            finalizedAt: null,
          }
          orch.repo.insertMessage(userMsg)
        } else if (role === 'assistant') {
          const oldAgentId = String(m.agent_id ?? '')
          const newAgentId = agentIdMap[oldAgentId]
          if (!newAgentId) continue // skip messages whose agent we couldn't map
          const finalizedAt = parseDate(m.finalized_at) ?? createdAt
          // Restore the prompt snapshot if the export carried one (added in the
          // raw-prompt-persistence release). Older exports won't have this
          // field; the message just stays unannotated.
          const importedPrompt = Array.isArray(m.prompt)
            ? (m.prompt as Array<{ role: string; content: string }>)
                .map((p) => ({ role: p.role as 'user' | 'assistant' | 'system', content: String(p.content ?? '') }))
            : null
          const aMsg: Message = {
            id: newId('a'),
            sessionId: session.id,
            roundId: round.id,
            roundIndex: idx,
            role: 'assistant',
            agentId: newAgentId,
            content,
            status: 'streaming',
            visibleTo: initialVisibilityForAssistant(newAgentId),
            rendered: null,
            prompt: importedPrompt,
            createdAt,
            finalizedAt,
          }
          orch.repo.insertMessage(aMsg)
        }
      }

      finalizeRound(orch.repo, {
        roundId: round.id,
        allAgentIds: newAgentIds,
        publicIds,
        now: roundCreatedAt,
      })
      orch.repo.touchSession(session.id, roundCreatedAt)
    }

    // Build response. Refresh from repo so rendered/visible/finalized fields
    // reflect what's actually stored.
    const freshSession = orch.repo.getSession(session.id)!
    const freshRounds = orch.repo.listRounds(session.id)
    const freshMessages = orch.repo.listMessages(session.id)

    const validModes: DiscussionMode[] = ['free', 'consensus', 'brainstorm']
    const rawMode = typeof body.mode === 'string' ? (body.mode as DiscussionMode) : 'free'
    const mode: DiscussionMode = validModes.includes(rawMode) ? rawMode : 'free'

    let consensusRun: ConsensusRunResult | null = null
    const cr = body.consensus_run as Record<string, unknown> | undefined
    if (cr) {
      const reconstructedRounds: ConsensusRoundRecord[] = []
      for (const r of sortedRounds) {
        const c = r.consensus as Record<string, unknown> | undefined
        if (!c) continue
        reconstructedRounds.push({
          roundNumber: Number(r.index ?? 0),
          phase: ((c.phase as string) === 'review' ? 'review' : 'initial'),
          orchestratorState: (c.orchestrator_state ?? null) as OrchestratorState | null,
          agentSignals: Array.isArray(c.agent_signals) ? (c.agent_signals as AgentSignal[]) : [],
          stoppedAfter: Boolean(c.stopped_after),
          stopReason: (typeof c.stop_reason === 'string' ? c.stop_reason : null),
        })
      }
      const firstUserMsg = sortedRounds[0]
        ? ((sortedRounds[0].messages as Array<Record<string, unknown>>) ?? []).find(
            (m) => m.role === 'user',
          )
        : null
      const finalSyn = (cr.final_synthesis ?? {}) as ConsensusFinalSynthesis
      consensusRun = {
        sessionId: session.id,
        question: typeof firstUserMsg?.content === 'string' ? firstUserMsg.content : '',
        modelIds,
        rounds: reconstructedRounds,
        finalSynthesis: {
          consensusFindings: finalSyn.consensusFindings ?? '',
          remainingDisagreements: finalSyn.remainingDisagreements ?? '',
          confidenceRange: finalSyn.confidenceRange ?? '',
          practicalImplications: finalSyn.practicalImplications ?? '',
          rawText: finalSyn.rawText ?? '',
        },
        totalRounds: Number(cr.total_rounds ?? reconstructedRounds.length),
        transcript: typeof cr.transcript_markdown === 'string' ? cr.transcript_markdown : '',
      }
      // Persist the imported synthesis so reload picks it up.
      try {
        orch.repo.insertConsensusRun({
          id: newId('cr'),
          sessionId: session.id,
          result: consensusRun,
          createdAt: Date.now(),
        })
      } catch (e) {
        console.error('[import] persist consensus_run failed:', (e as Error).message)
      }
    }

    return c.json({
      session: freshSession,
      rounds: freshRounds,
      messages: freshMessages,
      agents: newAgents.map((a) => ({ id: a.id, label: a.label, model: a.model })),
      mode,
      consensusRun,
    })
  })

  app.post('/api/rounds', async (c) => {
    const body = await c.req.json()
    const sessionId = String(body.sessionId ?? '')
    const userText = String(body.userText ?? '')
    const rawMode = String(body.mode ?? 'free')
    const mode: DiscussionMode =
      rawMode === 'consensus' || rawMode === 'brainstorm' ? rawMode : 'free'
    if (!sessionId || !userText) {
      return c.json({ error: 'sessionId and userText required' }, 400)
    }
    const result = orch.startRound({ sessionId, userText, mode })
    return c.json(result)
  })

  app.get('/api/rounds/:roundId/stream/:agentId', (c) => {
    const roundId = c.req.param('roundId')
    const agentId = c.req.param('agentId')
    return streamSSE(c, async (stream) => {
      // Serialize events through a queue so we await each writeSSE in order
      // and won't close the stream before the terminal event has flushed.
      const queue: Array<{ type: string; payload: string } | null> = []
      let notify: (() => void) | null = null

      const push = (item: { type: string; payload: string } | null) => {
        queue.push(item)
        notify?.()
      }

      const sub = orch.subscribe(roundId, agentId, (ev) => {
        push({ type: ev.type, payload: JSON.stringify(ev) })
      })

      if (!sub) {
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({ type: 'error', error: 'stream not found' }),
        })
        return
      }

      c.req.raw.signal.addEventListener('abort', () => {
        sub.unsubscribe()
        push(null) // sentinel to break the loop
      })

      try {
        while (true) {
          while (queue.length > 0) {
            const item = queue.shift()!
            if (item === null) return
            await stream.writeSSE({ event: item.type, data: item.payload })
            if (item.type === 'done' || item.type === 'error') {
              return
            }
          }
          await new Promise<void>((r) => {
            notify = () => {
              notify = null
              r()
            }
          })
        }
      } finally {
        sub.unsubscribe()
      }
    })
  })

  app.post('/api/consensus/run', async (c) => {
    let body: {
      question?: unknown
      sessionId?: unknown
      modelIds?: unknown
      maxRounds?: unknown
    }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid JSON' }, 400)
    }
    const question = String(body.question ?? '').trim()
    const sessionId = body.sessionId ? String(body.sessionId).trim() : ''
    const modelIds: string[] = Array.isArray(body.modelIds)
      ? (body.modelIds as unknown[]).map(String).filter((s) => s.length > 0)
      : []
    const maxRounds = Math.max(2, Math.min(10, Number(body.maxRounds ?? 4)))
    if (!question) return c.json({ error: 'question required' }, 400)
    if (!sessionId && modelIds.length < 2) {
      return c.json({ error: 'either sessionId or 2+ modelIds required' }, 400)
    }
    if (sessionId && !orch.repo.getSession(sessionId)) {
      return c.json({ error: 'session not found' }, 404)
    }

    return streamSSE(c, async (stream) => {
      const send = async (event: string, data: unknown) => {
        try {
          await stream.writeSSE({ event, data: JSON.stringify(data) })
        } catch {
          // ignore: client may have disconnected
        }
      }

      try {
        const { runConsensus } = await import('./consensus/runner')
        await send('progress', { message: 'Starting consensus run…' })

        const baseArgs = {
          question,
          maxRounds,
          orch,
          onProgress: (msg: string) => {
            send('progress', { message: msg })
          },
          onRoundStarted: (info: {
            consensusIdx: number
            phase: 'initial' | 'review'
            round: unknown
            userMessage: unknown
            assistantMessages: unknown
          }) => {
            send('round-started', info)
          },
        }
        const runArgs = sessionId
          ? { ...baseArgs, sessionId }
          : { ...baseArgs, modelIds }

        const result = await runConsensus(runArgs)
        // Persist the synthesis so it survives reload / tab close.
        try {
          orch.repo.insertConsensusRun({
            id: newId('cr'),
            sessionId: result.sessionId,
            result,
            createdAt: Date.now(),
          })
        } catch (persistErr) {
          console.error('[consensus] persist failed:', (persistErr as Error).message)
        }
        await send('complete', result)
      } catch (e) {
        await send('error', { error: (e as Error).message })
      }
    })
  })

  app.post('/api/sessions/:id/summarize', async (c) => {
    const sessionId = c.req.param('id')
    const session = orch.repo.getSession(sessionId)
    if (!session) return c.json({ error: 'session not found' }, 404)

    let body: { prompt?: unknown }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid JSON' }, 400)
    }
    const userPrompt = String(body.prompt ?? '').trim()
    if (!userPrompt) return c.json({ error: 'prompt required' }, 400)

    // Summarize is handled by the fixed Host model (see src/server/host.ts) —
    // independent of which participants the user picked, so the output style
    // stays consistent across sessions. We still need the participant label
    // map below to render the transcript with their display names.
    const sessionAgents = orch.agentsFor(sessionId)
    const labelById = Object.fromEntries(sessionAgents.map((a) => [a.id, a.label]))

    // Build a chronological transcript across all rounds.
    const rounds = [...orch.repo.listRounds(sessionId)].sort((a, b) => a.index - b.index)
    const messages = orch.repo.listMessages(sessionId)

    const transcriptParts: string[] = []
    for (const r of rounds) {
      transcriptParts.push(`## Round ${r.index + 1}\n`)
      const userMsg = messages.find((m) => m.roundId === r.id && m.role === 'user')
      if (userMsg && userMsg.content) {
        transcriptParts.push(`**User**:\n${userMsg.content}\n`)
      }
      for (const a of sessionAgents) {
        const m = messages.find(
          (msg) => msg.roundId === r.id && msg.agentId === a.id && msg.role === 'assistant',
        )
        if (m && m.content) {
          transcriptParts.push(`\n**${labelById[a.id] ?? a.id}**:\n${m.content}\n`)
        }
      }
      transcriptParts.push('')
    }
    const transcript = transcriptParts.join('\n').trim() || '(empty conversation)'

    // Persist a streaming summary row so reload / tab-reopen can resume it.
    const summaryId = newId('sum')
    const summaryStartedAt = Date.now()
    orch.repo.insertSummary({
      id: summaryId,
      sessionId,
      prompt: userPrompt,
      agentLabel: HOST_LABEL,
      content: '',
      status: 'streaming',
      error: null,
      createdAt: summaryStartedAt,
      finalizedAt: null,
    })

    return streamSSE(c, async (stream) => {
      const send = async (event: string, data: unknown) => {
        try {
          await stream.writeSSE({ event, data: JSON.stringify(data) })
        } catch {}
      }

      const adapterMessages = [
        {
          role: 'system' as const,
          content: `You are processing the full transcript of a multi-AI conversation. Each round shows the user's message followed by every AI's response, labeled by the AI's name.

Read the transcript carefully, then follow the user's instruction precisely. The instruction may ask for a summary, a translation, an extraction (action items, key disagreements, etc.), a comparison, or any other operation on the transcript content. Respond in the language and style implied by the user's instruction.

Do not invent content that is not in the transcript. Cite specific AI names when attributing claims.

TRANSCRIPT:
${transcript}`,
        },
        { role: 'user' as const, content: userPrompt },
      ]

      try {
        for await (const ev of getHostAdapter().stream({ messages: adapterMessages })) {
          if (ev.type === 'chunk') {
            orch.repo.appendSummaryContent(summaryId, ev.text)
            await send('chunk', { text: ev.text })
          } else if (ev.type === 'done') {
            orch.repo.finalizeSummary(summaryId, Date.now())
            await send('done', { summaryId })
            return
          } else if (ev.type === 'error') {
            orch.repo.setSummaryError(summaryId, ev.error, Date.now())
            await send('error', { error: ev.error })
            return
          }
        }
        orch.repo.finalizeSummary(summaryId, Date.now())
        await send('done', { summaryId })
      } catch (e) {
        const errMsg = (e as Error).message
        orch.repo.setSummaryError(summaryId, errMsg, Date.now())
        await send('error', { error: errMsg })
      }
    })
  })

  app.post('/api/messages/:id/retry', (c) => {
    const id = c.req.param('id')
    try {
      const { round, message } = orch.retryMessage(id)
      return c.json({ round, message })
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400)
    }
  })

  app.get('/api/messages/:id/prompt', (c) => {
    const id = c.req.param('id')
    const rawMode = c.req.query('mode') ?? 'free'
    const mode: DiscussionMode =
      rawMode === 'consensus' || rawMode === 'brainstorm' ? rawMode : 'free'
    const result = orch.promptFor(id, mode)
    if (!result) return c.json({ error: 'not found' }, 404)
    return c.json(result)
  })

  return app
}
