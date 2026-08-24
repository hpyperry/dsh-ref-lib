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
      try { const m = statSync(join(base, group.name, s.name, 'session.jsonl.zstd')).mtimeMs; found.push({ id: s.name, m }) } catch { continue }
    }
  }
  found.sort((a, b) => b.m - a.m)
  return found
}
const root = process.argv[2]
const pick = enumerate(root)[0]
console.error(`session: ${pick.id} ${new Date(pick.m).toISOString()}`)
const ctx = new Context()
const store = new SessionStore(ctx)
const backend = new JsonlSessionPersistence(ctx, { root })
const inspection = await backend.load(pick.id)
await ctx.fiber.dispose()
const calls = new Map()
let injects = 0, injectV15 = 0
for (const e of inspection.events) {
  if (e.type === 'tool/call') {
    const name = e.data?.name ?? '?'
    calls.set(name, (calls.get(name) ?? 0) + 1)
  }
  const s = JSON.stringify(e)
  if (s.includes('[Read-only Reference Libraries]')) {
    injects += 1
    if (s.includes('registered for this session')) injectV15 += 1
  }
}
console.log('tool calls:', [...calls.entries()].map(([k, v]) => `${k}:${v}`).join(' '))
console.log(`injects total=${injects} v15=${injectV15}`)
