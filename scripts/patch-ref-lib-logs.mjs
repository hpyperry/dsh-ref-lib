#!/usr/bin/env node
/**
 * 事故修复工具：给会话日志里所有 `ref-lib/set` 事件信封补上 `ignorable: true`。
 *
 * 背景（2026-08-17 事故）：ref-lib 插件把 per-session 状态写成会话日志事件
 * `ref-lib/set`，但该类型不在 harness 的 `KNOWN_SESSION_EVENT_TYPES`（仓库内
 * 静态生成白名单）里，且 `session.append()` 没有写入 `ignorable` 标记的途径，
 * 导致任何包含该事件的会话日志被加载器整体拒绝（SessionFormatUnsupportedError）。
 *
 * 本工具按 harness 自己的 zstd 帧格式（每帧一次写入批次、带 checksum）原样
 * 重写日志：只对含 `ref-lib/set` 的帧做解压 → 逐行补 `ignorable: true` →
 * 用与 harness 完全相同的参数（node:zlib zstd + ZSTD_c_checksumFlag=1）重新
 * 压缩，其余帧字节原样保留；改前先备份为 `session.jsonl.zstd.bak-<ts>`。
 *
 * 用法：
 *   node patch-ref-lib-logs.mjs <log1> [log2 ...]
 * 或省略参数时扫描 ~/.dsh/sessions 下所有含 ref-lib/set 的日志。
 */

import { readFileSync, writeFileSync, renameSync, copyFileSync, statSync, existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { zstdCompressSync, zstdDecompressSync, constants } from 'node:zlib'

const ZSTD_MAGIC = 0xfd2fb528
/** 与 harness `zstd.ts` 的 CHECKSUM_OPTIONS 完全一致。 */
const CHECKSUM_OPTIONS = { params: { [constants.ZSTD_c_checksumFlag]: 1 } }

/** 扫描 zstd 帧边界（与 harness zstd.ts `scanZstdFrames` 等价）。
 * ⚠️ 与 scripts/verify-ref-lib-logs.mjs 的 scanFrames 及 harness 的 zstd.ts 为
 * 同一份帧格式的三处实现，harness 帧格式变更时必须三处同步修改。 */
function scanFrames(buf) {
  const frames = []
  let offset = 0
  let tornStart
  while (offset < buf.length) {
    const start = offset
    if (buf.length - offset < 4) { tornStart = start; break }
    if (buf.readUInt32LE(offset) !== ZSTD_MAGIC) {
      throw new Error(`corrupt zstd: invalid frame magic at byte ${offset}`)
    }
    offset += 4
    if (offset === buf.length) { tornStart = start; break }
    const descriptor = buf.readUInt8(offset)
    offset += 1
    if ((descriptor & 0x18) !== 0) {
      throw new Error(`corrupt zstd: reserved frame-header bit at byte ${offset - 1}`)
    }
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 0x20) !== 0
    const checksum = (descriptor & 0x04) !== 0
    const dictionaryFlag = descriptor & 0x03
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buf.length - offset < remainingHeaderBytes) { tornStart = start; break }
    offset += remainingHeaderBytes
    for (;;) {
      if (buf.length - offset < 3) { tornStart = start; break }
      const blockHeader = buf.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 0x03
      const blockSize = blockHeader >>> 3
      if (blockType === 0x03) {
        throw new Error(`corrupt zstd: reserved block type at byte ${offset - 3}`)
      }
      const payloadBytes = blockType === 0x01 ? 1 : blockSize
      if (buf.length - offset < payloadBytes) { tornStart = start; break }
      offset += payloadBytes
      if (lastBlock) break
    }
    if (tornStart !== undefined) break
    if (checksum) {
      if (buf.length - offset < 4) { tornStart = start; break }
      offset += 4
    }
    frames.push({ start, end: offset })
  }
  return { frames, tornStart }
}

/** 校验：解压后首帧必须恰好是 header 一行（与 harness assertZstdHeaderFrame 一致）。 */
function assertHeaderFrame(frameBuf) {
  const plain = zstdDecompressSync(frameBuf)
  if (plain.length === 0 || plain.indexOf(0x0a) !== plain.length - 1) {
    throw new Error('corrupt log: first frame is not exactly one header line')
  }
  return plain.toString('utf8')
}

/**
 * 给一段明文里的 `ref-lib/set` 事件补 `ignorable: true`。
 * 只改动目标行，其余行字节原样。返回 { text, changed, patchedCount }。
 */
