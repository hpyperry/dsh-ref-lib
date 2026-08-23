/**
 * `/api/ref-lib/*` 路由单测：loopback 护栏 + list/add/remove 语义。
 * 用假 req/res/服务（不启动真实 HTTP server）。
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Session } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { isLoopbackRequest, makeRefLibRoutes, MAX_JSON_BODY_BYTES } from '../src/routes.ts'
import { RefLibDuplicateError, RefLibNoteError, RefLibPathError, RefLibUnavailableError, RefLibUnknownError, type RefLibService } from '../src/service.ts'

/** 假响应：捕获状态码与 body。 */
function fakeRes(): { res: ServerResponse; out: { status: number; body: string } } {
  const out = { status: 0, body: '' }
  const res = {
    writeHead(status: number) {
      out.status = status
    },
    end(body: unknown) {
      out.body = String(body)
    },
  } as unknown as ServerResponse
  return { res, out }
}

/** 假请求：loopback 默认 + 可选 body/属性覆盖。 */
function fakeReq(
  options: {
    body?: unknown
    remoteAddress?: string
    headers?: Record<string, string | undefined>
    method?: string
    url?: string
  } = {},
): IncomingMessage {
  const chunks = options.body === undefined ? [] : [Buffer.from(JSON.stringify(options.body))]
  return {
    socket: { remoteAddress: options.remoteAddress ?? '127.0.0.1' },
    headers: {
      host: '127.0.0.1:3080',
      origin: 'http://127.0.0.1:3080',
      ...options.headers,
    },
    method: options.method ?? 'GET',
    url: options.url ?? '/api/ref-lib/list',
    [Symbol.asyncIterator]: async function* () {
      for (const chunk of chunks) yield chunk
    },
  } as unknown as IncomingMessage
}

describe('isLoopbackRequest（护栏）', () => {
  it('回环源 + 同源 Origin 放行', () => {
    expect(isLoopbackRequest(fakeReq())).toBe(true)
  })

  it('LAN 源地址拒绝', () => {
    expect(isLoopbackRequest(fakeReq({ remoteAddress: '192.168.1.5' }))).toBe(false)
  })

  it('跨域 Origin 拒绝', () => {
    expect(isLoopbackRequest(fakeReq({ headers: { origin: 'http://evil.example' } }))).toBe(false)
  })

  it('无 Origin 时按回环放行（非浏览器客户端）', () => {
    expect(isLoopbackRequest(fakeReq({ headers: { origin: undefined } }))).toBe(true)
  })

  it('sec-fetch-site=cross-site 拒绝', () => {
    expect(isLoopbackRequest(fakeReq({ headers: { 'sec-fetch-site': 'cross-site' } }))).toBe(false)
  })
})

