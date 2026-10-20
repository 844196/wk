import { readFile } from 'node:fs/promises'
import { ConfigError } from './errors.ts'
import {
  type Binding,
  type Context,
  type ContextInput,
  defaultContext,
  type ParseResult,
  parseFile,
  resolveContext,
} from './schema.ts'
import { getKeySymbol } from './ui.ts'

// Only the first line of a message fits `zle -M`, and a trailing colon would
// introduce whatever follows it.
//
// Node's IO errors put the errno code in front and may append the syscall
// and the path (`EACCES: permission denied, open '/x'`). The code is for
// programs, and the path is what the `<path>: ` prefix already carries.
export function summarize(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e)
  return message
    .split('\n')[0]
    .replace(/^E[A-Z]+: /, '')
    .replace(/, \w+ '.*'$/, '')
    .replace(/:$/, '')
}

// One configuration file to read: the first of `candidates` that exists. A
// file the user named is `required`, and its absence is an error like any
// other, so that a mistyped path cannot quietly fall back to an empty layer.
export type ConfigFile = { candidates: string[]; required: boolean }

// `<base>.yaml` is read in preference to `<base>.yml`, the order docker compose
// uses. Having both is not reported: on success wk's stderr has nowhere to go.
export function defaultFile(base: string): ConfigFile {
  return { candidates: [`${base}.yaml`, `${base}.yml`], required: false }
}

// A named path is read as written, with no extension tried after it.
export function givenFile(path: string): ConfigFile {
  return { candidates: [path], required: true }
}

// `--config` replaces both default files rather than adding to them: a caller
// that names its files is the one deciding what the menu holds.
export function configFiles(given: string[], defaults: { globalBase: string; localBase: string }): ConfigFile[] {
  return given.length > 0 ? given.map(givenFile) : [defaultFile(defaults.globalBase), defaultFile(defaults.localBase)]
}

// A missing default file is the only silent fallback. Anything else — a syntax
// error, a shape mismatch, EACCES, EISDIR — stops wk, so that a typo cannot
// quietly change how it behaves.
//
// The path that was read comes back with the value, or undefined if no
// candidate exists.
export async function loadYaml<T>(
  file: ConfigFile,
  fallback: T,
  parse: (given: unknown) => ParseResult<T>,
): Promise<{ path: string | undefined; value: T }> {
  let path = ''
  let text: string | undefined
  for (const candidate of file.candidates) {
    path = candidate
    try {
      text = await readFile(path, 'utf8')
      break
    } catch (e: unknown) {
      if (file.required || (e as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new ConfigError(path, summarize(e))
      }
    }
  }
  if (text === undefined) {
    return { path: undefined, value: fallback }
  }

  let parsed: unknown
  try {
    parsed = Bun.YAML.parse(text)
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
export function mergeBindings(global: Binding[], local: Binding[]): Binding[] {
  return [...firstByKey([...local, ...global]).values()]
}

// Local settings override global ones field by field, so that a project can
// change one colour or one symbol and keep the rest. A colour is a single value
// even when it is written as `{ color, attrs }`, so it is replaced whole;
// `symbols.keys` is a mapping of independent entries, so it is merged per key.
// A section written with nothing under it is null, and spreads as nothing.
export function mergeContext(global: ContextInput, local: ContextInput): ContextInput {
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

// ASCII only, like which-key's %w: a symbol such as ⏎ or a Nerd Font glyph
// is not a letter to the reader, even where Unicode says it is one.
const ALNUM = /^[A-Za-z0-9]+$/

// Same order as which-key.nvim's default sorters: commands before groups
// ("group"), then alphanumeric keys before the rest ("alphanum"), then the
// symbol the menu shows. Applied at every nesting level, not just the merged
// top level. Two distinct keys can collate as equal (e.g. `f2` and `f02`
// under `numeric`), and `toSorted` is stable, so an exact-string tie-break
// keeps their order from depending on where each one came from.
export function sortBindings(ctx: Context, bindings: Binding[]): Binding[] {
  const typeRank = (b: Binding) => (b.type === 'bindings' ? 1 : 0)
  const alnumRank = (b: Binding) => (ALNUM.test(getKeySymbol(ctx, b.key)) ? 0 : 1)
  return [...firstByKey(bindings).values()]
    .toSorted(
      (a, b) =>
        typeRank(a) - typeRank(b) ||
        alnumRank(a) - alnumRank(b) ||
        keyCollator.compare(getKeySymbol(ctx, a.key), getKeySymbol(ctx, b.key)) ||
        (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
    )
    .map((binding) =>
      binding.type === 'bindings' ? { ...binding, bindings: sortBindings(ctx, binding.bindings) } : binding,
    )
}

// The files are layered in the order given: a later one overrides an earlier
// one, by the rules of `mergeContext` and `mergeBindings`. They are read one at
// a time, so that the first broken file is the one reported and the rest are
// left untouched.
export async function loadConfig(files: ConfigFile[]): Promise<{ ctx: Context; bindings: Binding[] }> {
  let config: ContextInput = {}
  let bindings: Binding[] = []
  let ctx = defaultContext
  for (const file of files) {
    const loaded = await loadYaml(file, {}, parseFile)
    config = mergeContext(config, loaded.value.config ?? {})
    bindings = mergeBindings(bindings, loaded.value.bindings ?? [])

    // The defaults are filled in after each merge rather than per file, so
    // that a default never stands in for a value an earlier file set. Every
    // file has passed on its own, so a merge that fails is the doing of the
    // file just laid on, and checking after each one is what names it.
    const resolved = resolveContext(config)
    if (!resolved.ok) {
      throw new ConfigError(loaded.path ?? file.candidates[0], resolved.reason)
    }
    ctx = resolved.value
  }

  return { ctx, bindings: sortBindings(ctx, bindings) }
}
