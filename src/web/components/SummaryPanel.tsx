import { useEffect, useState } from 'react'
import { useStore } from '../store'

export function SummaryPanel() {
  const summary = useStore((s) => s.summary)
  const clearSummary = useStore((s) => s.clearSummary)

  // Default-collapsed on session reopen so the chat keeps its full
  // height (QA issue 002 — the panel was claiming so much vertical
  // space the chat scroll container was squeezed to ~127 px). Auto-
  // expand while streaming so the user sees output appear; collapse
  // again when a new summary loads (e.g. switching sessions).
  const [expanded, setExpanded] = useState(false)
  const isStreaming = summary?.status === 'streaming'
  useEffect(() => {
    if (isStreaming) setExpanded(true)
  }, [isStreaming])
  // Reset expansion whenever the active summary changes (different
  // session or new summary). Keyed off prompt+agentLabel because the
  // store doesn't carry an id.
  const summaryKey = summary ? `${summary.agentLabel}|${summary.prompt}` : ''
  useEffect(() => {
    setExpanded(false)
  }, [summaryKey])

  if (!summary) return null

  const isError = summary.status === 'error'

  return (
    <div className="border-t border-parchment-300 bg-parchment-100/40 px-5 py-3 flex-shrink-0">
      <div className="max-w-5xl mx-auto">
        <div className="rounded-xl bg-white border border-parchment-200 shadow-sm overflow-hidden">
          <button
            onClick={() => setExpanded((e) => !e)}
            aria-expanded={expanded}
            className="w-full px-5 pt-3.5 pb-3 border-b border-parchment-200 bg-parchment-50/50 flex items-start justify-between gap-3 text-left hover:bg-parchment-100/50 transition-colors"
          >
            <div className="flex-1 min-w-0">
              <div className="font-sans text-[10px] font-semibold uppercase tracking-widest text-ink-600">
                Summary · {summary.agentLabel}
              </div>
              <div className="mt-1 font-sans text-[13px] text-parchment-600 italic break-words">
                "{summary.prompt}"
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {isStreaming && (
                <span className="flex items-center gap-1.5 font-sans text-[11px] text-emerald-700">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  streaming
                </span>
              )}
              {isError && (
                <span className="font-sans text-[11px] text-red-600 font-medium">error</span>
              )}
              <span
                className="text-parchment-400 font-sans text-[12px] select-none"
                aria-hidden="true"
              >
                {expanded ? '▾' : '▸'}
              </span>
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation()
                  clearSummary()
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    e.stopPropagation()
                    clearSummary()
                  }
                }}
                className="w-7 h-7 flex items-center justify-center rounded-md font-sans text-[14px] text-parchment-400 hover:text-parchment-900 hover:bg-parchment-200 transition-colors cursor-pointer"
                title="Dismiss"
                aria-label="Dismiss summary"
              >
                ✕
              </span>
            </div>
          </button>

          {expanded && (
            <div className="px-5 py-4 max-h-[40vh] overflow-y-auto">
              {isError ? (
                <div className="font-sans text-[13px] text-red-600 leading-relaxed break-words">
                  {summary.error ?? 'Unknown error'}
                </div>
              ) : (
                <div className="font-sans text-[14px] leading-relaxed text-parchment-900 whitespace-pre-wrap">
                  {summary.content}
                  {isStreaming && (
                    <span
                      className="inline-block w-[2px] h-[1.1em] ml-0.5 align-middle cursor-blink"
                      style={{ backgroundColor: '#2B4EAB' }}
                    />
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
