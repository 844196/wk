import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join as joinPath } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  defaultFile,
  givenFile,
  loadConfig,
  loadYaml,
  mergeBindings,
  mergeContext,
  sortBindings,
  summarize,
} from './config.ts'
import { ConfigError } from './errors.ts'
import { type Binding, defaultContext, parseFile } from './schema.ts'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(joinPath(tmpdir(), 'wk-test-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function write(name: string, yaml: string) {
  const path = joinPath(dir, name)
  writeFileSync(path, yaml)
  return path
}

const base = (name: string) => joinPath(dir, name)
const defaults = () => [defaultFile(base('config')), defaultFile(base('wk'))]

async function configError(promise: Promise<unknown>): Promise<{ path: string; detail: string }> {
  const error = await promise.then(
    () => {
      throw new Error('expected a ConfigError')
    },
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(ConfigError)
  return { path: (error as ConfigError).getPath(), detail: (error as ConfigError).getDetail() }
}

const command = (key: string, buffer = key): Binding => ({ key, type: 'command', buffer })
const group = (key: string, bindings: Binding[]): Binding => ({ key, type: 'bindings', desc: key, bindings })
const keys = (bindings: Binding[]) => bindings.map((b) => b.key)

const FALLBACK = { bindings: [command('fallback')] }

describe('summarize', () => {
  test.each([
    ["EACCES: permission denied, open '/x/config.yaml'", 'permission denied'],
    ["EISDIR: illegal operation on a directory, read '/x'", 'illegal operation on a directory'],
    ['first line\nsecond line', 'first line'],
    ['ends with a colon:', 'ends with a colon'],
  ])('%j becomes %j', (message, summary) => {
    expect(summarize(new Error(message))).toBe(summary)
  })

  test('a thrown non-Error is stringified', () => {
    expect(summarize('plain')).toBe('plain')
  })
})

describe('loadYaml', () => {
  test('a missing file falls back without a path', async () => {
    const { path, value } = await loadYaml(defaultFile(base('config')), FALLBACK, parseFile)
    expect(path).toBeUndefined()
    expect(value).toBe(FALLBACK)
  })

  test('.yaml is read when there is no .yml', async () => {
    const path = write('config.yaml', 'bindings:\n  - key: l\n    type: command\n    buffer: ls\n')
    expect(await loadYaml(defaultFile(base('config')), {}, parseFile)).toEqual({
      path,
      value: { config: undefined, bindings: [command('l', 'ls')] },
    })
  })

  test('.yml is read when there is no .yaml', async () => {
    const path = write('config.yml', 'bindings:\n  - key: l\n    type: command\n    buffer: ls\n')
    expect((await loadYaml(defaultFile(base('config')), {}, parseFile)).path).toBe(path)
  })

  test('.yaml wins over .yml, which is not read at all', async () => {
    const path = write('config.yaml', 'bindings: []\n')
    write('config.yml', 'not: [valid')
    expect(await loadYaml(defaultFile(base('config')), {}, parseFile)).toEqual({
      path,
      value: { config: undefined, bindings: [] },
    })
  })

  test.each([
    ['empty', ''],
    ['comments only', '# nothing here\n'],
    ['a bare document marker', '---\n'],
    ['null', 'null\n'],
    ['a tilde', '~\n'],
  ])('a file holding %s is read as the fallback, with its path', async (_, yaml) => {
    const path = write('config.yaml', yaml)
    expect(await loadYaml(defaultFile(base('config')), FALLBACK, parseFile)).toEqual({ path, value: FALLBACK })
  })

  test('a YAML syntax error names the file', async () => {
    const path = write('config.yaml', 'bindings:\n  - key: l\n     type: command\n')
    const { path: reported, detail } = await configError(loadYaml(defaultFile(base('config')), {}, parseFile))
    expect(reported).toBe(path)
    expect(detail).not.toBe('')
    expect(detail).not.toContain('\n')
  })

  test('a shape mismatch names the file and the reason', async () => {
    const path = write('config.yaml', 'bindings: {}\n')
    expect(await configError(loadYaml(defaultFile(base('config')), {}, parseFile))).toEqual({
      path,
      detail: 'bindings: expected a list of bindings',
    })
  })

  test('a directory in place of .yaml stops, rather than falling through to .yml', async () => {
    mkdirSync(joinPath(dir, 'config.yaml'))
    write('config.yml', 'bindings: []\n')
    const { path, detail } = await configError(loadYaml(defaultFile(base('config')), {}, parseFile))
    expect(path).toBe(joinPath(dir, 'config.yaml'))
    expect(detail).toContain('directory')
  })

  test('a given path is read as written, with no extension tried after it', async () => {
    write('tmux.yaml', 'bindings: []\n')
    expect((await configError(loadYaml(givenFile(base('tmux')), {}, parseFile))).path).toBe(base('tmux'))
  })

  test('a given path may have any extension, or none', async () => {
    const path = write('tmux', 'bindings:\n  - key: l\n    type: command\n    buffer: ls\n')
    expect(await loadYaml(givenFile(path), {}, parseFile)).toEqual({
      path,
      value: { config: undefined, bindings: [command('l', 'ls')] },
    })
  })
})

describe('mergeBindings', () => {
  test('a later binding replaces an earlier one with the same key', () => {
    const merged = mergeBindings([command('l', 'global'), command('g')], [command('l', 'local')])
    expect(merged).toEqual([command('l', 'local'), command('g')])
  })

  test('a group replaces another group of the same key whole, without merging their entries', () => {
    const merged = mergeBindings([group('g', [command('p'), command('s')])], [group('g', [command('c')])])
    expect(merged).toEqual([group('g', [command('c')])])
  })

  test('a command can replace a group, and the other way round', () => {
    expect(mergeBindings([group('g', [command('p')])], [command('g')])).toEqual([command('g')])
    expect(mergeBindings([command('g')], [group('g', [command('p')])])).toEqual([group('g', [command('p')])])
  })

  test('within one file the first of a duplicated key is kept', () => {
    expect(mergeBindings([], [command('d', 'first'), command('d', 'second')])).toEqual([command('d', 'first')])
  })
})

describe('mergeContext', () => {
  test('a later field overrides an earlier one and keeps the rest', () => {
    expect(mergeContext({ timeout: 100, outputDelimiter: ',' }, { timeout: 200 })).toMatchObject({
      timeout: 200,
      outputDelimiter: ',',
    })
  })

  test('colours merge per colour, and a { color, attrs } is replaced whole', () => {
    const merged = mergeContext(
      { colors: { prompt: 1, group: { color: 2, attrs: ['bold'] } } },
      { colors: { group: 3 } },
    )
    expect(merged.colors).toEqual({ prompt: 1, group: 3 })
  })

  test('symbols.keys merge per key', () => {
    const merged = mergeContext(
      { symbols: { prompt: '$ ', keys: { space: 'SPC', tab: 'TAB' } } },
      { symbols: { keys: { tab: '->' } } },
    )
    expect(merged.symbols).toEqual({ prompt: '$ ', keys: { space: 'SPC', tab: '->' } })
  })
})

describe('sortBindings', () => {
  const sorted = (bindings: Binding[]) => keys(sortBindings(defaultContext, bindings))

  test('commands come before groups', () => {
    expect(sorted([group('a', [command('x')]), command('z')])).toEqual(['z', 'a'])
  })

  test('alphanumeric keys come before the rest', () => {
    expect(sorted([command('"'), command('z'), command('1')])).toEqual(['1', 'z', '"'])
  })

  test('a key named after a symbol sorts by that symbol, so space is not a letter', () => {
    expect(sorted([command('space'), command('a')])).toEqual(['a', 'space'])
  })

  test('keys sort naturally, not lexicographically', () => {
    expect(sorted([command('x10'), command('x2'), command('x1')])).toEqual(['x1', 'x2', 'x10'])
  })

  test('an uppercase key sorts before its lowercase counterpart', () => {
    expect(sorted([command('g'), command('G')])).toEqual(['G', 'g'])
  })

  test('keys that collate as equal still sort deterministically', () => {
    expect(sorted([command('1'), command('01')])).toEqual(['01', '1'])
    expect(sorted([command('01'), command('1')])).toEqual(['01', '1'])
  })

  test('a duplicated key keeps only its first definition', () => {
    expect(sortBindings(defaultContext, [command('d', 'first'), command('d', 'second')])).toEqual([
      command('d', 'first'),
    ])
  })

  test('nested groups are sorted and deduplicated too', () => {
    const [g] = sortBindings(defaultContext, [
      group('g', [group('x', [command('y')]), command('p', 'first'), command('c'), command('p', 'second')]),
    ])
    expect(g.type === 'bindings' && g.bindings).toEqual([
      command('c'),
      command('p', 'first'),
      group('x', [command('y')]),
    ])
  })
})

describe('loadConfig', () => {
  test('with no files there are the defaults and no bindings', async () => {
    expect(await loadConfig(defaults())).toEqual({ ctx: defaultContext, bindings: [] })
  })

  test('the files are layered in order, and the result is sorted', async () => {
    write(
      'config.yaml',
      'bindings:\n  - { key: l, type: command, buffer: ls }\n  - { key: g, type: command, buffer: global }\n',
    )
    write(
      'wk.yaml',
      'bindings:\n  - { key: g, type: command, buffer: local }\n  - { key: i, type: command, buffer: info }\n',
    )
    const { bindings } = await loadConfig(defaults())
    expect(bindings.map((b) => b.type === 'command' && b.buffer)).toEqual(['local', 'info', 'ls'])
  })

  test('a later file does not put the defaults back over an earlier file', async () => {
    write('config.yaml', 'config:\n  timeout: 500\n  colors:\n    prompt: 1\n')
    write('wk.yaml', 'config:\n  colors:\n    group: 2\n')
    const { ctx } = await loadConfig(defaults())
    expect(ctx.timeout).toBe(500)
    expect(ctx.colors.prompt).toBe(1)
    expect(ctx.colors.group).toBe(2)
    expect(ctx.colors.inputKeys).toBe(defaultContext.colors.inputKeys)
  })

  test('the first broken file is the one reported', async () => {
    const path = write('config.yaml', 'bindings: {}\n')
    write('wk.yaml', 'nonsense: [')
    expect((await configError(loadConfig(defaults()))).path).toBe(path)
  })

  test('an empty later file leaves the earlier one alone', async () => {
    write('config.yaml', 'bindings:\n  - { key: l, type: command, buffer: ls }\n')
    write('wk.yaml', '')
    expect(keys((await loadConfig(defaults())).bindings)).toEqual(['l'])
  })
})
