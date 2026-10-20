import { describe, expect, test } from 'vitest'
import { renderWidget, type WidgetOptions } from './init.ts'

const render = (options: Partial<WidgetOptions> = {}) =>
  renderWidget({ wkPath: '/opt/wk/bin/wk', majorPrefix: 'm', bindGlobal: false, ...options })

describe('renderWidget', () => {
  test('without a leader no key is bound, but the widgets are registered', () => {
    const widget = render()
    expect(widget).not.toContain('bindkey')
    expect(widget).toContain('zle -N _wk_widget\n')
    expect(widget).toContain('zle -N _wk_widget_major\n')
  })

  test('the widget invokes the binary by the given path', () => {
    expect(render()).toContain('res=$(/opt/wk/bin/wk run ')
  })

  test('a leader is bound through the self-insert wrapper', () => {
    const widget = render({ leader: ' ' })
    expect(widget).toContain("bindkey ' ' _wk_self_insert_or_wk\n")
    expect(widget).toContain('zle -N _wk_self_insert_or_wk\n')
  })

  test('bind-global binds the widget itself, without the wrapper', () => {
    const widget = render({ leader: ' ', bindGlobal: true })
    expect(widget).toContain("bindkey ' ' _wk_widget\n")
    expect(widget).not.toContain('_wk_self_insert_or_wk')
  })

  test('a major leader gets its own binding', () => {
    const widget = render({ leader: ' ', majorLeader: ',' })
    expect(widget).toContain("bindkey ',' _wk_self_insert_or_wk_major")
    expect(widget).toContain('zle -N _wk_self_insert_or_wk_major\n')
  })

  test('bind-global applies to the major leader too', () => {
    const widget = render({ majorLeader: ',', bindGlobal: true })
    expect(widget).toContain("bindkey ',' _wk_widget_major")
    expect(widget).not.toContain('_wk_self_insert_or_wk')
  })

  test('the major prefix is passed to the major widget as --inputs', () => {
    expect(render({ majorPrefix: 'x' })).toContain("zle _wk_widget -- --inputs 'x'\n")
  })

  test('a single quote is quoted with double quotes', () => {
    expect(render({ leader: "'" })).toContain(`bindkey "'" _wk_self_insert_or_wk\n`)
    expect(render({ majorPrefix: "'" })).toContain(`zle _wk_widget -- --inputs "'"\n`)
  })

  test('the exit codes the widget handles match the ones wk run uses', () => {
    const widget = render()
    expect(widget).toMatch(/^\s+0\)$/m)
    expect(widget).toMatch(/^\s+3\|4\)$/m)
  })
})
