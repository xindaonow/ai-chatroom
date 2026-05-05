/**
 * Quick live smoke test of Gemini adapter wiring. Costs <$0.001.
 * Run: bun run scripts/smoke-gemini.ts
 */
import { createGeminiAdapter } from '../src/server/adapters/gemini'

async function main() {
  const adapter = createGeminiAdapter({
    id: 'flash',
    model: 'gemini-2.5-flash',
  })

  let total = ''
  let saw_done = false
  for await (const ev of adapter.stream({
    messages: [
      {
        role: 'user',
        content: 'Reply with just the single word: pong',
      },
    ],
  })) {
    if (ev.type === 'chunk') {
      total += ev.text
      process.stdout.write(ev.text)
    } else if (ev.type === 'done') {
      saw_done = true
    } else if (ev.type === 'error') {
      console.error(`\nERROR: ${ev.error}`)
      process.exit(1)
    }
  }
  console.log()
  if (!saw_done) {
    console.error('did not see done event')
    process.exit(1)
  }
  if (!/pong/i.test(total)) {
    console.error(`unexpected response: ${total}`)
    process.exit(1)
  }
  console.log('SMOKE_GEMINI_PASS')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
