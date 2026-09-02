import * as z from '@zod/mini'
import { BindingsSchema, ContextSchema, nullableInputs } from '../src/schema.ts'

// These land in the release tarball as `schemas/`, for editors to validate a
// `bindings.yaml` or a `config.yaml` against. They are generated rather than
// committed so that they cannot drift from what wk itself enforces.
//
// `io: 'input'` describes what a user may write, which is what an editor needs:
// the output side has already had defaults filled in and `key` normalised.
const MAX_SAFE = Number.MAX_SAFE_INTEGER

const options = {
  io: 'input',
  override: (
    { zodSchema, jsonSchema }: { zodSchema: z.core.$ZodType; jsonSchema: Record<string, unknown> },
  ) => {
    // zod stamps the registry id it used to name the `$defs` entry, and spells
    // out the safe-integer bounds of every `z.int()`. Neither is worth
    // publishing.
    delete jsonSchema.id
    if (jsonSchema.maximum === MAX_SAFE) delete jsonSchema.maximum
    if (jsonSchema.minimum === -MAX_SAFE) delete jsonSchema.minimum
    // `colors:`/`symbols:` written with nothing under them are an absence wk
    // honours, but zod describes these wrappers by their output side alone.
    if (nullableInputs.has(zodSchema)) jsonSchema.type = [jsonSchema.type, 'null']
  },
} as const

// Cleared first, so that a schema that was renamed or removed cannot ride
// along in the next tarball.
try {
  Deno.removeSync('dist/schemas', { recursive: true })
} catch { /* nothing to clear */ }
Deno.mkdirSync('dist/schemas', { recursive: true })
for (const [name, schema] of [['bindings', BindingsSchema], ['config', ContextSchema]] as const) {
  const path = `dist/schemas/${name}.json`
  Deno.writeTextFileSync(path, `${JSON.stringify(z.toJSONSchema(schema, options), null, 2)}\n`)
  console.log(`generated: ${path}`)
}
