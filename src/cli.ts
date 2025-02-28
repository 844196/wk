import { Eta } from '@eta-dev/eta'
import { deepMerge } from '@std/collections'
import { join as joinPath } from '@std/path'
import { XDG_CONFIG_HOME } from './const.ts'
import { AbortError, KeyParseError, UndefinedKeyError } from './errors.ts'
import { type Dependencies, main } from './main.ts'
import { TUI } from './tui.ts'
import { type Binding } from './types/Binding.ts'
import { type Context, defaultContext } from './types/Context.ts'
import { getKeySymbol, renderPrompt, renderTable } from './ui.ts'
import { parse as parseYaml } from '@std/yaml'
import { parseArgs } from 'node:util'

const { values: opts } = parseArgs({
  options: {
    version: {
      type: 'boolean',
      short: 'v',
    },
    init: {
      type: 'string',
    },
  },
})

if (opts.version) {
  console.log(Deno.env.get('WK_VERSION') ?? 'unknown')
  Deno.exit(0)
}

if (opts.init !== undefined) {
  const eta = new Eta({ views: import.meta.dirname })

  const rendered = eta.render('./widget', {
    wk_path: Deno.execPath(),
    bindkey: opts.init,
  })

  console.log(rendered)

  Deno.exit(0)
}

async function loadYaml<T>(path: string) {
  const text = await Deno.readTextFile(path)
  return parseYaml(text) as T
}

const fetchContextWaiting = (async () => {
  const found = await loadYaml<Context>(joinPath(XDG_CONFIG_HOME, 'wk', 'config.yaml')).catch(() => undefined)
  if (found === undefined) {
    return defaultContext
  }
  return deepMerge<Context>(defaultContext, found)
})()

const loadBindings = (path: string) => loadYaml<Binding[]>(path).catch(() => [])
const fetchGlobalBindingsWaiting = loadBindings(joinPath(XDG_CONFIG_HOME, 'wk', 'bindings.yaml'))
const fetchLocalBindingsWaiting = loadBindings(joinPath(Deno.cwd(), 'wk.bindings.yaml'))

const [ttyReader, ttyWriter] = await Promise.all([
  Deno.open('/dev/tty', { read: true, write: false }),
  Deno.open('/dev/tty', { read: false, write: true }),
])
const tui = new TUI(ttyReader, ttyWriter)

try {
  tui.init()

  const ctx = await fetchContextWaiting

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

  const [globalBindings, localBindings] = await Promise.all([fetchGlobalBindingsWaiting, fetchLocalBindingsWaiting])
  const bindings = [...globalBindings, ...localBindings]

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
    console.error(`"${e.getInputKeys().map((k) => getKeySymbol(defaultContext, k)).join(' ')}" is undefined`)
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
