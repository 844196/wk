type ANSIColor = number | string

type ColorAttribute = 'bold' | 'dim' | 'italic' | 'underline' | 'inverse' | 'hidden' | 'strikethrough'

export type Color = ANSIColor | { color: ANSIColor; attrs: [ColorAttribute, ...ColorAttribute[]] }

export type Context = {
  outputDelimiter: string
  timeout: number
  symbols: {
    prompt: string
    breadcrumb: string
    separator: string
    group: string
    keys: Record<string, string>
  }
  colors: {
    prompt: Color
    breadcrumb: Color
    separator: Color
    group: Color
    inputKeys: Color
    lastInputKey: Color
    bindingKey: Color
    bindingIcon: Color
    bindingDescription: Color
  }
}

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
