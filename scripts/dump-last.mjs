import { JsonlSessionPersistence } from '@deepseek-ai/dsh-session-persistence-jsonl'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SessionStore } from '@deepseek-ai/dsh-session'
function enumerate(base) {
  const found = []
  for (const group of readdirSync(base, { withFileTypes: true })) {
    if (!group.isDirectory()) continue
    for (const session of readdirSync(join(base, group.name), { withFileTypes: true })) {
      if (!session.isDirectory()) continue
      try {
        const m = statSync(join(base, group.name, session.name, 'session.jsonl.zstd')).mtimeMs
        found.push({ id: session.name, m })
      } catch { continue }
    }
  }
  found.sort((a, b) => b.m - a.m)
  return found
}
const root = process.argv[2]
const all = enumerate(root)
const pick = all.find((s) => s.id.includes(process.argv[3] ?? '')) ?? all[0]
console.error(`session: ${pick.id} (${new Date(pick.m).toISOString()})`)
const ctx = new Context()
const store = new SessionStore(ctx)
const backend = new JsonlSessionPersistence(ctx, { root })
const inspection = await backend.load(pick.id)
await ctx.fiber.dispose()
for (let i = inspection.events.length - 1; i >= 0; i -= 1) {
  const e = inspection.events[i]
  if (e.type === 'assistant/message') {
    const msg = e.data.message
    const text = msg?.content?.map((b) => (b.type === 'text' ? b.text : `[${b.type}]`)).join('') ?? ''
    console.log(text)
    break
  }
}
