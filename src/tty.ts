import { ansi } from '@cliffy/ansi'
import { tty as ttyFactory } from '@cliffy/ansi/tty'
import { type KeyCode, parse as parseKeyCode } from '@cliffy/keycode'
import { type Binding } from './types/Binding.ts'
import { type Context } from './types/Context.ts'
import { renderPrompt, renderTable } from './ui.ts'

type TTY = {
  reader: Deno.FsFile
  writer: Deno.FsFile
}

export async function* receiveKeyPress(tty: Pick<TTY, 'reader'>): AsyncGenerator<KeyCode, void> {
  while (true) {
    const data = new Uint8Array(8)

    tty.reader.setRaw(true)
    const numberOfBytesRead = await tty.reader.read(data)
    tty.reader.setRaw(false)

    if (numberOfBytesRead === null) {
      return
    }

    const keys: Array<KeyCode> = parseKeyCode(data.subarray(0, numberOfBytesRead))
    for (const key of keys) {
      yield key
    }
  }
}

export function draw(tty: TTY, ctx: Context, ks: string[], bs: Binding[]) {
  const table = renderTable(ctx, bs)

  tty.writer.writeSync(
    ansi
      .cursorHide
      .eraseLine.text('\x1b[0J')
      .cursorLeft.text(renderPrompt(ctx, ks))
      .bytes(),
  )

  const { x } = ttyFactory(tty).getCursorPosition()

  tty.writer.writeSync(
    ansi
      .text('\n')
      .text('\x1b[0J')
      .text(table.toString())
      .cursorUp(table.getBody().length)
      .cursorLeft.cursorMove(x - 1, 0)
      .cursorShow
      .bytes(),
  )
}

export function clear(tty: Pick<TTY, 'writer'>) {
  tty.writer.writeSync(
    ansi
      .cursorHide
      .cursorLeft.eraseLine.text('\x1b[0J')
      .cursorShow
      .bytes(),
  )
}

export function showCursor(tty: Pick<TTY, 'writer'>) {
  tty.writer.writeSync(ansi.cursorShow.bytes())
}
