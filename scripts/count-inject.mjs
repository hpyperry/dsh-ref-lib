import { JsonlSessionPersistence } from '@deepseek-ai/dsh-session-persistence-jsonl'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SessionStore } from '@deepseek-ai/dsh-session'
function enumerate(base) {
  const found = []
  for (const group of readdirSync(base, { withFileTypes: true })) {
    if (!group.isDirectory()) continue
    for (const s of readdirSync(join(base, group.name), { withFileTypes: true })) {
      if (!s.isDirectory()) continue
      try { statSync(join(base, group.name, s.name, 'session.jsonl.zstd')) } catch { continue }
      found.push(s.name)
    }
  }
  return found
}
const root = process.argv[2]
const id = enumerate(root).find((s) => s.includes(process.argv[3])) ?? enumerate(root)[0]
const ctx = new Context()
const store = new SessionStore(ctx)
const backend = new JsonlSessionPersistence(ctx, { root })
const inspection = await backend.load(id)
await ctx.fiber.dispose()
let v13 = 0, v15 = 0, total = 0
for (const e of inspection.events) {
  const s = JSON.stringify(e)
  if (!s.includes('[Read-only Reference Libraries]')) continue
  total += 1
  if (s.includes('registered as reference libraries')) v13 += 1
  else if (s.includes('registered for this session')) v15 += 1
  else if (s.includes('[Usage Guidance]')) v15 += 1
}
console.log(`inject snapshots: total=${total} v13=${v13} v15=${v15}`)
