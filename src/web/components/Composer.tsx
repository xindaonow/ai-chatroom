import { useLayoutEffect, useRef, useState } from 'react'

type Props = {
  disabled: boolean
  onSend: (text: string) => void
}

const MIN_HEIGHT = 44 // ~one line of text + padding
const MAX_HEIGHT = 220 // ~8 lines before internal scroll kicks in

export function Composer({ disabled, onSend }: Props) {
  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-grow the textarea between MIN_HEIGHT and MAX_HEIGHT.
  useLayoutEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    const next = Math.min(Math.max(ta.scrollHeight, MIN_HEIGHT), MAX_HEIGHT)
    ta.style.height = `${next}px`
  }, [text])

  function send() {
    // Guard ⌘↵ during a busy round — user can keep typing the next
    // question, but we hold the send until current AI replies finish.
    if (disabled) return
    const t = text.trim()
    if (!t) return
    onSend(t)
    setText('')
  }

  const canSend = !disabled && !!text.trim()

  return (
    // Float layer: positioned absolute at the bottom of the parent (a
    // relative wrapper around Timeline + Composer), takes no layout space.
    // Outer wrapper is pointer-events-none so timeline scrolling on the
    // left/right zones beside the composer card passes through. The card
    // itself re-enables pointer events.
    <div className="absolute bottom-0 left-0 right-0 px-5 py-3 pointer-events-none z-20">
      <div className="max-w-5xl mx-auto pointer-events-auto">
        <div className="bg-white border border-parchment-300 rounded-2xl shadow-md transition-colors focus-within:border-parchment-400 focus-within:ring-1 focus-within:ring-parchment-200">
          <div className="flex items-end gap-2 p-2.5">
            <textarea
              ref={textareaRef}
              rows={1}
              style={{ minHeight: MIN_HEIGHT, maxHeight: MAX_HEIGHT }}
              className="flex-1 resize-none bg-transparent outline-none px-2 py-2.5 font-sans text-[14px] leading-relaxed text-parchment-900 placeholder:text-parchment-400 placeholder:font-sans placeholder:text-[13px] overflow-y-auto"
              placeholder={
                disabled
                  ? 'Type your next question — sends when current replies finish'
                  : 'Ask a question… ⌘↵ to send'
              }
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault()
                  send()
                }
              }}
            />

            {/* Send — single primary action. Summarize used to live in a
                chevron dropdown next to Send, but it's a transcript-level
                operation (compress / extract / translate the conversation
                so far), not a "next message" — so it now lives at the end
                of the timeline as a session-level action and Send stays
                solo here. */}
            <button
              onClick={send}
              disabled={!canSend}
              title="Send · ⌘↵"
              className="self-end flex-shrink-0 px-4 h-9 rounded-full font-sans text-[13px] font-medium bg-ink text-white hover:bg-ink-700 active:bg-ink-700 disabled:bg-parchment-200 disabled:text-parchment-500 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-ink/40 transition-colors duration-150 ease-out"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
