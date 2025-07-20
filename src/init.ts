import WIDGET_TEMPLATE from './widget.eta' with { type: 'text' }
import { Eta } from '@eta-dev/eta'
import { Command } from '@cliffy/command'

export const initCommand = new Command()
  .description('Render the widget for zsh.')
  .option('--bindkey <KEY:string>', 'The key to bind the widget to.')
  .example('eval "$(wk init)"', 'Register the widget without binding it to a key.')
  .example(`eval "$(wk init --bindkey '^G')"`, 'Register the widget and bind it to Ctrl-G.')
  .action(({ bindkey }) => {
    const eta = new Eta()

    const rendered = eta.renderString(WIDGET_TEMPLATE, {
      wk_path: Deno.execPath(),
      bindkey,
    })

    console.log(rendered)
  })
