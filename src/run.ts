import { readFile } from 'node:fs/promises'
import { join as joinPath } from 'node:path'
import { Command, EnumType } from '@cliffy/command'
import { parse as parseYaml } from '@std/yaml'
import { WK_CONFIG_HOME } from './const.ts'
import { openTty, TUI } from './tui.ts'
import type { Binding, ContextInput, ParseResult } from './schema.ts'
import { type Dependencies, main } from './main.ts'
import { getKeySymbol, renderPrompt, renderTable } from './ui.ts'
import { AbortError, ConfigError, KeyParseError, UndefinedKeyError } from './errors.ts'

// `@std/yaml` reports `at line N, column M` on the first line, then an excerpt
// and a caret. Only the first line fits `zle -M`, and its trailing colon
// introduces the excerpt that is being dropped.
//
// Node's IO errors put the errno code in front and may append the syscall
// and the path (`EACCES: permission denied, open '/x'`). The code is for
// programs, and the path is what the `<path>: ` prefix already carries.
function summarize(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e)
  return message
    .split('\n')[0]
    .replace(/^E[A-Z]+: /, '')
    .replace(/, \w+ '.*'$/, '')
    .replace(/:$/, '')
}

// A missing file is the only silent fallback. Anything else — a syntax error, a
// shape mismatch, EACCES, EISDIR — stops wk, so that a typo cannot quietly
// change how it behaves.
//
// `<base>.yaml` is read in preference to `<base>.yml`, the order docker compose
// uses. Having both is not reported: on success wk's stderr has nowhere to go.
//
// The path that was read comes back with the value, or undefined if neither
// file exists.
async function loadYaml<T>(
  base: string,
  fallback: T,
  parse: (given: unknown) => ParseResult<T>,
): Promise<{ path: string | undefined; value: T }> {
  let path = ''
  let text: string | undefined
  for (const extension of ['yaml', 'yml']) {
    path = `${base}.${extension}`
    try {
      text = await readFile(path, 'utf8')
      break
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new ConfigError(path, summarize(e))
      }
    }
  }
  if (text === undefined) {
    return { path: undefined, value: fallback }
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
    return { path, value: fallback }
  }

  const result = parse(parsed)
  if (!result.ok) {
    throw new ConfigError(path, result.reason)
  }

  return { path, value: result.value }
}

function abbreviateHome(path: string): string {
  const home = process.env.HOME
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

// Local settings override global ones field by field, so that a project can
// change one colour or one symbol and keep the rest. A colour is a single value
// even when it is written as `{ color, attrs }`, so it is replaced whole;
// `symbols.keys` is a mapping of independent entries, so it is merged per key.
// A section written with nothing under it is null, and spreads as nothing.
function mergeContext(global: ContextInput, local: ContextInput): ContextInput {
  return {
    ...global,
    ...local,
    symbols: {
      ...global.symbols,
      ...local.symbols,
      keys: { ...global.symbols?.keys, ...local.symbols?.keys },
    },
    colors: { ...global.colors, ...local.colors },
  }
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
    .map((binding) =>
      binding.type === 'bindings' ? { ...binding, bindings: sortBindings(binding.bindings) } : binding,
    )
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
    const { defaultContext, parseFile, resolveContext } = await import('./schema.ts')

    const load = async () => {
      const global = await loadYaml(joinPath(WK_CONFIG_HOME, 'config'), {}, parseFile)
      const local = await loadYaml(joinPath(process.cwd(), 'wk'), {}, parseFile)
      // The defaults are filled in after the merge, so that a default never
      // stands in for a value the global file set.
      const ctx = resolveContext(mergeContext(global.value.config ?? {}, local.value.config ?? {}))
      if (!ctx.ok) {
        // A merge that fails is the local file's doing: the global one passed
        // on its own. With no local file the merge is the global file as it
        // was, which cannot fail here.
        throw new ConfigError(local.path ?? global.path ?? joinPath(WK_CONFIG_HOME, 'config.yaml'), ctx.reason)
      }
      const bindings = sortBindings(mergeBindings(global.value.bindings ?? [], local.value.bindings ?? []))
      return [ctx.value, bindings] as const
    }

    const tty = openTty()
    const tui = new TUI(tty, inputs === undefined ? [] : inputs.split(' ').map(unescapeAnsi))

    try {
      tui.init(upOneLine === true ? true : upOneLine === 'true' ? true : upOneLine === 'false' ? false : 'auto')

      const [ctx, bindings] = await load()

      let timeoutTimerId: ReturnType<typeof setTimeout> | undefined
      const handleTimeout = () => {
        tui.close()
        process.exit(4)
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
        process.exit(3)
      } else if (e instanceof UndefinedKeyError) {
        tui.close()
        console.error(
          `"${e
            .getInputKeys()
            .map((k) => getKeySymbol(defaultContext, k))
            .join(' ')}" is undefined`,
        )
        process.exit(5)
      } else if (e instanceof KeyParseError) {
        tui.close()
        console.error('Failed to parse key', e.getKey())
        process.exit(6)
      } else if (e instanceof ConfigError) {
        tui.close()
        console.error(`${abbreviateHome(e.getPath())}: ${e.getDetail()}`)
        process.exit(7)
      } else {
        throw e
      }
    } finally {
      tui.showCursor()
    }
  })
