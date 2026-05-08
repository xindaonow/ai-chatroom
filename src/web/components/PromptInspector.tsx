import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { getMessagePrompt, type PromptInspection } from '../api'
import type { DiscussionMode } from '@shared/index'

const MODES: DiscussionMode[] = ['free', 'brainstorm', 'consensus']

export function PromptInspector() {
  const target = useStore((s) => s.promptInspectorFor)
  const close = useStore((s) => s.openPromptInspector)
  const currentMode = useStore((s) => s.mode)
  const [mode, setMode] = useState<DiscussionMode>(currentMode)
  const [data, setData] = useState<PromptInspection | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset to current mode whenever a new target opens.
  useEffect(() => {
    if (target) setMode(currentMode)
  }, [target, currentMode])

  useEffect(() => {
    if (!target) {
      setData(null)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    getMessagePrompt(target, mode)
      .then((r) => setData(r))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [target, mode])

  if (!target) return null

  const totalChars = data?.messages.reduce((sum, m) => sum + m.content.length, 0) ?? 0

  return (
    <div
      className="fixed inset-0 bg-black/50 z-40 flex justify-end"
      onClick={() => close(null)}
    >
      <div
        className="w-[640px] max-w-[95vw] h-full bg-parchment-50 border-l border-parchment-300 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-parchment-300 flex items-start justify-between flex-shrink-0">
          <div>
            <div className="font-sans text-[16px] font-medium text-parchment-900">
              Prompt Inspector
            </div>
            <div className="font-sans text-[11px] text-parchment-500 mt-0.5">
              Last request to the LLM + the response
            </div>
            {data && (
              <div className="font-sans text-[11px] text-parchment-500 mt-1.5 tabular-nums">
                <span className="font-medium text-parchment-700">{data.agent.label}</span>
                <span className="text-parchment-400"> · </span>
                <span className="font-mono text-[10px]">{data.agent.model}</span>
                <span className="text-parchment-400"> · </span>
                Round {data.round.index + 1}
                <span className="text-parchment-400"> · </span>
                {data.messages.length} turns
                <span className="text-parchment-400"> · </span>
                {totalChars.toLocaleString()} chars
              </div>
            )}
          </div>
          <button
            className="mt-0.5 w-7 h-7 flex items-center justify-center rounded-md font-sans text-[14px] text-parchment-400 hover:text-parchment-900 hover:bg-parchment-200 transition-colors"
            onClick={() => close(null)}
          >
            ✕
          </button>
        </div>

        {/* Mode selector — only matters for the reconstruction fallback path
            (messages generated before the prompt column was added). When the
            persisted snapshot is present the server returns it verbatim and
            this selector has no effect. */}
        <div className="px-5 py-2.5 border-b border-parchment-200 flex items-center gap-2 flex-shrink-0">
          <span className="font-sans text-[10px] font-semibold uppercase tracking-widest text-parchment-400">
            Mode
          </span>
          <div className="flex gap-1">
            {MODES.map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={[
                  'px-2.5 py-1 rounded-md font-sans text-[11px] capitalize transition-colors',
                  mode === m
                    ? 'bg-ink text-white'
                    : 'bg-parchment-100 text-parchment-600 hover:bg-parchment-200',
                ].join(' ')}
              >
                {m}
              </button>
            ))}
          </div>
          <span
            className="ml-auto font-sans text-[10px] text-parchment-400"
            title="Only used when reconstructing — when a persisted snapshot exists, this selector has no effect"
          >
            (fallback only)
          </span>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {loading && (
            <div className="font-sans text-[13px] text-parchment-400 py-6 text-center">
              Loading…
            </div>
          )}
          {error && (
            <div className="font-sans text-[13px] text-red-600 py-3">{error}</div>
          )}
          {data && (
            <>
              <JsonSection
                heading="Request"
                subtitle={`${data.messages.length} turns sent to the LLM`}
                messages={data.messages}
              />
              <JsonSection
                heading="Response"
                subtitle={
                  data.responseStatus === 'streaming'
                    ? 'streaming…'
                    : data.responseStatus === 'error'
                      ? 'error'
                      : 'returned by the LLM'
                }
                messages={[{ role: 'assistant', content: data.responseContent }]}
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Renders a JSON-shaped message array, but the `content` value of each entry
 * is rendered with the same typography MessageBubble uses for AI responses
 * (sans-serif 16px, whitespace-pre-wrap) so multi-line content is readable.
 * The outer skeleton — brackets, `"role"` keys, role-string values — stays
 * in mono so it still reads like JSON.
 *
 * Copy-to-clipboard is best-effort: it copies a strict-JSON-stringified
 * version of the array (with `\n` properly escaped) so the result is valid
 * to paste into a JSON parser.
 */
function JsonSection({
  heading,
  subtitle,
  messages,
}: {
  heading: string
  subtitle: string
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
}) {
  const [copied, setCopied] = useState(false)

  function copy() {
    if (messages.length === 0) return
    navigator.clipboard.writeText(JSON.stringify(messages, null, 2)).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    })
  }

  return (
    <section>
      <div className="flex items-baseline justify-between mb-2">
        <div>
          <span className="font-sans text-[12px] font-semibold uppercase tracking-widest text-parchment-700">
            {heading}
          </span>
          <span className="font-sans text-[11px] text-parchment-500 ml-2">{subtitle}</span>
        </div>
        <button
          onClick={copy}
          disabled={messages.length === 0}
          className="px-1.5 py-0.5 rounded font-sans text-[10px] text-parchment-500 hover:text-parchment-900 hover:bg-white transition-colors disabled:opacity-30"
          title="Copy as strict JSON"
        >
          {copied ? 'copied' : 'copy'}
        </button>
      </div>

      <div className="bg-white border border-parchment-200 rounded-lg p-3 space-y-1">
        <div className="font-mono text-[12px] text-parchment-500">[</div>
        {messages.map((m, i) => (
          <div key={i} className="pl-4">
            <div className="font-mono text-[12px] text-parchment-500">{'{'}</div>
            <div className="pl-4 space-y-1">
              <div className="font-mono text-[12px] text-parchment-700">
                <span className="text-parchment-500">"role": </span>
                <span className="text-amber-700 font-semibold">
                  {JSON.stringify(m.role)}
                </span>
                <span className="text-parchment-500">,</span>
              </div>
              <div className="font-mono text-[12px] text-parchment-500">"content":</div>
              <div className="font-sans text-[12px] leading-relaxed text-parchment-900 whitespace-pre-wrap bg-parchment-50 rounded-md border border-parchment-200 px-3 py-2">
                {m.content || <span className="text-parchment-400 italic">(empty)</span>}
              </div>
            </div>
            <div className="font-mono text-[12px] text-parchment-500">
              {'}'}{i < messages.length - 1 ? ',' : ''}
            </div>
          </div>
        ))}
        <div className="font-mono text-[12px] text-parchment-500">]</div>
      </div>
    </section>
  )
}
