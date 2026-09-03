import * as z from '@zod/mini'

// The single source of truth for what a `config.yaml` and a `bindings.yaml` may
// contain. `schemas/*.json` in a release tarball is generated from here by
// `mise run generate:schemas`, and the types below are inferred from it, so
// there is only one place to change when a field is added or removed.
//
// Every message is the expectation on its own, because `run.ts` prints it after
// the path that located it: `<file>: <path>: expected ...`. `@zod/mini` ships no
// locale, so an expectation that is not spelled out here comes out as a bare
// `Invalid input`.
function expected(what: string) {
  return { error: `expected ${what}` }
}

function singleCharacter() {
  const params = expected('a single character')
  return z.string(params).check(z.length(1, params))
}

const aString = () => z.string(expected('a string'))

// ---------------------------------------------------------------- bindings

// A key is a string, but YAML turns an unquoted digit into a number and `1` is
// a natural thing to bind, so take those too and normalise them back. The
// punctuation that YAML reads as null (`~`, `!`, `?`, `#`) cannot be recovered
// this way and still has to be quoted.
const aKey = expected('a key name or a digit 0-9')

const KeySchema = z.union([
  z.string().check(z.minLength(1, aKey)),
  z.pipe(z.int().check(z.minimum(0), z.maximum(9)), z.transform(String)),
], aKey)

// The extra keys are the `key:value` pairs of the output protocol, so anything
// the widget can carry — a string or a boolean — is allowed through.
const CommandSchema = z.catchall(
  z.object({
    key: KeySchema,
    desc: z.optional(aString()),
    icon: z.optional(aString()),
    type: z.literal('command'),
    buffer: aString(),
    delimiter: z.optional(singleCharacter()),
    // Named rather than left to the catchall, so that the published schema can
    // offer the two flags `widget.eta` actually acts on.
    eval: z.optional(z.boolean(expected('a boolean'))),
    accept: z.optional(z.boolean(expected('a boolean'))),
  }),
  z.union([z.string(), z.boolean()], expected('a string or a boolean')),
)

const GroupSchema = z.strictObject({
  key: KeySchema,
  // Unlike a command, a group has no buffer to fall back on when drawing.
  desc: aString(),
  icon: z.optional(aString()),
  type: z.literal('bindings'),
  get bindings() {
    return z.array(BindingSchema, expected('a list of bindings'))
      .check(z.minLength(1, expected('at least one binding')))
  },
}, {
  error: (issue) =>
    issue.code === 'unrecognized_keys'
      ? `unknown field ${issue.keys.map((key) => `"${key}"`).join(', ')}`
      : 'expected a group',
})

const BindingSchema: z.ZodMiniType = z.discriminatedUnion(
  'type',
  [CommandSchema, GroupSchema],
  expected('type "command" or "bindings"'),
)
z.globalRegistry.add(BindingSchema, { id: 'Binding' })

export const BindingsSchema = z.array(BindingSchema, expected('a list of bindings'))

export type Command = z.infer<typeof CommandSchema>
export type Group = Omit<z.infer<typeof GroupSchema>, 'bindings'> & { bindings: Binding[] }
export type Binding = Command | Group

// ---------------------------------------------------------------- config

// Every branch reports the same expectation, so that a number out of range
// reads as a bad colour rather than as a failed bound.
const aColor = expected('a color')