describe('makeRefLibRoutes', () => {
  const fakeSession = { id: 'session-live', header: { id: 'session-live', cwd: '/workspace' } } as unknown as Session

  function boot() {
    const calls: Array<{ session: unknown; path?: string; note?: string; id?: string }> = []
    const refLibs = {
      list: () => [{ id: 'e1', path: '/lib/a' }],
      add: async (_session: unknown, path: string, note?: string) => {
        calls.push({ session: _session, path, ...(note === undefined ? {} : { note }) })
        return { id: 'e1', path, ...(note === undefined ? {} : { note }) }
      },
      remove: async (_session: unknown, id: string) => {
        calls.push({ session: _session, id })
      },
      setNote: async (_session: unknown, id: string, note: string) => {
        calls.push({ session: _session, id, note })
        return { id, path: '/lib/a', note }
      },
    } as unknown as RefLibService
    const resolveSession = (sessionId: string): Session | undefined =>
      sessionId === 'session-live' ? fakeSession : undefined
    const routes = makeRefLibRoutes({ refLibs, resolveSession, log: () => {} })
    const byPath = (path: string) => routes.find((route) => route.path === path)!
    return { calls, byPath }
  }

  it('GET list 返回 { libs }（展示倒序：最近添加在前）', async () => {
    const refLibs = {
      list: () => [
        { id: 'e1', path: '/lib/old' },
        { id: 'e2', path: '/lib/new' },
      ],
    } as unknown as RefLibService
    const resolveSession = (sessionId: string): Session | undefined =>
      sessionId === 'session-live' ? fakeSession : undefined
    const routes = makeRefLibRoutes({ refLibs, resolveSession, log: () => {} })
    const byPath = (path: string) => routes.find((route) => route.path === path)!
    const { res, out } = fakeRes()
    await byPath('/api/ref-lib/list').handler(fakeReq({ url: '/api/ref-lib/list?session=session-live' }), res)
    expect(out.status).toBe(200)
    expect(JSON.parse(out.body)).toEqual({
      libs: [
        { id: 'e2', path: '/lib/new' },
        { id: 'e1', path: '/lib/old' },
      ],
    })
  })

  it('list 对非 live 会话返回 404', async () => {
    const { byPath } = boot()
    const { res, out } = fakeRes()
    await byPath('/api/ref-lib/list').handler(fakeReq({ url: '/api/ref-lib/list?session=session-gone' }), res)
    expect(out.status).toBe(404)
  })

  it('POST add 调用服务并返回 { entry }', async () => {
    const { calls, byPath } = boot()
    const { res, out } = fakeRes()
    await byPath('/api/ref-lib/add').handler(
      fakeReq({ method: 'POST', body: { session: 'session-live', path: '/lib/a' } }),
      res,
    )
    expect(out.status).toBe(200)
    expect(JSON.parse(out.body)).toEqual({ entry: { id: 'e1', path: '/lib/a' } })
    expect(calls[0]).toMatchObject({ session: fakeSession, path: '/lib/a' })
  })

  it('POST add 透传 note 用途说明', async () => {
    const { calls, byPath } = boot()
    const { res, out } = fakeRes()
    await byPath('/api/ref-lib/add').handler(
      fakeReq({ method: 'POST', body: { session: 'session-live', path: '/lib/a', note: '源码库' } }),
      res,
    )
    expect(out.status).toBe(200)
    expect(JSON.parse(out.body)).toEqual({ entry: { id: 'e1', path: '/lib/a', note: '源码库' } })
    expect(calls[0]).toMatchObject({ path: '/lib/a', note: '源码库' })
  })

  it('POST add note 非字符串返回 400', async () => {
    const { byPath } = boot()
    const { res, out } = fakeRes()
    await byPath('/api/ref-lib/add').handler(
      fakeReq({ method: 'POST', body: { session: 'session-live', path: '/lib/a', note: 42 } }),
      res,
    )
    expect(out.status).toBe(400)
    expect(JSON.parse(out.body)).toEqual({ error: 'note must be a string' })
  })

  it('POST add 请求体超限返回 400（流仍被排空）', async () => {
    const { byPath } = boot()
    const { res, out } = fakeRes()
    const huge = { session: 'session-live', path: 'x'.repeat(MAX_JSON_BODY_BYTES) }
    await byPath('/api/ref-lib/add').handler(fakeReq({ method: 'POST', body: huge }), res)
    expect(out.status).toBe(400)
  })

  it('add 业务错误（路径不存在）映射 400 并带 wire code', async () => {
    const refLibs = {
      list: () => [],
      add: async (_session: unknown, path: string) => {
        throw new RefLibPathError(path, 'missing')
      },
      remove: async () => {},
    } as unknown as RefLibService
    const resolveSession = () => fakeSession
    const routes = makeRefLibRoutes({ refLibs, resolveSession, log: () => {} })
    const { res, out } = fakeRes()
    await routes
      .find((route) => route.path === '/api/ref-lib/add')!
      .handler(fakeReq({ method: 'POST', body: { session: 'session-live', path: '/nope' } }), res)
    expect(out.status).toBe(400)
    const missingBody = JSON.parse(out.body) as { error: string; code: string; path: string }
    expect(missingBody.error).toContain('不存在')
    expect(missingBody.code).toBe('ref-lib/missing')
    expect(missingBody.path).toBe('/nope')
  })

  it('add 路径含控制字符（unsafe）映射 400 并带 wire code', async () => {
    const refLibs = {
      list: () => [],
      add: async (_session: unknown, path: string) => {
        throw new RefLibPathError(path, 'unsafe')
      },
      remove: async () => {},
    } as unknown as RefLibService
    const resolveSession = () => fakeSession
    const routes = makeRefLibRoutes({ refLibs, resolveSession, log: () => {} })
    const { res, out } = fakeRes()
    await routes
      .find((route) => route.path === '/api/ref-lib/add')!
      .handler(fakeReq({ method: 'POST', body: { session: 'session-live', path: '/lib\ninject' } }), res)
    expect(out.status).toBe(400)
    expect((JSON.parse(out.body) as { code: string }).code).toBe('ref-lib/unsafe')
  })

  it('add note 含控制字符（RefLibNoteError）映射 400 并带 wire code', async () => {
    const refLibs = {
      list: () => [],
      add: async () => {
        throw new RefLibNoteError()
      },
      remove: async () => {},
    } as unknown as RefLibService
    const resolveSession = () => fakeSession
    const routes = makeRefLibRoutes({ refLibs, resolveSession, log: () => {} })
    const { res, out } = fakeRes()
    await routes
      .find((route) => route.path === '/api/ref-lib/add')!
      .handler(fakeReq({ method: 'POST', body: { session: 'session-live', path: '/lib', note: 'bad\nnote' } }), res)
    expect(out.status).toBe(400)
    expect((JSON.parse(out.body) as { code: string }).code).toBe('ref-lib/note-unsafe')
  })

  it('POST remove 调用服务并返回 { ok: true }', async () => {
    const { calls, byPath } = boot()
    const { res, out } = fakeRes()
    await byPath('/api/ref-lib/remove').handler(
      fakeReq({ method: 'POST', body: { session: 'session-live', id: 'e1' } }),      res,
    )
    expect(out.status).toBe(200)
    expect(JSON.parse(out.body)).toEqual({ ok: true })
    expect(calls[0]).toMatchObject({ session: fakeSession, id: 'e1' })
  })

  it('remove 未知 id 映射 400 并带 wire code', async () => {
    const refLibs = {
      list: () => [],
      add: async () => ({ id: 'x', path: '/x' }),
      remove: async () => {
        throw new RefLibUnknownError('ghost')
      },
    } as unknown as RefLibService
    const resolveSession = () => fakeSession
    const routes = makeRefLibRoutes({ refLibs, resolveSession, log: () => {} })
    const { res, out } = fakeRes()
    await routes
      .find((route) => route.path === '/api/ref-lib/remove')!
      .handler(fakeReq({ method: 'POST', body: { session: 'session-live', id: 'ghost' } }), res)
    expect(out.status).toBe(400)
    expect(JSON.parse(out.body) as { code: string; id: string }).toMatchObject({
      code: 'ref-lib/unknown-id',
      id: 'ghost',
    })
  })

  it('POST note 更新用途说明并返回 { entry }', async () => {
    const { calls, byPath } = boot()
    const { res, out } = fakeRes()
    await byPath('/api/ref-lib/note').handler(
      fakeReq({ method: 'POST', body: { session: 'session-live', id: 'e1', note: '新用途' } }),
      res,
    )
    expect(out.status).toBe(200)
    expect(JSON.parse(out.body)).toEqual({ entry: { id: 'e1', path: '/lib/a', note: '新用途' } })
    expect(calls[0]).toMatchObject({ id: 'e1', note: '新用途' })
  })

  it('POST note 对失效条目映射 400 并带 wire code（仅允许移除）', async () => {
    const refLibs = {
      list: () => [],
      add: async () => ({ id: 'x', path: '/x' }),
      remove: async () => undefined,
      setNote: async () => {
        throw new RefLibUnavailableError('/lib/deleted')
      },
    } as unknown as RefLibService
    const resolveSession = () => fakeSession
    const routes = makeRefLibRoutes({ refLibs, resolveSession, log: () => {} })
    const { res, out } = fakeRes()
    await routes
      .find((route) => route.path === '/api/ref-lib/note')!
      .handler(fakeReq({ method: 'POST', body: { session: 'session-live', id: 'e1', note: '新用途' } }), res)
    expect(out.status).toBe(400)
    expect(JSON.parse(out.body) as { code: string; path: string }).toMatchObject({
      code: 'ref-lib/unavailable',
      path: '/lib/deleted',
    })
  })

  it('POST note 缺 id 返回 400', async () => {
    const { byPath } = boot()
    const { res, out } = fakeRes()
    await byPath('/api/ref-lib/note').handler(
      fakeReq({ method: 'POST', body: { session: 'session-live', note: 'x' } }),
      res,
    )
    expect(out.status).toBe(400)
    expect(JSON.parse(out.body)).toEqual({ error: 'missing id' })
  })

  it('POST note note 非字符串返回 400', async () => {
    const { byPath } = boot()
    const { res, out } = fakeRes()
    await byPath('/api/ref-lib/note').handler(
      fakeReq({ method: 'POST', body: { session: 'session-live', id: 'e1', note: 42 } }),
      res,
    )
    expect(out.status).toBe(400)
    expect(JSON.parse(out.body)).toEqual({ error: 'note must be a string' })
  })

  it('非 loopback 请求一律 403', async () => {
    const { byPath } = boot()
    const { res, out } = fakeRes()
    await byPath('/api/ref-lib/list').handler(
      fakeReq({ url: '/api/ref-lib/list?session=session-live', remoteAddress: '10.0.0.8' }),
      res,
    )
    expect(out.status).toBe(403)
  })

  it('方法不符返回 405', async () => {
    const { byPath } = boot()
    const { res, out } = fakeRes()
    await byPath('/api/ref-lib/add').handler(fakeReq({ method: 'GET', url: '/api/ref-lib/add' }), res)
    expect(out.status).toBe(405)
  })
})

