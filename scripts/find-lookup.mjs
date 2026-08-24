// 只读调试工具：统计会话日志里直接发出的 reference_lookup 工具调用（顶层 tool/call 事件）。
// 注意：PTC（Code Mode）模式下模型经 run_code 程序内的 SDK（tools.reference_lookup）调用，
// 不产生独立 tool/call 事件——本脚本数不到；需另扫 code-dispatch 子调用的代码串。
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
const all = enumerate(root)
for (const pick of all.slice(0, 6)) {
  const ctx = new Context()
  const store = new SessionStore(ctx)
  const backend = new JsonlSessionPersistence(ctx, { root })
  const inspection = await backend.load(pick.id)
  await ctx.fiber.dispose()
  let calls = 0
  for (const e of inspection.events) {
    if (e.type === 'tool/call' && e.data?.name === 'reference_lookup') {
      calls += 1
      const args = JSON.stringify(e.data?.arguments ?? '')
      if (calls <= 3) console.log(`${pick.id.slice(0, 8)}: ${args.slice(0, 120)}`)
    }
  }
  console.log(`${pick.id.slice(0, 8)} (${new Date(pick.m).toISOString().slice(11, 19)}): reference_lookup calls = ${calls}`)
}
