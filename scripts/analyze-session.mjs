#!/usr/bin/env node
/**
 * 会话轨迹分析脚本（隔离环境调试用）：用真实 JsonlSessionPersistence 冷加载
 * 会话日志（zstd JSONL），打印关键事件流（用户消息 / assistant 消息 / 工具调用 /
 * 工具结果 / 错误），便于分析模型行为与工具链路问题。
 *
 * 用法：
 *   node scripts/analyze-session.mjs <sessionsRoot> [sessionId|latest] [--full]
 *   node scripts/analyze-session.mjs ~/.dsh-dev/sessions latest
 */
import { JsonlSessionPersistence } from '@deepseek-ai/dsh-session-persistence-jsonl'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SessionStore } from '@deepseek-ai/dsh-session'

const root = process.argv[2]
const target = process.argv[3] ?? 'latest'
const full = process.argv.includes('--full')

if (root === undefined) {
  console.error('用法: node scripts/analyze-session.mjs <sessionsRoot> [sessionId|latest] [--full]')
  process.exit(1)
}

/** 枚举全部会话目录（含 workspace 分组子目录），返回 { id, dir, mtime }。 */
function enumerateSessionDirs(base) {
  const found = []
  for (const group of readdirSync(base, { withFileTypes: true })) {
    if (!group.isDirectory()) continue
    const groupDir = join(base, group.name)
    for (const session of readdirSync(groupDir, { withFileTypes: true })) {
      if (!session.isDirectory()) continue
      const dir = join(groupDir, session.name)
      let mtime = 0
      try {
        mtime = statSync(join(dir, 'session.jsonl.zstd')).mtimeMs
      } catch {
        continue
      }
      found.push({ id: session.name, dir, mtime })
    }
  }
  found.sort((a, b) => b.mtime - a.mtime)
  return found
}

const sessions = enumerateSessionDirs(root)
if (sessions.length === 0) {
  console.error('未找到会话日志')
  process.exit(1)
}
console.log(`共 ${sessions.length} 个会话（按 mtime 倒序）:`)
for (const s of sessions.slice(0, 10)) console.log(`  ${s.id}  ${new Date(s.mtime).toISOString()}`)

const pick = target === 'latest' ? sessions[0] : sessions.find((s) => s.id.includes(target))
if (pick === undefined) {
  console.error(`未找到会话 ${target}`)
  process.exit(1)
}
console.log(`\n=== 分析会话 ${pick.id}（${new Date(pick.mtime).toISOString()}）===`)

const ctx = new Context()
const store = new SessionStore(ctx)
const backend = new JsonlSessionPersistence(ctx, { root })
const inspection = await backend.load(pick.id)
await ctx.fiber.dispose()

const events = inspection.events
console.log(`事件总数: ${events.length}\n`)

for (const event of events) {
  const t = event.type
  if (t === 'user/message') {
    const msg = event.data.message
    const text = msg?.content?.map((b) => (b.type === 'text' ? b.text : `[${b.type}]`)).join('') ?? ''
    const source = msg?.source?.kind ?? '?'
    console.log(`── user/message (source=${source})`)
    console.log(`   ${text.split('\n').slice(0, 6).join('\n   ')}`)
  } else if (t === 'assistant/message') {
    const msg = event.data.message
    const text = msg?.content?.map((b) => (b.type === 'text' ? b.text : `[${b.type}]`)).join('') ?? ''
    const usage = event.data.usage
    const usageStr = usage ? ` usage=${JSON.stringify(usage)}` : ''
    console.log(`── assistant/message${usageStr}`)
    console.log(`   ${text.split('\n').slice(0, 8).join('\n   ')}`)
  } else if (t === 'tool/call') {
    const call = event.data
    console.log(`── tool/call: ${call.name} args=${JSON.stringify(call.arguments).slice(0, 300)}`)
  } else if (t === 'tool/result') {
    const r = event.data
    const dump = JSON.stringify(r)
    if (r?.isError === true) {
      console.log(`── tool/result ERROR: ${dump.slice(0, 800)}`)
    } else if (full) {
      console.log(`── tool/result ok: ${dump.slice(0, 900)}`)
    } else {
      console.log(`── tool/result ok`)
    }
  } else if (t === 'tool/error') {
    console.log(`── tool/error: ${JSON.stringify(event.data).slice(0, 800)}`)
  } else if (t === 'turn/start') {
    console.log(`── turn/start turn=${event.data.turn}`)
  } else if (t === 'turn/end') {
    console.log(`── turn/end turn=${event.data.turn} reason=${JSON.stringify(event.data.reason)}`)
  } else if (t === 'step/start' || t === 'step/end' || t === 'assistant/chunk') {
    // 噪声事件：省略
  } else if (t === 'llm/request' || t === 'llm/stream') {
    // 省略
  } else {
    console.log(`── ${t}`)
  }
}
