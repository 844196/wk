import type { Command, Context } from './schema.ts'

// What `wk run` prints for the widget: the delimiter, then the buffer and every
// extra field as `key:value`, joined by that delimiter. A binding's own
// delimiter wins over the configured one and is not itself printed.
export function formatOutput(command: Command, ctx: Context): string {
  const { key: _, desc: __, icon: ___, type: ____, buffer, delimiter: definedDelimiter, ...rest } = command

  const delimiter = typeof definedDelimiter === 'string' ? definedDelimiter : ctx.outputDelimiter

  // The schema has already narrowed every extra field to a string or a
  // boolean, and a boolean interpolates as `true` / `false` on its own.
  const outputs = [delimiter, buffer]
  for (const [k, v] of Object.entries(rest)) {
    outputs.push(`${k}:${v}`)
  }

  return outputs.join(delimiter)
}
