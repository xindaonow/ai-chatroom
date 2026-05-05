import type { AgentId, Message, Rendered } from '@shared/index'

/**
 * Map from internal agentId → opaque publicId shown to models.
 * Decouples real model identity from what appears in the conversation,
 * so models can't recognize themselves or peers by name.
 */
export type PublicIdMap = Record<AgentId, string>

/**
 * Build the per-viewer rendered snapshot for a finalized message.
 *
 * Rules:
 *  - user / system messages: viewer-agnostic, role preserved
 *  - assistant messages: for the author viewer the role is 'assistant';
 *    for other-agent viewers we wrap as a user-role message with a publicId tag,
 *    so providers (which forbid consecutive assistants from different speakers)
 *    accept the sequence without merging.
 *
 * Once written, this snapshot is byte-frozen and reused on every subsequent
 * request — guaranteeing prefix stability for prompt caching.
 */
export function buildRendered(args: {
  message: Pick<Message, 'role' | 'agentId' | 'content'>
  allAgentIds: AgentId[]
  publicIds: PublicIdMap
}): Rendered {
  const { message, allAgentIds, publicIds } = args

  if (message.role === 'user' || message.role === 'system') {
    return {
      '*': {
        role: message.role,
        content: message.content,
      },
    }
  }

  // assistant
  const out: Rendered = {}
  const authorPublic =
    (message.agentId && publicIds[message.agentId]) ?? message.agentId ?? 'agent'
  for (const viewer of allAgentIds) {
    if (viewer === message.agentId) {
      out[viewer] = { role: 'assistant', content: message.content }
    } else {
      out[viewer] = {
        role: 'user',
        content: `[${authorPublic}]: ${message.content}`,
      }
    }
  }
  return out
}

/**
 * Pick the rendered view for a given viewer agent, falling back to '*'.
 */
export function pickRendered(
  rendered: Rendered,
  viewer: AgentId,
): { role: 'user' | 'assistant' | 'system'; content: string } | null {
  if (rendered[viewer]) return rendered[viewer]
  if (rendered['*']) return rendered['*']
  return null
}
