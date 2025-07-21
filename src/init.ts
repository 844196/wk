import WIDGET_TEMPLATE from './widget.eta' with { type: 'text' }
import { Eta } from '@eta-dev/eta'
import { Command } from '@cliffy/command'

function shellQuote(key: string) {
  return key === "'" ? `"'"` : `'${key}'`
}

export const initCommand = new Command()
  .description('Render the widget for zsh.')
  .option(
    '--leader <KEY:string>',
    'Key to trigger the wk.',
  )
  .option(
    '--major-leader <KEY:string>',
    'Key to trigger the wk major-prefix menu.',
  )
  .option('--major-prefix <PREFIX:string>', 'Prefix used for entries shown when major-leader is pressed.', {
    default: 'm',
  })
  .option('--bind-global', 'Bind leader and major-leader even when the prompt buffer is not empty.')
  .example(
    'eval "$(wk init)"',
    'Register the which-key widget without any key bindings.',
  )
  .example(
    `eval "$(wk init --leader '^G')"`,
    'Bind the Ctrl+G as the leader key.',
  )
  .example(
    `eval "$(wk init --leader ' ' --major-leader ',' --major-prefix 'm')"`,
    `Bind space as the leader key and comma as the major-leader key.
The major-prefix "m" is used for the major menu.`,
  )
  .action(({ leader, majorLeader, majorPrefix, bindGlobal = false }) => {
    const eta = new Eta()

    const rendered = eta.renderString(WIDGET_TEMPLATE, {
      wk_path: Deno.execPath(),
      leader: leader === undefined ? undefined : shellQuote(leader),
      majorLeader: majorLeader === undefined ? undefined : shellQuote(majorLeader),
      majorPrefix: shellQuote(majorPrefix),
      bindGlobal,
    })

    console.log(rendered)
  })
