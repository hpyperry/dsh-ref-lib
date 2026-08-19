import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseRefLibCommand, resolveRefLibPath } from '../src/commands.ts'

describe('resolveRefLibPath', () => {
  const base = '/home/user/dev/dsh-plugins'

  it('绝对路径原样返回（含空格）', () => {
    expect(resolveRefLibPath('/home/user/dev/deepseek-harness', base)).toBe('/home/user/dev/deepseek-harness')
    expect(resolveRefLibPath('/home/user/My Docs', base)).toBe('/home/user/My Docs')
  })

  it('~ 展开为 home 目录', () => {
    expect(resolveRefLibPath('~', base)).toBe(homedir())
    expect(resolveRefLibPath('~/dev/deepseek-harness', base)).toBe(join(homedir(), 'dev/deepseek-harness'))
  })

  it('相对路径基于基准目录解析', () => {
    expect(resolveRefLibPath('ref-lib', base)).toBe(join(base, 'ref-lib'))
    expect(resolveRefLibPath('./ref-lib/src', base)).toBe(join(base, 'ref-lib/src'))
    expect(resolveRefLibPath('../deepseek-harness', base)).toBe(join(base, '../deepseek-harness'))
  })
})

describe('parseRefLibCommand', () => {
  it('空输入返回用法错误', () => {
    const r = parseRefLibCommand('   ')
    expect(r.kind).toBe('error')
  })

  it('list', () => {
    expect(parseRefLibCommand(' list')).toEqual({ kind: 'list' })
    expect(parseRefLibCommand('list')).toEqual({ kind: 'list' })
  })

  it('list 带参数报错', () => {
    const r = parseRefLibCommand('list extra')
    expect(r.kind).toBe('error')
  })

  it('add 带空格路径', () => {
    expect(parseRefLibCommand(' add /home/user/dev/deepseek-harness')).toEqual({
      kind: 'add',
      path: '/home/user/dev/deepseek-harness',
    })
    expect(parseRefLibCommand('add "/home/user/My Docs/Deepseek Harness"')).toEqual({
      kind: 'add',
      path: '"/home/user/My Docs/Deepseek Harness"',
    })
  })

  it('add 缺路径报错', () => {
    const r = parseRefLibCommand('add')
    expect(r.kind).toBe('error')
  })

  it('add 支持 --note 用途说明（--note 前为路径、后到行尾为 note）', () => {
    expect(parseRefLibCommand('add /home/user/dev/deepseek-harness --note harness 源码')).toEqual({
      kind: 'add',
      path: '/home/user/dev/deepseek-harness',
      note: 'harness 源码',
    })
    // 路径可含空格：--note 是唯一分隔符
    expect(parseRefLibCommand('add "/home/user/My Docs/Deepseek Harness" --note 带空格路径')).toEqual({
      kind: 'add',
      path: '"/home/user/My Docs/Deepseek Harness"',
      note: '带空格路径',
    })
  })

  it('add --note 后为空视为未提供 note', () => {
    expect(parseRefLibCommand('add /lib/a --note  ')).toEqual({ kind: 'add', path: '/lib/a' })
  })

  it('add 路径本身含 --note 字样但无分隔空白时不拆解', () => {
    expect(parseRefLibCommand('add /lib/--note-lib')).toEqual({ kind: 'add', path: '/lib/--note-lib' })
  })

  it('remove', () => {
    expect(parseRefLibCommand(' remove abc-123')).toEqual({ kind: 'remove', id: 'abc-123' })
  })

  it('remove 缺 id 报错', () => {
    const r = parseRefLibCommand('remove')
    expect(r.kind).toBe('error')
  })

  it('未知子命令报错', () => {
    const r = parseRefLibCommand('delete /tmp/x')
    expect(r.kind).toBe('error')
  })
})
