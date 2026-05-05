import type { Database } from 'bun:sqlite'
import {
  type Message,
  type Round,
  type Session,
  type SessionListItem,
  type Visibility,
  type AgentId,
  type Rendered,
  type Summary,
  type ConsensusRunResult,
  type ConsensusFinalSynthesis,
  type ConsensusRoundRecord,
  MessageSchema,
  RoundSchema,
  SessionSchema,
} from '@shared/index'

type MessageRow = {
  id: string
  session_id: string
  round_id: string
  round_index: number
  role: string
  agent_id: string | null
  content: string
  status: string
  visible_to: string
  rendered: string | null
  prompt: string | null
  created_at: number
  finalized_at: number | null
}

type RoundRow = {
  id: string
  session_id: string
  idx: number
  status: string
  created_at: number
}

type SessionRow = {
  id: string
  agents: string
  title: string | null
  created_at: number
  updated_at: number
}

type SessionListRow = SessionRow & { round_count: number }

type ConsensusRunRow = {
  id: string
  session_id: string
  question: string
  total_rounds: number
  consensus_findings: string
  remaining_disagreements: string
  confidence_range: string
  practical_implications: string
  raw_text: string
  transcript: string
  rounds_json: string
  model_ids: string
  created_at: number
}

type SummaryRow = {
  id: string
  session_id: string
  prompt: string
  agent_label: string
  content: string
  status: string
  error: string | null
  created_at: number
  finalized_at: number | null
}

function rowToMessage(r: MessageRow): Message {
  return MessageSchema.parse({
    id: r.id,
    sessionId: r.session_id,
    roundId: r.round_id,
    roundIndex: r.round_index,
    role: r.role,
    agentId: r.agent_id,
    content: r.content,
    status: r.status,
    visibleTo: JSON.parse(r.visible_to),
    rendered: r.rendered ? JSON.parse(r.rendered) : null,
    prompt: r.prompt ? JSON.parse(r.prompt) : null,
    createdAt: r.created_at,
    finalizedAt: r.finalized_at,
  })
}

function rowToRound(r: RoundRow): Round {
  return RoundSchema.parse({
    id: r.id,
    sessionId: r.session_id,
    index: r.idx,
    status: r.status,
    createdAt: r.created_at,
  })
}

function rowToSession(r: SessionRow): Session {
  return SessionSchema.parse({
    id: r.id,
    agents: JSON.parse(r.agents),
    title: r.title,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  })
}

