import { Command } from '@cliffy/command'
import { deepMerge } from '@std/collections'
import { join as joinPath } from '@std/path'
import { parse as parseYaml } from '@std/yaml'
import { rcFile } from 'rc-config-loader'
import { z } from 'zod'
import { XDG_CONFIG_HOME } from './const.ts'
import { AbortError, KeyParseError, UndefinedKeyError } from './errors.ts'
import { Dependencies, main } from './main.ts'
import * as tty from './tty.ts'
import { type Binding, BindingSchema } from './types/Binding.ts'
import { type Context, ContextSchema, defaultContext } from './types/Context.ts'
import { getKeySymbol } from './ui.ts'
import version from './version.generated.json' with { type: 'json' }

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

    let timeoutTimerId: number | undefined
    const handleTimeout = () => {
      tty.clear({ writer: ttyWriter })
      console.error('Timeout')
      Deno.exit(2)
    }

    const deps: Dependencies = {
      receiveKeyPress: () => tty.receiveKeyPress({ reader: ttyReader }),
      draw: (inputKeys, bindings) => tty.draw({ reader: ttyReader, writer: ttyWriter }, ctx, inputKeys, bindings),
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
      const {
        key: _,
        desc: __,
        icon: ___,
        type: ____,
        buffer,
        delimiter: definedDelimiter,
        ...rest
      } = await main(deps, bindings)

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

      tty.clear({ writer: ttyWriter })

      console.log(outputs.join(delimiter))
    } catch (e: unknown) {
      if (e instanceof AbortError) {
        tty.clear({ writer: ttyWriter })
        console.error('Abort')
        Deno.exit(1)
      } else if (e instanceof UndefinedKeyError) {
        tty.clear({ writer: ttyWriter })
        console.error(`"${e.getInputKeys().map((k) => getKeySymbol(ctx, k)).join(' ')}" is undefined`)
        Deno.exit(3)
      } else if (e instanceof KeyParseError) {
        tty.clear({ writer: ttyWriter })
        console.error('Failed to parse key', e.getKey())
        Deno.exit(4)
      } else {
        throw e
      }
    } finally {
      tty.showCursor({ writer: ttyWriter })
    }
  })

await cli.parse(Deno.args)
