import { ansi } from '@cliffy/ansi'
import { tty as ttyFactory } from '@cliffy/ansi/tty'
import { keypress, KeyPressEvent } from '@cliffy/keypress'
import { stripAnsiCode } from '@std/fmt/colors'

export class TUI {
  #reader: Deno.FsFile
  #writer: Deno.FsFile
  #upOneLine: boolean = false

  constructor(reader: Deno.FsFile, writer: Deno.FsFile) {
    this.#reader = reader
    this.#writer = writer
  }

  init(): void {
    const pos = ttyFactory({ reader: this.#reader, writer: this.#writer }).getCursorPosition()

    // getCursorPosition() ordinary returns 1-based position.
    // However, if the process fails, it returns { x: 0, y: 0 }.
    const cursorX = Math.max(pos.x, 1)

    this.#upOneLine = cursorX > 1

    if (this.#upOneLine) {
      this.#writer.writeSync(ansi.text('\n').bytes())
    }
  }

  showCursor(): void {
    this.#writer.writeSync(ansi.cursorShow.bytes())
  }

  clear(): void {
    this.#writer.writeSync(
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
      this.#writer.writeSync(ansi.cursorUp.bytes())
    }

    this.showCursor()
  }

  draw(promptLine: string, tableLines: string): void {
    this.#writer.writeSync(
      ansi
        .cursorHide
        .eraseLine.text('\x1b[0J')
        .cursorLeft.text(promptLine)
        .bytes(),
    )

    this.#writer.writeSync(
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
