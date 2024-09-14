import { ansi } from '@cliffy/ansi'
import { tty as ttyFactory } from '@cliffy/ansi/tty'
import { keypress, KeyPressEvent } from '@cliffy/keypress'

export class TUI {
  #reader: Deno.FsFile
  #writer: Deno.FsFile
  #upOneLine: boolean = false

  constructor(reader: Deno.FsFile, writer: Deno.FsFile) {
    this.#reader = reader
    this.#writer = writer
  }

  init(): void {
    this.#upOneLine = ttyFactory({ reader: this.#reader, writer: this.#writer }).getCursorPosition().x > 1

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

    const { x } = ttyFactory({ reader: this.#reader, writer: this.#writer }).getCursorPosition()

    this.#writer.writeSync(
      ansi
        .text('\n')
        .text('\x1b[0J')
        .text(tableLines)
        .cursorUp(tableLines.split('\n').length)
        .cursorLeft.cursorMove(x - 1, 0)
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
