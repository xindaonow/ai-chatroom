import { useEffect, useRef, useState } from 'react'
import { useStore } from './store'
import {
  createSession,
  getSession,
  listModels,
  listPresets,
  openStream,
  runConsensusStream,
  startRound,
} from './api'
import { Composer } from './components/Composer'
import { Timeline } from './components/Timeline'
import { ModeSelector } from './components/ModeSelector'
import { ModelPicker } from './components/ModelPicker'
import { ConsensusProgress } from './components/ConsensusProgress'
import { FinalSynthesis } from './components/FinalSynthesis'
import { ImportButton } from './components/ImportButton'
import { SummaryPanel } from './components/SummaryPanel'
import { SessionsSidebar } from './components/SessionsSidebar'
import { PromptInspector } from './components/PromptInspector'
import { exportAsJson, downloadText } from './utils/export'
import type { Message } from '@shared/index'

export function App() {
  const session = useStore((s) => s.session)
  const setAgents = useStore((s) => s.setAgents)
  const setAvailableModels = useStore((s) => s.setAvailableModels)
  const setPresets = useStore((s) => s.setPresets)
  const setSnapshot = useStore((s) => s.setSnapshot)
  const appendMessages = useStore((s) => s.appendMessages)
  const appendChunk = useStore((s) => s.appendChunk)
  const markDone = useStore((s) => s.markDone)
  const markError = useStore((s) => s.markError)
  const clearStreaming = useStore((s) => s.clearStreaming)
  const agents = useStore((s) => s.agents)

  const mode = useStore((s) => s.mode)
  const setMode = useStore((s) => s.setMode)
  const consensusMaxRounds = useStore((s) => s.consensusMaxRounds)
  const setSelectedModelIds = useStore((s) => s.setSelectedModelIds)
  const selectedModelIds = useStore((s) => s.selectedModelIds)
  const presets = useStore((s) => s.presets)
  const rounds = useStore((s) => s.rounds)
  const messages = useStore((s) => s.messages)
  const [busy, setBusy] = useState(false)
  const consensusProgress = useStore((s) => s.consensusProgress)
  const consensusRun = useStore((s) => s.consensusRun)
  const summary = useStore((s) => s.summary)

  function handleSave() {
    if (!session || rounds.length === 0) return
    const json = exportAsJson(session, rounds, messages, agents, {
      mode,
      consensusRun,
      summary,
    })
    const date = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-')
    downloadText(json, `ai-chatroom-${date}.json`, 'application/json;charset=utf-8')
  }

  const setConsensusRun = useStore((s) => s.setConsensusRun)
  const pushConsensusProgress = useStore((s) => s.pushConsensusProgress)
  const resetConsensusProgress = useStore((s) => s.resetConsensusProgress)
  const loadSummary = useStore((s) => s.loadSummary)
  const [sidebarRefresh, setSidebarRefresh] = useState(0)

  /**
   * Resubscribe to any messages that were still streaming when we loaded the
   * session. Server keeps generating regardless of client connection — so
   * after a reload, we just attach to the live stream and let chunks flow.
   */
  function resumeInProgressStreams(messagesToScan: Message[]) {
    for (const m of messagesToScan) {
      if (
        m.status === 'streaming' &&
        m.role === 'assistant' &&
        m.agentId
      ) {
        openStream(m.roundId, m.agentId, {
          onChunk: (chunk) => appendChunk(m.id, chunk),
          onDone: async () => {
            markDone(m.id)
            try {
              const fresh = await getSession(session?.id ?? m.sessionId)
              setSnapshot({
                session: fresh.session,
                rounds: fresh.rounds,
                messages: fresh.messages,
              })
            } catch {}
            clearStreaming(m.id)
          },
          onError: (err) => markError(m.id, err),
        })
      }
    }
  }

  /** Load a saved session into the UI and reconnect any live streams. */
  async function switchToSession(id: string) {
    const fresh = await getSession(id)
    setAgents(
      fresh.session.agents.map((a) => ({ id: a.id, label: a.label, model: a.model })),
    )
    setSelectedModelIds(fresh.session.agents.map((a) => a.model))
    setSnapshot({
      session: fresh.session,
      rounds: fresh.rounds,
      messages: fresh.messages,
    })
    // Restore the picker mode from the session's stored mode so re-opening
    // a brainstorm/consensus session doesn't silently fall back to whatever
    // the picker last showed (e.g. Free).
    setMode(fresh.session.mode)
    setConsensusRun(fresh.consensusRun)
    loadSummary(fresh.summary)
    resetConsensusProgress()
    resumeInProgressStreams(fresh.messages)
  }

  /**
   * Clear UI to empty state without creating a DB session. The next Send
   * will lazy-create the session — that way reloading / clicking "+ New chat"
   * / switching models doesn't pollute the sidebar with empty sessions.
   * Selection resets to the pro preset (same as the page-load default).
   */
  function handleNewChat() {
    setAgents([])
    const proIds = presets['pro']?.map((m) => m.model) ?? []
    setSelectedModelIds(proIds)
    setSnapshot({ session: null, rounds: [], messages: [] })
    setConsensusRun(null)
    loadSummary(null)
    resetConsensusProgress()
    setSidebarRefresh((n) => n + 1)
  }

  async function handleApplyModels(modelIds: string[]) {
    // Store the user's model selection. Don't create a session yet — wait for
    // the first Send so we don't accumulate empty sessions when the user is
    // just exploring the picker.
    setSelectedModelIds(modelIds)
    setAgents([])
    setSnapshot({ session: null, rounds: [], messages: [] })
    setConsensusRun(null)
    loadSummary(null)
    resetConsensusProgress()
  }

  const initRef = useRef(false)

  useEffect(() => {
    if (initRef.current) return
    initRef.current = true
    ;(async () => {
      const [models, presetMap] = await Promise.all([
        listModels(),
        listPresets().catch(() => ({}) as Record<string, { id: string; label: string; model: string }[]>),
      ])
      setAvailableModels(models)
      setPresets(presetMap)
      // Default selection = pro preset. The user sees pro pre-selected in
      // the picker without us having created a DB session yet (lazy mode).
      const proPreset = presetMap['pro']
      if (proPreset && proPreset.length >= 2) {
        setSelectedModelIds(proPreset.map((m) => m.model))
      }
      // Don't auto-create a session. Empty timeline shows; first Send
      // will lazy-create one bound to whatever models are selected.
    })().catch((e) => {
      console.error('init failed', e)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSend(text: string) {
    setBusy(true)

    // Lazy session creation: the page-load / "+ New chat" / Apply Models flows
    // do NOT create sessions. Only the first Send does, so the sidebar never
    // collects empty sessions just from idle UI exploration.
    let activeSession = session
    if (!activeSession) {
      const created = await createSession(
        selectedModelIds.length >= 2 ? selectedModelIds : undefined,
        mode,
      )
      activeSession = created.session
      setAgents(created.agents)
      setSelectedModelIds(created.agents.map((a) => a.model))
      setSnapshot({ session: activeSession, rounds: [], messages: [] })
    }
    const sessionId = activeSession.id

    async function runOneRound(roundText: string) {
      const { round, userMessage, assistantMessages } = await startRound(
        sessionId,
        roundText,
        mode,
      )
      appendMessages([round], [userMessage, ...assistantMessages])

      await new Promise<void>((resolve) => {
        const finishedFlags: Record<string, boolean> = {}
        for (const m of assistantMessages) {
          finishedFlags[m.id] = false
          openStream(round.id, m.agentId!, {
            onChunk: (chunk) => appendChunk(m.id, chunk),
            onDone: () => {
              markDone(m.id)
              finishedFlags[m.id] = true
              if (Object.values(finishedFlags).every(Boolean)) resolve()
            },
            onError: (err) => {
              markError(m.id, err)
              finishedFlags[m.id] = true
              if (Object.values(finishedFlags).every(Boolean)) resolve()
            },
          })
        }
      })

      let fresh = await getSession(sessionId)
      for (let i = 0; i < 50 && fresh.rounds.find(r => r.id === round.id)?.status !== 'finalized'; i++) {
        await new Promise((r) => setTimeout(r, 100))
        fresh = await getSession(sessionId)
      }
      setSnapshot(fresh)
      for (const m of assistantMessages) clearStreaming(m.id)
    }

    try {
      if (mode === 'consensus') {
        // Server-side consensus run with auto-loop. The server emits
        // `round-started` per round; we hook each round into the same
        // streaming pipeline used by Free / Brainstorm so
        // the user sees bubbles fill in live.
        resetConsensusProgress()
        setConsensusRun(null)

        const allStreamingIds: string[] = []
        await runConsensusStream(
          { sessionId, question: text, maxRounds: consensusMaxRounds },
          {
            onProgress: (msg) => pushConsensusProgress(msg),
            onRoundStarted: ({ round, userMessage, assistantMessages }) => {
              appendMessages([round], [userMessage, ...assistantMessages])
              for (const m of assistantMessages) {
                if (!m.agentId) continue
                allStreamingIds.push(m.id)
                openStream(round.id, m.agentId, {
                  onChunk: (chunk) => appendChunk(m.id, chunk),
                  onDone: () => markDone(m.id),
                  onError: (err) => markError(m.id, err),
                })
              }
            },
            onComplete: async (result) => {
              setConsensusRun(result)
              const fresh = await getSession(sessionId)
              setSnapshot(fresh)
              for (const id of allStreamingIds) clearStreaming(id)
            },
            onError: (err) => {
              pushConsensusProgress(`ERROR: ${err}`)
            },
          },
        )
        // Final refresh — covers the case where onComplete didn't fire
        // (e.g., transport error mid-stream after some rounds completed).
        try {
          const fresh = await getSession(sessionId)
          setSnapshot(fresh)
          for (const id of allStreamingIds) clearStreaming(id)
        } catch {}
      } else {
        // free / brainstorm — single-round, user-paced.
        await runOneRound(text)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setBusy(false)
      // Refresh sidebar so the new round count + title + recency is reflected.
      setSidebarRefresh((n) => n + 1)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <header className="border-b border-parchment-300 px-5 py-3 flex items-center gap-4 bg-parchment-50/80 backdrop-blur-sm">
        <div className="flex items-baseline">
          <span className="font-sans text-[22px] font-semibold tracking-tight text-parchment-900">AI Chatroom</span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <SessionsSidebar
            activeSessionId={session?.id ?? null}
            onSwitch={switchToSession}
            onNewChat={() => handleNewChat()}
            refreshKey={sidebarRefresh}
          />
          <ModeSelector />
          <ModelPicker onApply={handleApplyModels} />
          <ImportButton />
          <button
            onClick={handleSave}
            disabled={rounds.length === 0}
            title="Export JSON"
            className="px-3 py-1.5 rounded-md border border-parchment-300 bg-white font-sans text-[12px] text-parchment-700 font-medium hover:border-parchment-400 hover:bg-parchment-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            Export
          </button>
        </div>
      </header>
      <Timeline />
      {consensusRun && <FinalSynthesis run={consensusRun} />}
      <SummaryPanel />
      <Composer disabled={busy} onSend={handleSend} />
      {busy && mode === 'consensus' && (
        <ConsensusProgress messages={consensusProgress} />
      )}
      <PromptInspector />
    </div>
  )
}
