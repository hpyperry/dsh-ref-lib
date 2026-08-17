#!/usr/bin/env node
/**
 * 验证修补后的会话日志能被 harness 加载器正常读取。
 *
 * 两级验证，全部使用 **GUI 同款安装版 dsh 运行时**（npm -g @deepseek-ai/dsh
 * 依赖树里的 dsh-session / dsh-session-persistence-jsonl / cordis）。
 * 运行时根解析：优先环境变量 `DSH_VERIFY_MODULES`，否则由 `npm root -g` 推导
 * （见 resolveModulesRoot），不依赖任何个人/机器特定路径。
 *
 * L1 逐事件断言：复刻 coordinator.ts `assertEventsSupported` 的精确判定
 *     （KNOWN_SESSION_EVENT_TYPES 包含 || 信封 ignorable === true），再用
 *     `Session.fromRestore`（sessions.prepare 在 persistence 种子下的路径）
 *     做完整信封/header 校验，最后折叠出 ref-lib 投影值。
 * L2 真实加载链路：在临时副本根上构造 `JsonlSessionPersistence`（真实
 *     PersistenceCoordinator + JSONL 后端 + SessionStore），调用 `load(id)`，
 *     验证不再抛 SessionFormatUnsupportedError 且事件齐全。
 *
 * 用法：node verify-ref-lib-logs.mjs <log.zstd> <session-id> [更多…]
 */

import { readFileSync, mkdtempSync, mkdirSync, copyFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, basename } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

/**
 * 定位安装版 dsh 的 @deepseek-ai 依赖目录（本脚本的运行时根，即 GUI 同款运行时）。
 * 解析顺序：
 *  1. 环境变量 DSH_VERIFY_MODULES 显式指定（最可靠）；
 *  2. 由 `npm root -g` 推导——优先 dsh 自带的嵌套依赖
 *     `<global>/@deepseek-ai/dsh/node_modules/@deepseek-ai`，退化到全局平铺的
 *     `<global>/@deepseek-ai`；
 *  3. 均不可用时给出可复制的报错退出（不依赖个人/机器特定路径）。
 */
function resolveModulesRoot() {
  const candidates = []
  const explicit = process.env.DSH_VERIFY_MODULES
  if (explicit) candidates.push(explicit)
  try {
    const globalRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim()
    candidates.push(join(globalRoot, '@deepseek-ai/dsh/node_modules/@deepseek-ai'))
    candidates.push(join(globalRoot, '@deepseek-ai'))
  } catch {
    // npm 不可用时仅保留显式候选
  }
  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'dsh-session/lib/index.js'))) return candidate
  }
  console.error(
    '无法定位安装版 dsh 的 @deepseek-ai 依赖目录，已尝试：\n' +
      candidates.map(c => `  ${c}`).join('\n') +
      '\n请通过环境变量 DSH_VERIFY_MODULES 显式指定，例如：\n' +
      '  DSH_VERIFY_MODULES="$(npm root -g)/@deepseek-ai/dsh/node_modules/@deepseek-ai" \\\n' +
      '    node scripts/verify-ref-lib-logs.mjs <log.zstd> <session-id>'
  )
  process.exit(1)
}

const D = resolveModulesRoot()
const { Context } = await import(join(D, 'cordis/lib/index.js'))
const dshSession = await import(join(D, 'dsh-session/lib/index.js'))
const { JsonlSessionPersistence } = await import(join(D, 'dsh-session-persistence-jsonl/lib/index.js'))
const { Session, SessionId, decodeStorageRecord, KNOWN_SESSION_EVENT_TYPES, SessionStore } = dshSession

const ZSTD_MAGIC = 0xfd2fb528

/** 扫描 zstd 帧边界（与 harness zstd.ts `scanZstdFrames` 等价；简化版：允许撕裂帧
 * 提前结束）。⚠️ 与 scripts/patch-ref-lib-logs.mjs 的 scanFrames 及 harness 的
 * zstd.ts 为同一份帧格式的三处实现，harness 帧格式变更时必须三处同步修改。 */
function scanFrames(buf) {
  const frames = []
  let offset = 0
  while (offset < buf.length) {
    const start = offset
    if (buf.length - offset < 4) break
    if (buf.readUInt32LE(offset) !== ZSTD_MAGIC) throw new Error(`bad magic at ${offset}`)
    offset += 4
    if (offset === buf.length) break
    const descriptor = buf.readUInt8(offset)
    offset += 1
    if ((descriptor & 0x18) !== 0) throw new Error(`reserved header bit at ${offset - 1}`)
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 0x20) !== 0
    const checksum = (descriptor & 0x04) !== 0
    const dictionaryFlag = descriptor & 0x03
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buf.length - offset < remainingHeaderBytes) break
    offset += remainingHeaderBytes
    for (;;) {
      if (buf.length - offset < 3) return { frames }
      const blockHeader = buf.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 0x03
      const blockSize = blockHeader >>> 3
      if (blockType === 0x03) throw new Error(`reserved block type at ${offset - 3}`)
      const payloadBytes = blockType === 0x01 ? 1 : blockSize
      if (buf.length - offset < payloadBytes) return { frames }
      offset += payloadBytes
      if (lastBlock) break
    }
    if (checksum) {
      if (buf.length - offset < 4) return { frames }
      offset += 4
    }
    frames.push({ start, end: offset })
  }
  return { frames }
}

