import { useEffect, useRef, useState } from 'react'
import type { ConsensusRunResult } from '@shared/index'

type Props = {
  run: ConsensusRunResult
}

export function FinalSynthesis({ run }: Props) {
  const { finalSynthesis: s, totalRounds, rounds } = run
  const stoppedRound = rounds.find((r) => r.stoppedAfter)

  // Default-expanded — synthesis is the headline result, surface it on load.
  // Reset to expanded whenever a different consensus run loads.
  const [expanded, setExpanded] = useState(true)
  useEffect(() => {
    setExpanded(true)
  }, [run.sessionId, run.totalRounds])

  // Body height in px. Resized via the top edge drag handle. Bottom of the
  // panel is anchored to the Composer area (flex column layout) so growing
  // takes space from the Timeline above.
  const [bodyHeight, setBodyHeight] = useState(() =>
    Math.round((typeof window !== 'undefined' ? window.innerHeight : 800) * 0.4),
  )

  const dragRef = useRef<{
    startY: number
    startHeight: number
    direction: 'top' | 'bottom'
  } | null>(null)

  useEffect(() => {
    function onMove(e: MouseEvent) {
      const ds = dragRef.current
      if (!ds) return
      e.preventDefault()
      // Top-edge drag: cursor up = grow (top moves up, bottom anchored).
      // Bottom-edge drag: cursor down = grow (height adds; top moves up since
      // bottom is layout-anchored, but the gesture still feels natural).
      const delta =
        ds.direction === 'top' ? ds.startY - e.clientY : e.clientY - ds.startY
      const min = 144
      const max = Math.round(window.innerHeight * 0.85)
      setBodyHeight(Math.max(min, Math.min(max, ds.startHeight + delta)))
    }
    function onUp() {
      if (!dragRef.current) return
      dragRef.current = null
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [])

  function startDrag(direction: 'top' | 'bottom') {
    return (e: React.MouseEvent) => {
      e.preventDefault()
      dragRef.current = {
        startY: e.clientY,
        startHeight: bodyHeight,
        direction,
      }
      document.body.style.userSelect = 'none'
      document.body.style.cursor = 'ns-resize'
    }
  }

  return (
    <div className="border-t border-parchment-300 bg-parchment-100/50 px-5 py-3 flex-shrink-0">
      <div className="max-w-5xl mx-auto">
        <div className="rounded-xl bg-white border border-parchment-200 shadow-sm overflow-hidden">
          {/* Top edge drag handle — drawer-style pill, centered. The outer
              div is the click target (full width, generous hit area); the
              inner div is the visible pill. */}
          {expanded && (
            <div
              onMouseDown={startDrag('top')}
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize final synthesis (top edge)"
              title="Drag to resize"
              className="h-2.5 cursor-ns-resize flex items-center justify-center group"
            >
              <div className="w-10 h-1 rounded-full bg-parchment-300 group-hover:bg-parchment-500 transition-colors" />
            </div>
          )}

          <button
            onClick={() => setExpanded((e) => !e)}
            aria-expanded={expanded}
            className="w-full px-5 py-3 border-b border-parchment-200 bg-parchment-50/60 flex items-baseline justify-between gap-3 text-left hover:bg-parchment-100/50 transition-colors"
          >
            <div className="flex-1 min-w-0 flex items-baseline gap-2.5 flex-wrap">
              <span className="font-sans text-[10px] font-semibold uppercase tracking-widest text-ink-600">
                Final Synthesis
              </span>
              <span className="font-sans text-[12px] text-parchment-500">
                {totalRounds} round{totalRounds === 1 ? '' : 's'} completed
              </span>
              {stoppedRound?.stopReason && (
                <span className="font-sans text-[11px] text-parchment-500">
                  · stopped: {stoppedRound.stopReason.replace(/_/g, ' ')}
                </span>
              )}
            </div>
            <span
              className="text-parchment-600 font-sans text-[22px] leading-none flex-shrink-0 select-none"
              aria-hidden="true"
            >
              {expanded ? '▾' : '▸'}
            </span>
          </button>

          {expanded && (
            <>
              <div
                className="px-5 py-4 overflow-auto"
                style={{ height: bodyHeight }}
              >
                {s.rawText ? (
                  <div className="font-sans text-[14px] leading-relaxed whitespace-pre-wrap text-parchment-900">
                    {s.rawText}
                  </div>
                ) : (
                  <div className="font-sans text-[14px] italic text-parchment-400">
                    —
                  </div>
                )}
              </div>

              {/* Bottom edge drag handle — drawer-style pill, symmetric to
                  the top one. Same height/click target, same visual pill. */}
              <div
                onMouseDown={startDrag('bottom')}
                role="separator"
                aria-orientation="horizontal"
                aria-label="Resize final synthesis (bottom edge)"
                title="Drag to resize"
                className="h-2.5 cursor-ns-resize flex items-center justify-center group"
              >
                <div className="w-10 h-1 rounded-full bg-parchment-300 group-hover:bg-parchment-500 transition-colors" />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
