#!/usr/bin/env bun
/**
 * Run full consensus via the server API and write transcript to file.
 *
 * Usage:
 *   bun src/scripts/run-consensus.mjs <path-to-ai-chatroom.json>
 *
 * Requires server running on localhost:3000.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const API = 'http://localhost:3000'
const OUTPUT_PATH = '/tmp/consensus-test-result.md'

const transcriptPath = process.argv[2]
if (!transcriptPath) {
  console.error('Usage: bun src/scripts/run-consensus.mjs <path-to-ai-chatroom.json>')
  process.exit(1)
}

let transcript
try {
  transcript = JSON.parse(readFileSync(transcriptPath, 'utf-8'))
} catch (e) {
  console.error(`Failed to read transcript: ${e.message}`)
  process.exit(1)
}

const question = transcript.rounds?.[0]?.messages?.find((m) => m.role === 'user')?.content
if (!question) {
  console.error('Could not find question in transcript')
  process.exit(1)
}

console.log(`Question: ${question.slice(0, 120)}${question.length > 120 ? '…' : ''}`)
console.log(`Calling POST ${API}/api/consensus/run …`)
console.log(`(This may take several minutes)\n`)

const t0 = Date.now()
let response
try {
  response = await fetch(`${API}/api/consensus/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      question,
      modelIds: [
        'anthropic/claude-opus-4.7',
        'google/gemini-3.1-pro-preview',
        'openai/gpt-5.5',
      ],
      maxRounds: 4,
    }),
  })
} catch (e) {
  console.error(`Network error: ${e.message}`)
  process.exit(1)
}

if (!response.ok) {
  const err = await response.text()
  console.error(`API error ${response.status}: ${err}`)
  process.exit(1)
}

const result = await response.json()
const elapsed = ((Date.now() - t0) / 1000).toFixed(1)

writeFileSync(OUTPUT_PATH, result.transcript, 'utf-8')

console.log(`\n✓ Done in ${elapsed}s`)
console.log(`  Session ID  : ${result.sessionId}`)
console.log(`  Total rounds: ${result.totalRounds}`)
const lastRound = result.rounds[result.rounds.length - 1]
if (lastRound?.stopReason) console.log(`  Stop reason : ${lastRound.stopReason}`)
console.log(`\nTranscript → ${OUTPUT_PATH}`)
console.log(`\n── Final Synthesis ─────────────────────────────────────`)
console.log(result.finalSynthesis.rawText)
