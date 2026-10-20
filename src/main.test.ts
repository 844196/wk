import type { KeyPressEvent } from '@cliffy/keypress'
import { describe, expect, test } from 'vitest'
import { AbortError, KeyParseError, UndefinedKeyError } from './errors.ts'
import { type Dependencies, main } from './main.ts'
import type { Binding } from './schema.ts'

type Key = { key?: string; ctrlKey?: boolean; shiftKey?: boolean }

// Records what `main` drew and how it handled the timer, so that a case can
// look at the menu it would have shown without a terminal.
function run(keys: (Key | string)[], bindings: Binding[]) {
  const events: string[] = []
  const deps: Dependencies = {
    keypress: async function* () {
      for (const key of keys) {
        yield (typeof key === 'string' ? { key } : key) as KeyPressEvent
      }
    },
    draw: (inputKeys, shown) => events.push(`draw [${inputKeys.join(' ')}] ${shown.map((b) => b.key).join('')}`),
    setTimeoutTimer: () => events.push('set'),
    clearTimeoutTimer: () => events.push('clear'),
  }
  return { result: main(deps, bindings), events }
}

const BINDINGS: Binding[] = [
  { key: 'l', type: 'command', buffer: 'ls -la' },
  { key: 'L', type: 'command', buffer: 'less' },
  {
    key: 'g',
    type: 'bindings',
    desc: 'Git',
    bindings: [
      { key: 's', type: 'command', buffer: 'git status' },
      {
        key: 'p',
        type: 'bindings',
        desc: 'Push/Pull',
        bindings: [
          { key: 'f', type: 'command', buffer: 'git push --force' },
          { key: 'l', type: 'command', buffer: 'git pull' },
        ],
      },
    ],
  },
  { key: 'd', type: 'command', buffer: 'first' },
  { key: 'd', type: 'command', buffer: 'second' },
]

const buffer = async (keys: (Key | string)[]) => (await run(keys, BINDINGS).result).buffer

describe('selecting', () => {
  test('a key at the root selects its command', async () => {
    expect(await buffer(['l'])).toBe('ls -la')
  })

  test('descending two levels selects the leaf command', async () => {
    expect(await buffer(['g', 'p', 'f'])).toBe('git push --force')
  })

  test('a shifted key matches an uppercase binding key', async () => {
    expect(await buffer([{ key: 'l', shiftKey: true }])).toBe('less')
  })

  test('a duplicated key resolves to the first definition', async () => {
    expect(await buffer(['d'])).toBe('first')
  })

  test('the whole command is returned, extra fields included', async () => {
    const { result } = run(['x'], [{ key: 'x', type: 'command', buffer: 'x', eval: true, note: 'n' }])
    expect(await result).toEqual({ key: 'x', type: 'command', buffer: 'x', eval: true, note: 'n' })
  })
})

describe('navigating', () => {
  test('backspace goes up one level so another branch can be taken', async () => {
    expect(await buffer(['g', 'p', 'backspace', 's'])).toBe('git status')
  })

  test('ctrl-w behaves like backspace', async () => {
    expect(await buffer(['g', 'p', { key: 'w', ctrlKey: true }, 's'])).toBe('git status')
  })

  test('ctrl-u returns all the way to the root', async () => {
    expect(await buffer(['g', 'p', { key: 'u', ctrlKey: true }, 'l'])).toBe('ls -la')
  })

  test('other ctrl combinations are ignored and the menu stays open', async () => {
    expect(await buffer(['g', { key: 'a', ctrlKey: true }, 's'])).toBe('git status')
  })

  test('each level is drawn with the keys entered so far', async () => {
    const { result, events } = run(['g', 'p', 'backspace', 's'], BINDINGS)
    await result
    expect(events.filter((e) => e.startsWith('draw'))).toEqual([
      'draw [] lLgdd',
      'draw [g] sp',
      'draw [g p] fl',
      'draw [g] sp',
    ])
  })

  test('the timer is cleared on every key and set again whenever the menu stays open', async () => {
    const { result, events } = run(['g', { key: 'a', ctrlKey: true }, 's'], BINDINGS)
    await result
    expect(events.filter((e) => !e.startsWith('draw'))).toEqual(['set', 'clear', 'set', 'clear', 'set', 'clear'])
  })
})

describe('aborting', () => {
  test.each([
    ['escape', { key: 'escape' }],
    ['ctrl-c', { key: 'c', ctrlKey: true }],
    ['ctrl-d', { key: 'd', ctrlKey: true }],
    ['backspace at the root', { key: 'backspace' }],
    ['ctrl-w at the root', { key: 'w', ctrlKey: true }],
    ['ctrl-u at the root', { key: 'u', ctrlKey: true }],
  ])('%s throws AbortError', async (_, key) => {
    await expect(buffer([key])).rejects.toBeInstanceOf(AbortError)
  })

  test('escape aborts from inside a group too', async () => {
    await expect(buffer(['g', 'escape'])).rejects.toBeInstanceOf(AbortError)
  })
})

describe('failing', () => {
  test('an undefined key reports the whole key sequence', async () => {
    const error = await buffer(['g', 'p', 'z']).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(UndefinedKeyError)
    expect((error as UndefinedKeyError).getInputKeys()).toEqual(['g', 'p', 'z'])
  })

  test('an undefined key at the root reports just that key', async () => {
    const error = await buffer(['z']).catch((e: unknown) => e)
    expect((error as UndefinedKeyError).getInputKeys()).toEqual(['z'])
  })

  test('a key without a name is a parse error', async () => {
    const error = await buffer([{ key: undefined }]).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(KeyParseError)
  })
})
