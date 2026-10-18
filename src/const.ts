import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join as joinPath } from 'node:path'
import { xdgConfig } from 'xdg-basedir'

export const WK_CONFIG_HOME = joinPath(xdgConfig ?? mkdtempSync(joinPath(tmpdir(), 'wk-')), 'wk')

export const PRINTABLE_ASCII = /^[ -~]$/
