import { useState } from 'react'
import { SummarizeButton } from './SummarizeButton'

type Props = {
  disabled: boolean
  onSend: (text: string) => void
}

export function Composer({ disabled, onSend }: Props) {
  const [text, setText] = useState('')

  function send() {
    const t = text.trim()
    if (!t) return
    onSend(t)
    setText('')
  }

  return (
    <div className="border-t border-parchment-300 bg-parchment-50/90 backdrop-blur-sm px-5 py-4">
      <div className="max-w-5xl mx-auto flex gap-3 items-end">
        <textarea
          className="flex-1 h-[88px] bg-white border border-parchment-300 rounded-xl px-4 py-3 font-sans text-[14px] leading-relaxed text-parchment-900 placeholder:text-parchment-400 placeholder:font-sans placeholder:text-[13px] outline-none focus:border-parchment-400 focus:ring-1 focus:ring-parchment-200 resize-none transition-colors disabled:opacity-50"
          placeholder={disabled ? 'Waiting for replies…' : 'Ask a question… ⌘↵ to send'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              send()
            }
          }}
          disabled={disabled}
        />
        <div className="flex flex-col gap-2 flex-shrink-0 w-28">
          <button
            className="w-full px-3 py-2.5 rounded-xl bg-ink text-white font-sans text-[13px] font-medium hover:bg-ink-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            onClick={send}
            disabled={disabled || !text.trim()}
          >
            Send
          </button>
          <SummarizeButton disabled={disabled} />
        </div>
      </div>
    </div>
  )
}
