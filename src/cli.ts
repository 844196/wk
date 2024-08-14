import { Command } from '@cliffy/command'
import { deepMerge } from '@std/collections'
import { join as joinPath } from '@std/path'
import { parse as parseYaml } from '@std/yaml'
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

const cli = new Command()
  .name('wk')
  .version(version)
  .versionOption('-v, --version', 'Show the version number for this program.', { global: true })

cli
  .option('--no-validation', 'Skip validation of the configuration files.')
  .action(async ({ validation = true }) => {
    const ctx = (() => {
      const found = rcFile('wk', { configFileName: joinPath(XDG_CONFIG_HOME, 'wk', 'config') })
      if (found === undefined) {
        return defaultContext
      }

      let config
      if (validation) {
        config = ContextSchema.partial().parse(found.config)
      } else {
        config = found.config as unknown as Context
      }

      return deepMerge<Context>(defaultContext, config)
    })()

    const bindings = (() => {
      const found = parseYaml(Deno.readTextFileSync(joinPath(XDG_CONFIG_HOME, 'wk', 'bindings.yaml')))

      if (validation) {
        return z.array(BindingSchema).parse(found)
      } else {
        return found as unknown as Binding[]
      }
    })()

    const [ttyReader, ttyWriter] = await Promise.all([
      Deno.open('/dev/tty', { read: true, write: false }),
      Deno.open('/dev/tty', { read: false, write: true }),
    ])
    const tui = new TUI(ttyReader, ttyWriter)

    let timeoutTimerId: number | undefined
    const handleTimeout = () => {
      tui.close()
      console.error('Timeout')
      Deno.exit(2)
    }

    const deps: Dependencies = {
      receiveKeyPress: () => tui.receiveKeyPress(),
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
        console.error('Abort')
        Deno.exit(1)
      } else if (e instanceof UndefinedKeyError) {
        tui.close()
        console.error(`"${e.getInputKeys().map((k) => getKeySymbol(ctx, k)).join(' ')}" is undefined`)
        Deno.exit(3)
      } else if (e instanceof KeyParseError) {
        tui.close()
        console.error('Failed to parse key', e.getKey())
        Deno.exit(4)
      } else {
        throw e
      }
    } finally {
      tui.showCursor()
    }
  })

await cli.parse(Deno.args)
