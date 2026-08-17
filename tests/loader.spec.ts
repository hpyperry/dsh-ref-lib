/**
 * 隔离的 loader 级测试：用真实 `cordis-plugin-loader` + `cordis-plugin-include`
 * 装载与用户安装一致的 cordis.yml 组合（ref-lib 插件）。
 *
 * 用途：在本地复现真实 `dsh web` 的插件加载路径（entry 解析 → 插件构造），
 * 任何"装载失败"都会在此测试抛错，而不是炸掉真实 profile。
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import RefLibPlugin from '../src/index.ts'

let counter = 0
let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** fake session（per-session 数据操作）。 */
function fakeSession(): Session {
  const id = `session-test-${++counter}`
  const events: SessionEvent[] = []
  const header = { version: 0, id, createdAt: Date.now() } as SessionHeader
  return { id, header, events } as unknown as Session
}

/** 构造与用户 profile 等价的组合（ref-lib 插件，存储根指向临时目录）。 */
async function bootComposition(): Promise<Context> {
  root = await mkdtemp(join(process.cwd(), 'tests/.tmp-loader-'))
  const storeRoot = join(root, 'ref-lib-store')
  await mkdir(storeRoot)
  const configPath = join(root, 'cordis.yml')
  await writeFile(
    configPath,
    ['- id: ref-lib', "  name: '@hpyperry/dsh-ref-lib'", '  config:', `    root: ${storeRoot}`].join('\n'),
  )

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([['@hpyperry/dsh-ref-lib', { default: RefLibPlugin }]])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await ctx.loader.await()
  return ctx
}

describe('真实 Loader 装载（隔离，不碰真实 profile）', () => {
  it('cordis.yml 含 ref-lib 时插件装载成功，ctx.refLibs 可用', async () => {
    const ctx = await bootComposition()
    expect(ctx.refLibs).toBeDefined()
    expect(ctx.refLibs.list(fakeSession())).toEqual([])
  })

  it('装载后 add/remove 写入当前会话（per-session sidecar）', async () => {
    const ctx = await bootComposition()
    const dir = join(root!, 'my-lib')
    await mkdir(dir)
    const session = fakeSession()
    const entry = await ctx.refLibs.add(session, dir)
    expect(entry.path).toBe(dir)
    expect(ctx.refLibs.list(session)).toEqual([entry])
    await ctx.refLibs.remove(session, entry.id)
    expect(ctx.refLibs.list(session)).toEqual([])
  })
})
