import { useEffect, useState } from 'react'
import type { ConsensusRunResult } from '@shared/index'

type Props = {
  run: ConsensusRunResult
}

export function FinalSynthesis({ run }: Props) {
  const { finalSynthesis: s, totalRounds, rounds } = run
  const stoppedRound = rounds.find((r) => r.stoppedAfter)

  // Default-expanded — synthesis is the headline result, surface it on
  // load. Reset to expanded whenever a different consensus run loads so
  // session switching doesn't carry stale collapsed state forward.
  const [expanded, setExpanded] = useState(true)
  useEffect(() => {
    setExpanded(true)
  }, [run.sessionId, run.totalRounds])

  return (
    <div className="rounded-2xl bg-white border border-parchment-200/70 overflow-hidden">
      <button
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        className="w-full px-5 py-3 border-b border-parchment-200/70 bg-parchment-50/70 flex items-baseline justify-between gap-3 text-left hover:bg-parchment-100/50 transition-colors"
      >
        <div className="flex-1 min-w-0 flex items-baseline gap-2.5 flex-wrap">
          <span className="font-sans text-[12px] font-semibold uppercase tracking-widest text-ink-600">
            Final Synthesis
          </span>
          <span className="font-sans text-[12px] text-parchment-500">
            {totalRounds} round{totalRounds === 1 ? '' : 's'} completed
          </span>
          {stoppedRound?.stopReason && (
            <span className="font-sans text-[12px] text-parchment-500">
              · stopped: {stoppedRound.stopReason.replace(/_/g, ' ')}
            </span>
          )}
        </div>
        <span
          className="text-parchment-600 font-sans text-[14px] leading-none flex-shrink-0 select-none"
          aria-hidden="true"
        >
          {expanded ? '▾' : '▸'}
        </span>
      </button>

      {expanded && (
        <div className="px-5 py-4">
          {s.rawText ? (
            <div className="font-sans text-[12px] leading-relaxed whitespace-pre-wrap text-parchment-900">
              {s.rawText}
            </div>
          ) : (
            <div className="font-sans text-[12px] italic text-parchment-400">
              —
            </div>
          )}
        </div>
      )}
    </div>
  )
}
