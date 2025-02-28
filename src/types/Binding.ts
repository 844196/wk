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

export type { TmpBinding as Binding }
