import { Command, EnumType } from '@cliffy/command'
import { join as joinPath } from '@std/path'
import { parse as parseYaml } from '@std/yaml'
import { Binding } from './types/Binding.ts'
import { XDG_CONFIG_HOME } from './const.ts'
import { TUI } from './tui.ts'
import { defaultContext, mergeContext, PartialContext } from './types/Context.ts'
import { Dependencies, main } from './main.ts'
import { getKeySymbol, renderPrompt, renderTable } from './ui.ts'
import { AbortError, KeyParseError, UndefinedKeyError } from './errors.ts'

async function loadYaml<T>(path: string) {
  const text = await Deno.readTextFile(path)
  return parseYaml(text) as T
}

function unescapeAnsi(given: string): string {
  return given.replace(/\\x([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
}

export const runCommand = new Command()
  .description('Run.')
  .type('boolOrAuto', new EnumType(['true', 'false', 'auto']))
  .option('--up-one-line [VALUE:boolOrAuto]', 'Whether to move the input up one line.', { default: 'auto' })
  .option('--inputs <KEYS:string>', '(Experimental) Simulate input keys.')
  .example('wk run', 'Run.')
  .example(
    "wk run --inputs 'g p f'",
    `Run with simulated input keys. (Space separated)
For example, this simulates pressing "g", "p", and "f".`,
  )
  .action(async ({ upOneLine, inputs }) => {
    const fetchContextWaiting = (async () => {
      const found = await loadYaml<PartialContext>(joinPath(XDG_CONFIG_HOME, 'wk', 'config.yaml')).catch(() =>
        undefined
      )
      if (found === undefined) {
        return defaultContext
      }
      return mergeContext(found)
    })()

    const fetchBindingsWaiting = Promise.all([
      loadYaml<Binding[]>(joinPath(XDG_CONFIG_HOME, 'wk', 'bindings.yaml')).catch(() => []).catch(() => []),
      loadYaml<Binding[]>(joinPath(Deno.cwd(), 'wk.bindings.yaml')).catch(() => []).catch(() => []),
    ]).then(([globalBindings, localBindings]) => [...globalBindings, ...localBindings])

    const tty = await Deno.open('/dev/tty', { read: true, write: true })
    const tui = new TUI(tty, inputs === undefined ? [] : inputs.split(' ').map(unescapeAnsi))

    try {
      tui.init(upOneLine === true ? true : upOneLine === 'true' ? true : upOneLine === 'false' ? false : 'auto')

      const [ctx, bindings] = await Promise.all([fetchContextWaiting, fetchBindingsWaiting])

      let timeoutTimerId: number | undefined
      const handleTimeout = () => {
        tui.close()
        Deno.exit(4)
      }

      const deps: Dependencies = {
        keypress: tui.keypress.bind(tui),
        draw: (inputKeys, bindings) => tui.draw(renderPrompt(ctx, inputKeys), renderTable(ctx, bindings).toString()),
        setTimeoutTimer: () => {
          if (ctx.timeout > 0) {
            timeoutTimerId = setTimeout(handleTimeout, ctx.timeout)
          }
        },
        clearTimeoutTimer: () => {
          if (timeoutTimerId !== undefined) clearTimeout(timeoutTimerId)
        },
      }

      const {
        key: _,
        desc: __,
        icon: ___,
        type: ____,
        buffer,
        delimiter: definedDelimiter,
        ...rest
      } = await main(deps, bindings)

      tui.close()

      const outputs = [buffer]
      for (const [k, v] of Object.entries(rest)) {
        switch (typeof v) {
          case 'string':
            outputs.push(`${k}:${v}`)
            break
          case 'boolean':
            outputs.push(`${k}:${JSON.stringify(v)}`)
            break
          default:
            break
        }
      }

      const delimiter = typeof definedDelimiter === 'string' ? definedDelimiter : ctx.outputDelimiter

      console.log(outputs.join(delimiter))
    } catch (e: unknown) {
      if (e instanceof AbortError) {
        tui.close()
        Deno.exit(3)
      } else if (e instanceof UndefinedKeyError) {
        tui.close()
        console.error(`"${e.getInputKeys().map((k) => getKeySymbol(defaultContext, k)).join(' ')}" is undefined`)
        Deno.exit(5)
      } else if (e instanceof KeyParseError) {
        tui.close()
        console.error('Failed to parse key', e.getKey())
        Deno.exit(6)
      } else {
        throw e
      }
    } finally {
      tui.showCursor()
    }
  })
