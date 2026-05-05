# Operations

## Scripts

```bash
bun run dev                # vite + bun --watch api server
bun run build:web          # production frontend bundle (dist/web)
bun run typecheck          # tsc --noEmit
bun test                   # ~80 unit tests across modes, extractor, orchestrator,
                           #   repo, adapters, visibility, coalesce
bun run verify             # full pre-push gate: fast + visibility + adapters + e2e
bun run verify:fast        # typecheck + all unit tests
bun run verify:visibility  # focused: visibility resolver tests only
bun run verify:adapters    # focused: provider-adapter tests only
bun run verify:e2e         # spin up server with mock adapters, drive a 2-round
                           #   conversation through HTTP+SSE, assert DB state
bun run verify:cache       # prompt-cache prefix-stability check (run after touching
                           #   visibility / render / coalesce code; not in default chain)
```

`scripts/` also holds standalone diagnostics (cross-context flow, parallel agent timing, smoke tests, end-to-end frontend flow). Run any with `bun run scripts/<name>.ts`.

## Tests

| File | What it covers |
|---|---|
| `modes.test.ts` | mode prompt builders (Free/Brainstorm/Consensus), phase switching, orchestrator-state injection, hard rules, final-synthesis prompt |
| `consensus/extractor.test.ts` | `parseAgentSignals` parsing variations, `shouldStop` heuristic branches |
| `orchestrator.test.ts` | per-message finalize semantics, individual finalizedAt timestamps, retry message lifecycle, rendered snapshots per viewer |
| `repo.test.ts` | listSessions ordering / roundCount; deleteSession cascade through 4 tables; touchSession + setTitleIfMissing; repairOrphanStreams |
| `adapters/openrouter.test.ts` | endpoint URL, Authorization header, default body shape (reasoning/verbosity/max_tokens), Anthropic cache_control routing, empty-message filtering, role coalescing, error responses |
| `adapters/coalesce.test.ts` | naive same-role join + peer-aware merge (user-first ordering, peer-only header, multi-peer order preservation) |
| `adapters/mock.test.ts` | deterministic mock adapter |
| `visibility/resolver.test.ts` | cross-round transparent / intra-round isolated rules, rendered building |

## Deployment & safety

This server is designed for **single-user local use** by default. The generation endpoints spend whatever budget your `OPENROUTER_API_KEY` (and optional `ARK_API_KEY`) has — and the server has **no auth and no rate-limit**. Don't expose port 3000 to the public internet without first adding those layers.

- **CORS**: defaults to `http://localhost:5173,http://127.0.0.1:5173`. If you reverse-proxy from another origin (Tailscale, custom domain), set `CORS_ORIGINS=https://your-host` (comma-separated for multiple). **Never** set `CORS_ORIGINS=*` on a public deployment.
- **TLS verification**: the server runs with normal TLS verification. If you hit `UNKNOWN_CERTIFICATE_VERIFICATION_ERROR` on macOS Bun against openrouter.ai, you can opt into a workaround with `INSECURE_TLS=1` in `.env.local` — **for local development only**, since it disables certificate validation on every outbound HTTPS request. Better long-term: upgrade Bun or set `NODE_EXTRA_CA_CERTS=/etc/ssl/cert.pem`.

## Environment variables

| Var | Required | Notes |
|---|---|---|
| `OPENROUTER_API_KEY` | yes | Get one at <https://openrouter.ai/keys>. Spent on every model the picker shows except `doubao/...` |
| `ARK_API_KEY` | only for Doubao | Volcengine ARK key |
| `CORS_ORIGINS` | no | Comma-separated allow-list. Default localhost dev origins |
| `INSECURE_TLS` | no | `1` to disable outbound TLS verification (local dev only) |
| `DB_PATH` | no | Override SQLite path. Default `./data/dev.db` |
| `PORT` | no | Override server port. Default `3000` |
