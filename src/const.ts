import { xdgConfig } from 'xdg-basedir'

export const XDG_CONFIG_HOME = xdgConfig ?? Deno.makeTempDirSync()

export const PRINTABLE_ASCII = /^[ -~]$/
