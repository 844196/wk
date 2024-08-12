import { KeyCode } from '@cliffy/keycode'

export class AbortError extends Error {}

export class UndefinedKeyError extends Error {
  #inputKeys: string[]

  constructor(inputKeys: string[]) {
    super()
    this.#inputKeys = inputKeys
  }

  getInputKeys(): string[] {
    return this.#inputKeys
  }
}

export class KeyParseError extends Error {
  #key: KeyCode

  constructor(key: KeyCode) {
    super()
    this.#key = key
  }

  getKey(): KeyCode {
    return this.#key
  }
}
