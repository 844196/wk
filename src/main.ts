import type { KeyPressEvent } from '@cliffy/keypress'
import { PRINTABLE_ASCII } from './const.ts'
import { AbortError, KeyParseError, UndefinedKeyError } from './errors.ts'
import type { Binding, Command } from './schema.ts'

export type Dependencies = {
  keypress: () => AsyncIterable<KeyPressEvent>
  draw: (inputKeys: string[], bindings: Binding[]) => unknown
  setTimeoutTimer: () => unknown
  clearTimeoutTimer: () => unknown
}

export async function main(deps: Dependencies, bindings: Binding[]): Promise<Command> {
  const inputKeys: string[] = []
  const navigation: [Binding[], ...Binding[][]] = [bindings]
  const current = (): Binding[] => navigation[navigation.length - 1]

  deps.draw(inputKeys, bindings)
  deps.setTimeoutTimer()

  for await (const key of deps.keypress()) {
    deps.clearTimeoutTimer()

    if (typeof key.key === 'undefined') {
      throw new KeyParseError(key)
    }

    if ((key.ctrlKey && key.key === 'c') || (key.ctrlKey && key.key === 'd') || key.key === 'escape') {
      throw new AbortError()
    }

    if (key.key === 'backspace' || (key.ctrlKey && key.key === 'w')) {
      if (navigation.length === 1) {
        throw new AbortError()
      }

      inputKeys.pop()
      navigation.pop()

      deps.draw(inputKeys, current())
      deps.setTimeoutTimer()

      continue
    }

    if (key.ctrlKey && key.key === 'u') {
      if (navigation.length === 1) {
        throw new AbortError()
      }

      inputKeys.length = 0
      navigation.splice(1)

      deps.draw(inputKeys, current())
      deps.setTimeoutTimer()

      continue
    }

    if (key.ctrlKey && PRINTABLE_ASCII.test(key.key)) {
      deps.setTimeoutTimer()

      continue
    }

    const inputKey = key.shiftKey ? key.key.toUpperCase() : key.key
    inputKeys.push(inputKey)

    const match = current().find((b) => b.key === inputKey)
    if (!match) {
      throw new UndefinedKeyError(inputKeys)
    }

    if (match.type === 'bindings') {
      navigation.push(match.bindings)

      deps.draw(inputKeys, match.bindings)
      deps.setTimeoutTimer()

      continue
    }

    if (match.type === 'command') {
      return match
    }
  }

  throw new Error('Unreachable')
}
