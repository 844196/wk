import { ansi } from '@cliffy/ansi'
import { cursorPosition } from '@cliffy/ansi/ansi-escapes'
import { keypress, KeyPressEvent } from '@cliffy/keypress'
import { stripAnsiCode } from '@std/fmt/colors'
import { type KeyCode, parse as parseKeycode } from '@cliffy/keycode'

// deno-lint-ignore no-control-regex
const CURSOR_POSITION_REPLY = /\x1b\[(\d+);(\d+)R/

// @cliffy/keycode stops after one modifier digit, so a two-digit column loses the trailing R.
// deno-lint-ignore no-control-regex
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

export class TUI {
  #tty: Deno.FsFile
  #inputs: string[]
  #upOneLine: boolean = false
  #typeAhead: string = ''

  constructor(tty: Deno.FsFile, inputs: string[]) {
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
      this.#tty.writeSync(ansi.text('\n').bytes())
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
      this.#tty.writeSync(new TextEncoder().encode(cursorPosition))

      for (let reads = 0; reads < CURSOR_POSITION_READ_LIMIT; reads++) {
        const read = this.#tty.readSync(chunk)
        if (read === null || read === 0) {
          break
        }
        buffered += decoder.decode(chunk.subarray(0, read), { stream: true })

        const match = buffered.match(CURSOR_POSITION_REPLY)
        if (match) {
          this.#typeAhead += buffered.slice(0, match.index) + buffered.slice(match.index! + match[0].length)
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
    this.#tty.writeSync(ansi.cursorShow.bytes())
  }

  clear(): void {
    this.#tty.writeSync(
      ansi
        .cursorHide
        .cursorLeft.eraseLine.text('\x1b[0J')
        .cursorShow
        .bytes(),
    )
  }

  close(): void {
    this.clear()

    if (this.#upOneLine) {
      this.#tty.writeSync(ansi.cursorUp.bytes())
    }

    this.showCursor()
  }

  draw(promptLine: string, tableLines: string): void {
    this.#tty.writeSync(
      ansi
        .cursorHide
        .eraseLine.text('\x1b[0J')
        .cursorLeft.text(promptLine)
        .bytes(),
    )

    this.#tty.writeSync(
      ansi
        .text('\n')
        .text('\x1b[0J')
        .text(tableLines)
        .cursorUp(tableLines.split('\n').length)
        .cursorLeft.cursorMove(stripAnsiCode(promptLine).length, 0)
        .cursorShow
        .bytes(),
    )
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

    for await (const key of keypress()) {
      if (key.sequence !== undefined && CURSOR_POSITION_REPLY_KEY.test(key.sequence)) {
        continue
      }
      yield key
    }
  }
}
