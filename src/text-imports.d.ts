// `with { type: 'text' }` imports, which `bun build --compile` embeds as strings.
declare module '*.eta' {
  const text: string
  export default text
}