describe('makeRefLibRoutes（v12 跨会话导入）', () => {
  const fakeSession = { id: 'session-live', header: { id: 'session-live', cwd: '/workspace' } } as unknown as Session

  function boot() {
    const listSessionsCalls: string[] = []
    const importCalls: unknown[] = []
    const refLibs = {
      listSessions: (exclude?: string) => {
        listSessionsCalls.push(exclude ?? '')
        return [
          { sessionId: 'session-other', count: 2, available: 1, updatedAt: 1000 },
          { sessionId: 'session-old', count: 1, available: 1, updatedAt: 500 },
        ]
      },
      importEntries: async (_session: unknown, plan: unknown) => {
        importCalls.push(plan)
        return { added: [{ id: 'new-1', path: '/lib/a', status: 'available' }], replaced: [] }
      },
    } as unknown as RefLibService
    const resolveSession = (sessionId: string): Session | undefined =>
      sessionId === 'session-live' ? fakeSession : undefined
    const routes = makeRefLibRoutes({ refLibs, resolveSession, log: () => {} })
    const byPath = (path: string) => routes.find((route) => route.path === path)!
    return { listSessionsCalls, importCalls, byPath }
  }

  it('GET sessions 返回来源清单并排除当前会话', async () => {
    const { listSessionsCalls, byPath } = boot()
    const { res, out } = fakeRes()
    await byPath('/api/ref-lib/sessions').handler(
      fakeReq({ url: '/api/ref-lib/sessions?session=session-live' }),
      res,
    )
    expect(out.status).toBe(200)
    expect(listSessionsCalls).toEqual(['session-live'])
    expect(JSON.parse(out.body)).toEqual({
      sessions: [
        { sessionId: 'session-other', count: 2, available: 1, updatedAt: 1000 },
        { sessionId: 'session-old', count: 1, available: 1, updatedAt: 500 },
      ],
    })
  })

  it('GET sessions 缺当前会话参数 → 400', async () => {
    const { byPath } = boot()
    const { res, out } = fakeRes()
    await byPath('/api/ref-lib/sessions').handler(fakeReq({ url: '/api/ref-lib/sessions' }), res)
    expect(out.status).toBe(400)
  })

  it('POST import 提交规划并返回 { added, replaced }', async () => {
    const { importCalls, byPath } = boot()
    const { res, out } = fakeRes()
    await byPath('/api/ref-lib/import').handler(
      fakeReq({
        method: 'POST',
        body: {
          session: 'session-live',
          plan: { additions: [{ path: '/lib/a', note: 'x' }], replacements: [{ existingId: 'e1' }] },
        },
      }),
      res,
    )
    expect(out.status).toBe(200)
    expect(importCalls).toEqual([
      { additions: [{ path: '/lib/a', note: 'x' }], replacements: [{ existingId: 'e1' }] },
    ])
    expect(JSON.parse(out.body)).toEqual({ added: [{ id: 'new-1', path: '/lib/a', status: 'available' }], replaced: [] })
  })

  it('POST import 畸形 plan → 400', async () => {
    const { byPath } = boot()
    for (const body of [
      { session: 'session-live', plan: { additions: 'x', replacements: [] } },
      { session: 'session-live', plan: { additions: [{ path: 42 }], replacements: [] } },
      { session: 'session-live', plan: { additions: [], replacements: [{ existingId: 42 }] } },
      { session: 'session-live' },
    ]) {
      const { res, out } = fakeRes()
      await byPath('/api/ref-lib/import').handler(fakeReq({ method: 'POST', body }), res)
      expect(out.status).toBe(400)
    }
  })
})

