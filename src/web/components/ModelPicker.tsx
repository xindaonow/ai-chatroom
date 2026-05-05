import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'

export function ModelPicker({ onApply }: { onApply: (ids: string[]) => void }) {
  const availableModels = useStore((s) => s.availableModels)
  const presets = useStore((s) => s.presets)
  const selectedModelIds = useStore((s) => s.selectedModelIds)
  const setSelectedModelIds = useStore((s) => s.setSelectedModelIds)

  const [customInput, setCustomInput] = useState('')
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  // Local draft of selections — toggling models in the picker mutates this,
  // not the store. Apply commits to store + fires onApply. Closing without
  // Apply (click-outside / Esc) discards the draft.
  const [draftIds, setDraftIds] = useState<string[]>(selectedModelIds)

  const containerRef = useRef<HTMLDivElement>(null)

  const presetEntries = useMemo(() => Object.entries(presets), [presets])

  // Whenever the picker opens, snapshot current store state into the draft.
  useEffect(() => {
    if (open) {
      setDraftIds(selectedModelIds)
      setSearch('')
      setCustomInput('')
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // Click-outside closes the picker WITHOUT committing the draft.
  useEffect(() => {
    if (!open) return
    function onMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false) // discards draft — store untouched
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

  const visibleModels = useMemo(() => {
    // Strip all separators (spaces, hyphens, slashes, dots, underscores) for
    // both query and target, then subsequence-match — so "deepseek v4 pro",
    // "deepv4pro", and "deepseek-v4-pro" all match `deepseek/deepseek-v4-pro`.
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
    const q = normalize(search)
    const isSubsequence = (needle: string, hay: string): boolean => {
      let i = 0
      for (let j = 0; j < hay.length && i < needle.length; j++) {
        if (hay[j] === needle[i]) i++
      }
      return i === needle.length
    }
    const filtered = q
      ? availableModels.filter((m) => isSubsequence(q, normalize(m.model)))
      : availableModels
    // Pin draft-selected models to the top so they're easy to find / unselect.
    const draftSet = new Set(draftIds)
    const selected = filtered.filter((m) => draftSet.has(m.model))
    const rest = filtered.filter((m) => !draftSet.has(m.model))
    return [...selected, ...rest]
  }, [availableModels, search, draftIds])

  function toggle(modelId: string) {
    setDraftIds((cur) =>
      cur.includes(modelId) ? cur.filter((id) => id !== modelId) : [...cur, modelId],
    )
  }

  function addCustom() {
    const id = customInput.trim()
    if (!id || draftIds.includes(id)) return
    setDraftIds((cur) => [...cur, id])
    setCustomInput('')
  }

  function apply() {
    if (draftIds.length < 2) return
    setSelectedModelIds(draftIds)
    onApply(draftIds)
    setOpen(false)
  }

  /**
   * Presets are explicit one-click intents — apply immediately and close,
   * skipping the draft/Apply dance.
   */
  function applyPreset(modelIds: string[]) {
    if (modelIds.length < 2) return
    setSelectedModelIds(modelIds)
    onApply(modelIds)
    setOpen(false)
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-parchment-300 bg-white font-sans text-[12px] text-parchment-600 hover:border-parchment-400 hover:bg-parchment-50 transition-colors"
      >
        <span className="text-parchment-400">Models</span>
        <span className="text-parchment-800 font-medium tabular-nums">
          {selectedModelIds.length > 0
            ? `${selectedModelIds.length} selected`
            : '(default)'}
        </span>
        <span className="text-parchment-400 ml-0.5 text-[10px]">▾</span>
      </button>

      {open && (
        // Position: fixed (not absolute) so the popover is anchored to
        // the viewport directly, decoupled from the trigger button's
        // location and from any ancestor stacking-context quirks. This
        // is what finally gets the Apply button out of the composer's
        // overlap zone — `position: absolute` + various max-h caps were
        // still letting the popover bottom land inside the composer's
        // y-range on 577-px viewports (QA issue 001).
        //
        //   top-14:    56px from viewport top, clears the header
        //   max-h-[calc(100vh-200px)]: bottom never enters composer
        //   right-4:   16px from viewport right, near the trigger
        //   z-[60]:    above the composer's backdrop-filter stacking
        //              context
        <div className="fixed right-4 top-14 z-[60] w-96 max-w-[calc(100vw-2rem)] max-h-[calc(100vh-200px)] rounded-xl border border-parchment-200 bg-white shadow-lg shadow-parchment-900/10 flex flex-col">
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 min-h-0">
          {presetEntries.length > 0 && (
            <div>
              <div className="font-sans text-[10px] font-semibold text-parchment-400 uppercase tracking-widest mb-2">
                Presets
              </div>
              <div className="flex flex-wrap gap-1.5">
                {presetEntries.map(([name, specs]) => {
                  const ids = specs.map((s) => s.model)
                  // Compare against the COMMITTED selection (store), not the
                  // draft — preset highlight reflects "what's actually active".
                  const isActive =
                    ids.length === selectedModelIds.length &&
                    ids.every((id) => selectedModelIds.includes(id))
                  return (
                    <button
                      key={name}
                      onClick={() => applyPreset(ids)}
                      title={specs.map((s) => s.label).join(' · ')}
                      className={[
                        'px-3 py-1.5 rounded-lg font-sans text-[12px] font-medium transition-colors capitalize',
                        isActive
                          ? 'bg-ink text-white'
                          : 'bg-parchment-100 text-parchment-700 hover:bg-parchment-200 border border-parchment-200',
                      ].join(' ')}
                    >
                      {name}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          <div>
            <div className="flex items-baseline justify-between mb-2">
              <span className="font-sans text-[10px] font-semibold text-parchment-400 uppercase tracking-widest">
                Models
              </span>
              <span className="font-sans text-[10px] text-parchment-400">
                {visibleModels.length}/{availableModels.length}
              </span>
            </div>
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  if (search) setSearch('')
                  else setOpen(false) // also discards draft
                }
              }}
              placeholder="Search model id (e.g. deepseek/v4)…"
              className="w-full bg-parchment-50 border border-parchment-300 rounded-lg px-2.5 py-1.5 mb-2 font-sans text-[12px] text-parchment-800 placeholder-parchment-400 focus:outline-none focus:border-parchment-400"
            />
            <div className="flex flex-col gap-1 max-h-72 overflow-y-auto">
              {visibleModels.length === 0 && (
                <div className="font-sans text-[12px] text-parchment-400 py-3 text-center">
                  No matches
                </div>
              )}
              {visibleModels.map((m) => {
                const active = draftIds.includes(m.model)
                return (
                  <button
                    key={m.model}
                    onClick={() => toggle(m.model)}
                    className={[
                      'text-left px-3 py-1.5 rounded-md font-mono text-[11px] leading-tight transition-colors break-all',
                      active
                        ? 'bg-ink-50 text-ink-600 border border-ink-200 font-medium'
                        : 'bg-parchment-100 text-parchment-700 border border-transparent hover:bg-parchment-200',
                    ].join(' ')}
                    title={m.model}
                  >
                    {m.model}
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <div className="font-sans text-[10px] font-semibold text-parchment-400 uppercase tracking-widest mb-2">Custom OpenRouter ID</div>
            <div className="flex gap-1.5">
              <input
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addCustom()}
                placeholder="e.g. mistral/mistral-large"
                className="flex-1 bg-parchment-50 border border-parchment-300 rounded-lg px-2.5 py-1.5 font-sans text-[12px] text-parchment-800 placeholder-parchment-400 focus:outline-none focus:border-parchment-400"
              />
              <button
                onClick={addCustom}
                className="px-3 py-1.5 rounded-lg bg-parchment-200 font-sans text-[12px] text-parchment-700 hover:bg-parchment-300 transition-colors"
              >
                Add
              </button>
            </div>
          </div>

          {draftIds.length > 0 && (
            <div>
              <div className="font-sans text-[10px] font-semibold text-parchment-400 uppercase tracking-widest mb-2">
                Selected ({draftIds.length})
              </div>
              <div className="flex flex-wrap gap-1.5">
                {draftIds.map((id) => (
                  <span
                    key={id}
                    className="flex items-center gap-1 bg-parchment-100 border border-parchment-200 rounded-md px-2 py-0.5 font-mono text-[11px] text-parchment-700 break-all"
                  >
                    <span title={id}>{id}</span>
                    <button
                      onClick={() => toggle(id)}
                      className="text-parchment-400 hover:text-parchment-900 leading-none ml-0.5 flex-shrink-0"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}
          </div>

          {/* Sticky footer — always on-screen so Apply is reachable. */}
          <div className="border-t border-parchment-200 p-3 flex-shrink-0">
            <button
              onClick={apply}
              disabled={draftIds.length < 2}
              className={[
                'w-full py-2 rounded-lg font-sans text-[13px] font-medium transition-colors',
                draftIds.length >= 2
                  ? 'bg-ink text-white hover:bg-ink-700'
                  : 'bg-parchment-100 text-parchment-400 cursor-not-allowed',
              ].join(' ')}
            >
              {draftIds.length < 2
                ? 'Select at least 2 models'
                : `Apply (${draftIds.length} models) — new session`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
