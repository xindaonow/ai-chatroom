import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { agentAccent } from '../theme'
import { getSession, openStream, retryMessage } from '../api'
import type { Message } from '@shared/index'

type Props = {
  message: Message
  agentIndex?: number
}

export function MessageBubble({ message, agentIndex = 0 }: Props) {
  const stream = useStore((s) => s.streaming.get(message.id))
  const agentLabel = useStore((s) =>
    message.agentId
      ? (s.agents.find((a) => a.id === message.agentId)?.label ?? message.agentId)
      : null,
  )
  const session = useStore((s) => s.session)
  const setSnapshot = useStore((s) => s.setSnapshot)
  const appendChunk = useStore((s) => s.appendChunk)
  const markDone = useStore((s) => s.markDone)
  const markError = useStore((s) => s.markError)
  const clearStreaming = useStore((s) => s.clearStreaming)
  const openPromptInspector = useStore((s) => s.openPromptInspector)
  const [retrying, setRetrying] = useState(false)

  const isStreaming = stream?.status === 'streaming'
  const isError = stream?.status === 'error' || message.status === 'error'
  const liveContent = stream?.content ?? message.content
  const isConnecting = !stream && !isError && message.status === 'streaming'
  const isWaiting = isStreaming && !liveContent
  const isDone = !isConnecting && !isStreaming && !isError && message.status === 'finalized'

  const [elapsed, setElapsed] = useState(0)
  const ttftRef = useRef<number | null>(null)
  const [ttft, setTtft] = useState<number | null>(null)

  useEffect(() => {
    if (!isStreaming) return
    const start = message.createdAt
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 500)
    return () => clearInterval(id)
  }, [isStreaming, message.createdAt])

  useEffect(() => {
    if (!isWaiting && isStreaming && ttftRef.current === null) {
      ttftRef.current = Date.now()
      setTtft(Date.now() - message.createdAt)
    }
  }, [isWaiting, isStreaming, message.createdAt])

  useEffect(() => {
    if (!isStreaming && ttftRef.current !== null && ttft === null) {
      setTtft(ttftRef.current - message.createdAt)
    }
  }, [isStreaming, message.createdAt, ttft])

  const isUser = message.role === 'user'
  // Only show a duration when the elapsed time is actually positive — for
  // imported sessions or sessions where the export carried matching
  // created_at / finalized_at, the diff can round to a misleading
  // "-0.0s · ttft -0.0s" sentinel (QA issue 005). Treat ≤ 0 as "no
  // timing data available" and hide the row entirely.
  const elapsedMs =
    message.finalizedAt && message.finalizedAt > message.createdAt
      ? message.finalizedAt - message.createdAt
      : null
  const totalTime = elapsedMs !== null ? (elapsedMs / 1000).toFixed(1) : null
  const accent = agentAccent(agentIndex)
  const canRetry = !isUser && !isStreaming && !isConnecting && !retrying

  async function handleRetry() {
    if (!session || !message.agentId || retrying) return
    setRetrying(true)
    clearStreaming(message.id) // drop stale error / done state if any
    try {
      const { round } = await retryMessage(message.id)
      // Pull fresh row (content cleared, status='streaming') so the bubble
      // doesn't flash old content while the new stream warms up.
      const fresh = await getSession(session.id)
      setSnapshot(fresh)
      openStream(round.id, message.agentId, {
        onChunk: (chunk) => appendChunk(message.id, chunk),
        onDone: async () => {
          markDone(message.id)
          try {
            const final = await getSession(session.id)
            setSnapshot(final)
          } catch {}
          clearStreaming(message.id)
          setRetrying(false)
        },
        onError: (err) => {
          markError(message.id, err)
          setRetrying(false)
        },
      })
    } catch (e) {
      console.error('retry failed', e)
      alert(`Retry failed: ${(e as Error).message}`)
      setRetrying(false)
    }
  }

  // ── User message ──────────────────────────────────────────────────────────
  if (isUser) {
    return (
      <div className="rounded-xl bg-white border border-parchment-200 px-4 py-3 shadow-sm">
        <div className="font-sans text-[10px] font-semibold uppercase tracking-widest text-parchment-400 mb-2">
          You
        </div>
        <div className="font-sans text-[14px] leading-relaxed text-parchment-900 whitespace-pre-wrap">
          {message.content}
        </div>
      </div>
    )
  }

  // ── Assistant message ──────────────────────────────────────────────────────
  return (
    <div
      className="rounded-xl bg-white border border-parchment-200 shadow-sm overflow-hidden"
      style={{ borderLeft: `3px solid ${accent.stripe}` }}
    >
      {/* Agent header */}
      <div
        className="px-4 pt-3 pb-2 flex items-center justify-between"
        style={{ backgroundColor: accent.bg }}
      >
        <div className="flex items-center gap-1.5">
          <span
            className="font-sans text-[10px] font-semibold uppercase tracking-widest"
            style={{ color: accent.stripe }}
          >
            {agentLabel}
          </span>
          {/* Public ID tag — same formula as adapters/index.ts so the
              chip in the UI matches the [agent-X] tag the model itself
              sees in its prompt. Useful when debugging "which AI did
              the AI just say is which?". */}
          <span
            className="font-mono text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/60 border border-parchment-200 text-parchment-500"
            title="Public ID — what other AIs see this agent as"
          >
            agent-{String.fromCharCode(65 + agentIndex)}
          </span>
        </div>

        {/* Status badge */}
        <div className="font-sans text-[11px] tabular-nums flex items-center gap-1.5">
          {isConnecting && (
            <span className="text-parchment-400">connecting…</span>
          )}
          {isWaiting && (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
              <span className="text-amber-700 font-medium">waiting</span>
              <span className="text-parchment-500">{elapsed}s</span>
            </>
          )}
          {isStreaming && !isWaiting && (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-emerald-700 font-medium">streaming</span>
              {ttft !== null && (
                <span className="text-parchment-400">· ttft {(ttft / 1000).toFixed(1)}s</span>
              )}
              <span className="text-parchment-500">{elapsed}s</span>
            </>
          )}
          {isDone && totalTime && (
            <span className="text-parchment-400">
              {totalTime}s
              {ttft !== null && ttft > 0 && ` · ttft ${(ttft / 1000).toFixed(1)}s`}
            </span>
          )}
          {isError && (
            <span className="text-red-600 font-medium">error</span>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation()
              openPromptInspector(message.id)
            }}
            title="View the raw prompt sent to this AI"
            className="ml-1 px-1.5 py-0.5 rounded text-parchment-400 hover:text-parchment-900 hover:bg-white/70 transition-colors font-mono text-[10px] leading-none"
            aria-label="view prompt"
          >
            {'</>'}
          </button>
          {canRetry && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleRetry()
              }}
              title="Retry — re-run this AI's response"
              className="ml-1 px-1.5 py-0.5 rounded text-parchment-400 hover:text-parchment-900 hover:bg-white/70 transition-colors text-[12px] leading-none"
              aria-label="retry"
            >
              ↻
            </button>
          )}
        </div>
      </div>

      {/* Content — capped height with internal scroll for long responses. */}
      <div className="px-4 py-3 max-h-[60vh] overflow-y-auto">
        {isWaiting ? (
          <div className="flex items-center gap-2 text-parchment-400 py-0.5 select-none">
            <span className="text-base tracking-widest">⋯</span>
          </div>
        ) : isError ? (
          <div className="text-[13px] text-red-600 break-all leading-relaxed">
            {stream?.error ?? message.content}
          </div>
        ) : (
          <div className="font-sans text-[14px] leading-relaxed text-parchment-900 whitespace-pre-wrap">
            {liveContent}
            {isStreaming && (
              <span className="inline-block w-[2px] h-[1.1em] ml-0.5 align-middle cursor-blink"
                style={{ backgroundColor: accent.stripe }} />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
