import { describe, expect, test } from 'vitest'
import { defaultContext, parseFile, resolveContext } from './schema.ts'

// Parsed through Bun.YAML, as `run.ts` does, so that a case reads like the
// file a user would write and YAML's own typing (`1` is a number) applies.
function parse(yaml: string) {
  return parseFile(Bun.YAML.parse(yaml))
}

function reasonOf(yaml: string) {
  const result = parse(yaml)
  if (result.ok) throw new Error('expected the file to be rejected')
  return result.reason
}

const VALID_BINDINGS = `
bindings:
  - key: l
    type: command
    buffer: ls -la
`

describe('parseFile', () => {
  describe('rejects a malformed config section, naming the path', () => {
    test.each([
      ['a non-string outputDelimiter', 'outputDelimiter: 42', 'config.outputDelimiter: expected a single character'],
      [
        'a multi-character outputDelimiter',
        "outputDelimiter: '::'",
        'config.outputDelimiter: expected a single character',
      ],
      ['a non-numeric timeout', 'timeout: 5s', 'config.timeout: expected a whole number of milliseconds'],
      ['a negative timeout', 'timeout: -1', 'config.timeout: expected 0 or more'],
      ['a timeout past 5 minutes', 'timeout: 300001', 'config.timeout: expected 300000 (5 minutes) or less'],
      ['a malformed colour', 'colors:\n    prompt: {}', 'config.colors.prompt: expected a color'],
      ['a colour outside the ANSI range', 'colors:\n    prompt: 999', 'config.colors.prompt: expected a color'],
      ['a hex colour that is too short', "colors:\n    prompt: '#fff'", 'config.colors.prompt: expected a color'],
      [
        'an unknown colour attribute',
        'colors:\n    prompt: { color: 1, attrs: [blink] }',
        'config.colors.prompt: expected a color',
      ],
      ['a symbols section holding a scalar', 'symbols: 1', 'config.symbols: expected a mapping'],
      [
        'a symbols.keys holding a list',
        'symbols:\n    keys: [a]',
        'config.symbols.keys: expected a mapping of key names to symbols',
      ],
    ])('%s', (_, config, reason) => {
      expect(reasonOf(`${VALID_BINDINGS}config:\n  ${config}\n`)).toBe(reason)
    })
  })

  describe('rejects a malformed binding, naming the path', () => {
    test.each([
      ['a binding without a type', '- key: l\n  buffer: ls', 'bindings[0].type: expected type "command" or "bindings"'],
      [
        'a binding without a key',
        '- type: command\n  buffer: ls',
        'bindings[0].key: expected a key name or a digit 0-9',
      ],
      [
        'an empty key',
        "- key: ''\n  type: command\n  buffer: ls",
        'bindings[0].key: expected a key name or a digit 0-9',
      ],
      [
        'a digit key past 9',
        '- key: 10\n  type: command\n  buffer: ls',
        'bindings[0].key: expected a key name or a digit 0-9',
      ],
      ['a non-string buffer', '- key: l\n  type: command\n  buffer: 1', 'bindings[0].buffer: expected a string'],
      [
        'an empty binding delimiter',
        "- key: l\n  type: command\n  buffer: ls\n  delimiter: ''",
        'bindings[0].delimiter: expected a single character',
      ],
      [
        'a non-string extra field',
        '- key: l\n  type: command\n  buffer: ls\n  note: 1',
        'bindings[0].note: expected a string or a boolean',
      ],
      [
        'a list-valued extra field',
        '- key: l\n  type: command\n  buffer: ls\n  arr: [a, b]',
        'bindings[0].arr: expected a string or a boolean',
      ],
      [
        'a non-boolean eval',
        "- key: l\n  type: command\n  buffer: ls\n  eval: 'yes'",
        'bindings[0].eval: expected a boolean',
      ],
      [
        'a group without a description',
        '- key: g\n  type: bindings\n  bindings:\n    - key: p\n      type: command\n      buffer: git push',
        'bindings[0].desc: expected a string',
      ],
      [
        'a group whose bindings are not a list',
        '- key: g\n  type: bindings\n  desc: Git\n  bindings: {}',
        'bindings[0].bindings: expected a list of bindings',
      ],
      [
        'an empty group',
        '- key: g\n  type: bindings\n  desc: Git\n  bindings: []',
        'bindings[0].bindings: expected at least one binding',
      ],
      [
        'an unknown field on a group',
        '- key: g\n  type: bindings\n  desc: Git\n  oops: 1\n  bindings:\n    - key: p\n      type: command\n      buffer: git push',
        'bindings[0]: unknown field "oops"',
      ],
      [
        'a nested binding',
        [
          '- key: g',
          '  desc: Git',
          '  type: bindings',
          '  bindings:',
          '    - key: p',
          '      desc: Push/Pull',
          '      type: bindings',
          '      bindings:',
          '        - key: {}',
          '          type: command',
          '          buffer: git push',
        ].join('\n'),
        'bindings[0].bindings[0].bindings[0].key: expected a key name or a digit 0-9',
      ],
      [
        'the first broken entry of several',
        '- key: l\n  type: command\n  buffer: ls\n- type: command\n  buffer: pwd',
        'bindings[1].key: expected a key name or a digit 0-9',
      ],
    ])('%s', (_, bindings, reason) => {
      const indented = bindings.replaceAll('\n', '\n  ')
      expect(reasonOf(`bindings:\n  ${indented}\n`)).toBe(reason)
    })
  })

  describe('rejects a malformed file', () => {
    test.each([
      ['a scalar', 'hello', 'expected a mapping'],
      ['a list', '- a', 'expected a mapping'],
      ['a config section holding a scalar', 'config: 1', 'config: expected a mapping'],
      ['a bindings section holding a mapping', 'bindings:\n  key: l', 'bindings: expected a list of bindings'],
      ['an unknown top-level key', 'binding: []', 'unknown field "binding"'],
      [
        'a v1 config.yaml with its fields at the top level',
        'timeout: 1\ncolors: {}',
        'unknown field "timeout", "colors"',
      ],
    ])('%s', (_, yaml, reason) => {
      expect(reasonOf(yaml)).toBe(reason)
    })
  })

  test('an unquoted digit is accepted as a key, as a string', () => {
    expect(parse('bindings:\n  - key: 1\n    type: command\n    buffer: first\n')).toEqual({
      ok: true,
      value: { config: undefined, bindings: [{ key: '1', type: 'command', buffer: 'first' }] },
    })
  })

  test('extra string and boolean fields on a command are kept', () => {
    const result = parse(`
bindings:
  - key: l
    type: command
    buffer: ls
    eval: true
    accept: false
    note: hi
`)
    expect(result).toEqual({
      ok: true,
      value: {
        config: undefined,
        bindings: [{ key: 'l', type: 'command', buffer: 'ls', eval: true, accept: false, note: 'hi' }],
      },
    })
  })

  test('sections written with nothing under them are read as absent', () => {
    expect(parse('config:\nbindings:\n')).toEqual({ ok: true, value: { config: undefined, bindings: undefined } })
  })

  test('config is handed back as written, without the defaults filled in', () => {
    // Filling them in here would let a local file's defaults overwrite what the
    // global one set.
    expect(parse('config:\n  timeout: 500\n')).toEqual({
      ok: true,
      value: { config: { timeout: 500 }, bindings: undefined },
    })
  })

  test('containers written with nothing under them are dropped from config', () => {
    const result = parse(`
config:
  timeout: 500
  colors:
    # bindingKey: 4
  symbols:
    keys:
`)
    expect(result).toEqual({ ok: true, value: { config: { timeout: 500, symbols: {} }, bindings: undefined } })
  })

  test('an unknown config field is left alone', () => {
    expect(parse('config:\n  unknownField: whatever\n')).toEqual({
      ok: true,
      value: { config: { unknownField: 'whatever' }, bindings: undefined },
    })
  })

  test('an unknown config field that refers to itself is left alone too', () => {
    const result = parse('config:\n  extra: &loop\n    self: *loop\n')
    expect(result.ok).toBe(true)
  })
})

describe('resolveContext', () => {
  test('an empty config resolves to the defaults', () => {
    expect(resolveContext({})).toEqual({ ok: true, value: defaultContext })
  })

  test('the defaults fill in around the fields that were set', () => {
    const result = resolveContext({ timeout: 500, colors: { prompt: 1 } })
    if (!result.ok) throw new Error(result.reason)
    expect(result.value.timeout).toBe(500)
    expect(result.value.colors.prompt).toBe(1)
    expect(result.value.colors.group).toBe(defaultContext.colors.group)
    expect(result.value.outputDelimiter).toBe('\t')
  })

  test('symbols.keys merge into the built-in symbols per key', () => {
    const result = resolveContext({ symbols: { keys: { space: 'SPC', x: 'X' } } })
    if (!result.ok) throw new Error(result.reason)
    expect(result.value.symbols.keys.space).toBe('SPC')
    expect(result.value.symbols.keys.x).toBe('X')
    expect(result.value.symbols.keys.return).toBe('⏎')
  })

  test('a rejection is reported with the config. path of a file', () => {
    expect(resolveContext({ outputDelimiter: '::' })).toEqual({
      ok: false,
      reason: 'config.outputDelimiter: expected a single character',
    })
  })
})
