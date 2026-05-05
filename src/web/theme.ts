// Per-agent visual identity. Index 0 = first model, etc.
export const AGENT_ACCENTS = [
  { stripe: '#3B6FE8', bg: '#F0F5FF', label: 'blue' },
  { stripe: '#2A9B6B', bg: '#F0FDF8', label: 'green' },
  { stripe: '#D05A20', bg: '#FFF5F0', label: 'orange' },
  { stripe: '#7C4FD9', bg: '#F6F0FF', label: 'purple' },
  { stripe: '#C43A52', bg: '#FFF0F3', label: 'red' },
] as const

export function agentAccent(index: number) {
  return AGENT_ACCENTS[index % AGENT_ACCENTS.length]
}
