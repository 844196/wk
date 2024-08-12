import { type KeyCode } from '@cliffy/keycode'
import { PRINTABLE_ASCII } from './const.ts'
import { AbortError, KeyParseError, UndefinedKeyError } from './errors.ts'
import { type Binding, type Command } from './types/Binding.ts'

export type Dependencies = {
  receiveKeyPress: () => AsyncGenerator<KeyCode, void>
  draw: (inputKeys: string[], bindings: Binding[]) => unknown
  setTimeoutTimer: () => unknown
  clearTimeoutTimer: () => unknown
}

export async function main(deps: Dependencies, bindings: Binding[]): Promise<Command> {
  const inputKeys: string[] = []
  const navigation: [Binding[], ...(Binding[])[]] = [bindings]

  deps.draw(inputKeys, bindings)
  deps.setTimeoutTimer()

  for await (const key of deps.receiveKeyPress()) {
    deps.clearTimeoutTimer()

    if (typeof key.name === 'undefined') {
      throw new KeyParseError(key)
    }

    if ((key.ctrl && key.name === 'c') || (key.ctrl && key.name === 'd') || (key.name === 'escape')) {
      throw new AbortError()
    }

    if (key.name === 'backspace' || (key.ctrl && key.name === 'w')) {
      if (navigation.length === 1) {
        throw new AbortError()
      }

      inputKeys.pop()
      navigation.pop()

      deps.draw(inputKeys, navigation.at(-1)!)
      deps.setTimeoutTimer()

      continue
    }

    if (key.ctrl && key.name === 'u') {
      if (navigation.length === 1) {
        throw new AbortError()
      }

      inputKeys.length = 0
      navigation.splice(1)

      deps.draw(inputKeys, navigation.at(-1)!)
      deps.setTimeoutTimer()

      continue
    }

    if (key.ctrl && PRINTABLE_ASCII.test(key.name)) {
      deps.setTimeoutTimer()

      continue
    }

    const inputKey = key.shift ? key.name.toUpperCase() : key.name
    inputKeys.push(inputKey)

    const match = navigation.at(-1)!.find((b) => b.key === inputKey)
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
