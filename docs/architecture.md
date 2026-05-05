# Architecture

## Code layout

```
src/
├── server/                    Bun + Hono backend (port 3000)
│   ├── index.ts               server bootstrap, calls repairOrphanStreams on start
│   ├── api.ts                 HTTP / SSE endpoints
│   ├── orchestrator.ts        rounds, per-agent stream pubsub, per-message finalize
│   ├── modes.ts               mode-specific system prompts + Host system prompt
│   ├── host.ts                fixed Host adapter (Gemini 3 Flash, lazy-init)
│   ├── repo.ts                SQLite persistence layer
│   ├── ids.ts                 short ID generator
│   ├── openrouter-models.ts   1-hr cache of OpenRouter's full model catalog
│   ├── visibility/            cross-round transparent / intra-round isolated
│   │   ├── resolver.ts        finalizeRound, buildContextFor
│   │   └── render.ts          per-viewer message rendering
│   ├── consensus/             consensus mode internals
│   │   ├── runner.ts          multi-round loop using orchestrator + Host adapter
│   │   └── extractor.ts       parseAgentSignals, buildOrchestratorState, shouldStop
│   └── adapters/              LLM provider clients
│       ├── openrouter.ts      direct fetch w/ reasoning.effort=xhigh, verbosity=low,
│       │                      max_tokens=32000, cache_control on Anthropic
│       ├── doubao.ts          direct Volcengine ARK (Chat Completions)
│       ├── coalesce.ts        merge consecutive same-role messages, peer-aware
│       ├── mock.ts            offline test adapter (deterministic reply)
│       └── index.ts           routing + AgentSpec construction
│
├── shared/
│   └── schema.ts              types shared between server + web
│
└── web/                       React + Vite frontend (port 5173)
    ├── App.tsx                root: load most recent session on init,
    │                          reconnect any in-progress streams
    ├── store.ts               zustand: agents, session, streaming map,
    │                          summary, consensusRun, presets, debugMode
    ├── api.ts                 fetch wrappers, SSE parsers
    ├── theme.ts               per-agent accent colors
    ├── utils/export.ts        JSON snapshot shape
    ├── index.css / index.html Atelier theme bootstrap
    └── components/
        ├── Timeline           rounds + agent columns
        ├── MessageBubble      bubble with status badge + retry button + debug icon
        ├── Composer           textarea + Send + SummarizeButton + (consensus) rounds input
        ├── ModeSelector       3-mode pill toggle
        ├── ModelPicker        searchable picker w/ presets, selected-on-top
        ├── SessionsSidebar    browse / switch / delete past sessions
        ├── PromptInspector    side panel: full [system, …history] payload (per-message)
        ├── ConsensusProgress  floating progress overlay during consensus run
        ├── FinalSynthesis     synthesis card after consensus completes
        ├── SummarizeButton    popover over the composer for ad-hoc summary
        ├── SummaryPanel       streaming summary card above composer
        └── ImportButton       JSON file → restored session

agents.config.ts               presets (pro / flash) + extraModels (non-OpenRouter)
```

## Backend dispatch

```
GET    /api/sessions             list past sessions (ordered by updated_at)
GET    /api/sessions/:id         session + rounds + messages + consensusRun + summary
POST   /api/sessions             create session
DELETE /api/sessions/:id         cascade-delete rounds, messages, consensus_runs, summaries
POST   /api/sessions/import      restore an exported JSON, replay rounds finalized
POST   /api/sessions/:id/summarize  SSE — Host model against full transcript (persisted)
POST   /api/rounds               free / brainstorm — one round at a time
GET    /api/rounds/:rid/stream/:aid  SSE — per-agent chunks
POST   /api/consensus/run        consensus — full multi-round loop, SSE'ed back (persists synthesis)
POST   /api/messages/:id/retry   re-run one assistant message in place
GET    /api/models               hardcoded extras + dynamic OpenRouter catalog
GET    /api/presets              named model bundles (pro / flash)
GET    /api/messages/:id/prompt  full [system, …history] payload sent to this agent
```

## Key conventions

- **Model IDs** are `provider/model` (matches OpenRouter). The `doubao/` prefix routes to the direct Volcengine adapter; everything else goes through OpenRouter.
- **Reasoning defaults** in the OpenRouter adapter: `reasoning.effort: 'xhigh'`, `verbosity: 'low'`, `max_tokens: 32000`. Honored by GPT-5.5 / Claude 4.7+ / Gemini 3 reasoning models; ignored by others.
- **Visibility model**: assistant messages are visible only to the author while streaming (`visibleTo: [self]`); the moment that agent's stream finishes, its message individually flips to `visibleTo: '*'` with a frozen `rendered` snapshot — *not* waiting for the round to finalize. Each bubble shows its own elapsed time, and earlier finishers don't briefly revert to "connecting".
- **Consensus phases**: round 0 = `initial` (CLAIM/CONFIDENCE/REASONING/ASSUMPTIONS/...); round 1+ = `review` (POSITION_DELTA/PEER_REVIEW_*/CONTINUE_NEEDED). Final synthesis is a separate single-call step against the Host adapter, not a round.
- **Host model** (`src/server/host.ts`): one shared lazy-init OpenRouter adapter pinned to `google/gemini-3-flash-preview`. Used for the per-round consensus recap, the consensus final synthesis, and the manual Summarize endpoint. Independent of which participants the user picked.
- **Coalesce + peer-aware merge** (`src/server/adapters/coalesce.ts`): consecutive same-role messages get joined; within user-role groups, bare-user content is placed FIRST and bracketed `[publicId]: …` peer responses go AFTER a clear divider with caption. The base system prompt teaches the model this exact layout. Same function powers the prompt inspector so the debug view = the API payload.
- **Anthropic prompt caching**: cache_control marker on the last non-empty message; thanks to byte-stable rendered snapshots, subsequent rounds hit the cached prefix.
- **Crash recovery**: server startup runs `repairOrphanStreams` to flip any leftover `streaming` rows from a previous crash to `finalized` (preserving partial content), so the UI never displays a phantom-streaming bubble after a server restart.

## Persistence

SQLite at `./data/dev.db`. Sessions, rounds, messages, consensus runs, and summaries all survive restarts. Override the path with `DB_PATH=...`.

The most recent consensus run and summary per session are persisted alongside messages, so reopening a session restores the synthesis card and summary panel automatically.
