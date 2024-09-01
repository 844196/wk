import { z } from 'zod'

type Base = {
  key: string
  desc?: string
  icon?: string
}

export type Command = Base & {
  type: 'command'
  buffer: string
  [key: string]: string | boolean
}

type Bindings = Base & {
  type: 'bindings'
  desc: string
  bindings: TmpBinding[]
}

type TmpBinding = Command | Bindings

// --------------------------------------------------------------------------------

const BaseSchema = z.object({
  key: z.string().min(1),
  icon: z.string().optional(),
})

const CommandSchema = BaseSchema
  .extend({
    type: z.literal('command'),
    desc: z.string().optional(),
    buffer: z.string(),
  })
  .and(z.record(z.string().or(z.boolean())))

const BindingsSchema: z.ZodType<Bindings> = z.lazy(() =>
  BaseSchema.extend({
    type: z.literal('bindings'),
    desc: z.string(),
    bindings: z.array(BindingSchema).min(1),
  })
)

export const BindingSchema = z.union([
  CommandSchema,
  BindingsSchema,
])

export type Binding = z.infer<typeof BindingSchema>
