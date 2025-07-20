import { ansi } from '@cliffy/ansi'
import { keypress, type KeyPressEvent } from '@cliffy/keypress'
import { stripAnsiCode } from '@std/fmt/colors'
import { getCursorPosition } from '@cliffy/ansi/cursor-position'

export class TUI {
  #tty: Deno.FsFile
  #upOneLine: boolean = false

  constructor(tty: Deno.FsFile) {
    this.#tty = tty
  }

  init(upOneLine: boolean | 'auto'): void {
    if (upOneLine === 'auto') {
      const pos = getCursorPosition({ reader: this.#tty, writer: this.#tty })

      // getCursorPosition() ordinary returns 1-based position.
      // However, if the process fails, it returns { x: 0, y: 0 }.
      const cursorX = Math.max(pos.x, 1)

      this.#upOneLine = cursorX > 1
    } else {
      this.#upOneLine = upOneLine
    }

    if (this.#upOneLine) {
      this.#tty.writeSync(ansi.text('\n').bytes())
    }
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
    for await (const key of keypress()) {
      if (key.sequence?.match(/\[\d+;\d+R/)) { // CSI 6 n response
        continue
      }
      yield key
    }
  }
}