const ANSI_COLOR = [
  z.int(aColor).check(z.minimum(-1, aColor), z.maximum(255, aColor)),
  z.string(aColor).check(z.regex(/^#[0-9a-fA-F]{6}$/, aColor)),
] as const

const ColorSchema = z.union([
  ...ANSI_COLOR,
  z.object({
    color: z.union([...ANSI_COLOR], aColor),
    attrs: z.array(
      z.enum(['bold', 'dim', 'italic', 'underline', 'inverse', 'hidden', 'strikethrough']),
      expected('a list of attributes'),
    ).check(z.minLength(1, expected('at least one attribute'))),
  }),
], aColor)
z.globalRegistry.add(ColorSchema, { id: 'Color' })

const aMapping = expected('a mapping')

// YAML reads `colors:` with nothing under it as null, which means the same as
// not writing the key at all — the fold `loadYaml` already applies to a whole
// document that parses to null. Only the containers get it: an empty
// `outputDelimiter:` is a value that cannot work, not an absence.
//
// The casts are only about `z.transform` widening its output past `schema`'s
// input. The pipe hands the value straight through, so the wrapper keeps
// `schema`'s own type, including whether the field is optional.
//
// A pipe that starts with a transform has no input schema to describe, so
// `z.toJSONSchema` falls back to the output side and the published schema would
// say `null` is invalid. `nullableInputs` marks the wrappers so that
// `generate-schemas.ts` can put it back; keeping the union out of the runtime
// schema is what keeps a bad field reported as `colors.prompt: expected a
// color` instead of collapsing to `colors: expected a mapping`.
export const nullableInputs = z.registry<Record<never, never>>()

function orAbsent<T extends z.ZodMiniType>(schema: T): T {
  const wrapper = z.pipe(
    z.transform((given: unknown) => given ?? undefined),
    schema as unknown as z.ZodMiniType<unknown, NonNullable<unknown> | undefined>,
  ) as unknown as T
  nullableInputs.add(wrapper, {})
  return wrapper
}

const DEFAULT_KEY_SYMBOLS: Record<string, string> = {
  space: '␣',
  return: '⏎',
  tab: '⇥',
  up: '↑',
  down: '↓',
  right: '→',
  left: '←',
  home: '⇱',
  end: '⇲',
  pageup: '⇞',
  pagedown: '⇟',
  insert: '⎀',
  delete: '⌦',
  f1: '󱊫',
  f2: '󱊬',
  f3: '󱊭',
  f4: '󱊮',
  f5: '󱊯',
  f6: '󱊰',
  f7: '󱊱',
  f8: '󱊲',
  f9: '󱊳',
  f10: '󱊴',
  f11: '󱊵',
  f12: '󱊶',
}

export const ContextSchema = z.looseObject({
  outputDelimiter: z._default(singleCharacter(), '\t'),
  // Capped because a delay past 2^31-1 wraps around in V8 and fires almost
  // immediately, which looks like the menu closing on its own.
  timeout: z._default(
    z.int(expected('a whole number of milliseconds')).check(
      z.minimum(0, expected('0 or more')),
      z.maximum(300_000, expected('300000 (5 minutes) or less')),
    ),
    0,
  ),
  symbols: orAbsent(
    z.prefault(
      z.looseObject({
        // U+F460 is a Nerd Font glyph; spelled out so that it survives editing.
        prompt: z._default(aString(), '\uF460 '),
        breadcrumb: z._default(aString(), ' » '),
        separator: z._default(aString(), '➜'),
        group: z._default(aString(), '+'),
        // Merged into the built-in symbols rather than replacing them, so that
        // naming one key does not blank out the rest.
        keys: orAbsent(
          z.pipe(
            z.optional(z.record(z.string(), aString(), expected('a mapping of key names to symbols'))),
            z.transform((given) => ({ ...DEFAULT_KEY_SYMBOLS, ...given })),
          ),
        ),
      }, aMapping),
      {},
    ),
  ),
  colors: orAbsent(
    z.prefault(
      z.looseObject({
        prompt: z._default(ColorSchema, 8),
        breadcrumb: z._default(ColorSchema, { color: 8, attrs: ['dim'] }),
        separator: z._default(ColorSchema, { color: 8, attrs: ['dim'] }),
        group: z._default(ColorSchema, 8),
        inputKeys: z._default(ColorSchema, 8),
        lastInputKey: z._default(ColorSchema, -1),
        bindingKey: z._default(ColorSchema, -1),
        bindingIcon: z._default(ColorSchema, 8),
        bindingDescription: z._default(ColorSchema, 8),
      }, aMapping),
      {},
    ),
  ),
}, aMapping)

export type Color = z.infer<typeof ColorSchema>
export type Context = z.infer<typeof ContextSchema>

export const defaultContext: Context = ContextSchema.parse({})

// ---------------------------------------------------------------- parsing

export type ParseResult<T> = { ok: true; value: T } | { ok: false; reason: string }

// The first issue is the one reported: only a single line fits `zle -M`.
function toReason(error: { issues: readonly { path: PropertyKey[]; message: string }[] }): string {
  const issue = error.issues[0]
  const path = issue.path
    .map((segment) => typeof segment === 'number' ? `[${segment}]` : `.${String(segment)}`)
    .join('')
    .replace(/^\./, '')
  return path === '' ? issue.message : `${path}: ${issue.message}`
}

export function parseBindings(given: unknown): ParseResult<Binding[]> {
  const result = BindingsSchema.safeParse(given)
  if (!result.success) {
    return { ok: false, reason: toReason(result.error) }
  }
  // `BindingSchema` is annotated as an opaque `ZodMiniType` to break the
  // recursion between a group and its own items, so what comes back is untyped
  // even though it matched.
  return { ok: true, value: result.data as Binding[] }
}

export function parseContext(given: unknown): ParseResult<Context> {
  const result = ContextSchema.safeParse(given)
  return result.success ? { ok: true, value: result.data } : { ok: false, reason: toReason(result.error) }
}
