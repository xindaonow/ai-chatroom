import type {
  ConsensusRunResult,
  DiscussionMode,
  Message,
  Round,
  Session,
  SessionListItem,
  Summary,
} from '@shared/index'

const API = '/api'
// SSE streams must bypass the Vite proxy (which drops long-lived connections).
// In dev we connect directly to the backend; in prod the origin is the same.
const STREAM_ORIGIN = import.meta.env.DEV ? 'http://localhost:3000' : ''

export type AgentInfo = { id: string; label: string; model: string }

export async function listAgents(): Promise<AgentInfo[]> {
  const r = await fetch(`${API}/agents`)
  if (!r.ok) throw new Error('listAgents failed')
  return r.json()
}

export type ModelInfo = { id: string; label: string; model: string }

export async function listModels(): Promise<ModelInfo[]> {
  const r = await fetch(`${API}/models`)
  if (!r.ok) throw new Error('listModels failed')
  return r.json()
}

export type PresetSpec = { id: string; label: string; model: string }

export async function listPresets(): Promise<Record<string, PresetSpec[]>> {
  const r = await fetch(`${API}/presets`)
  if (!r.ok) throw new Error('listPresets failed')
  return r.json()
}

export type ImportResult = {
  session: Session
  agents: AgentInfo[]
  rounds: Round[]
  messages: Message[]
  mode: DiscussionMode
  consensusRun: ConsensusRunResult | null
}

export async function importSession(jsonText: string): Promise<ImportResult> {
  const r = await fetch(`${API}/sessions/import`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: jsonText,
  })
  if (!r.ok) {
    let msg = `Import failed (HTTP ${r.status})`
    try {
      const data = (await r.json()) as { error?: string }
      if (data?.error) msg = data.error
    } catch {}
    throw new Error(msg)
  }
  return r.json()
}

export async function createSession(
  modelIds?: string[],
): Promise<{ session: Session; agents: AgentInfo[] }> {
  const r = await fetch(`${API}/sessions`, {
    method: 'POST',
    headers: modelIds ? { 'content-type': 'application/json' } : {},
    body: modelIds ? JSON.stringify({ modelIds }) : undefined,
  })
  if (!r.ok) throw new Error('createSession failed')
  return r.json()
}

export async function getSession(
  id: string,
): Promise<{
  session: Session
  rounds: Round[]
  messages: Message[]
  consensusRun: ConsensusRunResult | null
  summary: Summary | null
}> {
  const r = await fetch(`${API}/sessions/${id}`)
  if (!r.ok) throw new Error('getSession failed')
  return r.json()
}

export async function listSessions(): Promise<SessionListItem[]> {
  const r = await fetch(`${API}/sessions`)
  if (!r.ok) throw new Error('listSessions failed')
  return r.json()
}

export async function deleteSessionApi(id: string): Promise<void> {
  const r = await fetch(`${API}/sessions/${id}`, { method: 'DELETE' })
  if (!r.ok) throw new Error('deleteSession failed')
}

export async function retryMessage(
  messageId: string,
): Promise<{ round: Round; message: Message }> {
  const r = await fetch(`${API}/messages/${messageId}/retry`, { method: 'POST' })
  if (!r.ok) {
    let msg = `retry failed (HTTP ${r.status})`
    try {
      const data = (await r.json()) as { error?: string }
      if (data?.error) msg = data.error
    } catch {}
    throw new Error(msg)
  }
  return r.json()
}

export async function startRound(
  sessionId: string,
  userText: string,
  mode: DiscussionMode = 'free',
): Promise<{ round: Round; userMessage: Message; assistantMessages: Message[] }> {
  const r = await fetch(`${API}/rounds`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, userText, mode }),
  })
  if (!r.ok) throw new Error('startRound failed')
  return r.json()
}

export type PromptInspection = {
  systemContent: string
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
  agent: { id: string; label: string; publicId: string; model: string }
  round: { id: string; index: number }
  mode: DiscussionMode
  /** The AI's actual response — not part of the prompt; rendered as a
   *  labelled block at the bottom of the inspector for context. */
  responseContent: string
  responseStatus: 'streaming' | 'done' | 'error' | 'finalized'
}

