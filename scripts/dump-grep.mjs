import { JsonlSessionPersistence } from '@deepseek-ai/dsh-session-persistence-jsonl'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SessionStore } from '@deepseek-ai/dsh-session'

function enumerate(base) {
  const found = []
  for (const group of readdirSync(base, { withFileTypes: true })) {
    if (!group.isDirectory()) continue
    const groupDir = join(base, group.name)
    for (const session of readdirSync(groupDir, { withFileTypes: true })) {
      if (!session.isDirectory()) continue
      try { statSync(join(groupDir, session.name, 'session.jsonl.zstd')) } catch { continue }
      found.push(session.name)
    }
  }
  return found
}
const root = process.argv[2]
const target = process.argv[3]
const needle = process.argv[4] ?? 'Reference Libraries'
const id = enumerate(root).find((s) => s.includes(target))
if (id === undefined) { console.error('not found'); process.exit(1) }
const ctx = new Context()
const store = new SessionStore(ctx)
const backend = new JsonlSessionPersistence(ctx, { root })
const inspection = await backend.load(id)
await ctx.fiber.dispose()
let hits = 0
for (const e of inspection.events) {
  const s = JSON.stringify(e)
  if (s.includes(needle)) {
    hits += 1
    console.log(`== ${e.type} (${s.length} chars)`)
    if (e.type === 'request/context' || e.type === 'user/message') console.log(s.slice(0, 2000))
    if (hits > 6) break
  }
}
console.log(`total hits: ${hits}${hits > 6 ? ' (capped)' : ''}`)
