import { join as joinPath } from 'node:path'
import { Command, EnumType } from '@cliffy/command'
import { WK_CONFIG_HOME } from './const.ts'
import { openTty, TUI } from './tui.ts'
import { type Dependencies, main } from './main.ts'
import { formatOutput } from './output.ts'
import { getKeySymbol, renderPrompt, renderTable } from './ui.ts'
import { AbortError, ConfigError, KeyParseError, UndefinedKeyError } from './errors.ts'

function abbreviateHome(path: string): string {
  const home = process.env.HOME
  if (home === undefined || home === '') {
    return path
  }
  return path === home ? '~' : path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
}

function unescapeAnsi(given: string): string {
  return given.replace(/\\x([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
}

export const runCommand = new Command()
  .description('Run.')
  .type('boolOrAuto', new EnumType(['true', 'false', 'auto']))
  .option('--up-one-line [VALUE:boolOrAuto]', 'Whether to move the input up one line.', { default: 'auto' })
  .option('--inputs <KEYS:string>', '(Experimental) Simulate input keys.')
  .option('-c, --config <FILE:file>', 'Read FILE instead of the global and local files. Repeat to layer files.', {
    collect: true,
  })
  .example('wk run', 'Run.')
  .example(
    'wk run -c ~/.config/wk/config.yaml -c ~/.config/wk/tmux.yaml',
    'Run with only these files, the later one laid over the earlier one.',
  )
  .example(
    "wk run --inputs 'g p f'",
    `Run with simulated input keys. (Space separated)
For example, this simulates pressing "g", "p", and "f".`,
  )
  .action(async ({ upOneLine, inputs, config }) => {
    // Loaded here rather than at the top of the file: pulling in the schema
    // costs a few milliseconds, and `wk init` — which runs from `.zshrc` on
    // every new shell — has no configuration to validate.
    const { defaultContext } = await import('./schema.ts')
    const { configFiles, loadConfig } = await import('./config.ts')

    const tty = openTty()
    const tui = new TUI(tty, inputs === undefined ? [] : inputs.split(' ').map(unescapeAnsi))

    try {
      tui.init(upOneLine === true ? true : upOneLine === 'true' ? true : upOneLine === 'false' ? false : 'auto')

      const { ctx, bindings } = await loadConfig(
        configFiles(config ?? [], {
          globalBase: joinPath(WK_CONFIG_HOME, 'config'),
          localBase: joinPath(process.cwd(), 'wk'),
        }),
      )

      let timeoutTimerId: ReturnType<typeof setTimeout> | undefined
      const handleTimeout = () => {
        tui.close()
        process.exit(4)
      }

      const deps: Dependencies = {
        keypress: tui.keypress.bind(tui),
        draw: (inputKeys, bindings) => tui.draw(renderPrompt(ctx, inputKeys), renderTable(ctx, bindings)),
        setTimeoutTimer: () => {
          if (ctx.timeout > 0) {
            timeoutTimerId = setTimeout(handleTimeout, ctx.timeout)
          }
        },
        clearTimeoutTimer: () => {
          if (timeoutTimerId !== undefined) clearTimeout(timeoutTimerId)
        },
      }

      const command = await main(deps, bindings)

      tui.close()

      console.log(formatOutput(command, ctx))
    } catch (e: unknown) {
      if (e instanceof AbortError) {
        tui.close()
        process.exit(3)
      } else if (e instanceof UndefinedKeyError) {
        tui.close()
        console.error(
          `"${e
            .getInputKeys()
            .map((k) => getKeySymbol(defaultContext, k))
            .join(' ')}" is undefined`,
        )
        process.exit(5)
      } else if (e instanceof KeyParseError) {
        tui.close()
        console.error('Failed to parse key', e.getKey())
        process.exit(6)
      } else if (e instanceof ConfigError) {
        tui.close()
        console.error(`${abbreviateHome(e.getPath())}: ${e.getDetail()}`)
        process.exit(7)
      } else {
        throw e
      }
    } finally {
      tui.showCursor()
    }
  })
