import { useEffect, useRef, useState } from 'react'
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
      <div className="space-y-8">
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
  // Per-round collapse: when true, hide every AI bubble's BODY in this
  // round but keep the headers visible. Lets the user scan a long chat
  // by round / question without scrolling through every reply. Default
  // expanded; user clicks the divider button to fold an old round.
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div className="rounded-2xl bg-white border border-parchment-200/70 overflow-hidden">
      {/* Round indicator + user question — flat panel, divider below. */}
      <div className="flex items-start gap-3 px-3 py-3 border-b border-parchment-200/70">
        <div className="flex-shrink-0 w-6 h-6 rounded-full bg-parchment-900 flex items-center justify-center mt-0.5">
          <span className="text-[10px] font-semibold text-parchment-100 tabular-nums">
            {round.index + 1}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          {userMsg && <MessageBubble message={userMsg} merged />}
        </div>
      </div>

      {/* Collapse toggle — thin divider row between question and AI grid.
          When collapsed, AI bubble headers stay visible (model name + agent-X
          tag + timing + token count + retry + prompt-inspector); only the
          response bodies hide. */}
      <div className="flex justify-start px-3 py-1 border-b border-parchment-200/70">
        <button
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          aria-label={
            collapsed
              ? `Expand round ${round.index + 1} replies`
              : `Collapse round ${round.index + 1} replies`
          }
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md font-sans text-[14px] font-medium text-parchment-500 hover:text-parchment-900 hover:bg-parchment-100 transition-colors"
        >
          <span aria-hidden="true" className="text-[18px] leading-none">
            {collapsed ? '▸' : '▾'}
          </span>
          <span>{collapsed ? `Expand replies` : 'Collapse replies'}</span>
        </button>
      </div>

      {/* AI columns — flush, no gap. Vertical dividers between columns;
          accent stripe + colored header band per column do the agent
          identification. */}
      <div
        className="grid"
        style={{ gridTemplateColumns: `repeat(${agents.length}, minmax(0, 1fr))` }}
      >
        {agents.map((agent, idx) => {
          const m = messages.find(
            (msg) => msg.role === 'assistant' && msg.agentId === agent.id,
          )
          const accent = agentAccent(idx)
          const isLast = idx === agents.length - 1
          return (
            <div
              key={agent.id}
              className={isLast ? '' : 'border-r border-parchment-200/70'}
            >
              {m ? (
                <MessageBubble
                  message={m}
                  agentIndex={idx}
                  collapsed={collapsed}
                  merged
                />
              ) : (
                // Placeholder while the round hasn't started for this agent.
                <div className="px-4 py-3 text-sm text-parchment-400">
                  <div
                    className="text-[11px] font-semibold uppercase tracking-widest mb-2"
                    style={{ color: accent.stripe + 'aa' }}
                  >
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
