import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const DEFAULT_PATH = './data/dev.db'

let db: Database | null = null

export function openDb(path: string = DEFAULT_PATH): Database {
  if (db) return db
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  db = new Database(path, { create: true })
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  migrate(db)
  return db
}

export function resetDbForTests(): Database {
  db = new Database(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  migrate(db)
  return db
}

function migrate(d: Database) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id          TEXT PRIMARY KEY,
      agents      TEXT NOT NULL,           -- JSON: AgentSnapshot[] {id, label, model}
      title       TEXT,                    -- nullable, derived from first user msg
      mode        TEXT NOT NULL DEFAULT 'free',  -- 'free' | 'brainstorm' | 'consensus'
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL         -- last activity (round.created_at)
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);

    CREATE TABLE IF NOT EXISTS rounds (
      id          TEXT PRIMARY KEY,
      session_id  TEXT NOT NULL REFERENCES sessions(id),
      idx         INTEGER NOT NULL,
      status      TEXT NOT NULL,
      created_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rounds_session ON rounds(session_id, idx);

    CREATE TABLE IF NOT EXISTS messages (
      id            TEXT PRIMARY KEY,
      session_id    TEXT NOT NULL REFERENCES sessions(id),
      round_id      TEXT NOT NULL REFERENCES rounds(id),
      round_index   INTEGER NOT NULL,
      role          TEXT NOT NULL,
      agent_id      TEXT,
      content       TEXT NOT NULL,
      status        TEXT NOT NULL,
      visible_to    TEXT NOT NULL,
      rendered      TEXT,
      prompt        TEXT,                    -- JSON snapshot of [{role,content}…] sent to LLM (assistant rows only)
      input_tokens  INTEGER,                 -- prompt token count from provider's usage report
      output_tokens INTEGER,                 -- completion token count from provider's usage report
      created_at    INTEGER NOT NULL,
      finalized_at  INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_messages_round   ON messages(round_id);

    -- Persisted final synthesis from a consensus run. One row per completed run.
    -- raw_text holds the LLM's full synthesis output verbatim; the UI renders it as plain text.
    CREATE TABLE IF NOT EXISTS consensus_runs (
      id            TEXT PRIMARY KEY,
      session_id    TEXT NOT NULL REFERENCES sessions(id),
      question      TEXT NOT NULL,
      total_rounds  INTEGER NOT NULL,
      raw_text      TEXT NOT NULL,
      transcript    TEXT NOT NULL,
      rounds_json   TEXT NOT NULL,    -- JSON ConsensusRoundRecord[]
      model_ids     TEXT NOT NULL,    -- JSON string[]
      created_at    INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_consensus_session ON consensus_runs(session_id, created_at DESC);

    -- Persisted summaries (Summarize button output). Multiple per session allowed.
    CREATE TABLE IF NOT EXISTS summaries (
      id            TEXT PRIMARY KEY,
      session_id    TEXT NOT NULL REFERENCES sessions(id),
      prompt        TEXT NOT NULL,
      agent_label   TEXT NOT NULL,
      content       TEXT NOT NULL,
      status        TEXT NOT NULL,         -- 'streaming' | 'done' | 'error'
      error         TEXT,
      created_at    INTEGER NOT NULL,
      finalized_at  INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_summaries_session ON summaries(session_id, created_at DESC);
  `)

  // Additive migrations for older DBs that lack columns added after launch.
  // SQLite has no `ALTER TABLE ADD COLUMN IF NOT EXISTS`, so we rely on the
  // exception path for the no-op case. Cheap and idempotent.
  for (const stmt of [
    'ALTER TABLE messages ADD COLUMN prompt TEXT',
    'ALTER TABLE messages ADD COLUMN input_tokens INTEGER',
    'ALTER TABLE messages ADD COLUMN output_tokens INTEGER',
    // Dropped when the four-section synthesis parser was removed; raw_text
    // now holds the entire LLM output verbatim.
    'ALTER TABLE consensus_runs DROP COLUMN consensus_findings',
    'ALTER TABLE consensus_runs DROP COLUMN remaining_disagreements',
    'ALTER TABLE consensus_runs DROP COLUMN confidence_range',
    'ALTER TABLE consensus_runs DROP COLUMN practical_implications',
    // Added after launch so we can distinguish brainstorm sessions from
    // free, restore the picker on session switch, and round-trip mode
    // through export/import. Legacy rows default to 'free'.
    "ALTER TABLE sessions ADD COLUMN mode TEXT NOT NULL DEFAULT 'free'",
  ]) {
    try {
      d.exec(stmt)
    } catch {
      // column already absent / present — fine
    }
  }
}
