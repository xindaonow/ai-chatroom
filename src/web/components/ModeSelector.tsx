import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import type { DiscussionMode } from '@shared/index'

const MODES: {
  value: DiscussionMode
  label: string
  short: string
}[] = [
  {
    value: 'free',
    label: 'Free',
    short: 'Free chat — each AI answers naturally',
  },
  {
    value: 'brainstorm',
    label: 'Brainstorm',
    short: 'Divergent: many ideas per round, build on peers.',
  },
  {
    value: 'consensus',
    label: 'Consensus',
    short: 'Structured debate, auto-converging with a final synthesis',
  },
]

// Total rounds for a consensus run. Round 0 is initial answers; rounds > 0
// are review passes. We don't expose 1 (no review = not really consensus).
const ROUND_OPTIONS = [2, 3, 4, 5]

export function ModeSelector() {
  const mode = useStore((s) => s.mode)
  const setMode = useStore((s) => s.setMode)
  const consensusMaxRounds = useStore((s) => s.consensusMaxRounds)
  const setConsensusMaxRounds = useStore((s) => s.setConsensusMaxRounds)
  const [helpOpen, setHelpOpen] = useState(false)
  const helpRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!helpOpen) return
    function onMouseDown(e: MouseEvent) {
      if (helpRef.current && !helpRef.current.contains(e.target as Node)) {
        setHelpOpen(false)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [helpOpen])

  return (
    <div className="flex items-center gap-1.5">
      <span className="font-sans text-[10px] font-semibold text-parchment-400 uppercase tracking-widest">
        Mode
      </span>

      <div ref={helpRef} className="relative">
        <button
          onClick={() => setHelpOpen((o) => !o)}
          aria-label="What are the modes?"
          className={[
            'w-4 h-4 flex items-center justify-center rounded-full font-sans text-[10px] font-semibold transition-colors',
            helpOpen
              ? 'bg-parchment-700 text-white'
              : 'bg-parchment-200 text-parchment-500 hover:bg-parchment-300 hover:text-parchment-700',
          ].join(' ')}
        >
          ?
        </button>
        {helpOpen && (
          <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 z-50 w-96 rounded-xl border border-parchment-200 bg-white shadow-lg shadow-parchment-900/10 p-5 flex flex-col gap-4">
            {MODES.map((m) => (
              <div key={m.value}>
                <div className="font-sans text-[16px] font-semibold text-parchment-900 mb-1">
                  {m.label}
                </div>
                <div className="font-sans text-[16px] leading-relaxed text-parchment-600">
                  {m.short}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div
        role="radiogroup"
        aria-label="Conversation mode"
        className="flex items-center gap-0.5 rounded-lg bg-parchment-200 p-0.5 border border-parchment-300"
      >
        {MODES.map((m) => {
          const active = mode === m.value
          return (
            <button
              key={m.value}
              onClick={() => setMode(m.value)}
              role="radio"
              aria-checked={active}
              title={m.short}
              className={[
                'px-3 py-1 rounded-md font-sans text-[12px] font-medium transition-all',
                active
                  ? 'bg-white text-parchment-900 shadow-sm'
                  : 'text-parchment-500 hover:text-parchment-700',
              ].join(' ')}
            >
              {m.label}
            </button>
          )
        })}
      </div>

      {mode === 'consensus' && (
        <>
          <span className="font-sans text-[10px] font-semibold text-parchment-400 uppercase tracking-widest ml-2">
            Rounds
          </span>
          <div
            role="radiogroup"
            aria-label="Consensus rounds"
            className="flex items-center gap-0.5 rounded-lg bg-parchment-200 p-0.5 border border-parchment-300"
          >
            {ROUND_OPTIONS.map((n) => {
              const active = consensusMaxRounds === n
              return (
                <button
                  key={n}
                  onClick={() => setConsensusMaxRounds(n)}
                  role="radio"
                  aria-checked={active}
                  title={`${n} rounds — initial answers + ${n - 1} review pass${n - 1 === 1 ? '' : 'es'}`}
                  className={[
                    'px-3 py-1 rounded-md font-sans text-[12px] font-medium tabular-nums transition-all',
                    active
                      ? 'bg-white text-parchment-900 shadow-sm'
                      : 'text-parchment-500 hover:text-parchment-700',
                  ].join(' ')}
                >
                  {n}
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
