import { useEffect, useState } from 'react'
import type { ConsensusRunResult } from '@shared/index'

type Props = {
  run: ConsensusRunResult
}

export function FinalSynthesis({ run }: Props) {
  const { finalSynthesis: s, totalRounds, rounds } = run
  const stoppedRound = rounds.find((r) => r.stoppedAfter)

  // Default-collapsed on session reopen so the chat keeps its full
  // height (QA issue 007 — same root cause as the Summary panel).
  // Reset to collapsed whenever a different consensus run loads.
  const [expanded, setExpanded] = useState(false)
  useEffect(() => {
    setExpanded(false)
  }, [run.sessionId, run.totalRounds])

  return (
    <div className="border-t border-parchment-300 bg-parchment-100/50 px-5 py-3 flex-shrink-0">
      <div className="max-w-5xl mx-auto">
        <div className="rounded-xl bg-white border border-parchment-200 shadow-sm overflow-hidden">
          <button
            onClick={() => setExpanded((e) => !e)}
            aria-expanded={expanded}
            className="w-full px-5 pt-4 pb-3 border-b border-parchment-200 bg-parchment-50/60 flex items-start justify-between gap-3 text-left hover:bg-parchment-100/50 transition-colors"
          >
            <div className="flex-1 min-w-0">
              <div className="font-sans text-[10px] font-semibold uppercase tracking-widest text-ink-600">
                Final Synthesis
              </div>
              <div className="mt-1 flex items-baseline gap-3 flex-wrap">
                <span className="font-sans text-[15px] text-parchment-900">
                  {totalRounds} round{totalRounds === 1 ? '' : 's'} completed
                </span>
                {stoppedRound?.stopReason && (
                  <span className="font-sans text-[11px] text-parchment-500">
                    stopped: {stoppedRound.stopReason.replace(/_/g, ' ')}
                  </span>
                )}
              </div>
            </div>
            <span
              className="text-parchment-400 font-sans text-[12px] flex-shrink-0 select-none"
              aria-hidden="true"
            >
              {expanded ? '▾' : '▸'}
            </span>
          </button>

          {expanded && (
            <div className="px-5 py-4 space-y-4 max-h-[40vh] overflow-y-auto">
              <Section label="Consensus findings" body={s.consensusFindings} />
              <Section label="Remaining disagreements" body={s.remainingDisagreements} />
              <Section label="Confidence range" body={s.confidenceRange} />
              <Section label="Practical implications" body={s.practicalImplications} accent />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Section({ label, body, accent }: { label: string; body: string; accent?: boolean }) {
  return (
    <div>
      <div className="font-sans text-[10px] font-semibold uppercase tracking-widest text-parchment-500 mb-1">
        {label}
      </div>
      <div
        className={`font-sans text-[14px] leading-relaxed whitespace-pre-wrap ${
          accent ? 'text-ink-700' : 'text-parchment-900'
        }`}
      >
        {body || <span className="italic text-parchment-400">—</span>}
      </div>
    </div>
  )
}
