import { inspect, styleText } from 'node:util'
import { border as defaultBorder, Table } from '@cliffy/table'
import type { Binding, Color, Context } from './schema.ts'

type Attr = Extract<Color, { attrs: unknown }>['attrs'][number]

// bold and dim share their reset, so an inner reset is turned back into this
// attribute's code to keep it on for the rest of the text.
// wk draws on /dev/tty, not stdout. Without validateStream: false, styleText
// drops the codes because stdout is a pipe to the widget.
function attribute(text: string, attr: Attr) {
  const [open, close] = inspect.colors[attr] ?? []
  return styleText(attr, text.replaceAll(`\x1b[${close}m`, `\x1b[${open}m`), { validateStream: false })
}

function color(text: string, givenColor: Color) {
  const ansi256 = typeof givenColor === 'number' || typeof givenColor === 'string' ? givenColor : givenColor.color
  const attrs = typeof givenColor === 'number' || typeof givenColor === 'string' ? [] : givenColor.attrs

  const colorized =
    ansi256 === -1
      ? text
      : typeof ansi256 === 'string'
        ? `${Bun.color(ansi256, 'ansi-16m')}${text}\x1b[39m`
        : `\x1b[38;5;${ansi256}m${text}\x1b[39m`

  return attrs.reduce(attribute, colorized)
}

export function getKeySymbol(ctx: Context, key: string) {
  return ctx.symbols.keys[key] ?? key
}

export function renderPrompt(ctx: Context, givenKeys: string[]) {
  const prompt = color(ctx.symbols.prompt, ctx.colors.prompt)

  const keys: string[] = []
  for (let i = 0; i < givenKeys.length; i++) {
    const key = getKeySymbol(ctx, givenKeys[i])
    keys.push(color(key, i === givenKeys.length - 1 ? ctx.colors.lastInputKey : ctx.colors.inputKeys))
  }

  return `${prompt}${keys.join(color(ctx.symbols.breadcrumb, ctx.colors.breadcrumb))}${givenKeys.length > 0 ? ' ' : ''}`
}

const plainBorder = Object.entries(defaultBorder).reduce<Record<string, string>>((acc, [k]) => {
  acc[k] = ''
  return acc
}, {})
function renderTableRow(ctx: Context, binding: Binding) {
  const icon = typeof binding.icon === 'string' ? color(binding.icon, ctx.colors.bindingIcon) : ''
  const group = binding.type === 'bindings' ? color(ctx.symbols.group, ctx.colors.group) : ''

  let desc = ''
  if (binding.type === 'command') {
    desc = color(binding.desc ?? binding.buffer, ctx.colors.bindingDescription)
  } else {
    desc = color(binding.desc, ctx.colors.bindingDescription)
  }

  return [color(getKeySymbol(ctx, binding.key), ctx.colors.bindingKey), `${icon}${group}${desc}`]
}

export function renderTable(ctx: Context, bindings: Binding[]) {
  return Table.from(bindings.map((binding) => renderTableRow(ctx, binding)))
    .border(true)
    .chars({ ...plainBorder, middle: color(ctx.symbols.separator, ctx.colors.separator) })
}
