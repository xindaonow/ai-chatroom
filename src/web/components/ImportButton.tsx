import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { importSession } from '../api'

export function ImportButton() {
  const inputRef = useRef<HTMLInputElement>(null)
  const setAgents = useStore((s) => s.setAgents)
  const setSnapshot = useStore((s) => s.setSnapshot)
  const setMode = useStore((s) => s.setMode)
  const setConsensusRun = useStore((s) => s.setConsensusRun)
  const setSelectedModelIds = useStore((s) => s.setSelectedModelIds)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Auto-dismiss any error toast after a few seconds so it doesn't linger.
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
      // Sync the picker's selected model IDs so the header pill + dropdown
      // reflect the imported models, not whatever was selected before.
      setSelectedModelIds(result.agents.map((a) => a.model))
      setSnapshot({
        session: result.session,
        rounds: result.rounds,
        messages: result.messages,
      })
      setMode(result.mode)
      // setSnapshot clears consensusRun on session change; restore after.
      setConsensusRun(result.consensusRun)
    } catch (e) {
      const msg = (e as Error).message
      // Inline toast + console.error so silent failures (the original UX
      // had only a native alert that test harnesses dismissed without
      // notice — QA issue 004) become visible to humans AND scripts.
      console.error('Import failed:', msg)
      setError(msg)
    } finally {
      setBusy(false)
      // Reset so picking the same file twice in a row still triggers onChange.
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="relative">
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
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        title="Import a previously-exported JSON to continue the conversation"
        className="px-3 py-1.5 rounded-md border border-parchment-300 bg-white font-sans text-[12px] text-parchment-700 font-medium hover:border-parchment-400 hover:bg-parchment-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        {busy ? 'Importing…' : 'Import'}
      </button>
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
