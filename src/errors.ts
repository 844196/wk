import { type KeyPressEvent } from '@cliffy/keypress'

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
  #key: KeyPressEvent

  constructor(key: KeyPressEvent) {
    super()
    this.#key = key
  }

  getKey(): string | undefined {
    return this.#key.key
  }
}

export class ConfigError extends Error {
  #path: string
  #detail: string

  constructor(path: string, detail: string) {
    super()
    this.#path = path
    this.#detail = detail
  }

  getPath(): string {
    return this.#path
  }

  getDetail(): string {
    return this.#detail
  }
}
