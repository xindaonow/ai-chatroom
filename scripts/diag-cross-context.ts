/**
 * Cross-context proof: do the two models really see each other's prior
 * answers across rounds?
 *
 * Method:
 *   R1: ask each model to invent a unique fictional one-word name.
 *       (Very likely to diverge between the two models.)
 *   R2: ask each model "what word did the OTHER AI reply with?"
 *
 * Each model's R2 answer must match the OTHER model's R1 answer.
 * Each model also obviously knows its own R1 answer, but that does NOT
 * prove cross-context — only the OTHER's answer does.
 *
 * Each agent sees the cross-agent message wrapped as `[<otherId>]: <content>`
 * (see render.ts), so it can distinguish self from other in the history.
 *
 * Run while server is on :3000.
 */
const base = 'http://localhost:3000'

function norm(s: string): string {
  // Lowercase, drop everything except a-z; take first word-ish run.
  const m = s.toLowerCase().match(/[a-z]+/)
  return m?.[0] ?? ''
}

async function consume(url: string, maxMs = 20_000): Promise<string> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), maxMs)
  try {
    const res = await fetch(url, {
      headers: { Accept: 'text/event-stream' },
      signal: ctrl.signal,
    })
    const reader = res.body!.getReader()
    const dec = new TextDecoder()
    let buf = ''
    let chunks = ''
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let idx
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const block = buf.slice(0, idx)
        buf = buf.slice(idx + 2)
        let event = '',
          data = ''
        for (const ln of block.split('\n')) {
          if (ln.startsWith('event:')) event = ln.slice(6).trim()
          else if (ln.startsWith('data:')) data += ln.slice(5).trim()
        }
        if (event === 'chunk') chunks += JSON.parse(data).text
        else if (event === 'done' || event === 'error') {
          try {
            reader.cancel()
          } catch {}
          return chunks
        }
      }
    }
    return chunks
  } finally {
    clearTimeout(t)
  }
}

async function runRound(sessionId: string, userText: string) {
  const r = await fetch(`${base}/api/rounds`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, userText }),
  }).then((r) => r.json())
  const replies = await Promise.all(
    r.assistantMessages.map(async (m: any) => ({
      agentId: m.agentId,
      messageId: m.id,
      raw: await consume(`${base}/api/rounds/${r.round.id}/stream/${m.agentId}`),
    })),
  )
  return { roundId: r.round.id, replies }
}

async function attempt(): Promise<boolean> {
  const session = await fetch(`${base}/api/sessions`, { method: 'POST' }).then(
    (r) => r.json(),
  )
  console.log(`session ${session.id}`)

  // Round 1: invent a word (short prompt for fast TTFT)
  const r1 = await runRound(
    session.id,
    'Reply with ONE made-up word (lowercase letters only, no other text).',
  )
  const r1Words = Object.fromEntries(
    r1.replies.map((r: any) => [r.agentId, { raw: r.raw, word: norm(r.raw) }]),
  )
  console.log(`R1 words:`, r1Words)

  const agentIds = r1.replies.map((r: any) => r.agentId)
  const [a, b] = agentIds
  if (!r1Words[a].word || !r1Words[b].word) {
    console.log('one or both R1 replies unparseable, retrying')
    return false
  }
  if (r1Words[a].word === r1Words[b].word) {
    console.log(`both picked the same word "${r1Words[a].word}"; retrying`)
    return false
  }

  // Wait for finalize
  await new Promise((r) => setTimeout(r, 250))

  // Round 2: what word did the OTHER AI reply with?
  const r2 = await runRound(
    session.id,
    "What word did the OTHER AI reply with last round? Reply with ONLY that word, lowercase letters only.",
  )
  const r2Words = Object.fromEntries(
    r2.replies.map((r: any) => [r.agentId, { raw: r.raw, word: norm(r.raw) }]),
  )
  console.log(`R2 words:`, r2Words)

  // Assertions
  const expectedForA = r1Words[b].word // a should report b's word
  const expectedForB = r1Words[a].word
  const aOk = r2Words[a].word === expectedForA
  const bOk = r2Words[b].word === expectedForB

  console.log(
    `\n${a} R2 said "${r2Words[a].word}" expected "${expectedForA}" ${
      aOk ? '✅' : '❌'
    }`,
  )
  console.log(
    `${b} R2 said "${r2Words[b].word}" expected "${expectedForB}" ${
      bOk ? '✅' : '❌'
    }`,
  )

  if (aOk && bOk) {
    console.log('\nPROOF: each model correctly recalled the OTHER model\'s R1 answer.')
    console.log('→ cross-agent context is genuinely flowing through the system.')
    return true
  } else {
    console.log('\nPartial / fail. Rendered context fed to each agent in R2:')
    // Print what each R2 message actually saw
    const aMsg = r2.replies.find((r: any) => r.agentId === a)
    const bMsg = r2.replies.find((r: any) => r.agentId === b)
    for (const m of [aMsg, bMsg]) {
      const lens = await fetch(
        `${base}/api/messages/${m.messageId}/context`,
      ).then((r) => r.json())
      console.log(`\n  context fed to ${m.agentId}:`)
      for (const e of lens) {
        if (!e.visible) continue
        const tag = `${e.message.role}${e.message.agentId ? `/${e.message.agentId}` : ''}${e.self ? ' (self)' : ''}`
        console.log(`    [${tag}] ${e.message.content}`)
      }
    }
    return false
  }
}

async function main() {
  const MAX_ATTEMPTS = 1
  for (let i = 1; i <= MAX_ATTEMPTS; i++) {
    console.log(`\n=== Attempt ${i} ===`)
    const ok = await attempt()
    if (ok) {
      console.log('\nDIAG_CROSS_CONTEXT_PASS')
      return
    }
  }
  console.log(`\nDIAG_CROSS_CONTEXT_FAIL after ${MAX_ATTEMPTS} attempt(s)`)
  process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

export {}
