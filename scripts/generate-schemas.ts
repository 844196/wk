import * as z from '@zod/mini'
import { FileSchema, nullableInputs } from '../src/schema.ts'

// This lands in the release tarball as `schemas/config.json`, for editors to
// validate a `config.yaml` or a `wk.yaml` against — the two share one shape. It
// is generated rather than committed so that it cannot drift from what wk
// itself enforces.
//
// `io: 'input'` describes what a user may write, which is what an editor needs:
// the output side has already had defaults filled in and `key` normalised.
const MAX_SAFE = Number.MAX_SAFE_INTEGER

const options = {
  io: 'input',
  override: ({ zodSchema, jsonSchema }: { zodSchema: z.core.$ZodType; jsonSchema: Record<string, unknown> }) => {
    // zod stamps the registry id it used to name the `$defs` entry, and spells
    // out the safe-integer bounds of every `z.int()`. Neither is worth
    // publishing.
    delete jsonSchema.id
    if (jsonSchema.maximum === MAX_SAFE) delete jsonSchema.maximum
    if (jsonSchema.minimum === -MAX_SAFE) delete jsonSchema.minimum
    // `config:`/`colors:`/… written with nothing under them are an absence wk
    // honours, but zod describes these wrappers by their output side alone.
    if (nullableInputs.has(zodSchema)) jsonSchema.type = [jsonSchema.type, 'null']
  },
} as const

// Cleared first, so that a schema that was renamed or removed cannot ride
// along in the next tarball.
try {
  Deno.removeSync('dist/schemas', { recursive: true })
} catch {
  /* nothing to clear */
}
Deno.mkdirSync('dist/schemas', { recursive: true })
const path = 'dist/schemas/config.json'
Deno.writeTextFileSync(path, `${JSON.stringify(z.toJSONSchema(FileSchema, options), null, 2)}\n`)
console.log(`generated: ${path}`)
