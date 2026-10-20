import type { KeyPressEvent } from '@cliffy/keypress'
import { describe, expect, test } from 'vitest'
import { type Tty, TUI } from './tui.ts'

const CPR_QUERY = '\x1b[6n'

// A terminal that answers each read with the next chunk, and 0 once they run
// out, as a read on a tty in non-canonical mode with nothing pending would.
function fakeTty(chunks: string[] = []) {
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  const pending = [...chunks]
  const tty = {
    written: '',
    raw: [] as boolean[],
    reads: 0,
    setRaw(mode: boolean) {
      tty.raw.push(mode)
    },
    readSync(buffer: Uint8Array) {
      tty.reads++
      const chunk = pending.shift()
      if (chunk === undefined) return 0
      const bytes = encoder.encode(chunk)
      buffer.set(bytes)
      return bytes.length
    },
    writeSync(data: Uint8Array) {
      tty.written += decoder.decode(data)
      return data.length
    },
  } satisfies Tty & Record<string, unknown>
  return tty
}

// Takes the first `count` keys and stops there: past the simulated inputs and
// the type-ahead, `keypress` goes on to read the real stdin.
async function take(tui: TUI, count: number): Promise<Partial<KeyPressEvent>[]> {
  const keys: Partial<KeyPressEvent>[] = []
  if (count === 0) return keys
  for await (const key of tui.keypress()) {
    keys.push({ key: key.key, ctrlKey: key.ctrlKey, shiftKey: key.shiftKey })
    if (keys.length === count) break
  }
  return keys
}

describe('init', () => {
  test('up-one-line true moves the menu below the current line without asking the terminal', () => {
    const tty = fakeTty()
    new TUI(tty, []).init(true)
    expect(tty.written).toBe('\n')
    expect(tty.reads).toBe(0)
  })

  test('up-one-line false draws in place', () => {
    const tty = fakeTty()
    new TUI(tty, []).init(false)
    expect(tty.written).toBe('')
  })

  test('auto keeps the menu below a partially written line', () => {
    const tty = fakeTty(['\x1b[5;11R'])
    new TUI(tty, []).init('auto')
    expect(tty.written).toBe(`${CPR_QUERY}\n`)
    expect(tty.raw).toEqual([true, false])
  })

  test('auto draws in place at the start of a line', () => {
    const tty = fakeTty(['\x1b[5;1R'])
    new TUI(tty, []).init('auto')
    expect(tty.written).toBe(CPR_QUERY)
  })

  test('a reply split across reads is put back together', () => {
    const tty = fakeTty(['\x1b[5', ';1', '1R'])
    new TUI(tty, []).init('auto')
    expect(tty.written).toBe(`${CPR_QUERY}\n`)
  })

  test('a terminal that never answers is given up on after a bounded number of reads', () => {
    const tty = fakeTty(Array(20).fill('x'))
    new TUI(tty, []).init('auto')
    expect(tty.reads).toBe(8)
    expect(tty.written).toBe(CPR_QUERY)
    expect(tty.raw).toEqual([true, false])
  })
})

describe('type-ahead', () => {
  test('keys typed around the reply are delivered as keys, in order', async () => {
    const tui = new TUI(fakeTty(['g\x1b[5;11Rp']), [])
    tui.init('auto')
    expect(await take(tui, 2)).toEqual([
      { key: 'g', ctrlKey: false, shiftKey: false },
      { key: 'p', ctrlKey: false, shiftKey: false },
    ])
  })

  test('ctrl-c stops waiting for a reply and is delivered as a key', async () => {
    const tty = fakeTty(['\x03', 'never read'])
    const tui = new TUI(tty, [])
    tui.init('auto')
    expect(tty.reads).toBe(1)
    expect(await take(tui, 1)).toEqual([{ key: 'c', ctrlKey: true, shiftKey: false }])
  })

  test('without a reply what was read is still delivered', async () => {
    const tui = new TUI(fakeTty(['l']), [])
    tui.init('auto')
    expect(await take(tui, 1)).toEqual([{ key: 'l', ctrlKey: false, shiftKey: false }])
  })

  test('simulated inputs come before the type-ahead', async () => {
    const tui = new TUI(fakeTty(['b\x1b[5;11R']), ['a'])
    tui.init('auto')
    expect((await take(tui, 2)).map((k) => k.key)).toEqual(['a', 'b'])
  })
})

describe('simulated inputs', () => {
  test.each([
    ['\r', 'return'],
    [' ', 'space'],
    ['\t', 'tab'],
    ['\x1b[A', 'up'],
    ['\x1b', 'escape'],
    ['\x7f', 'backspace'],
    ['G', 'g'],
  ])('%j is read as %s', async (input, key) => {
    const tui = new TUI(fakeTty(), [input])
    expect((await take(tui, 1))[0].key).toBe(key)
  })

  test('an uppercase letter is read as shift and the letter', async () => {
    const tui = new TUI(fakeTty(), ['G'])
    expect(await take(tui, 1)).toEqual([{ key: 'g', ctrlKey: false, shiftKey: true }])
  })
})

describe('draw', () => {
  test('the cursor rests after the prompt, counted in columns', () => {
    const tty = fakeTty()
    new TUI(tty, []).draw('日本 ', ' a ➜ b \n c ➜ d ')
    expect(tty.written.endsWith('\x1b[2A\x1b[G\x1b[5C\x1b[?25h')).toBe(true)
  })

  test('closing after moving down one line moves back up', () => {
    const tty = fakeTty()
    const tui = new TUI(tty, [])
    tui.init(true)
    tty.written = ''
    tui.close()
    expect(tty.written).toBe('\x1b[?25l\x1b[G\x1b[2K\x1b[0J\x1b[?25h\x1b[1A\x1b[?25h')
  })
})
