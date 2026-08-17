/**
 * `/api/ref-lib/*` 路由单测：loopback 护栏 + list/add/remove 语义。
 * 用假 req/res/服务（不启动真实 HTTP server）。
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Session } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { isLoopbackRequest, makeRefLibRoutes, MAX_JSON_BODY_BYTES } from '../src/routes.ts'
import { RefLibPathError, RefLibUnknownError, type RefLibService } from '../src/service.ts'

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
    const calls: Array<{ session: unknown; path?: string; id?: string }> = []
    const refLibs = {
      list: () => [{ id: 'e1', path: '/lib/a' }],
      add: async (_session: unknown, path: string) => {
        calls.push({ session: _session, path })
        return { id: 'e1', path }
      },
      remove: async (_session: unknown, id: string) => {
        calls.push({ session: _session, id })
      },
    } as unknown as RefLibService
    const resolveSession = (sessionId: string): Session | undefined =>
      sessionId === 'session-live' ? fakeSession : undefined
    const routes = makeRefLibRoutes({ refLibs, resolveSession, log: () => {} })
    const byPath = (path: string) => routes.find((route) => route.path === path)!
    return { calls, byPath }
  }

  it('GET list 返回 { libs }', async () => {
    const { byPath } = boot()
    const { res, out } = fakeRes()
    await byPath('/api/ref-lib/list').handler(fakeReq({ url: '/api/ref-lib/list?session=session-live' }), res)
    expect(out.status).toBe(200)
    expect(JSON.parse(out.body)).toEqual({ libs: [{ id: 'e1', path: '/lib/a' }] })
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

  it('POST remove 调用服务并返回 { ok: true }', async () => {
    const { calls, byPath } = boot()
    const { res, out } = fakeRes()
    await byPath('/api/ref-lib/remove').handler(
      fakeReq({ method: 'POST', body: { session: 'session-live', id: 'e1' } }),
      res,
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
