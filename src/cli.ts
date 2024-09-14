import { Command } from '@cliffy/command'
import { deepMerge } from '@std/collections'
import { join as joinPath } from '@std/path'
import { rcFile } from 'rc-config-loader'
import { z } from 'zod'
import { XDG_CONFIG_HOME } from './const.ts'
import { AbortError, KeyParseError, UndefinedKeyError } from './errors.ts'
import { Dependencies, main } from './main.ts'
import { TUI } from './tui.ts'
import { type Binding, BindingSchema } from './types/Binding.ts'
import { type Context, ContextSchema, defaultContext } from './types/Context.ts'
import { getKeySymbol } from './ui.ts'
import version from './version.generated.json' with { type: 'json' }
import { renderPrompt } from './ui.ts'
import { renderTable } from './ui.ts'
import { Eta } from '@eta-dev/eta'
import widgetTemplate from './widget.generated.json' with { type: 'json' }

const cli = new Command()
  .name('wk')
  .version(version)
  .versionOption('-v, --version', 'Show the version number for this program.', { global: true })

const widget = new Command()
  .description('Outputs shell widget source code.')
  .arguments('<shell:string>')
  .option('--bindkey <key>', 'Bind the widget to the key.', { default: '^G' })
  .option('--no-bindkey', 'Do not bind the widget to the key.')
  .action(({ bindkey }) => {
    const eta = new Eta()

    const rendered = eta.renderString(widgetTemplate, {
      wk_path: Deno.execPath(),
      bindkey,
    })

    console.log(rendered)
  })

const run = new Command()
  .description('Run the workflow.')
  .option('--no-validation', 'Skip validation of the configuration files.')
  .action(async ({ validation: shouldValidation = true }) => {
    const ctx = (() => {
      const found = rcFile('wk', { configFileName: joinPath(XDG_CONFIG_HOME, 'wk', 'config') })
      if (found === undefined) {
        return defaultContext
      }

      let config
      if (shouldValidation) {
        config = ContextSchema.deepPartial().parse(found.config) as Partial<Context>
      } else {
        config = found.config as unknown as Context
      }

      return deepMerge<Context>(defaultContext, config)
    })()

    const bindings = (() => {
      const foundGlobal = rcFile('wk', { configFileName: joinPath(XDG_CONFIG_HOME, 'wk', 'bindings') })
      let globalBindings: Binding[]
      if (foundGlobal === undefined) {
        globalBindings = []
      } else {
        if (shouldValidation) {
          globalBindings = z.array(BindingSchema).parse(foundGlobal.config)
        } else {
          globalBindings = foundGlobal.config as unknown as Binding[]
        }
      }

      const foundLocal = rcFile('wk', { configFileName: 'wk.bindings' })
      let localBindings: Binding[]
      if (foundLocal === undefined) {
        localBindings = []
      } else {
        if (shouldValidation) {
          localBindings = z.array(BindingSchema).parse(foundLocal.config)
        } else {
          localBindings = foundLocal.config as unknown as Binding[]
        }
      }

      return [...globalBindings, ...localBindings]
    })()

    const [ttyReader, ttyWriter] = await Promise.all([
      Deno.open('/dev/tty', { read: true, write: false }),
      Deno.open('/dev/tty', { read: false, write: true }),
    ])
    const tui = new TUI(ttyReader, ttyWriter)

    let timeoutTimerId: number | undefined
    const handleTimeout = () => {
      tui.close()
      Deno.exit(4)
    }

    const deps: Dependencies = {
      keypress: tui.keypress,
      draw: (inputKeys, bindings) => tui.draw(renderPrompt(ctx, inputKeys), renderTable(ctx, bindings).toString()),
      setTimeoutTimer: () => {
        if (ctx.timeout > 0) {
          timeoutTimerId = setTimeout(handleTimeout, ctx.timeout)
        }
      },
      clearTimeoutTimer: () => {
        if (timeoutTimerId !== undefined) clearTimeout(timeoutTimerId)
      },
    }

    try {
      tui.init()

      const {
        key: _,
        desc: __,
        icon: ___,
        type: ____,
        buffer,
        delimiter: definedDelimiter,
        ...rest
      } = await main(deps, bindings)

      tui.close()

      const outputs = [buffer]
      for (const [k, v] of Object.entries(rest)) {
        switch (typeof v) {
          case 'string':
            outputs.push(`${k}:${v}`)
            break
          case 'boolean':
            outputs.push(`${k}:${JSON.stringify(v)}`)
            break
          default:
            break
        }
      }

      const delimiter = typeof definedDelimiter === 'string' ? definedDelimiter : ctx.outputDelimiter

      console.log(outputs.join(delimiter))
    } catch (e: unknown) {
      if (e instanceof AbortError) {
        tui.close()
        Deno.exit(3)
      } else if (e instanceof UndefinedKeyError) {
        tui.close()
        console.error(`"${e.getInputKeys().map((k) => getKeySymbol(ctx, k)).join(' ')}" is undefined`)
        Deno.exit(5)
      } else if (e instanceof KeyParseError) {
        tui.close()
        console.error('Failed to parse key', e.getKey())
        Deno.exit(6)
      } else {
        throw e
      }
    } finally {
      tui.showCursor()
    }
  })

await cli
  .command('widget', widget)
  .command('run', run)
  .parse(Deno.args)
