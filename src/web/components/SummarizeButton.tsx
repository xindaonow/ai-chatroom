import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { summarizeSessionStream } from '../api'

const SUGGESTIONS = [
  'Summarize the main points and disagreements',
  "Extract each AI's core position and compare them",
  'List all actionable items',
]

// Backend pins this to the Host model (src/server/host.ts) regardless of
// which participants the user picked. Displayed verbatim in the popover so
// the user knows whose voice they're getting.
const HOST_LABEL = 'Gemini 3.1 Pro (Host)'

export function SummarizeButton({ disabled = false }: { disabled?: boolean } = {}) {
  const [open, setOpen] = useState(false)
  const [prompt, setPrompt] = useState('')
  const session = useStore((s) => s.session)
  const rounds = useStore((s) => s.rounds)
  const startSummary = useStore((s) => s.startSummary)
  const appendSummaryChunk = useStore((s) => s.appendSummaryChunk)
  const markSummaryDone = useStore((s) => s.markSummaryDone)
  const markSummaryError = useStore((s) => s.markSummaryError)
  const summary = useStore((s) => s.summary)
  const isStreaming = summary?.status === 'streaming'
  const buttonDisabled = disabled || !session || rounds.length === 0 || isStreaming

  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  async function submit() {
    if (!session || !prompt.trim()) return
    startSummary(prompt.trim(), HOST_LABEL)
    setOpen(false)
    setPrompt('')
    await summarizeSessionStream(
      session.id,
      { prompt: prompt.trim() },
      {
        onChunk: appendSummaryChunk,
        onDone: markSummaryDone,
        onError: markSummaryError,
      },
    )
  }

  return (
    <div ref={containerRef} className="relative flex-shrink-0 w-full">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={buttonDisabled}
        title="Run a custom instruction over the entire transcript (summarize, translate, compare, extract…)"
        className="w-full px-3 py-2.5 rounded-xl border border-parchment-300 bg-white font-sans text-[13px] text-parchment-700 font-medium hover:border-parchment-400 hover:bg-parchment-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        Summarize
      </button>

      {open && (
        <div className="absolute right-0 bottom-full mb-1.5 z-50 w-[26rem] rounded-xl border border-parchment-200 bg-white shadow-lg shadow-parchment-900/10 p-4 flex flex-col gap-3">
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
                if (e.key === 'Escape') setOpen(false)
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
      )}
    </div>
  )
}
