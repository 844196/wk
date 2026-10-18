import { mkdtempSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join as joinPath } from 'node:path'

// The XDG Base Directory spec treats an empty XDG_CONFIG_HOME as unset.
const xdgConfig = process.env.XDG_CONFIG_HOME || (homedir() ? joinPath(homedir(), '.config') : undefined)

export const WK_CONFIG_HOME = joinPath(xdgConfig ?? mkdtempSync(joinPath(tmpdir(), 'wk-')), 'wk')

export const PRINTABLE_ASCII = /^[ -~]$/