function decompressLog(file) {
  const raw = readFileSync(file)
  const { frames } = scanFrames(raw)
  const parts = []
  for (const f of frames) parts.push(zstdDecompressSync(raw.subarray(f.start, f.end)))
  return Buffer.concat(parts).toString('utf8')
}

async function verifyL1(file, id) {
  const plain = decompressLog(file)
  const lines = plain.split('\n')
  const headerLine = lines[0]
  const headerObj = JSON.parse(headerLine)
  const events = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (line === '') continue
    const decoded = decodeStorageRecord(JSON.parse(line))
    events.push(...decoded)
  }
  // 与 coordinator.assertEventsSupported 完全相同的判定
  const refused = events.filter(e => !KNOWN_SESSION_EVENT_TYPES.has(e.type) && e.ignorable !== true)
  if (refused.length > 0) {
    throw new Error(`L1: ${refused.length} 个事件仍会被拒绝，例如 seq ${refused[0].seq} type ${refused[0].type}`)
  }
  const refLibEvents = events.filter(e => e.type === 'ref-lib/set')
  const unmarked = refLibEvents.filter(e => e.ignorable !== true)
  if (unmarked.length > 0) throw new Error(`L1: ${unmarked.length} 个 ref-lib/set 仍未标记 ignorable`)
  // Session.fromRestore —— sessions.prepare(seedSource:'persistence') 的路径
  const header = { ...headerObj }
  delete header.type
  const restored = Session.fromRestore(SessionId(id), events, header)
  // 折叠 ref-lib 投影（复刻插件 index.ts 的 apply）
  let state = { libs: [] }
  for (const e of restored.events) {
    if (e.type === 'ref-lib/set') state = { libs: [...e.data.libs] }
  }
  return { header: restored.header, eventCount: restored.events.length, refLibEvents: refLibEvents.length, libs: state.libs }
}

async function verifyL2(file, id) {
  // 在临时根上复制会话目录（含项目目录名），真实后端加载，避免 repair 写原文件
  const sessionDir = dirname(file)
  const projectDir = dirname(sessionDir)
  const root = mkdtempSync(join(tmpdir(), 'ref-lib-verify-'))
  const dstSession = join(root, basename(projectDir), basename(sessionDir))
  mkdirSync(dstSession, { recursive: true })
  copyFileSync(file, join(dstSession, basename(file)))

  const ctx = new Context()
  new SessionStore(ctx) // 提供 ctx.sessions（coordinator.prepare 需要）
  const backend = new JsonlSessionPersistence(ctx, { root })
  const inspection = await backend.load(SessionId(id))
  const refLib = inspection.events.filter(e => e.type === 'ref-lib/set')
  if (refLib.length === 0) throw new Error(`L2: 加载后未发现 ref-lib/set 事件（${id}）`)
  const bad = refLib.filter(e => e.ignorable !== true)
  if (bad.length > 0) throw new Error(`L2: ${bad.length} 个 ref-lib/set 未标记 ignorable`)
  return { eventCount: inspection.events.length, refLibEvents: refLib.length }
}

const targets = process.argv.slice(2)
if (targets.length === 0 || targets.length % 2 !== 0) {
  console.error('用法: node verify-ref-lib-logs.mjs <log.zstd> <session-id> [<log.zstd> <session-id> ...]')
  process.exit(2)
}

for (let i = 0; i < targets.length; i += 2) {
  const file = targets[i]
  const id = targets[i + 1]
  try {
    const l1 = await verifyL1(file, id)
    const l2 = await verifyL2(file, id)
    console.log(`OK   ${id}`)
    console.log(`     L1: header=${l1.header.id} events=${l1.eventCount} ref-lib/set=${l1.refLibEvents} 投影 libs=${l1.libs.length}`)
    console.log(`         libs: ${l1.libs.map(l => l.path).join(' | ') || '(空)'}`)
    console.log(`     L2: 真实 JsonlSessionPersistence.load 成功，events=${l2.eventCount} ref-lib/set=${l2.refLibEvents}`)
  } catch (error) {
    console.error(`FAIL ${id}: ${error.message}`)
    process.exitCode = 1
  }
}
