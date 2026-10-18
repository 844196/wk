import { Command } from '@cliffy/command'
import { initCommand } from './init.ts'
import { runCommand } from './run.ts'

// Replaced by `bun build --define`. `bun src/wk.ts` runs without it.
const version = typeof BUILD_VERSION === 'string' ? BUILD_VERSION : 'unknown'
const buildTime = typeof BUILD_TIME === 'string' ? BUILD_TIME : 'unknown'

await new Command()
  .name('wk')
  .description('which-key like menu for zsh.')
  .version(version)
  .meta('Built', buildTime)
  .command('init', initCommand)
  .command('run', runCommand)
  .parse()

// cliffy's keypress leaves a `readable` listener on process.stdin, which keeps
// the event loop alive after the action.
process.exit(0)
