import { create } from 'zustand'
import type {
  ConsensusRunResult,
  DiscussionMode,
  Message,
  Round,
  Session,
  Summary,
} from '@shared/index'
import type { AgentInfo, ModelInfo, PresetSpec } from './api'

/**
 * Streaming buffer: messageId -> { content, status }.
 * Updated per chunk; fine-grained subscribers only re-render the affected bubble.
 */
type StreamState = {
  content: string
  status: 'streaming' | 'done' | 'error'
  error?: string
}

export type SummaryState = {
  prompt: string
  agentLabel: string
  content: string
  status: 'streaming' | 'done' | 'error'
  error?: string
}

type State = {
  agents: AgentInfo[]
  availableModels: ModelInfo[]
  presets: Record<string, PresetSpec[]>
  selectedModelIds: string[]   // OpenRouter model IDs chosen in picker
  session: Session | null
  rounds: Round[]
  messages: Message[]
  streaming: Map<string, StreamState>
  mode: DiscussionMode
  consensusMaxRounds: number
  /** Last completed consensus run, keyed by sessionId. Cleared when session changes. */
  consensusRun: ConsensusRunResult | null
  /** Live progress messages during a consensus run. */
  consensusProgress: string[]
  /** Summary card produced by the user-driven summarize action. */
  summary: SummaryState | null
  /** When set, the PromptInspector panel opens for this message id. */
  promptInspectorFor: string | null

  setAgents: (a: AgentInfo[]) => void
  setAvailableModels: (m: ModelInfo[]) => void
  setPresets: (p: Record<string, PresetSpec[]>) => void
  setSelectedModelIds: (ids: string[]) => void
  setMode: (m: DiscussionMode) => void
  setConsensusMaxRounds: (n: number) => void
  setSnapshot: (s: { session: Session | null; rounds: Round[]; messages: Message[] }) => void
  appendMessages: (rounds: Round[], messages: Message[]) => void
  appendChunk: (id: string, text: string) => void
  markDone: (id: string) => void
  markError: (id: string, error: string) => void
  clearStreaming: (id: string) => void
  setConsensusRun: (r: ConsensusRunResult | null) => void
  pushConsensusProgress: (msg: string) => void
  resetConsensusProgress: () => void
  startSummary: (prompt: string, agentLabel: string) => void
  appendSummaryChunk: (text: string) => void
  markSummaryDone: () => void
  markSummaryError: (error: string) => void
  clearSummary: () => void
  /** Hydrate the summary panel from a persisted record (e.g. on session load). */
  loadSummary: (s: Summary | null) => void
  openPromptInspector: (messageId: string | null) => void
}

export const useStore = create<State>((set) => ({
  agents: [],
  availableModels: [],
  presets: {},
  selectedModelIds: [],
  session: null,
  rounds: [],
  messages: [],
  streaming: new Map(),
  mode: 'free',
  consensusMaxRounds: 3,
  consensusRun: null,
  consensusProgress: [],
  summary: null,
  promptInspectorFor: null,

  setAgents: (agents) => set({ agents }),
  setAvailableModels: (availableModels) => set({ availableModels }),
  setPresets: (presets) => set({ presets }),
  setSelectedModelIds: (selectedModelIds) => set({ selectedModelIds }),
  setMode: (mode) => set({ mode }),
  setConsensusMaxRounds: (consensusMaxRounds) => set({ consensusMaxRounds }),
  setSnapshot: ({ session, rounds, messages }) =>
    set((s) => {
      // session can be null (lazy mode: no session created until first Send).
      // Compare by id; treat null/missing as "different session" → clear artifacts.
      const newId = session?.id ?? null
      const oldId = s.session?.id ?? null
      const sameSession = newId !== null && newId === oldId
      return {
        session,
        rounds,
        messages,
        consensusRun: sameSession ? s.consensusRun : null,
        consensusProgress: sameSession ? s.consensusProgress : [],
        summary: sameSession ? s.summary : null,
      }
    }),
  appendMessages: (newRounds, newMessages) =>
    set((s) => ({
      rounds: dedupeById([...s.rounds, ...newRounds]),
      messages: dedupeById([...s.messages, ...newMessages]),
    })),
  appendChunk: (id, text) =>
    set((s) => {
      const next = new Map(s.streaming)
      const cur = next.get(id) ?? { content: '', status: 'streaming' as const }
      next.set(id, { ...cur, content: cur.content + text })
      return { streaming: next }
    }),
  markDone: (id) =>
    set((s) => {
      const next = new Map(s.streaming)
      const cur = next.get(id)
      if (cur) next.set(id, { ...cur, status: 'done' })
      return { streaming: next }
    }),
  markError: (id, error) =>
    set((s) => {
      const next = new Map(s.streaming)
      const cur = next.get(id) ?? { content: '', status: 'error' as const }
      next.set(id, { ...cur, status: 'error', error })
      return { streaming: next }
    }),
  clearStreaming: (id) =>
    set((s) => {
      const next = new Map(s.streaming)
      next.delete(id)
      return { streaming: next }
    }),
  setConsensusRun: (consensusRun) => set({ consensusRun }),
  pushConsensusProgress: (msg) =>
    set((s) => ({ consensusProgress: [...s.consensusProgress, msg] })),
  resetConsensusProgress: () => set({ consensusProgress: [] }),
  startSummary: (prompt, agentLabel) =>
    set({ summary: { prompt, agentLabel, content: '', status: 'streaming' } }),
  appendSummaryChunk: (text) =>
    set((s) =>
      s.summary
        ? { summary: { ...s.summary, content: s.summary.content + text } }
        : {},
    ),
  markSummaryDone: () =>
    set((s) => (s.summary ? { summary: { ...s.summary, status: 'done' } } : {})),
  markSummaryError: (error) =>
    set((s) =>
      s.summary
        ? { summary: { ...s.summary, status: 'error', error } }
        : {},
    ),
  clearSummary: () => set({ summary: null }),
  loadSummary: (s) =>
    set({
      summary: s
        ? {
            prompt: s.prompt,
            agentLabel: s.agentLabel,
            content: s.content,
            status: s.status,
            ...(s.error !== null ? { error: s.error } : {}),
          }
        : null,
    }),
  openPromptInspector: (id) => set({ promptInspectorFor: id }),
}))

function dedupeById<T extends { id: string }>(arr: T[]): T[] {
  const seen = new Map<string, T>()
  for (const it of arr) seen.set(it.id, it)
  return [...seen.values()]
}
