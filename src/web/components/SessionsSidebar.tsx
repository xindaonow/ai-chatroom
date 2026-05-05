import { useEffect, useRef, useState } from 'react'
import type { SessionListItem } from '@shared/index'
import { deleteSessionApi, listSessions } from '../api'

type Props = {
  /** Currently displayed session id; used to highlight active row. */
  activeSessionId: string | null
  /** Switch to the chosen session (caller handles loading + setSnapshot). */
  onSwitch: (id: string) => void
  /** Caller signals "create a new chat"; sidebar closes. */
  onNewChat: () => void
  /** Bumped externally whenever sessions might have changed (after a round, etc.) */
  refreshKey?: number
}

export function SessionsSidebar({
  activeSessionId,
  onSwitch,
  onNewChat,
  refreshKey,
}: Props) {
  const [open, setOpen] = useState(false)
  const [sessions, setSessions] = useState<SessionListItem[]>([])
  const [loading, setLoading] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  async function reload() {
    setLoading(true)
    try {
      const list = await listSessions()
      setSessions(list)
    } catch (e) {
      console.error('listSessions failed', e)
    } finally {
      setLoading(false)
    }
  }

  // Reload when opened OR when refreshKey bumps (e.g. after a new round).
  useEffect(() => {
    if (open) reload()
  }, [open, refreshKey])

  async function handleDelete(id: string, ev: React.MouseEvent) {
    ev.stopPropagation()
    if (!confirm('Delete this session and all its rounds permanently?')) return
    try {
      await deleteSessionApi(id)
      await reload()
      if (id === activeSessionId) {
        // Active session was deleted → caller should pick a new one.
        const next = sessions.find((s) => s.id !== id)
        if (next) onSwitch(next.id)
        else onNewChat()
      }
    } catch (e) {
      alert(`Delete failed: ${(e as Error).message}`)
    }
  }

  function handleNewChat() {
    onNewChat()
    setOpen(false)
  }

  function handleSwitch(id: string) {
    if (id !== activeSessionId) onSwitch(id)
    setOpen(false)
  }

  const grouped = groupByTime(sessions)

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-parchment-300 bg-white font-sans text-[12px] text-parchment-700 hover:border-parchment-400 hover:bg-parchment-50 transition-colors"
      >
        Sessions
        <span className="text-parchment-400 ml-0.5 text-[10px]">▾</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 w-[22rem] rounded-xl border border-parchment-200 bg-white shadow-lg shadow-parchment-900/10 flex flex-col max-h-[80vh]">
          <div className="px-4 py-3 border-b border-parchment-200 flex items-center justify-between flex-shrink-0">
            <span className="font-sans text-[10px] font-semibold text-parchment-400 uppercase tracking-widest">
              {sessions.length} sessions
            </span>
            <button
              onClick={handleNewChat}
              className="px-3 py-1 rounded-md bg-ink text-white font-sans text-[12px] font-medium hover:bg-ink-700 transition-colors"
            >
              + New chat
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading && sessions.length === 0 && (
              <div className="font-sans text-[12px] text-parchment-400 py-6 text-center">
                Loading…
              </div>
            )}
            {!loading && sessions.length === 0 && (
              <div className="font-sans text-[12px] text-parchment-400 py-6 text-center">
                No conversations yet. Click "+ New chat" to begin.
              </div>
            )}
            {grouped.map(({ label, items }) => (
              <div key={label}>
                <div className="px-4 pt-3 pb-1 font-sans text-[10px] font-semibold text-parchment-400 uppercase tracking-widest">
                  {label}
                </div>
                {items.map((s) => (
                  <SessionRow
                    key={s.id}
                    session={s}
                    active={s.id === activeSessionId}
                    onClick={() => handleSwitch(s.id)}
                    onDelete={(e) => handleDelete(s.id, e)}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function SessionRow({
  session,
  active,
  onClick,
  onDelete,
}: {
  session: SessionListItem
  active: boolean
  onClick: () => void
  onDelete: (e: React.MouseEvent) => void
}) {
  const title =
    session.title?.trim() ||
    `(empty conversation)`
  const agentSummary = session.agents.map((a) => a.label).join(' · ')

  return (
    <div
      onClick={onClick}
      className={[
        'group cursor-pointer px-4 py-2.5 border-b border-parchment-100 transition-colors',
        active ? 'bg-ink-50' : 'hover:bg-parchment-50',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div
            className={[
              'font-sans text-[13px] leading-snug truncate',
              active ? 'text-ink-700 font-medium' : 'text-parchment-900',
            ].join(' ')}
          >
            {title}
          </div>
          <div className="mt-0.5 font-sans text-[10px] text-parchment-400 truncate">
            {session.roundCount} round{session.roundCount === 1 ? '' : 's'} · {agentSummary}
          </div>
        </div>
        <button
          onClick={onDelete}
          className="opacity-0 group-hover:opacity-100 flex-shrink-0 px-1.5 py-0.5 rounded font-sans text-[11px] text-parchment-400 hover:text-red-600 hover:bg-red-50 transition-all"
          title="Delete"
        >
          ✕
        </button>
      </div>
    </div>
  )
}

/** Bucket sessions by relative date for sidebar display. */
function groupByTime(sessions: SessionListItem[]): Array<{
  label: string
  items: SessionListItem[]
}> {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000
  const startOfWeek = startOfToday - 7 * 24 * 60 * 60 * 1000

  const today: SessionListItem[] = []
  const yesterday: SessionListItem[] = []
  const week: SessionListItem[] = []
  const earlier: SessionListItem[] = []
  for (const s of sessions) {
    const t = s.updatedAt
    if (t >= startOfToday) today.push(s)
    else if (t >= startOfYesterday) yesterday.push(s)
    else if (t >= startOfWeek) week.push(s)
    else earlier.push(s)
  }
  const groups: Array<{ label: string; items: SessionListItem[] }> = []
  if (today.length) groups.push({ label: 'Today', items: today })
  if (yesterday.length) groups.push({ label: 'Yesterday', items: yesterday })
  if (week.length) groups.push({ label: 'Earlier this week', items: week })
  if (earlier.length) groups.push({ label: 'Older', items: earlier })
  return groups
}