describe('makeRefLibRoutes（v12 只读 source 路由）', () => {
  it('GET source 读取历史会话 sidecar（不要求 live，展示倒序）', async () => {
    const refLibs = {
      readSessionLibs: (sessionId: string) =>
        sessionId === 'session-history'
          ? [
              { id: 'h1', path: '/lib/old' },
              { id: 'h2', path: '/lib/new' },
            ]
          : [],
    } as unknown as RefLibService
    const routes = makeRefLibRoutes({ refLibs, resolveSession: () => undefined, log: () => {} })
    const route = routes.find((r) => r.path === '/api/ref-lib/source')!
    const { res, out } = fakeRes()
    await route.handler(fakeReq({ url: '/api/ref-lib/source?session=session-history' }), res)
    expect(out.status).toBe(200)
    expect(JSON.parse(out.body)).toEqual({
      libs: [
        { id: 'h2', path: '/lib/new' },
        { id: 'h1', path: '/lib/old' },
      ],
    })
  })

  it('GET source 无 sidecar 会话返回空列表', async () => {
    const refLibs = { readSessionLibs: () => [] } as unknown as RefLibService
    const routes = makeRefLibRoutes({ refLibs, resolveSession: () => undefined, log: () => {} })
    const route = routes.find((r) => r.path === '/api/ref-lib/source')!
    const { res, out } = fakeRes()
    await route.handler(fakeReq({ url: '/api/ref-lib/source?session=session-none' }), res)
    expect(out.status).toBe(200)
    expect(JSON.parse(out.body)).toEqual({ libs: [] })
  })

  it('GET source 缺 session 参数 → 400', async () => {
    const refLibs = { readSessionLibs: () => [] } as unknown as RefLibService
    const routes = makeRefLibRoutes({ refLibs, resolveSession: () => undefined, log: () => {} })
    const route = routes.find((r) => r.path === '/api/ref-lib/source')!
    const { res, out } = fakeRes()
    await route.handler(fakeReq({ url: '/api/ref-lib/source' }), res)
    expect(out.status).toBe(400)
  })
})

describe('makeRefLibRoutes（v12 add 重复 400）', () => {
  it('duplicate 错误映射为 400 + code + entry', async () => {
    const refLibs = {
      add: async () => {
        throw new RefLibDuplicateError({ id: 'e1', path: '/lib/a', note: '现有' })
      },
    } as unknown as RefLibService
    const resolveSession = (id: string): Session | undefined =>
      id === 'session-live' ? ({ id: 'session-live', header: { id: 'session-live', cwd: '/w' } } as unknown as Session) : undefined
    const routes = makeRefLibRoutes({ refLibs, resolveSession, log: () => {} })
    const route = routes.find((r) => r.path === '/api/ref-lib/add')!
    const { res, out } = fakeRes()
    await route.handler(fakeReq({ method: 'POST', body: { session: 'session-live', path: '/lib/a', note: '新' } }), res)
    expect(out.status).toBe(400)
    expect(JSON.parse(out.body)).toEqual({
      error: '该目录已是参考库：/lib/a',
      code: 'ref-lib/duplicate',
      entry: { id: 'e1', path: '/lib/a', note: '现有' },
    })
  })
})