function rowToSessionListItem(r: SessionListRow): SessionListItem {
  return {
    id: r.id,
    title: r.title,
    agents: JSON.parse(r.agents),
    roundCount: r.round_count,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

function rowToConsensusRun(r: ConsensusRunRow): ConsensusRunResult {
  const finalSynthesis: ConsensusFinalSynthesis = {
    consensusFindings: r.consensus_findings,
    remainingDisagreements: r.remaining_disagreements,
    confidenceRange: r.confidence_range,
    practicalImplications: r.practical_implications,
    rawText: r.raw_text,
  }
  return {
    sessionId: r.session_id,
    question: r.question,
    modelIds: JSON.parse(r.model_ids) as string[],
    rounds: JSON.parse(r.rounds_json) as ConsensusRoundRecord[],
    finalSynthesis,
    totalRounds: r.total_rounds,
    transcript: r.transcript,
  }
}

function rowToSummary(r: SummaryRow): Summary {
  return {
    id: r.id,
    sessionId: r.session_id,
    prompt: r.prompt,
    agentLabel: r.agent_label,
    content: r.content,
    status: r.status as Summary['status'],
    error: r.error,
    createdAt: r.created_at,
    finalizedAt: r.finalized_at,
  }
}

export function createRepo(db: Database) {
  return {
    // ── Sessions ──────────────────────────────────────────────────────────────
    insertSession(s: Session): void {
      db.prepare(
        'INSERT INTO sessions (id, agents, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ).run(
        s.id,
        JSON.stringify(s.agents),
        s.title,
        s.createdAt,
        s.updatedAt,
      )
    },

    getSession(id: string): Session | null {
      const row = db
        .prepare('SELECT * FROM sessions WHERE id = ?')
        .get(id) as SessionRow | null
      return row ? rowToSession(row) : null
    },

    listSessions(): SessionListItem[] {
      const rows = db
        .prepare(
          `SELECT s.*,
                  (SELECT COUNT(*) FROM rounds r WHERE r.session_id = s.id) AS round_count
             FROM sessions s
            ORDER BY s.updated_at DESC, s.created_at DESC`,
        )
        .all() as SessionListRow[]
      return rows.map(rowToSessionListItem)
    },

    /** Manual cascade: delete summaries, consensus_runs, messages, rounds, then session. */
    deleteSession(id: string): void {
      const tx = db.transaction(() => {
        db.prepare('DELETE FROM summaries WHERE session_id = ?').run(id)
        db.prepare('DELETE FROM consensus_runs WHERE session_id = ?').run(id)
        db.prepare('DELETE FROM messages WHERE session_id = ?').run(id)
        db.prepare('DELETE FROM rounds WHERE session_id = ?').run(id)
        db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
      })
      tx()
    },

    /** Bump updated_at — call after each new round. */
    touchSession(id: string, ts: number): void {
      db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(ts, id)
    },

    /** Set title only if currently null (don't overwrite later edits). */
    setTitleIfMissing(id: string, title: string): void {
      db.prepare(
        'UPDATE sessions SET title = ? WHERE id = ? AND title IS NULL',
      ).run(title, id)
    },

    /**
     * Server-startup cleanup: any messages/rounds in 'streaming' state are
     * leftovers from a server crash. Mark them finalized so they don't show
     * a phantom streaming UI on reload.
     */
    repairOrphanStreams(now: number): {
      messages: number
      rounds: number
      summaries: number
    } {
      const m = db
        .prepare(
          `UPDATE messages
              SET status = 'finalized', finalized_at = ?
            WHERE status = 'streaming'`,
        )
        .run(now)
      const r = db
        .prepare(
          `UPDATE rounds SET status = 'finalized' WHERE status = 'streaming'`,
        )
        .run()
      const s = db
        .prepare(
          `UPDATE summaries SET status = 'done', finalized_at = ?
            WHERE status = 'streaming'`,
        )
        .run(now)
      return {
        messages: m.changes,
        rounds: r.changes,
        summaries: s.changes,
      }
    },

    // ── Rounds ────────────────────────────────────────────────────────────────
    insertRound(r: Round): void {
      db.prepare(
        'INSERT INTO rounds (id, session_id, idx, status, created_at) VALUES (?, ?, ?, ?, ?)',
      ).run(r.id, r.sessionId, r.index, r.status, r.createdAt)
    },

    updateRoundStatus(id: string, status: 'streaming' | 'finalized'): void {
      db.prepare('UPDATE rounds SET status = ? WHERE id = ?').run(status, id)
    },

    getRound(id: string): Round | null {
      const row = db
        .prepare('SELECT * FROM rounds WHERE id = ?')
        .get(id) as RoundRow | null
      return row ? rowToRound(row) : null
    },

    listRounds(sessionId: string): Round[] {
      const rows = db
        .prepare('SELECT * FROM rounds WHERE session_id = ? ORDER BY idx ASC')
        .all(sessionId) as RoundRow[]
      return rows.map(rowToRound)
    },

    nextRoundIndex(sessionId: string): number {
      const row = db
        .prepare(
          'SELECT MAX(idx) as max_idx FROM rounds WHERE session_id = ?',
        )
        .get(sessionId) as { max_idx: number | null }
      return (row?.max_idx ?? -1) + 1
    },

    // ── Messages ──────────────────────────────────────────────────────────────
    insertMessage(m: Message): void {
      db.prepare(
        `INSERT INTO messages
          (id, session_id, round_id, round_index, role, agent_id, content, status, visible_to, rendered, prompt, created_at, finalized_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        m.id,
        m.sessionId,
        m.roundId,
        m.roundIndex,
        m.role,
        m.agentId,
        m.content,
        m.status,
        JSON.stringify(m.visibleTo),
        m.rendered ? JSON.stringify(m.rendered) : null,
        m.prompt ? JSON.stringify(m.prompt) : null,
        m.createdAt,
        m.finalizedAt,
      )
    },

    /**
     * Snapshot the [{role, content}, …] payload that the orchestrator just
     * sent to this assistant message's adapter. Stored as JSON so it survives
     * future codebase changes; future replays can read this verbatim instead
     * of recomputing. Called from `startAgentStream` for both initial gen and
     * retries (overwrites cleanly).
     */
    setMessagePrompt(id: string, promptJson: string): void {
      db.prepare('UPDATE messages SET prompt = ? WHERE id = ?').run(promptJson, id)
    },

    appendMessageContent(id: string, delta: string): void {
      db.prepare('UPDATE messages SET content = content || ? WHERE id = ?').run(
        delta,
        id,
      )
    },

    setMessageContent(id: string, content: string): void {
      db.prepare('UPDATE messages SET content = ? WHERE id = ?').run(
        content,
        id,
      )
    },

    finalizeMessage(
      id: string,
      args: {
        visibleTo: Visibility
        rendered: Rendered
        finalizedAt: number
      },
    ): void {
      db.prepare(
        `UPDATE messages
         SET status = 'finalized',
             visible_to = ?,
             rendered = ?,
             finalized_at = ?
         WHERE id = ?`,
      ).run(
        JSON.stringify(args.visibleTo),
        JSON.stringify(args.rendered),
        args.finalizedAt,
        id,
      )
    },

    setMessageError(id: string, errMsg: string, finalizedAt: number): void {
      db.prepare(
        `UPDATE messages SET status = 'error', content = ?, finalized_at = ? WHERE id = ?`,
      ).run(errMsg, finalizedAt, id)
    },

    /**
     * Reset an assistant message to its pre-stream state so it can be re-run.
     * Used by the manual-retry feature.
     */
    resetMessage(id: string, args: { visibleTo: Visibility }): void {
      db.prepare(
        `UPDATE messages
         SET content = '',
             status = 'streaming',
             visible_to = ?,
             rendered = NULL,
             prompt = NULL,
             finalized_at = NULL
         WHERE id = ?`,
      ).run(JSON.stringify(args.visibleTo), id)
    },

    setVisibility(id: string, visibleTo: Visibility): void {
      db.prepare('UPDATE messages SET visible_to = ? WHERE id = ?').run(
        JSON.stringify(visibleTo),
        id,
      )
    },

    getMessage(id: string): Message | null {
      const row = db
        .prepare('SELECT * FROM messages WHERE id = ?')
        .get(id) as MessageRow | null
      return row ? rowToMessage(row) : null
    },

    listMessages(sessionId: string): Message[] {
      // Order: by round, then role-priority (system → user → assistant) so
      // intra-round ordering is deterministic even when timestamps collide.
      const rows = db
        .prepare(
          `SELECT * FROM messages WHERE session_id = ?
           ORDER BY round_index ASC,
                    CASE role WHEN 'system' THEN 0 WHEN 'user' THEN 1 ELSE 2 END ASC,
                    created_at ASC,
                    id ASC`,
        )
        .all(sessionId) as MessageRow[]
      return rows.map(rowToMessage)
    },

    listMessagesByRound(roundId: string): Message[] {
      const rows = db
        .prepare(
          `SELECT * FROM messages WHERE round_id = ?
           ORDER BY CASE role WHEN 'system' THEN 0 WHEN 'user' THEN 1 ELSE 2 END ASC,
                    created_at ASC,
                    id ASC`,
        )
        .all(roundId) as MessageRow[]
      return rows.map(rowToMessage)
    },

    /**
     * Visibility-driven query: messages visible to `agentId`, optionally up to a round index.
     */
    listVisibleMessages(
      sessionId: string,
      agentId: AgentId,
      opts?: { upToRoundIndex?: number },
    ): Message[] {
      const all = this.listMessages(sessionId)
      return all.filter((m) => {
        if (opts?.upToRoundIndex !== undefined && m.roundIndex > opts.upToRoundIndex) {
          return false
        }
        if (m.visibleTo === '*') return true
        return Array.isArray(m.visibleTo) && m.visibleTo.includes(agentId)
      })
    },

    // ── Consensus runs ────────────────────────────────────────────────────────
    insertConsensusRun(args: {
      id: string
      sessionId: string
      result: ConsensusRunResult
      createdAt: number
    }): void {
      const { result } = args
      db.prepare(
        `INSERT INTO consensus_runs
          (id, session_id, question, total_rounds,
           consensus_findings, remaining_disagreements, confidence_range,
           practical_implications, raw_text, transcript,
           rounds_json, model_ids, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        args.id,
        args.sessionId,
        result.question,
        result.totalRounds,
        result.finalSynthesis.consensusFindings,
        result.finalSynthesis.remainingDisagreements,
        result.finalSynthesis.confidenceRange,
        result.finalSynthesis.practicalImplications,
        result.finalSynthesis.rawText,
        result.transcript,
        JSON.stringify(result.rounds),
        JSON.stringify(result.modelIds),
        args.createdAt,
      )
    },

    /** Most recent consensus run for the session, or null. */
    getLatestConsensusRun(sessionId: string): ConsensusRunResult | null {
      const row = db
        .prepare(
          `SELECT * FROM consensus_runs
            WHERE session_id = ?
            ORDER BY created_at DESC LIMIT 1`,
        )
        .get(sessionId) as ConsensusRunRow | null
      return row ? rowToConsensusRun(row) : null
    },

    // ── Summaries ─────────────────────────────────────────────────────────────
    insertSummary(s: Summary): void {
      db.prepare(
        `INSERT INTO summaries
          (id, session_id, prompt, agent_label, content, status, error, created_at, finalized_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        s.id,
        s.sessionId,
        s.prompt,
        s.agentLabel,
        s.content,
        s.status,
        s.error,
        s.createdAt,
        s.finalizedAt,
      )
    },

    appendSummaryContent(id: string, delta: string): void {
      db.prepare(
        'UPDATE summaries SET content = content || ? WHERE id = ?',
      ).run(delta, id)
    },

    finalizeSummary(id: string, finalizedAt: number): void {
      db.prepare(
        `UPDATE summaries SET status = 'done', finalized_at = ? WHERE id = ?`,
      ).run(finalizedAt, id)
    },

    setSummaryError(id: string, error: string, finalizedAt: number): void {
      db.prepare(
        `UPDATE summaries SET status = 'error', error = ?, finalized_at = ? WHERE id = ?`,
      ).run(error, finalizedAt, id)
    },

    /** Most recent summary for the session, or null. */
    getLatestSummary(sessionId: string): Summary | null {
      const row = db
        .prepare(
          `SELECT * FROM summaries
            WHERE session_id = ?
            ORDER BY created_at DESC LIMIT 1`,
        )
        .get(sessionId) as SummaryRow | null
      return row ? rowToSummary(row) : null
    },

    deleteSummary(id: string): void {
      db.prepare('DELETE FROM summaries WHERE id = ?').run(id)
    },
  }
}

export type Repo = ReturnType<typeof createRepo>
