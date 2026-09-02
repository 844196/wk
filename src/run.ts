import { Command, EnumType } from '@cliffy/command'
import { join as joinPath } from '@std/path'
import { parse as parseYaml } from '@std/yaml'
import { Binding } from './types/Binding.ts'
import { WK_CONFIG_HOME } from './const.ts'
import { TUI } from './tui.ts'
import { defaultContext, mergeContext, PartialContext } from './types/Context.ts'
import { Dependencies, main } from './main.ts'
import { getKeySymbol, renderPrompt, renderTable } from './ui.ts'
import { AbortError, ConfigError, KeyParseError, UndefinedKeyError } from './errors.ts'

// `@std/yaml` reports `at line N, column M` on the first line, then an excerpt
// and a caret. Only the first line fits `zle -M`, and its trailing colon
// introduces the excerpt that is being dropped.
//
// Deno's IO errors append the syscall and the path (`... : readfile '/x'`),
// which the `<path>: ` prefix already carries.
function summarize(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e)
  return message.split('\n')[0].replace(/: \w+ '.*'$/, '').replace(/:$/, '')
}

function isPartialContext(given: unknown): given is PartialContext {
  return typeof given === 'object' && given !== null && !Array.isArray(given)
}

function isBindings(given: unknown): given is Binding[] {
  return Array.isArray(given) &&
    given.every((b) => typeof b === 'object' && b !== null && typeof (b as { key?: unknown }).key === 'string')
}

// A missing file is the only silent fallback. Anything else — a syntax error, a
// shape mismatch, EACCES, EISDIR — stops wk, so that a typo cannot quietly
// change how it behaves.
async function loadYaml<T>(path: string, fallback: T, isValid: (given: unknown) => given is T): Promise<T> {
  let text: string
  try {
    text = await Deno.readTextFile(path)
  } catch (e: unknown) {
    if (e instanceof Deno.errors.NotFound) {
      return fallback
    }
    throw new ConfigError(path, summarize(e))
  }

  let parsed: unknown
  try {
    parsed = parseYaml(text)
  } catch (e: unknown) {
    throw new ConfigError(path, summarize(e))
  }

  // An empty document — blank, comments only, `---`, `null`, `~` — parses to
  // null. Treat it exactly like an absent file.
  if (parsed === null || parsed === undefined) {
    return fallback
  }

  if (!isValid(parsed)) {
    throw new ConfigError(path, 'invalid format')
  }

  return parsed
}

function abbreviateHome(path: string): string {
  const home = Deno.env.get('HOME')
  if (home === undefined || home === '') {
    return path
  }
  return path === home ? '~' : path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
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
    // Read in a fixed order and one at a time, so that the first broken file is
    // the one reported and the rest are left untouched.
    const load = async () => {
      const ctx = mergeContext(await loadYaml(joinPath(WK_CONFIG_HOME, 'config.yaml'), {}, isPartialContext))
      const globalBindings = await loadYaml(joinPath(WK_CONFIG_HOME, 'bindings.yaml'), [], isBindings)
      const localBindings = await loadYaml(joinPath(Deno.cwd(), 'wk.bindings.yaml'), [], isBindings)
      return [ctx, globalBindings.concat(localBindings)] as const
    }

    const tty = await Deno.open('/dev/tty', { read: true, write: true })
    const tui = new TUI(tty, inputs === undefined ? [] : inputs.split(' ').map(unescapeAnsi))

    try {
      tui.init(upOneLine === true ? true : upOneLine === 'true' ? true : upOneLine === 'false' ? false : 'auto')

      const [ctx, bindings] = await load()

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

      const delimiter = typeof definedDelimiter === 'string' ? definedDelimiter : ctx.outputDelimiter

      const outputs = [delimiter, buffer]
      for (const [k, v] of Object.entries(rest)) {
        switch (typeof v) {
          case 'string':
            outputs.push(`${k}:${v}`)
            break
          case 'boolean':
            outputs.push(`${k}:${v ? 'true' : 'false'}`)
            break
          default:
            break
        }
      }

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
      } else if (e instanceof ConfigError) {
        tui.close()
        console.error(`${abbreviateHome(e.getPath())}: ${e.getDetail()}`)
        Deno.exit(7)
      } else {
        throw e
      }
    } finally {
      tui.showCursor()
    }
  })
