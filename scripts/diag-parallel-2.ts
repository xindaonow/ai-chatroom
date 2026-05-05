/**
 * Bypass the orchestrator: call both adapters directly in parallel and
 * measure TTFT. This isolates whether Pro's slowness is Gemini-side
 * or our orchestration.
 */
import { createGeminiAdapter } from '../src/server/adapters/gemini'

async function timeAdapter(label: string, model: string, t0: number) {
  const adapter = createGeminiAdapter({ id: label, model })
  const startMs = Date.now() - t0
  let firstMs: number | null = null
  let lastMs: number | null = null
  let count = 0
  for await (const ev of adapter.stream({
    messages: [
      {
        role: 'user',
        content:
          'Write exactly two short sentences about the ocean. No more, no less.',
      },
    ],
  })) {
    if (ev.type === 'chunk') {
      const now = Date.now() - t0
      if (firstMs === null) firstMs = now
      lastMs = now
      count++
    }
  }
  console.log(
    `  ${label.padEnd(8)} model=${model.padEnd(20)} start=${startMs}ms first=${firstMs}ms last=${lastMs}ms chunks=${count}`,
  )
}

async function main() {
  const t0 = Date.now()
  console.log('--- Test A: flash + pro in parallel (Promise.all) ---')
  await Promise.all([
    timeAdapter('flash', 'gemini-2.5-flash', t0),
    timeAdapter('pro', 'gemini-2.5-pro', t0),
  ])

  const t1 = Date.now()
  console.log('\n--- Test B: flash + flash in parallel (control: same model) ---')
  await Promise.all([
    timeAdapter('flashA', 'gemini-2.5-flash', t1),
    timeAdapter('flashB', 'gemini-2.5-flash', t1),
  ])
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
