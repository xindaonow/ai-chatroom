import { useStore } from '../store'

/**
 * Two-pill segmented control for switching AI-response density. Mirrors the
 * style of ModeSelector / Rounds so it sits naturally in the header next to
 * other "view-level" controls.
 *
 * - Normal: generous max-height (480px), Show-more for very long replies.
 *   Best for reading flow when responses are similar length.
 * - Compact: tight max-height (240px), every reply caps to a preview card.
 *   Best for scanning many AIs side-by-side at a glance.
 */
const OPTIONS = [
  {
    value: 'normal' as const,
    label: '≡',
    title: 'Normal view — full responses, Show more for long ones',
  },
  {
    value: 'compact' as const,
    label: '⊞',
    title: 'Compact view — fixed-size preview cards, click to expand',
  },
]

export function ViewModeToggle() {
  const viewMode = useStore((s) => s.viewMode)
  const setViewMode = useStore((s) => s.setViewMode)

  return (
    <div className="flex items-center gap-1.5">
      <span className="font-sans text-[10px] font-semibold text-parchment-400 uppercase tracking-widest">
        View
      </span>
      <div
        role="radiogroup"
        aria-label="AI response view mode"
        className="flex items-center gap-0.5 rounded-lg bg-parchment-200 p-0.5 border border-parchment-300"
      >
        {OPTIONS.map((opt) => {
          const active = viewMode === opt.value
          return (
            <button
              key={opt.value}
              onClick={() => setViewMode(opt.value)}
              role="radio"
              aria-checked={active}
              title={opt.title}
              className={[
                'w-7 h-6 flex items-center justify-center rounded-md font-sans text-[14px] leading-none transition-all',
                active
                  ? 'bg-white text-parchment-900 shadow-sm'
                  : 'text-parchment-500 hover:text-parchment-700',
              ].join(' ')}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
