import { z } from 'zod'

export const AgentIdSchema = z.string().min(1)
export type AgentId = z.infer<typeof AgentIdSchema>

export const VisibilitySchema = z.union([
  z.literal('*'),
  z.array(AgentIdSchema),
])
export type Visibility = z.infer<typeof VisibilitySchema>

export const RoleSchema = z.enum(['user', 'assistant', 'system'])
export type Role = z.infer<typeof RoleSchema>

export const MessageStatusSchema = z.enum(['streaming', 'finalized', 'error'])
export type MessageStatus = z.infer<typeof MessageStatusSchema>

export const RoundStatusSchema = z.enum(['streaming', 'finalized'])
export type RoundStatus = z.infer<typeof RoundStatusSchema>

export const DiscussionModeSchema = z.enum(['free', 'brainstorm', 'consensus'])
export type DiscussionMode = z.infer<typeof DiscussionModeSchema>

// Rendered: per-viewer frozen serialization, set at finalize time.
// Key is viewer agentId; '*' means same content for all viewers (e.g. user msgs).
export const RenderedSchema = z.record(
  z.string(),
  z.object({
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string(),
  }),
)
export type Rendered = z.infer<typeof RenderedSchema>

/**
 * Snapshot of the [{role, content}, …] payload that was actually sent to the
 * LLM API for an assistant message. Captured at gen time (after coalesce, so
 * it matches what the provider received). Null for user/system messages and
 * for any assistant message generated before this column existed.
 */
export const PromptSnapshotSchema = z.array(
  z.object({
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string(),
  }),
)
export type PromptSnapshot = z.infer<typeof PromptSnapshotSchema>

export const MessageSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  roundId: z.string(),
  roundIndex: z.number().int().nonnegative(),
  role: RoleSchema,
  agentId: AgentIdSchema.nullable(),
  content: z.string(),
  status: MessageStatusSchema,
  visibleTo: VisibilitySchema,
  rendered: RenderedSchema.nullable(),
  prompt: PromptSnapshotSchema.nullable(),
  /** Final token counts from the LLM provider. Set once when the stream
   *  ends; null while streaming and for non-assistant messages. */
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  createdAt: z.number(),
  finalizedAt: z.number().nullable(),
})
export type Message = z.infer<typeof MessageSchema>

export const RoundSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  index: z.number().int().nonnegative(),
  status: RoundStatusSchema,
  createdAt: z.number(),
})
export type Round = z.infer<typeof RoundSchema>

export const AgentSnapshotSchema = z.object({
  id: z.string(),
  label: z.string(),
  model: z.string(),
})
export type AgentSnapshot = z.infer<typeof AgentSnapshotSchema>

export const SessionSchema = z.object({
  id: z.string(),
  agents: z.array(AgentSnapshotSchema),
  title: z.string().nullable(),
  mode: DiscussionModeSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
})
export type Session = z.infer<typeof SessionSchema>

export const SessionListItemSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  agents: z.array(AgentSnapshotSchema),
  mode: DiscussionModeSchema,
  roundCount: z.number().int().nonnegative(),
  createdAt: z.number(),
  updatedAt: z.number(),
})
export type SessionListItem = z.infer<typeof SessionListItemSchema>

export type Summary = {
  id: string
  sessionId: string
  prompt: string
  agentLabel: string
  content: string
  status: 'streaming' | 'done' | 'error'
  error: string | null
  createdAt: number
  finalizedAt: number | null
}

export type ConsensusPhase = 'initial' | 'review' | 'final'

export type AgentSignal = {
  agentId: string
  positionDelta: 'UNCHANGED' | 'CHANGED' | null
  changeReason: string | null
  continueNeeded: boolean | null
  confidenceDelta: 'SAME' | 'UP' | 'DOWN' | null
  unresolvedDisagreements: string[]
}

export type DisagreementRecord = {
  description: string
  materiality: 'HIGH' | 'MEDIUM' | 'LOW'
  firstSeenRound: number
  lastSeenRound: number
}

export type OrchestratorState = {
  roundNumber: number
  agreedClaims: string[]
  openDisagreements: DisagreementRecord[]
  supersededClaims: string[]
  confidenceByAgent: Record<string, number>
  continueNeededByAgent: Record<string, boolean>
  summaryText: string
}

/**
 * Final synthesis from a consensus run. The LLM's raw output, persisted
 * as a single string. The UI renders it as-is. The Host model is still
 * asked to structure its output (see `buildFinalSynthesisPrompt`), but
 * we don't enforce or parse — we just trust the model.
 */
export type ConsensusFinalSynthesis = {
  rawText: string
}

export type ConsensusRoundRecord = {
  roundNumber: number
  phase: ConsensusPhase
  orchestratorState: OrchestratorState | null
  agentSignals: AgentSignal[]
  stoppedAfter: boolean
  stopReason: string | null
}

export type ConsensusRunResult = {
  sessionId: string
  question: string
  modelIds: string[]
  rounds: ConsensusRoundRecord[]
  finalSynthesis: ConsensusFinalSynthesis
  totalRounds: number
  transcript: string
}
