import { Command } from '@cliffy/command'
import VERSION from '../VERSION' with { type: 'text' }
import { initCommand } from './init.ts'
import { runCommand } from './run.ts'

await new Command()
  .name('wk')
  .description('which-key like menu for zsh.')
  .version(VERSION.trim())
  .command('init', initCommand)
  .command('run', runCommand)
  .parse()
