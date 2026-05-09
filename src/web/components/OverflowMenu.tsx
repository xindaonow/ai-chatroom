import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { importSession } from '../api'

type Props = {
  onExport: () => void
  exportDisabled: boolean
}

/**
 * Header overflow menu — collapses rare session-level actions (Import / Export)
 * behind a single ⋯ trigger so the always-needed controls (Mode / Models /
 * Sessions) own the visible header chrome. Keeps the import error toast
 * (role="alert", required by QA ISSUE-004).
 */
export function OverflowMenu({ onExport, exportDisabled }: Props) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const setAgents = useStore((s) => s.setAgents)
  const setSnapshot = useStore((s) => s.setSnapshot)
  const setMode = useStore((s) => s.setMode)
  const setConsensusRun = useStore((s) => s.setConsensusRun)
  const setSelectedModelIds = useStore((s) => s.setSelectedModelIds)
  const loadSummary = useStore((s) => s.loadSummary)

  useEffect(() => {
    if (!open) return
    function onMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

  // Auto-dismiss the error toast so it doesn't linger.
  useEffect(() => {
    if (!error) return
    const t = setTimeout(() => setError(null), 6000)
    return () => clearTimeout(t)
  }, [error])

  async function handleFile(file: File) {
    setBusy(true)
    setError(null)
    try {
      const text = await file.text()
      // Cheap upfront sanity check before round-tripping to the server.
      try {
        JSON.parse(text)
      } catch {
        throw new Error('Not valid JSON')
      }
      const result = await importSession(text)
      setAgents(result.agents)
      setSelectedModelIds(result.agents.map((a) => a.model))
      setSnapshot({
        session: result.session,
        rounds: result.rounds,
        messages: result.messages,
      })
      setMode(result.mode)
      setConsensusRun(result.consensusRun)
      loadSummary(result.summary ?? null)
    } catch (e) {
      const msg = (e as Error).message
      console.error('Import failed:', msg)
      setError(msg)
    } finally {
      setBusy(false)
      // Reset so picking the same file twice in a row still triggers onChange.
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) handleFile(f)
        }}
        className="hidden"
      />

      <button
        onClick={() => setOpen((o) => !o)}
        disabled={busy}
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        title="More actions"
        className={[
          'w-8 h-8 flex items-center justify-center rounded-md border font-sans text-[18px] leading-none transition-colors',
          open
            ? 'border-parchment-400 bg-parchment-100 text-parchment-900'
            : 'border-parchment-300 bg-white text-parchment-700 hover:border-parchment-400 hover:bg-parchment-50',
          busy ? 'opacity-30 cursor-not-allowed' : '',
        ].join(' ')}
      >
        ⋯
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1.5 z-50 min-w-[10rem] rounded-md border border-parchment-200 bg-white shadow-lg shadow-parchment-900/10 py-1"
        >
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false)
              inputRef.current?.click()
            }}
            disabled={busy}
            className="w-full px-3 py-1.5 text-left font-sans text-[13px] text-parchment-700 hover:bg-parchment-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy ? 'Importing…' : 'Import'}
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onExport()
            }}
            disabled={exportDisabled}
            className="w-full px-3 py-1.5 text-left font-sans text-[13px] text-parchment-700 hover:bg-parchment-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Export
          </button>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="absolute right-0 top-full mt-1.5 z-50 w-72 rounded-md border border-red-200 bg-red-50 shadow-lg shadow-red-900/10 px-3 py-2 flex items-start gap-2"
        >
          <div className="flex-1 min-w-0">
            <div className="font-sans text-[11px] font-semibold uppercase tracking-widest text-red-700">
              Import failed
            </div>
            <div className="font-sans text-[12px] text-red-800 mt-0.5 break-words">
              {error}
            </div>
          </div>
          <button
            onClick={() => setError(null)}
            className="text-red-400 hover:text-red-700 leading-none flex-shrink-0"
            aria-label="Dismiss error"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}
