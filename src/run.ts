import { Command, EnumType } from '@cliffy/command'
import { join as joinPath } from '@std/path'
import { parse as parseYaml } from '@std/yaml'
import { WK_CONFIG_HOME } from './const.ts'
import { TUI } from './tui.ts'
import type { Binding, ParseResult } from './schema.ts'
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

// A missing file is the only silent fallback. Anything else — a syntax error, a
// shape mismatch, EACCES, EISDIR — stops wk, so that a typo cannot quietly
// change how it behaves.
async function loadYaml<T>(path: string, fallback: T, parse: (given: unknown) => ParseResult<T>): Promise<T> {
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

  const result = parse(parsed)
  if (!result.ok) {
    throw new ConfigError(path, result.reason)
  }

  return result.value
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

// `main.ts`'s `find` always resolves a duplicated key to its first match, so
// keeping the first occurrence here (rather than e.g. the last) is what
// keeps a merge or a sort from disagreeing with that.
function firstByKey(bindings: Binding[]): Map<string, Binding> {
  const byKey = new Map<string, Binding>()
  for (const binding of bindings) {
    if (!byKey.has(binding.key)) byKey.set(binding.key, binding)
  }
  return byKey
}

// Local bindings shadow global ones sharing the same key, whole-entry — a
// group and a command never partially merge, and a group's own nested
// `bindings` never cross the boundary either. `local` goes first so
// `firstByKey` keeps its entry over global's for a shared key.
function mergeBindings(global: Binding[], local: Binding[]): Binding[] {
  return [...firstByKey([...local, ...global]).values()]
}

// A fixed locale rather than the ambient one, so key order doesn't shift
// with the user's `LANG`. `numeric` compares a digit run by value (f2
// before f10 — ICU chunks past 254 significant digits, well past any real
// key name), and `caseFirst: 'upper'` keeps `G` before `g`.
const keyCollator = new Intl.Collator('en', { numeric: true, caseFirst: 'upper' })

// Applied at every nesting level, not just the merged top level. Two
// distinct keys can collate as equal (e.g. `f2` and `f02` under `numeric`),
// and `toSorted` is stable, so an exact-string tie-break keeps their order
// from depending on where each one came from.
function sortBindings(bindings: Binding[]): Binding[] {
  return [...firstByKey(bindings).values()]
    .toSorted((a, b) => keyCollator.compare(a.key, b.key) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map((binding) => binding.type === 'bindings' ? { ...binding, bindings: sortBindings(binding.bindings) } : binding)
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
    // Loaded here rather than at the top of the file: pulling in the schema
    // costs a few milliseconds, and `wk init` — which runs from `.zshrc` on
    // every new shell — has no configuration to validate.
    const { defaultContext, parseBindings, parseContext } = await import('./schema.ts')

    const load = async () => {
      const ctx = await loadYaml(joinPath(WK_CONFIG_HOME, 'config.yaml'), defaultContext, parseContext)
      const empty: Binding[] = []
      const globalBindings = await loadYaml(joinPath(WK_CONFIG_HOME, 'bindings.yaml'), empty, parseBindings)
      const localBindings = await loadYaml(joinPath(Deno.cwd(), 'wk.bindings.yaml'), empty, parseBindings)
      return [ctx, sortBindings(mergeBindings(globalBindings, localBindings))] as const
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

      // The schema has already narrowed every extra field to a string or a
      // boolean, and a boolean interpolates as `true` / `false` on its own.
      const outputs = [delimiter, buffer]
      for (const [k, v] of Object.entries(rest)) {
        outputs.push(`${k}:${v}`)
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
