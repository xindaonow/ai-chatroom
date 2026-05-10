import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { agentAccent } from '../theme'
import { getSession, openStream, retryMessage } from '../api'
import type { Message } from '@shared/index'

// Per-bubble height caps. Long responses get clipped with a fade + Show
// more so length disparity across columns doesn't break the multi-AI
// comparison. Compact mode is the optional dense-card view; normal is
// the default editorial-reading height.
const MAX_HEIGHT_NORMAL = 480
const MAX_HEIGHT_COMPACT = 240

type Props = {
  message: Message
  agentIndex?: number
  /** When true, drop the card chrome (rounded corners, white bg, border,
   *  shadow, internal padding) so the bubble blends into a parent round
   *  container. AI bubbles keep their accent stripe + header band so each
   *  column is still identifiable. */
  merged?: boolean
}

export function MessageBubble({ message, agentIndex = 0, merged = false }: Props) {
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
  const viewMode = useStore((s) => s.viewMode)
  const [retrying, setRetrying] = useState(false)

  // Adaptive cap. Defaults collapsed; user clicks Show more to read the
  // full response inline (no modal, no scroll-region change).
  const [expanded, setExpanded] = useState(false)
  const [hasOverflow, setHasOverflow] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const maxHeight = viewMode === 'compact' ? MAX_HEIGHT_COMPACT : MAX_HEIGHT_NORMAL

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

  // Re-measure overflow whenever content changes (streaming chunks +
  // viewMode toggle change the threshold). scrollHeight reflects natural
  // (uncapped) content height, even when we apply max-height + clip.
  useLayoutEffect(() => {
    const el = bodyRef.current
    if (!el) return
    setHasOverflow(el.scrollHeight > maxHeight + 8)
  }, [liveContent, maxHeight])

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
    // Consensus review rounds inject an auto-generated user message in
    // place of real user typing. Detect both the current ("Agents are
    // reviewing each other's answers (pass N)…") and the legacy
    // ("Review round N: see your system prompt…") formats so old
    // sessions also render the friendly text. After the round finalizes
    // we use the past-tense display form.
    function detectAutoReviewPrompt(content: string): number | null {
      const m1 = content.match(
        /^Agents are reviewing each other's answers \(pass (\d+)\)/,
      )
      if (m1) return Number(m1[1])
      const m2 = content.match(/^Review round (\d+): see your system prompt/)
      if (m2) return Number(m2[1])
      return null
    }
    const reviewPassNum = detectAutoReviewPrompt(message.content)
    const isAutoReviewPrompt = reviewPassNum !== null
    const isRoundFinalized = message.status === 'finalized'
    const displayContent = isAutoReviewPrompt
      ? isRoundFinalized
        ? `Agents reviewed each other's answers and generated new responses (pass ${reviewPassNum})`
        : `Agents are reviewing each other's answers and generating new responses (pass ${reviewPassNum})…`
      : message.content
    return (
      <div
        className={[
          // Cap user-input width so long questions don't stretch across
          // a wide viewport — keeps reading line-length sane (600px ≈
          // 60-70 chars at 12px). The AI grid below is unaffected; it
          // still spans the full timeline width.
          'max-w-[600px]',
          merged
            ? ''
            : 'rounded-xl bg-white border border-parchment-200 px-4 py-3 shadow-sm',
        ].join(' ')}
      >
        <div
          className={[
            'font-sans text-[12px] leading-relaxed whitespace-pre-wrap',
            isAutoReviewPrompt
              ? 'italic text-parchment-500'
              : 'text-parchment-900',
          ].join(' ')}
        >
          {displayContent}
        </div>
      </div>
    )
  }

  // ── Assistant message ──────────────────────────────────────────────────────
  return (
    <div
      className={
        merged
          ? ''
          : 'rounded-xl bg-white border border-parchment-200 shadow-sm overflow-hidden'
      }
    >
      {/* Metadata bar.
          - Normal mode: parchment-50 tinted band, edge-to-edge bottom
            border separates it from the white body.
          - Compact mode: same bg as body (white), no edge-to-edge border;
            an inset hairline below this section marks the split between
            metadata and content without breaking the flat single-bg card. */}
      <div
        className={[
          'px-4 pt-2.5 pb-2 flex items-center justify-between',
          viewMode === 'compact'
            ? 'bg-white'
            : 'bg-parchment-50 border-b border-parchment-200/80',
        ].join(' ')}
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

        {/* Status badge. While the response isn't complete (connecting /
            waiting for first token / streaming chunks) we show a 3-dot
            pulsing wave alongside the elapsed-time text. The single
            colored alarm/success dots were removed in favor of the
            unified wave — it reads as "loading" without invoking
            "warning"/"success" semantics that don't fit editorial. */}
        <div className="font-sans text-[11px] tabular-nums flex items-center gap-1.5">
          {(isConnecting || isWaiting || (isStreaming && !isWaiting)) && (
            <span className="flex items-center gap-1" aria-label="Generating response">
              <span className="w-1 h-1 rounded-full bg-parchment-500 animate-pulse" />
              <span
                className="w-1 h-1 rounded-full bg-parchment-500 animate-pulse"
                style={{ animationDelay: '200ms' }}
              />
              <span
                className="w-1 h-1 rounded-full bg-parchment-500 animate-pulse"
                style={{ animationDelay: '400ms' }}
              />
            </span>
          )}
          {isConnecting && (
            <span className="text-parchment-500">connecting…</span>
          )}
          {isWaiting && (
            <span className="text-parchment-500">waiting · {elapsed}s</span>
          )}
          {isStreaming && !isWaiting && (
            <>
              {ttft !== null && (
                <span className="text-parchment-400">ttft {(ttft / 1000).toFixed(1)}s ·</span>
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
          {/* Token usage from the provider (set by the orchestrator after
              the adapter's `usage` event). Display the output token count
              with input/total in the tooltip — that's what the user
              perceives as "how much did this AI write." */}
          {message.outputTokens !== null && message.outputTokens !== undefined && (
            <span
              className="text-parchment-400"
              title={`${message.inputTokens ?? 0} in · ${message.outputTokens} out · ${(message.inputTokens ?? 0) + message.outputTokens} total`}
            >
              · {message.outputTokens.toLocaleString()} tok
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

      {/* Inset hairline (compact mode only) — replaces the edge-to-edge
          border-b on the metadata bar. Doesn't reach the card edges, so
          the white card reads as one continuous surface with a subtle
          internal split. */}
      {viewMode === 'compact' && (
        <div
          aria-hidden="true"
          className="mx-4 border-t border-parchment-200/70"
        />
      )}

      {/* Content. Normal mode: natural height, no cap. Compact mode:
          cap to MAX_HEIGHT_COMPACT with a fade gradient at the bottom and
          the entire body becomes clickable to expand inline. No explicit
          "Show more" button — affordance is the clickable card surface +
          cursor-pointer hint when overflowing. */}
      {(() => {
        const compactCapped =
          viewMode === 'compact' && !expanded && hasOverflow
        return (
          <div
            ref={bodyRef}
            onClick={
              compactCapped ? () => setExpanded(true) : undefined
            }
            className={[
              'px-4 py-3 relative',
              compactCapped ? 'cursor-pointer' : '',
            ].join(' ')}
            style={
              compactCapped
                ? { maxHeight: maxHeight, overflow: 'hidden' }
                : undefined
            }
          >
            {isWaiting ? (
              // Body kept empty while waiting — the 3-dot loading wave in
              // the header already conveys "generating", no need to
              // duplicate the indicator inside the body.
              <div className="h-4" aria-label="Generating response" />
            ) : isError ? (
              <div className="text-[13px] text-red-600 break-all leading-relaxed">
                {stream?.error ?? message.content}
              </div>
            ) : (
              <div className="font-sans text-[12px] leading-relaxed text-parchment-900 whitespace-pre-wrap break-words">
                {liveContent}
                {isStreaming && (
                  <span
                    className="inline-block w-[2px] h-[1.1em] ml-0.5 align-middle cursor-blink"
                    style={{ backgroundColor: accent.stripe }}
                  />
                )}
              </div>
            )}
            {compactCapped && (
              <div
                aria-hidden="true"
                className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-white via-white/85 to-transparent pointer-events-none"
              />
            )}
          </div>
        )
      })()}
    </div>
  )
}
