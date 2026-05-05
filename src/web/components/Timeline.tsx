import { useEffect, useRef } from 'react'
import { useStore } from '../store'
import { MessageBubble } from './MessageBubble'
import { agentAccent } from '../theme'
import type { Message, Round } from '@shared/index'

export function Timeline() {
  const rounds = useStore((s) => s.rounds)
  const messages = useStore((s) => s.messages)
  const agents = useStore((s) => s.agents)

  const sorted = [...rounds].sort((a, b) => a.index - b.index)

  // Auto-pin to the bottom whenever a new round arrives, so the user's
  // most recent question + the streaming replies are in view. Without
  // this, after a follow-up the chat stays scrolled to round 1 and the
  // new round renders below the fold (QA issue 003).
  const scrollRef = useRef<HTMLDivElement>(null)
  const lastRoundCount = useRef(sorted.length)
  useEffect(() => {
    if (sorted.length > lastRoundCount.current && scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: 'smooth',
      })
    }
    lastRoundCount.current = sorted.length
  }, [sorted.length])

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-8">
      <div className="space-y-10">
        {sorted.length === 0 && (
          <div className="text-center mt-24 select-none">
            <div className="text-[15px] font-medium text-parchment-700">Ask one question, watch multiple AIs answer at once</div>
            <div className="text-[12px] text-parchment-500 mt-1.5">
              After each follow-up, every AI can see the others' answers from the previous round.
            </div>
          </div>
        )}
        {sorted.map((round) => (
          <RoundBlock
            key={round.id}
            round={round}
            messages={messages.filter((m) => m.roundId === round.id)}
            agents={agents}
          />
        ))}
      </div>
    </div>
  )
}

function RoundBlock({
  round,
  messages,
  agents,
}: {
  round: Round
  messages: Message[]
  agents: { id: string; label: string }[]
}) {
  const userMsg = messages.find((m) => m.role === 'user')

  return (
    <div className="space-y-4">
      {/* Round divider */}
      <div className="flex items-center gap-3">
        <div
          className="flex-shrink-0 w-6 h-6 rounded-full bg-parchment-900 flex items-center justify-center"
        >
          <span className="text-[10px] font-semibold text-parchment-100 tabular-nums">
            {round.index + 1}
          </span>
        </div>
        <div className="h-px flex-1 bg-parchment-300" />
      </div>

      {/* User message */}
      {userMsg && (
        <div className="px-1">
          <MessageBubble message={userMsg} />
        </div>
      )}

      {/* Agent columns */}
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: `repeat(${agents.length}, minmax(0, 1fr))` }}
      >
        {agents.map((agent, idx) => {
          const m = messages.find(
            (msg) => msg.role === 'assistant' && msg.agentId === agent.id,
          )
          const accent = agentAccent(idx)
          return (
            <div key={agent.id}>
              {m ? (
                <MessageBubble message={m} agentIndex={idx} />
              ) : (
                // Placeholder card while round hasn't started for this agent
                <div
                  className="rounded-xl bg-white border border-parchment-200 px-4 py-3 text-sm text-parchment-400 shadow-sm"
                  style={{ borderLeft: `3px solid ${accent.stripe}20` }}
                >
                  <div className="text-[11px] font-semibold uppercase tracking-widest mb-2"
                    style={{ color: accent.stripe + 'aa' }}>
                    {agent.label}
                  </div>
                  <div className="text-parchment-400">…</div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
