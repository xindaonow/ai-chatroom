# Usage

A typical session, walked through.

**1. Pick models (optional).** First-time open: you get the `pro` preset (4 frontier models). Click **Models** in the header → either click `Pro` / `Flash` for one-tap presets, or search the catalog (`gpt55`, `claude opus`, `deepseek v4 pro` — subsequence match, not strict substring). Click models to toggle, then **Apply** — that creates a new session bound to your selection.

**2. Pick a mode.** Click **Free / Brainstorm / Consensus** in the header. Free is the safe default. In Consensus, an `[N] rounds` input appears next to Send — N is exact, no early stop.

**3. Ask.** Type into the bottom textarea, ⌘↵ (or Send). All N agents start streaming in parallel. Each bubble has its own color stripe and progress badge.

**4. Iterate.** Two things you can do once a round finishes:
- **Send a follow-up** — agents see all prior rounds. In Brainstorm that's where the structure pays off (peers' answers feed the next prompt).
- **Click `↻`** in any bubble's header — re-run just that AI, leaves the others alone. Useful for failed responses or unsatisfying outputs.

**5. Summarize.** When the conversation is long, click **Summarize** next to Send. Type an instruction ("用中文提取每个 AI 的核心立场" / "extract action items" / "compare positions"). The Host model (Gemini 3 Flash) gets the full transcript + your instruction and streams a result into a panel above the composer. Persisted per session.

**6. Browse / switch sessions.** Click **Sessions ▾** in the header. Today / Yesterday / Earlier groupings. Click a row to switch (loads that session's rounds, synthesis, latest summary). Click **+ New chat** for a fresh session.

**7. Close the tab.** Streaming in progress? Server keeps generating. Reopen later: the most recent session loads automatically and any still-streaming bubbles auto-resume their SSE feeds. Server crash mid-stream gets repaired on next startup (partial content preserved, status flipped to finalized).

**8. Export / Import.** Click **Export** (header) for a JSON snapshot. **Import** (next to Export) loads such a JSON back. Imported sessions get fresh internal IDs but full history + synthesis are restored. Useful for sharing or seeding a new chat.

## Picking a mode

| Goal | Mode |
|---|---|
| "What does each model say about X?" | **Free** |
| "Generate as many ideas as possible" | **Brainstorm** |
| "Reach a calibrated conclusion across N rounds" | **Consensus** |

## Mode details

| Mode | When to use | How it runs |
|---|---|---|
| **Free** | Quick comparison of model styles, no structure | Per-round streaming via `POST /api/rounds`, each round = one user message |
| **Brainstorm** | Generate many distinct ideas, build on others' | Same per-round flow; mode-specific prompts force `NEW_IDEAS` / `BUILDS_ON_PEER` / `CROSS_POLLINATIONS` structure |
| **Consensus** | Hard questions where you want calibrated convergence | Server-side multi-round runner. Each round emits `round-started` over SSE so bubbles still stream live. Between rounds, a fixed Host model (Gemini 3 Flash) writes a 3-sentence recap fed into next round's system prompt (agreed claims / open disagreements / evidence needed). After N rounds, the same Host model produces a final-synthesis card (`consensusFindings / remainingDisagreements / confidenceRange / practicalImplications`). |

`maxRounds` for Consensus is exact (no early auto-stop) — if you set 3, every AI gets exactly 3 turns plus the synthesis.

## Debug mode

Click **Debug** in the header to toggle a `</>` icon on every assistant bubble. Clicking the icon opens a **Prompt Inspector** showing the exact `[system, …history]` payload that would be sent to the LLM API for that message — including all coalesced peer-context blocks. Useful for understanding why an answer came out the way it did, or debugging a mode prompt.
