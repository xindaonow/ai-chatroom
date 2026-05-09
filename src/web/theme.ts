// Per-agent visual identity. Index 0 = first model, etc.
//
// All values use OKLCH so the five accents read as ink colors on a page
// rather than RGB neon. Stripes are pegged near the same lightness (0.55)
// and chroma (0.10–0.13) so they feel like one family; only hue varies.
// Backgrounds sit at lightness 0.97 with very faint chroma — soft tints,
// not coloured fills.
export const AGENT_ACCENTS = [
  { stripe: 'oklch(0.50 0.12 255)', bg: 'oklch(0.97 0.020 255)', label: 'blue' },
  { stripe: 'oklch(0.52 0.10 155)', bg: 'oklch(0.97 0.020 155)', label: 'green' },
  { stripe: 'oklch(0.58 0.13 55)',  bg: 'oklch(0.97 0.022 55)',  label: 'orange' },
  { stripe: 'oklch(0.52 0.13 305)', bg: 'oklch(0.97 0.020 305)', label: 'purple' },
  { stripe: 'oklch(0.52 0.14 25)',  bg: 'oklch(0.97 0.022 25)',  label: 'red' },
] as const

export function agentAccent(index: number) {
  return AGENT_ACCENTS[index % AGENT_ACCENTS.length]
}
