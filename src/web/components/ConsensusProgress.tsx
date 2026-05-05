type Props = {
  messages: string[]
}

export function ConsensusProgress({ messages }: Props) {
  const latest = messages[messages.length - 1] ?? 'Starting…'
  const errored = latest.startsWith('ERROR:')

  return (
    <div className="fixed bottom-0 left-0 right-0 z-30 pointer-events-none">
      <div className="max-w-5xl mx-auto px-5 pb-24">
        <div
          className={`pointer-events-auto rounded-xl border shadow-lg backdrop-blur-md px-4 py-3 flex items-start gap-3 ${
            errored
              ? 'bg-red-50/95 border-red-200'
              : 'bg-white/95 border-parchment-200'
          }`}
        >
          <div className="flex-shrink-0 mt-0.5">
            {errored ? (
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500" />
            ) : (
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-sans text-[10px] font-semibold uppercase tracking-widest text-parchment-400 mb-1">
              {errored ? 'Consensus error' : 'Consensus running'}
            </div>
            <div className="font-sans text-[13px] leading-snug text-parchment-800">
              {latest}
            </div>
            {messages.length > 1 && (
              <details className="mt-2 group">
                <summary className="cursor-pointer font-sans text-[11px] text-parchment-500 hover:text-parchment-800 select-none">
                  History · {messages.length} steps
                </summary>
                <div className="mt-2 max-h-40 overflow-y-auto font-sans text-[11px] text-parchment-500 space-y-0.5">
                  {messages.slice(0, -1).map((m, i) => (
                    <div key={i} className="leading-relaxed">{m}</div>
                  ))}
                </div>
              </details>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
