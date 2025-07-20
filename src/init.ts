import WIDGET_TEMPLATE from './widget.eta' with { type: 'text' }
import { Eta } from '@eta-dev/eta'
import { Command } from '@cliffy/command'

export const initCommand = new Command()
  .description('Render the widget for zsh.')
  .option(
    '--bindkey <KEY:string>',
    `
    The key to bind the widget to.
    The widget is triggered only when a key is pressed while the prompt buffer is empty.

    If you want the widget to be triggered regardless of the state of the prompt buffer, add the --bindkey-global option.
    `,
  )
  .option('--bindkey-global', 'Whether to bind the widget globally.', { default: false, depends: ['bindkey'] })
  .example('eval "$(wk init)"', 'Register the widget without binding it to a key.')
  .example(`eval "$(wk init --bindkey ',')"`, 'Register the widget and bind it to the key `,`.')
  .example(`eval "$(wk init --bindkey '^G' --bindkey-global)"`, 'Register the widget and bind it to Ctrl-G globally.')
  .action(({ bindkey, bindkeyGlobal }) => {
    const eta = new Eta()

    const rendered = eta.renderString(WIDGET_TEMPLATE, {
      wk_path: Deno.execPath(),
      bindkey,
      bindkeyGlobal,
    })

    console.log(rendered)
  })
