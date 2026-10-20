import WIDGET_TEMPLATE from './widget.eta' with { type: 'text' }
import { Eta } from 'eta'
import { Command } from '@cliffy/command'

function shellQuote(key: string) {
  return key === "'" ? `"'"` : `'${key}'`
}

export type WidgetOptions = {
  wkPath: string
  leader?: string
  majorLeader?: string
  majorPrefix: string
  bindGlobal: boolean
}

// The zsh code `wk init` prints. `wkPath` is the binary the widget runs, which
// is `process.execPath` in a compiled wk.
export function renderWidget({ wkPath, leader, majorLeader, majorPrefix, bindGlobal }: WidgetOptions): string {
  return new Eta().renderString(WIDGET_TEMPLATE, {
    wk_path: wkPath,
    leader: leader === undefined ? undefined : shellQuote(leader),
    majorLeader: majorLeader === undefined ? undefined : shellQuote(majorLeader),
    majorPrefix: shellQuote(majorPrefix),
    bindGlobal,
  })
}

export const initCommand = new Command()
  .description('Render the widget for zsh.')
  .option('--leader <KEY:string>', 'Key to trigger the wk.')
  .option('--major-leader <KEY:string>', 'Key to trigger the wk major-prefix menu.')
  .option('--major-prefix <PREFIX:string>', 'Prefix used for entries shown when major-leader is pressed.', {
    default: 'm',
  })
  .option('--bind-global', 'Bind leader and major-leader even when the prompt buffer is not empty.')
  .example('eval "$(wk init)"', 'Register the which-key widget without any key bindings.')
  .example(`eval "$(wk init --leader '^G')"`, 'Bind the Ctrl+G as the leader key.')
  .example(
    `eval "$(wk init --leader ' ' --major-leader ',' --major-prefix 'm')"`,
    `Bind space as the leader key and comma as the major-leader key.
The major-prefix "m" is used for the major menu.`,
  )
  .action(({ leader, majorLeader, majorPrefix, bindGlobal = false }) => {
    console.log(renderWidget({ wkPath: process.execPath, leader, majorLeader, majorPrefix, bindGlobal }))
  })
