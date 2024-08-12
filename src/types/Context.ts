import { z } from 'zod'

const ANSIColorSchema = z.union([
  z.number().int().min(-1).max(255),
  z.string().regex(/^#[0-9a-fA-F]{6}$/),
])

const ColorSchema = z.union([
  ANSIColorSchema,
  z.object({
    color: ANSIColorSchema,
    attrs: z.array(z.enum(['bold', 'dim', 'italic', 'underline', 'inverse', 'hidden', 'strikethrough'])).min(1),
  }),
])

export type Color = z.infer<typeof ColorSchema>

export const ContextSchema = z.object({
  outputDelimiter: z.string(),
  timeout: z.number().int().min(0),
  symbols: z.object({
    prompt: z.string(),
    breadcrumb: z.string(),
    separator: z.string(),
    group: z.string(),
    keys: z.record(z.string()),
  }),
  colors: z.object({
    prompt: ColorSchema,
    breadcrumb: ColorSchema,
    separator: ColorSchema,
    group: ColorSchema,
    inputKeys: ColorSchema,
    lastInputKey: ColorSchema,
    bindingKey: ColorSchema,
    bindingIcon: ColorSchema,
    bindingDescription: ColorSchema,
  }),
})

export type Context = z.infer<typeof ContextSchema>

export const defaultContext: Context = {
  outputDelimiter: '\t',
  timeout: 0,
  symbols: {
    prompt: ' ',
    breadcrumb: ' » ',
    separator: '➜',
    group: '+',
    keys: {
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
      F1: '󱊫',
      F2: '󱊬',
      F3: '󱊭',
      F4: '󱊮',
      F5: '󱊯',
      F6: '󱊰',
      F7: '󱊱',
      F8: '󱊲',
      F9: '󱊳',
      F10: '󱊴',
      F11: '󱊵',
      F12: '󱊶',
    },
  },
  colors: {
    prompt: 8,
    breadcrumb: {
      color: 8,
      attrs: ['dim'],
    },
    separator: {
      color: 8,
      attrs: ['dim'],
    },
    group: 8,
    inputKeys: 8,
    lastInputKey: -1,
    bindingKey: -1,
    bindingIcon: 8,
    bindingDescription: 8,
  },
}
