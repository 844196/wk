import { xdgConfig } from 'xdg-basedir'
import { join as joinPath } from '@std/path'

export const WK_CONFIG_HOME = joinPath(xdgConfig ?? Deno.makeTempDirSync(), 'wk')

export const PRINTABLE_ASCII = /^[ -~]$/
