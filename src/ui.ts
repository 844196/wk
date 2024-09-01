import { colors } from '@cliffy/ansi/colors'
import { border as defaultBorder, Table } from '@cliffy/table'
import { Color as ColorUtil } from '@dunosaurs/color'
import { emojify } from '@lambdalisue/github-emoji'
import { type Binding } from './types/Binding.ts'
import { type Color, type Context } from './types/Context.ts'

function color(text: string, givenColor: Color) {
  const ansi256 = (typeof givenColor === 'number' || typeof givenColor === 'string') ? givenColor : givenColor.color
  const attrs = (typeof givenColor === 'number' || typeof givenColor === 'string') ? [] : givenColor.attrs

  const colorized = ansi256 === -1
    ? text
    : typeof ansi256 === 'string'
    ? colors.rgb24(text, ColorUtil.string(ansi256).rgbNumber())
    : colors.rgb8(text, ansi256)

  let attributed = colorized
  for (const attr of attrs) {
    switch (attr) {
      case 'bold':
        attributed = colors.bold(attributed)
        break
      case 'dim':
        attributed = colors.dim(attributed)
        break
      case 'italic':
        attributed = colors.italic(attributed)
        break
      case 'underline':
        attributed = colors.underline(attributed)
        break
      case 'inverse':
        attributed = colors.inverse(attributed)
        break
      case 'hidden':
        attributed = colors.hidden(attributed)
        break
      case 'strikethrough':
        attributed = colors.strikethrough(attributed)
        break
    }
  }

  return attributed
}

export function getKeySymbol(ctx: Context, key: string) {
  return ctx.symbols.keys[key] ?? key
}

export function renderPrompt(ctx: Context, givenKeys: string[]) {
  const prompt = color(ctx.symbols.prompt, ctx.colors.prompt)

  const keys: string[] = []
  for (let i = 0; i < givenKeys.length; i++) {
    const key = getKeySymbol(ctx, givenKeys[i])
    keys.push(
      color(key, i === givenKeys.length - 1 ? ctx.colors.lastInputKey : ctx.colors.inputKeys),
    )
  }

  return `${prompt}${keys.join(color(ctx.symbols.breadcrumb, ctx.colors.breadcrumb))}${givenKeys.length > 0 ? ' ' : ''}`
}

const plainBorder = Object.entries(defaultBorder)
  .reduce<Record<string, string>>(
    (acc, [k]) => {
      acc[k] = ''
      return acc
    },
    {},
  )
function renderTableRow(ctx: Context, binding: Binding) {
  const icon = typeof binding.icon === 'string' ? color(emojify(binding.icon), ctx.colors.bindingIcon) : ''
  const group = binding.type === 'bindings' ? color(ctx.symbols.group, ctx.colors.group) : ''

  let desc = ''
  if (binding.type === 'command') {
    desc = color(binding.desc ?? binding.buffer, ctx.colors.bindingDescription)
  } else {
    desc = color(binding.desc, ctx.colors.bindingDescription)
  }

  return [
    color(getKeySymbol(ctx, binding.key), ctx.colors.bindingKey),
    `${icon}${group}${desc}`,
  ]
}

export function renderTable(ctx: Context, bindings: Binding[]) {
  return Table
    .from(bindings.map((binding) => renderTableRow(ctx, binding)))
    .border(true).chars({ ...plainBorder, middle: color(ctx.symbols.separator, ctx.colors.separator) })
}
