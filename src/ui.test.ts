import { describe, expect, test } from 'vitest'
import { type Binding, type Context, type ContextInput, resolveContext } from './schema.ts'
import { getKeySymbol, renderPrompt, renderTable } from './ui.ts'

function context(given: ContextInput = {}): Context {
  const result = resolveContext(given)
  if (!result.ok) throw new Error(result.reason)
  return result.value
}

// Every colour off, so that a case about layout reads as plain text.
const PLAIN_COLORS = {
  prompt: -1,
  breadcrumb: -1,
  separator: -1,
  group: -1,
  inputKeys: -1,
  lastInputKey: -1,
  bindingKey: -1,
  bindingIcon: -1,
  bindingDescription: -1,
}

const plain = context({ colors: PLAIN_COLORS, symbols: { prompt: '> ' } })

describe('getKeySymbol', () => {
  test('a key name with a built-in symbol resolves to it', () => {
    expect(getKeySymbol(plain, 'space')).toBe('␣')
    expect(getKeySymbol(plain, 'f12')).toBe('\u{f12b6}')
  })

  test('any other key is shown as itself', () => {
    expect(getKeySymbol(plain, 'g')).toBe('g')
  })

  test('symbols.keys from config override the built-in ones', () => {
    expect(getKeySymbol(context({ symbols: { keys: { space: 'SPC' } } }), 'space')).toBe('SPC')
  })
})

describe('renderPrompt', () => {
  test('with no keys entered it is just the prompt symbol', () => {
    expect(renderPrompt(plain, [])).toBe('> ')
  })

  test('the breadcrumb joins the keys entered so far, through their symbols', () => {
    expect(renderPrompt(plain, ['g', 'space', 'p'])).toBe('> g » ␣ » p ')
  })

  test('the last key is coloured apart from the ones before it', () => {
    const ctx = context({ colors: { ...PLAIN_COLORS, inputKeys: 1, lastInputKey: 2 } })
    expect(renderPrompt(ctx, ['g', 'p'])).toBe(`${ctx.symbols.prompt}\x1b[38;5;1mg\x1b[39m » \x1b[38;5;2mp\x1b[39m `)
  })
})

describe('renderTable', () => {
  const bindings: Binding[] = [
    { key: 'l', type: 'command', desc: 'List', buffer: 'ls -la' },
    { key: 'p', type: 'command', buffer: 'pwd' },
    { key: 'space', type: 'command', icon: '* ', desc: 'Space', buffer: 'x' },
    { key: 'g', type: 'bindings', desc: 'Git', bindings: [{ key: 'p', type: 'command', buffer: 'git push' }] },
  ]

  test('one row per binding, padded into columns', () => {
    expect(renderTable(plain, bindings).split('\n')).toEqual([
      ' l ➜ List    ',
      ' p ➜ pwd     ',
      ' ␣ ➜ * Space ',
      ' g ➜ +Git    ',
    ])
  })

  test('symbols.separator and symbols.group come from config', () => {
    const ctx = context({ colors: PLAIN_COLORS, symbols: { separator: '->', group: '[+] ' } })
    expect(renderTable(ctx, bindings.slice(3))).toBe(' g -> [+] Git ')
  })

  test('columns are measured in terminal cells, not code units', () => {
    const wide: Binding[] = [
      { key: 'a', type: 'command', desc: '日本語', buffer: 'x' },
      { key: 'bb', type: 'command', desc: 'ab', buffer: 'x' },
    ]
    expect(renderTable(plain, wide).split('\n')).toEqual([' a  ➜ 日本語 ', ' bb ➜ ab     '])
  })

  test('an empty list renders as nothing', () => {
    expect(renderTable(plain, [])).toBe('')
  })
})

describe('colours', () => {
  const row = (colors: ContextInput['colors']) =>
    renderTable(context({ colors: { ...PLAIN_COLORS, ...colors } }), [{ key: 'l', type: 'command', buffer: 'ls' }])

  test('-1 leaves the text uncoloured', () => {
    expect(row({ bindingKey: -1 })).toBe(' l ➜ ls ')
  })

  test('a number is an ANSI 256 colour', () => {
    expect(row({ bindingKey: 4 })).toBe(' \x1b[38;5;4ml\x1b[39m ➜ ls ')
  })

  test('a hex string is a 24-bit colour', () => {
    expect(row({ bindingKey: '#ff0000' })).toBe(' \x1b[38;2;255;0;0ml\x1b[39m ➜ ls ')
  })

  test('attributes wrap the coloured text', () => {
    expect(row({ bindingKey: { color: 4, attrs: ['bold', 'underline'] } })).toBe(
      ' \x1b[4m\x1b[1m\x1b[38;5;4ml\x1b[39m\x1b[22m\x1b[24m ➜ ls ',
    )
  })

  test('a foreground reset inside the text does not end the colour early', () => {
    const ctx = context({ colors: { ...PLAIN_COLORS, bindingDescription: 2 } })
    const table = renderTable(ctx, [{ key: 'l', type: 'command', desc: 'a\x1b[39mb', buffer: 'x' }])
    expect(table).toBe(' l ➜ \x1b[38;5;2ma\x1b[38;5;2mb\x1b[39m ')
  })

  test('an inner bold reset keeps a dim attribute on', () => {
    const ctx = context({ colors: { ...PLAIN_COLORS, bindingDescription: { color: -1, attrs: ['dim'] } } })
    const table = renderTable(ctx, [{ key: 'l', type: 'command', desc: 'a\x1b[22mb', buffer: 'x' }])
    expect(table).toBe(' l ➜ \x1b[2ma\x1b[2mb\x1b[22m ')
  })
})
