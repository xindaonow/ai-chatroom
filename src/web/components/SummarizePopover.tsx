import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { summarizeSessionStream } from '../api'

const SUGGESTIONS = [
  'Summarize the main points and disagreements',
  "Extract each AI's core position and compare them",
  'List all actionable items',
]

// Backend pins the summarize call to the Host model (src/server/host.ts)
// regardless of which models the user picked for the conversation.
const HOST_LABEL = 'Gemini 3.1 Pro (Host)'

type Props = {
  open: boolean
  onClose: () => void
}

/**
 * Controlled summarize popover. The trigger lives elsewhere — currently a
 * "Summarize conversation" button at the tail of the timeline (rendered by
 * Timeline.tsx as part of the session-artifact zone). This component owns
 * the popover surface and the submission flow. Position is fixed near the
 * bottom-center of the viewport, above the floating composer.
 */
export function SummarizePopover({ open, onClose }: Props) {
  const [prompt, setPrompt] = useState('')
  const session = useStore((s) => s.session)
  const startSummary = useStore((s) => s.startSummary)
  const appendSummaryChunk = useStore((s) => s.appendSummaryChunk)
  const markSummaryDone = useStore((s) => s.markSummaryDone)
  const markSummaryError = useStore((s) => s.markSummaryError)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open, onClose])

  async function submit() {
    if (!session || !prompt.trim()) return
    startSummary(prompt.trim(), HOST_LABEL)
    onClose()
    const submittedPrompt = prompt.trim()
    setPrompt('')
    await summarizeSessionStream(
      session.id,
      { prompt: submittedPrompt },
      {
        onChunk: appendSummaryChunk,
        onDone: markSummaryDone,
        onError: markSummaryError,
      },
    )
  }

  if (!open) return null

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-label="Summarize conversation"
      className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 w-[26rem] max-w-[calc(100vw-2.5rem)] rounded-2xl border border-parchment-200 bg-white shadow-lg shadow-parchment-900/10 p-4 flex flex-col gap-3"
    >
      <div>
        <div className="font-sans text-[10px] font-semibold text-parchment-400 uppercase tracking-widest mb-2">
          Your instruction
        </div>
        <textarea
          autoFocus
          rows={3}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              submit()
            }
            if (e.key === 'Escape') onClose()
          }}
          placeholder="e.g. summarize the key points · extract action items · compare positions"
          className="w-full bg-parchment-50 border border-parchment-300 rounded-lg px-3 py-2 font-sans text-[13px] leading-relaxed text-parchment-900 placeholder:font-sans placeholder:text-[12px] placeholder:text-parchment-400 focus:outline-none focus:border-parchment-400 resize-none"
        />
      </div>

      <div>
        <div className="font-sans text-[10px] font-semibold text-parchment-400 uppercase tracking-widest mb-2">
          Suggested
        </div>
        <div className="flex flex-col gap-1">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => setPrompt(s)}
              className="text-left px-2.5 py-1.5 rounded-md font-sans text-[12px] text-parchment-700 hover:bg-parchment-100 transition-colors"
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between pt-1 border-t border-parchment-100">
        <span className="font-sans text-[11px] text-parchment-500">
          Handled by <span className="font-medium text-parchment-700">{HOST_LABEL}</span>
        </span>
        <button
          onClick={submit}
          disabled={!prompt.trim()}
          className="px-4 py-1.5 rounded-md bg-ink text-white font-sans text-[12px] font-medium hover:bg-ink-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          Summarize · ⌘↵
        </button>
      </div>
    </div>
  )
}