function patchPlaintext(text) {
  const lines = text.split('\n')
  let changed = false
  let patchedCount = 0
  const out = lines.map((line) => {
    if (line === '') return line
    let obj
    try {
      obj = JSON.parse(line)
    } catch {
      return line // 非 JSON 行（理论上不存在），原样保留
    }
    if (obj === null || typeof obj !== 'object' || obj.type !== 'ref-lib/set') return line
    if (obj.ignorable === true) return line
    // 断言：原行是 JSON.stringify 的紧凑输出（写路径 eventLines 保证），
    // 因此重序列化不会改变任何其它字节。
    if (JSON.stringify(obj) !== line) {
      throw new Error(`unstable JSON roundtrip on ref-lib/set line: ${line.slice(0, 120)}`)
    }
    const patched = JSON.stringify({ ...obj, ignorable: true })
    const reparsed = JSON.parse(patched)
    if (reparsed.ignorable !== true || JSON.stringify(reparsed) !== patched) {
      throw new Error(`failed to patch ref-lib/set line: ${line.slice(0, 120)}`)
    }
    changed = true
    patchedCount += 1
    return patched
  })
  return { text: out.join('\n'), changed, patchedCount }
}

function patchLog(file) {
  const raw = readFileSync(file)
  const { frames, tornStart } = scanFrames(raw)
  if (frames.length === 0) throw new Error(`no zstd frames found in ${file}`)

  // 备份（先写 .bak 再动原文件）
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const backup = `${file}.bak-${ts}`
  copyFileSync(file, backup)
  if (statSync(backup).size !== raw.length) throw new Error('backup size mismatch — aborting')

  // 首帧必须是 header
  const headerPlain = assertHeaderFrame(raw.subarray(frames[0].start, frames[0].end))
  const headerFirstLine = headerPlain.slice(0, headerPlain.indexOf('\n'))
  const header = JSON.parse(headerFirstLine)
  if (header.type !== 'session') throw new Error(`first frame is not a session header: ${file}`)

  let patchedFrames = 0
  let patchedEvents = 0
  const outFrames = frames.map((f, i) => {
    const frameBuf = raw.subarray(f.start, f.end)
    if (i === 0) return frameBuf // header 帧不动
    const plain = zstdDecompressSync(frameBuf).toString('utf8')
    if (!plain.includes('ref-lib/set')) return frameBuf // 无目标事件，字节原样
    const { text, changed, patchedCount } = patchPlaintext(plain)
    if (!changed) return frameBuf
    patchedFrames += 1
    patchedEvents += patchedCount
    return zstdCompressSync(Buffer.from(text, 'utf8'), CHECKSUM_OPTIONS)
  })

  let result = Buffer.concat(outFrames)
  if (tornStart !== undefined) {
    // 保留撕裂尾部原样（harness 冷加载时会自行截断修复）
    result = Buffer.concat([result, raw.subarray(tornStart)])
  }

  const tmp = `${file}.patch-tmp`
  writeFileSync(tmp, result)
  // 落盘后、替换前，先对临时文件做一遍完整校验（帧可解、ref-lib/set 全部带 ignorable）
  const check = scanFrames(result)
  let verifiedEvents = 0
  for (const f of check.frames) {
    const plain = zstdDecompressSync(result.subarray(f.start, f.end)).toString('utf8')
    for (const line of plain.split('\n')) {
      if (line === '') continue
      const obj = JSON.parse(line)
      if (obj && obj.type === 'ref-lib/set') {
        if (obj.ignorable !== true) throw new Error(`verification failed: ref-lib/set without ignorable in ${file}`)
        verifiedEvents += 1
      }
    }
  }
  if (verifiedEvents === 0) throw new Error(`verification failed: no ref-lib/set events found in ${file}`)
  renameSync(tmp, file)

  return { file, frames: frames.length, patchedFrames, patchedEvents, backup, id: header.id, torn: tornStart !== undefined }
}

/** 扫描 ~/.dsh/sessions 下所有含 ref-lib/set 的日志。 */
function findAffectedLogs() {
  const root = join(homedir(), '.dsh', 'sessions')
  const found = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name)
      if (entry.isDirectory()) walk(p)
      else if ((entry.name === 'session.jsonl.zstd' || entry.name === 'session.jsonl') && !p.includes('.bak')) {
        found.push(p)
      }
    }
  }
  walk(root)
  return found
}

const targets = process.argv.slice(2)
const files = targets.length > 0 ? targets : findAffectedLogs()

let any = false
for (const file of files) {
  if (!existsSync(file)) { console.error(`SKIP (missing): ${file}`); continue }
  try {
    const r = patchLog(file)
    any = true
    console.log(`OK   ${r.id}`)
    console.log(`     ${r.file}`)
    console.log(`     frames=${r.frames} patchedFrames=${r.patchedFrames} patchedEvents=${r.patchedEvents} torn=${r.torn}`)
    console.log(`     backup: ${r.backup}`)
  } catch (error) {
    console.error(`FAIL ${file}: ${error.message}`)
    process.exitCode = 1
  }
}
if (!any && process.exitCode === undefined) {
  console.log('没有发现需要修补的日志（或未指定文件）。')
}