export async function getMessagePrompt(
  id: string,
  mode: DiscussionMode,
): Promise<PromptInspection> {
  const r = await fetch(`${API}/messages/${id}/prompt?mode=${encodeURIComponent(mode)}`)
  if (!r.ok) throw new Error('getMessagePrompt failed')
  return r.json()
}

export type SseHandler = {
  onChunk: (text: string) => void
  onDone: () => void
  onError: (msg: string) => void
}

export type SummaryHandlers = {
  onChunk: (text: string) => void
  onDone: () => void
  onError: (msg: string) => void
}

/** POSTs to /api/sessions/:id/summarize and parses the SSE response. */
export async function summarizeSessionStream(
  sessionId: string,
  body: { prompt: string; modelId?: string },
  handlers: SummaryHandlers,
): Promise<void> {
  const url = `${STREAM_ORIGIN}${API}/sessions/${sessionId}/summarize`
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok || !r.body) {
    handlers.onError(`Failed to start summary (HTTP ${r.status})`)
    return
  }
  const reader = r.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const blocks = buffer.split('\n\n')
    buffer = blocks.pop() ?? ''
    for (const block of blocks) {
      if (!block.trim()) continue
      let eventType = 'message'
      let data = ''
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) eventType = line.slice(6).trim()
        else if (line.startsWith('data:')) data += line.slice(5).trim()
      }
      try {
        const parsed = JSON.parse(data)
        if (eventType === 'chunk') handlers.onChunk(parsed.text ?? '')
        else if (eventType === 'done') {
          handlers.onDone()
          return
        } else if (eventType === 'error') {
          handlers.onError(parsed.error ?? 'unknown error')
          return
        }
      } catch {}
    }
  }
  handlers.onDone()
}

export type ConsensusRoundStarted = {
  consensusIdx: number
  phase: 'initial' | 'review'
  round: Round
  userMessage: Message
  assistantMessages: Message[]
}

export type ConsensusRunHandlers = {
  onProgress: (message: string) => void
  /**
   * Fires immediately when each round is created server-side (before agents
   * finish). The frontend should append the round/messages to the store and
   * open per-agent SSE streams to show live bubbles.
   */
  onRoundStarted: (info: ConsensusRoundStarted) => void
  onComplete: (result: ConsensusRunResult) => void
  onError: (error: string) => void
}

/**
 * POSTs to /api/consensus/run and parses the SSE response stream.
 * EventSource doesn't support POST, so we use fetch + manual SSE parsing.
 */
export async function runConsensusStream(
  body: { sessionId: string; question: string; maxRounds: number },
  handlers: ConsensusRunHandlers,
): Promise<void> {
  const url = `${STREAM_ORIGIN}${API}/consensus/run`
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok || !r.body) {
    handlers.onError(`Failed to start consensus run (HTTP ${r.status})`)
    return
  }
  const reader = r.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // SSE events are separated by blank lines (\n\n).
    const blocks = buffer.split('\n\n')
    buffer = blocks.pop() ?? ''

    for (const block of blocks) {
      if (!block.trim()) continue
      let eventType = 'message'
      let data = ''
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) eventType = line.slice(6).trim()
        else if (line.startsWith('data:')) data += line.slice(5).trim()
      }
      try {
        const parsed = JSON.parse(data)
        if (eventType === 'progress') handlers.onProgress(parsed.message ?? '')
        else if (eventType === 'round-started') handlers.onRoundStarted(parsed as ConsensusRoundStarted)
        else if (eventType === 'complete') handlers.onComplete(parsed as ConsensusRunResult)
        else if (eventType === 'error') handlers.onError(parsed.error ?? 'unknown error')
      } catch {
        // ignore malformed event
      }
    }
  }
}

export function openStream(
  roundId: string,
  agentId: string,
  handler: SseHandler,
): { close: () => void } {
  const url = `${STREAM_ORIGIN}${API}/rounds/${roundId}/stream/${agentId}`
  const es = new EventSource(url)
  es.addEventListener('chunk', (e) => {
    try {
      const data = JSON.parse((e as MessageEvent).data)
      handler.onChunk(data.text)
    } catch {}
  })
  es.addEventListener('done', () => {
    handler.onDone()
    es.close()
  })
  es.addEventListener('error', (e) => {
    let msg = 'sse error'
    try {
      msg = JSON.parse((e as MessageEvent).data).error ?? msg
    } catch {}
    handler.onError(msg)
    es.close()
  })
  return { close: () => es.close() }
}
