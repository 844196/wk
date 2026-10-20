import { describe, expect, test } from 'vitest'
import { formatOutput } from './output.ts'
import { type Command, defaultContext } from './schema.ts'

const commaContext = { ...defaultContext, outputDelimiter: ',' }

describe('formatOutput', () => {
  test('the default delimiter is a tab, and the payload is prefixed by two of them', () => {
    expect(formatOutput({ key: 'l', type: 'command', buffer: 'ls -la' }, defaultContext)).toBe('\t\tls -la')
  })

  test('key, desc, icon and type are stripped', () => {
    const command: Command = { key: 'l', desc: 'List', icon: '* ', type: 'command', buffer: 'ls' }
    expect(formatOutput(command, defaultContext)).toBe('\t\tls')
  })

  test('boolean fields are emitted as key:value, false included', () => {
    const command: Command = { key: 'l', type: 'command', buffer: 'ls', eval: true, accept: false }
    expect(formatOutput(command, defaultContext)).toBe('\t\tls\teval:true\taccept:false')
  })

  test('an arbitrary string field is passed through as key:value', () => {
    const command: Command = { key: 'l', type: 'command', buffer: 'ls', note: 'hi' }
    expect(formatOutput(command, defaultContext)).toBe('\t\tls\tnote:hi')
  })

  test('the configured outputDelimiter replaces the tab', () => {
    const command: Command = { key: 'l', type: 'command', buffer: 'ls', eval: true }
    expect(formatOutput(command, commaContext)).toBe(',,ls,eval:true')
  })

  test('a binding delimiter wins over the configured one and is not emitted itself', () => {
    const command: Command = { key: 'l', type: 'command', buffer: 'a,b', delimiter: '|', eval: true }
    expect(formatOutput(command, commaContext)).toBe('||a,b|eval:true')
  })

  test('an empty buffer still produces the two leading delimiters', () => {
    expect(formatOutput({ key: 'l', type: 'command', buffer: '' }, defaultContext)).toBe('\t\t')
  })

  test('a multibyte buffer survives unchanged', () => {
    expect(formatOutput({ key: 'l', type: 'command', buffer: 'echo 日本語 🍣' }, defaultContext)).toBe(
      '\t\techo 日本語 🍣',
    )
  })
})
