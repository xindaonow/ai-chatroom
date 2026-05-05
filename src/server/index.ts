// Optional: disable TLS certificate verification for all outgoing fetches.
// Some macOS Bun setups raise UNKNOWN_CERTIFICATE_VERIFICATION_ERROR against
// openrouter.ai because Bun doesn't pick up the system trust store the same
// way Node does. If you hit that, set INSECURE_TLS=1 in your local .env.local
// — but DO NOT enable this on a public deployment: it accepts ANY cert,
// including MITM ones, on every outbound HTTPS request.
//
// Better long-term fixes (not needing this flag):
//   • upgrade Bun (TLS handling has improved across releases)
//   • point Bun at the system bundle: NODE_EXTRA_CA_CERTS=/etc/ssl/cert.pem
if (process.env.INSECURE_TLS === '1') {
  console.warn(
    '[server] INSECURE_TLS=1 — TLS certificate verification disabled on outbound fetches. Local development only.',
  )
  const _baseFetch = globalThis.fetch.bind(globalThis)
  // @ts-ignore — `tls` is a Bun-specific fetch option, ignored in Node.js
  globalThis.fetch = (input: Parameters<typeof fetch>[0], init?: RequestInit) =>
    _baseFetch(input, { ...init, tls: { rejectUnauthorized: false } })
}

import { openDb } from './db'
import { createRepo } from './repo'
import { buildAgents } from './adapters'
import { createOrchestrator } from './orchestrator'
import { createApi } from './api'
import { prefetchOpenRouterModels } from './openrouter-models'

const db = openDb(process.env.DB_PATH ?? './data/dev.db')
const repo = createRepo(db)
const agents = buildAgents()
const orch = createOrchestrator({ repo, agents })
const app = createApi(orch)

// Server-restart cleanup: any rounds/messages stuck in 'streaming' status
// are leftovers from a previous crash. Mark them finalized so the UI doesn't
// show a phantom streaming indicator on reload.
{
  const repaired = repo.repairOrphanStreams(Date.now())
  if (repaired.messages > 0 || repaired.rounds > 0 || repaired.summaries > 0) {
    console.log(
      `[server] repaired ${repaired.rounds} orphan rounds, ` +
      `${repaired.messages} orphan messages, ${repaired.summaries} orphan summaries`,
    )
  }
}

const port = Number(process.env.PORT ?? 3000)
console.log(
  `[server] listening on :${port} agents=${agents.map((a) => a.id).join(',')} mock=${process.env.USE_MOCK_ADAPTERS === '1'}`,
)

// Warm the OpenRouter model catalog in the background. Failure is
// non-fatal — the picker will still work with the hardcoded suggestions.
prefetchOpenRouterModels().catch(() => {})

// idleTimeout=0 disables Bun's idle-connection close so slow-model SSE
// streams (e.g. GPT-5.5 Pro taking 120+ s) aren't dropped mid-response.
export default { port, fetch: app.fetch, idleTimeout: 0 }
