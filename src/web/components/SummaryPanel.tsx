import { useEffect, useState } from 'react'
import { useStore } from '../store'

export function SummaryPanel() {
  const summary = useStore((s) => s.summary)

  // Default-expanded since the panel now lives at the end of the timeline:
  // it scrolls into view when generated, and there's no need to defend the
  // chat's vertical real estate from a fixed bottom panel anymore.
  const [expanded, setExpanded] = useState(true)
  // Reset expansion whenever the active summary changes (different session
  // or new summary). Keyed off prompt+agentLabel because the store doesn't
  // carry an id.
  const summaryKey = summary ? `${summary.agentLabel}|${summary.prompt}` : ''
  useEffect(() => {
    setExpanded(true)
  }, [summaryKey])

  if (!summary) return null

  const isStreaming = summary.status === 'streaming'
  const isError = summary.status === 'error'

  return (
    <div className="rounded-2xl bg-white border border-parchment-200/70 overflow-hidden">
      <button
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        className="w-full px-5 py-3 border-b border-parchment-200/70 bg-parchment-50/70 flex items-baseline justify-between gap-3 text-left hover:bg-parchment-100/50 transition-colors"
      >
        <div className="flex-1 min-w-0 flex items-baseline gap-2.5 flex-wrap">
          <span className="font-sans text-[12px] font-semibold uppercase tracking-widest text-ink-600">
            Summary · {summary.agentLabel}
          </span>
          <span className="font-sans text-[12px] italic text-parchment-500 break-words">
            "{summary.prompt}"
          </span>
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
            className="text-parchment-600 font-sans text-[14px] leading-none select-none"
            aria-hidden="true"
          >
            {expanded ? '▾' : '▸'}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="px-5 py-4">
          {isError ? (
            <div className="font-sans text-[13px] text-red-600 leading-relaxed break-words">
              {summary.error ?? 'Unknown error'}
            </div>
          ) : (
            <div className="font-sans text-[12px] leading-relaxed text-parchment-900 whitespace-pre-wrap">
              {summary.content}
              {isStreaming && (
                <span
                  className="inline-block w-[2px] h-[1.1em] ml-0.5 align-middle cursor-blink bg-ink"
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
