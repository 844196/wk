import { openSync, readSync, writeSync } from 'node:fs'
import { ReadStream } from 'node:tty'
import { keypress, KeyPressEvent } from '@cliffy/keypress'
import { type KeyCode, parse as parseKeycode } from '@cliffy/keycode'

const CURSOR_SHOW = '\x1b[?25h'
const CURSOR_HIDE = '\x1b[?25l'
const CURSOR_TO_LINE_START = '\x1b[G'
const CURSOR_POSITION_QUERY = '\x1b[6n'
const ERASE_LINE = '\x1b[2K'
const ERASE_BELOW = '\x1b[0J'
const cursorUp = (lines: number) => `\x1b[${lines}A`
const cursorRight = (columns: number) => (columns > 0 ? `\x1b[${columns}C` : '')

// biome-ignore lint/suspicious/noControlCharactersInRegex: ESC opens the terminal's reply.
const CURSOR_POSITION_REPLY = /\x1b\[(\d+);(\d+)R/

// @cliffy/keycode stops after one modifier digit, so a two-digit column loses the trailing R.
// biome-ignore lint/suspicious/noControlCharactersInRegex: ESC opens the key sequence.
const CURSOR_POSITION_REPLY_KEY = /^\x1b\[\d+;\d+R?$/

const CURSOR_POSITION_READ_LIMIT = 8
const CURSOR_POSITION_TIMEOUT = 1000

const ABORT_KEY = '\x03'

function parseTypeAhead(input: string): KeyCode[] {
  if (input.length === 0) {
    return []
  }

  try {
    return parseKeycode(input)
  } catch {
    return []
  }
}

// The tty is opened on its own fd rather than taken from stdin, so the cursor
// position query and the drawing never touch what cliffy reads keys from.
export interface Tty {
  setRaw(mode: boolean): void
  readSync(buffer: Uint8Array): number | null
  writeSync(data: Uint8Array): number
}

export function openTty(path = '/dev/tty'): Tty {
  const fd = openSync(path, 'r+')
  // Only for setRawMode (tcsetattr on fd); the stream is never read, so it never competes for input.
  const stream = new ReadStream(fd)
  return {
    setRaw: (mode) => void stream.setRawMode(mode),
    readSync: (buffer) => readSync(fd, buffer),
    writeSync: (data) => writeSync(fd, data),
  }
}

export class TUI {
  #tty: Tty
  #inputs: string[]
  #upOneLine: boolean = false
  #typeAhead: string = ''

  constructor(tty: Tty, inputs: string[]) {
    this.#tty = tty
    this.#inputs = inputs
  }

  init(upOneLine: boolean | 'auto'): void {
    if (upOneLine === 'auto') {
      const pos = this.#queryCursorPosition()
      this.#upOneLine = pos !== undefined && pos.x > 1
    } else {
      this.#upOneLine = upOneLine
    }

    if (this.#upOneLine) {
      this.#write('\n')
    }
  }

  // Type-ahead shares this tty with the reply, so read until the reply is whole and keep the rest.
  #queryCursorPosition(): { x: number; y: number } | undefined {
    const decoder = new TextDecoder()
    const chunk = new Uint8Array(64)
    const deadline = Date.now() + CURSOR_POSITION_TIMEOUT
    let buffered = ''

    this.#tty.setRaw(true)
    try {
      this.#write(CURSOR_POSITION_QUERY)

      for (let reads = 0; reads < CURSOR_POSITION_READ_LIMIT; reads++) {
        const read = this.#tty.readSync(chunk)
        if (read === null || read === 0) {
          break
        }
        buffered += decoder.decode(chunk.subarray(0, read), { stream: true })

        const match = buffered.match(CURSOR_POSITION_REPLY)
        if (match) {
          this.#typeAhead += buffered.replace(CURSOR_POSITION_REPLY, '')
          return { y: Number(match[1]), x: Number(match[2]) }
        }

        // A terminal that never answers would otherwise be read forever.
        if (Date.now() > deadline || buffered.includes(ABORT_KEY)) {
          break
        }
      }
    } finally {
      this.#tty.setRaw(false)
    }

    this.#typeAhead += buffered
    return undefined
  }

  showCursor(): void {
    this.#write(CURSOR_SHOW)
  }

  clear(): void {
    this.#write(CURSOR_HIDE + CURSOR_TO_LINE_START + ERASE_LINE + ERASE_BELOW + CURSOR_SHOW)
  }

  close(): void {
    this.clear()

    if (this.#upOneLine) {
      this.#write(cursorUp(1))
    }

    this.showCursor()
  }

  draw(promptLine: string, tableLines: string): void {
    this.#write(CURSOR_HIDE + ERASE_LINE + ERASE_BELOW + CURSOR_TO_LINE_START + promptLine)

    this.#write(
      `\n${ERASE_BELOW}${tableLines}` +
        cursorUp(tableLines.split('\n').length) +
        CURSOR_TO_LINE_START +
        cursorRight(Bun.stringWidth(promptLine)) +
        CURSOR_SHOW,
    )
  }

  #write(text: string): void {
    this.#tty.writeSync(new TextEncoder().encode(text))
  }

  async *keypress(): AsyncIterable<KeyPressEvent> {
    for (const input of this.#inputs) {
      for (const keycode of parseKeycode(input)) {
        yield new KeyPressEvent('keydown', keycode)
      }
    }

    // Taken off the tty by the cursor position query, so nothing else will deliver them.
    const typeAhead = this.#typeAhead
    this.#typeAhead = ''
    for (const keycode of parseTypeAhead(typeAhead)) {
      yield new KeyPressEvent('keydown', keycode)
    }

    // npm.jsr.io's generated mod.d.ts drops Keypress's [Symbol.asyncIterator], though mod.js has it.
    for await (const key of keypress() as unknown as AsyncIterable<KeyPressEvent>) {
      if (key.sequence !== undefined && CURSOR_POSITION_REPLY_KEY.test(key.sequence)) {
        continue
      }
      yield key
    }
  }
}
