import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { MessageBubble } from './MessageBubble'
import { FinalSynthesis } from './FinalSynthesis'
import { SummaryPanel } from './SummaryPanel'
import { agentAccent } from '../theme'
import type { Message, Round } from '@shared/index'

type TimelineProps = {
  onSummarize: () => void
  summarizeDisabled: boolean
}

export function Timeline({ onSummarize, summarizeDisabled }: TimelineProps) {
  const rounds = useStore((s) => s.rounds)
  const messages = useStore((s) => s.messages)
  const agents = useStore((s) => s.agents)
  const consensusRun = useStore((s) => s.consensusRun)
  const summary = useStore((s) => s.summary)

  const sorted = [...rounds].sort((a, b) => a.index - b.index)

  // Auto-pin to the bottom whenever the timeline grows: a new round
  // arrives, a consensus synthesis appears, or a user-triggered summary
  // gets generated. We only fire on the null→non-null transition for
  // synthesis/summary, not on each streaming chunk, so streaming output
  // doesn't yank scroll mid-read. Footprint compares in a single ref so
  // we don't over-eagerly fire on session-switch flicker.
  const scrollRef = useRef<HTMLDivElement>(null)
  const lastFootprint = useRef({
    rounds: sorted.length,
    hasSynth: !!consensusRun,
    hasSummary: !!summary,
  })
  useEffect(() => {
    const next = {
      rounds: sorted.length,
      hasSynth: !!consensusRun,
      hasSummary: !!summary,
    }
    const prev = lastFootprint.current
    const grew =
      next.rounds > prev.rounds ||
      (next.hasSynth && !prev.hasSynth) ||
      (next.hasSummary && !prev.hasSummary)
    if (grew && scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: 'smooth',
      })
    }
    lastFootprint.current = next
  }, [sorted.length, consensusRun, summary])

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto px-5 pt-4 pb-32">
      {sorted.length === 0 && (
        <div className="text-center mt-24 select-none">
          <div className="text-[15px] font-medium text-parchment-700">Ask one question, watch multiple AIs answer at once</div>
          <div className="text-[12px] text-parchment-500 mt-1.5">
            After each follow-up, every AI can see the others' answers from the previous round.
          </div>
        </div>
      )}
      {/* Each conversational unit (round / synthesis / summary) is wrapped
          with vertical breathing room. No hairline between siblings — the
          py-1 padding alone provides the visual separation. */}
      <div>
        {sorted.map((round) => (
          <div key={round.id} className="py-1">
            <RoundBlock
              round={round}
              messages={messages.filter((m) => m.roundId === round.id)}
              agents={agents}
            />
          </div>
        ))}
        {/* Both meta-results live INSIDE the scrollable timeline so the
            conversation reads as a single linear narrative: rounds →
            synthesis (consensus mode's auto-generated conclusion) →
            summary (user-triggered post-action). Time-ordered. */}
        {consensusRun && (
          <div className="py-1">
            <FinalSynthesis run={consensusRun} />
          </div>
        )}
        {/* Summarize action — session-level, low-weight. Only rendered
            when there's an actual transcript to summarize. Sits with
            FinalSynthesis / SummaryPanel as the conversation's "session
            artifact" zone, distinct from the per-round content above
            and the next-message Composer below. */}
        {sorted.length > 0 && (
          <div className="py-2 flex justify-center">
            <button
              onClick={onSummarize}
              disabled={summarizeDisabled}
              className="inline-flex items-center gap-1.5 px-3 h-8 rounded-full border border-parchment-300 bg-white font-sans text-[12px] font-medium text-parchment-700 hover:bg-parchment-50 hover:border-parchment-400 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-parchment-400/50 transition-colors duration-150 ease-out"
            >
              {summary ? 'Summarize again' : 'Summarize conversation'}
            </button>
          </div>
        )}
        {summary && (
          <div className="py-1">
            <SummaryPanel />
          </div>
        )}
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
  const viewMode = useStore((s) => s.viewMode)
  const isCompact = viewMode === 'compact'
  // Per-round collapse: when true, the entire AI grid (header + body) is
  // hidden so the round folds down to just the question. The collapse
  // toggle bottom border drops too — without it, the row would look like
  // a stray line floating in empty container space.
  const [collapsed, setCollapsed] = useState(false)
  // Round-level "expand all bubbles" — compact mode caps each AI bubble to
  // a short height with a fade. Clicking any one bubble lifts the cap on
  // every peer so the user can compare full answers side-by-side without
  // having to click each card. Normal mode has no cap, so this flag is a
  // no-op there.
  const [allExpanded, setAllExpanded] = useState(false)

  return (
    <div>
      {/* Collapse toggle on the left + user question.
          The chevron now occupies the left "anchor" slot where the round
          number used to sit — folds the AI grid below; stays visible when
          collapsed so the round is always re-expandable. */}
      <div className="flex items-start">
        <button
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          aria-label={
            collapsed
              ? `Expand round ${round.index + 1} replies`
              : `Collapse round ${round.index + 1} replies`
          }
          title={collapsed ? 'Expand replies' : 'Collapse replies'}
          // 24px button with a 20px SVG icon; `-mt-0.5` nudges the icon
          // up 2px so its visual center aligns with the user-text first
          // line (text-[12px] leading-relaxed → glyph center ≈ y=10
          // while button center sits at y=12 by default).
          className="flex-shrink-0 inline-flex items-center justify-center w-6 h-6 -mt-0.5 rounded text-parchment-500 hover:text-parchment-900 hover:bg-parchment-100 transition-colors"
        >
          {/* Inline chevron-right SVG (Lucide path). Stroke-based + uses
              currentColor so font color rules apply; w-5/h-5 = 20px;
              rotates 0° → 90° on expand for a smooth disclosure. */}
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={[
              'w-4 h-4 transition-transform duration-150 ease-out',
              collapsed ? '' : 'rotate-90',
            ].join(' ')}
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          {userMsg && <MessageBubble message={userMsg} merged />}
        </div>
      </div>

      {/* AI columns. Auto-wrap grid: each cell at least 280px wide; rows
          add as needed.
          - Normal mode: cells flush inside ONE rounded card, hairlines
            between cells via gap-px + bg-parchment-200/70.
          - Compact mode: each cell is its own rounded tile on the page
            bg (no outer wrapper card — would create nested cards). */}
      {!collapsed && (
        <div
          className={[
            'grid',
            isCompact
              ? 'gap-3'
              : 'rounded-2xl bg-parchment-200/70 border border-parchment-200/70 overflow-hidden gap-px',
          ].join(' ')}
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}
        >
          {agents.map((agent, idx) => {
            const m = messages.find(
              (msg) => msg.role === 'assistant' && msg.agentId === agent.id,
            )
            const accent = agentAccent(idx)
            return (
              <div
                key={agent.id}
                className={[
                  'bg-white',
                  isCompact
                    ? 'rounded-xl border border-parchment-200/70 overflow-hidden'
                    : '',
                ].join(' ')}
              >
                {m ? (
                  <MessageBubble
                    message={m}
                    agentIndex={idx}
                    merged
                    expanded={isCompact ? allExpanded : undefined}
                    onExpand={isCompact ? () => setAllExpanded(true) : undefined}
                  />
                ) : (
                  // Placeholder while the round hasn't started for this agent.
                  // Same structure as MessageBubble so columns don't visually
                  // jump when the real bubble appears.
                  <div>
                    <div
                      className={[
                        'px-4 pt-2.5 pb-2',
                        isCompact
                          ? 'bg-white'
                          : 'bg-parchment-50 border-b border-parchment-200/80',
                      ].join(' ')}
                    >
                      <span
                        className="font-sans text-[10px] font-semibold uppercase tracking-widest"
                        style={{ color: accent.stripe, opacity: 0.65 }}
                      >
                        {agent.label}
                      </span>
                    </div>
                    {isCompact && (
                      <div
                        aria-hidden="true"
                        className="mx-4 border-t border-parchment-200/70"
                      />
                    )}
                    <div className="px-4 py-3 text-sm text-parchment-400">…</div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
