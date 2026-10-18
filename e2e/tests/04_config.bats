#!/usr/bin/env bats
#
# Where bindings and config come from, how the global and local files combine,
# and what happens when they are missing.

setup() {
  load '../helpers/common'
  setup_wk_env
}

@test "with no config file every key is undefined" {
  wk_run --inputs 'z'

  assert_equal "$status" 5
  assert_equal "$stderr" '"z" is undefined'
}

@test "with no config section the defaults apply" {
  write_global <<'YAML'
bindings:
  - key: l
    type: command
    buffer: ls -la
YAML

  wk_run --inputs 'l'

  assert_equal "$status" 0
  # The default outputDelimiter is a tab.
  assert_equal "$output" $'\t\tls -la'
}

@test "a config file with only a config section has no bindings" {
  write_global <<'YAML'
config:
  outputDelimiter: ','
YAML

  wk_run --inputs 'l'

  assert_equal "$status" 5
  assert_equal "$stderr" '"l" is undefined'
}

@test "sections written with nothing under them are read as absent" {
  write_global <<'YAML'
config:
bindings:
YAML

  wk_run --inputs 'l'

  assert_equal "$status" 5
  assert_equal "$stderr" '"l" is undefined'
}

@test "a malformed config file stops wk" {
  write_global <<'YAML'
bindings:
  - key: l
     type: command
    buffer: ls -la
YAML

  wk_run --inputs 'l'

  assert_equal "$status" 7
  # The wording comes from the YAML parser, so only the shape wk adds is pinned.
  assert_stderr_contains "${XDG_CONFIG_HOME}/wk/config.yaml: "
  assert_stderr_contains 'at line 3, column 10'
}

@test "an unterminated string in the config section stops wk" {
  write_global <<'YAML'
config:
  outputDelimiter: ',
bindings:
  - key: l
    type: command
    buffer: ls -la
YAML

  wk_run --inputs 'l'

  assert_equal "$status" 7
  assert_stderr_contains "${XDG_CONFIG_HOME}/wk/config.yaml: "
  assert_stderr_contains 'at line 7, column 1'
}

@test "a malformed local file stops wk" {
  write_global <<'YAML'
bindings:
  - key: l
    type: command
    buffer: ls -la
YAML
  write_local <<'YAML'
bindings:
  - key: x
     type: command
YAML

  # The local layer is not treated any more leniently than the global one.
  wk_run --inputs 'l'

  assert_equal "$status" 7
  assert_stderr_contains "${PWD}/wk.yaml: "
}

@test "a bindings section holding a mapping stops wk" {
  write_global <<'YAML'
bindings:
  foo: bar
YAML

  wk_run --inputs 'l'

  assert_equal "$status" 7
  assert_equal "$stderr" "${XDG_CONFIG_HOME}/wk/config.yaml: bindings: expected a list of bindings"
}

@test "a bindings entry without a key stops wk, naming the entry" {
  write_global <<'YAML'
bindings:
  - desc: fine
    key: a
    type: command
    buffer: ls -la
  - desc: no key here
    type: command
    buffer: ls -la
YAML

  wk_run --inputs 'a'

  assert_equal "$status" 7
  assert_equal "$stderr" \
    "${XDG_CONFIG_HOME}/wk/config.yaml: bindings[1].key: expected a key name or a digit 0-9"
}

@test "a config file holding a scalar stops wk" {
  write_global <<'YAML'
42
YAML

  wk_run --inputs 'l'

  assert_equal "$status" 7
  assert_equal "$stderr" "${XDG_CONFIG_HOME}/wk/config.yaml: expected a mapping"
}

@test "a config section holding a scalar stops wk" {
  write_global <<'YAML'
config: 42
YAML

  wk_run --inputs 'l'

  assert_equal "$status" 7
  assert_equal "$stderr" "${XDG_CONFIG_HOME}/wk/config.yaml: config: expected a mapping"
}

@test "an unknown top-level key stops wk" {
  write_global <<'YAML'
binding:
  - key: l
    type: command
    buffer: ls -la
YAML

  wk_run --inputs 'l'

  assert_equal "$status" 7
  assert_equal "$stderr" "${XDG_CONFIG_HOME}/wk/config.yaml: unknown field \"binding\""
}

@test "a v1 config.yaml, with its fields at the top level, stops wk" {
  write_global <<'YAML'
timeout: 1000
colors:
  prompt: 5
YAML

  wk_run --inputs 'l'

  assert_equal "$status" 7
  assert_equal "$stderr" "${XDG_CONFIG_HOME}/wk/config.yaml: unknown field \"timeout\", \"colors\""
}

@test "an unknown top-level key in the local file stops wk" {
  write_local <<'YAML'
timeout: 1000
YAML

  wk_run --inputs 'l'

  assert_equal "$status" 7
  assert_equal "$stderr" "${PWD}/wk.yaml: unknown field \"timeout\""
}

@test "the global file is read before the local one, so the first broken file wins" {
  write_global <<'YAML'
42
YAML
  write_local <<'YAML'
foo: bar
YAML

  wk_run --inputs 'l'

  assert_equal "$status" 7
  assert_equal "$stderr" "${XDG_CONFIG_HOME}/wk/config.yaml: expected a mapping"
}

@test "a directory in place of a config file stops wk" {
  mkdir -p "${XDG_CONFIG_HOME}/wk/config.yaml"

  wk_run --inputs 'l'

  assert_equal "$status" 7
  # The reason is the operating system's own wording.
  assert_stderr_contains "${XDG_CONFIG_HOME}/wk/config.yaml: "
  assert_stderr_contains 'directory'
}

@test "a directory in place of config.yaml is not passed over for config.yml" {
  mkdir -p "${XDG_CONFIG_HOME}/wk/config.yaml"
  cat >"${XDG_CONFIG_HOME}/wk/config.yml" <<'YAML'
bindings:
  - key: l
    type: command
    buffer: from-yml
YAML

  wk_run --inputs 'l'

  # Only a missing file falls through to the next candidate.
  assert_equal "$status" 7
  assert_stderr_contains "${XDG_CONFIG_HOME}/wk/config.yaml: "
}

@test "a path under HOME is reported with a tilde" {
  mkdir -p "${HOME}/.config/wk"
  cat >"${HOME}/.config/wk/config.yaml" <<'YAML'
bindings:
  foo: bar
YAML
  unset XDG_CONFIG_HOME

  wk_run --inputs 'l'

  assert_equal "$status" 7
  assert_equal "$stderr" '~/.config/wk/config.yaml: bindings: expected a list of bindings'
}

@test "local bindings override global ones with the same key" {
  write_global <<'YAML'
bindings:
  - key: l
    type: command
    buffer: from-global
  - key: g
    type: command
    buffer: global-only
YAML
  write_local <<'YAML'
bindings:
  - key: l
    type: command
    buffer: from-local
  - key: x
    type: command
    buffer: local-only
YAML

  # A shared key resolves to the local definition...
  wk_run --inputs 'l'
  assert_equal "$status" 0
  assert_equal "$output" $'\t\tfrom-local'

  # ...but an untouched global key still contributes...
  wk_run --inputs 'g'
  assert_equal "$status" 0
  assert_equal "$output" $'\t\tglobal-only'

  # ...alongside a local-only one.
  wk_run --inputs 'x'
  assert_equal "$status" 0
  assert_equal "$output" $'\t\tlocal-only'
}

@test "a local group replaces a global group of the same key entirely" {
  write_global <<'YAML'
bindings:
  - key: g
    type: bindings
    desc: Git (global)
    bindings:
      - key: p
        type: command
        buffer: git push
YAML
  write_local <<'YAML'
bindings:
  - key: g
    type: bindings
    desc: Git (local)
    bindings:
      - key: c
        type: command
        buffer: git commit
YAML

  # The whole group is swapped, not merged: the global group's own
  # sub-binding is gone rather than sitting alongside the local one.
  wk_run --inputs 'g p'
  assert_equal "$status" 5

  wk_run --inputs 'g c'
  assert_equal "$status" 0
  assert_equal "$output" $'\t\tgit commit'
}

@test "local bindings alone are enough" {
  write_local <<'YAML'
bindings:
  - key: x
    type: command
    buffer: local-only
YAML

  wk_run --inputs 'x'

  assert_equal "$status" 0
  assert_equal "$output" $'\t\tlocal-only'
}

@test "local bindings are read from the working directory, not from elsewhere" {
  write_local <<'YAML'
bindings:
  - key: x
    type: command
    buffer: local-only
YAML
  mkdir -p elsewhere
  cd elsewhere || return 1

  wk_run --inputs 'x'

  assert_equal "$status" 5
}

@test "without XDG_CONFIG_HOME the global file comes from ~/.config" {
  mkdir -p "${HOME}/.config/wk"
  cat >"${HOME}/.config/wk/config.yaml" <<'YAML'
bindings:
  - key: l
    type: command
    buffer: from-home
YAML
  unset XDG_CONFIG_HOME

  wk_run --inputs 'l'

  assert_equal "$status" 0
  assert_equal "$output" $'\t\tfrom-home'
}

@test "an empty config file is read as empty" {
  : >"${XDG_CONFIG_HOME}/wk/config.yaml"

  wk_run --inputs 'l'

  assert_equal "$status" 5
  assert_equal "$stderr" '"l" is undefined'
}

@test "an empty local file leaves the global file alone" {
  write_global <<'YAML'
config:
  outputDelimiter: ','
bindings:
  - key: l
    type: command
    buffer: ls -la
YAML
  : >"${PWD}/wk.yaml"

  wk_run --inputs 'l'

  assert_equal "$status" 0
  assert_equal "$output" ',,ls -la'
}

@test "a config file holding only comments is read as empty" {
  # "Empty" is wider than zero bytes: a lone newline, whitespace, comments,
  # `---`, `null` and `~` all parse to null too.
  write_global <<'YAML'
# TODO: add some bindings
YAML

  wk_run --inputs 'l'

  assert_equal "$status" 5
  assert_equal "$stderr" '"l" is undefined'
}

@test "config.yml is read when there is no config.yaml" {
  cat >"${XDG_CONFIG_HOME}/wk/config.yml" <<'YAML'
bindings:
  - key: l
    type: command
    buffer: from-yml
YAML

  wk_run --inputs 'l'

  assert_equal "$status" 0
  assert_equal "$output" $'\t\tfrom-yml'
}

@test "wk.yml is read when there is no wk.yaml" {
  cat >"${PWD}/wk.yml" <<'YAML'
bindings:
  - key: l
    type: command
    buffer: from-yml
YAML

  wk_run --inputs 'l'

  assert_equal "$status" 0
  assert_equal "$output" $'\t\tfrom-yml'
}

@test "config.yaml wins over config.yml, which is not read at all" {
  write_global <<'YAML'
bindings:
  - key: l
    type: command
    buffer: from-yaml
YAML
  # Broken on purpose: reading it at all would stop wk.
  cat >"${XDG_CONFIG_HOME}/wk/config.yml" <<'YAML'
timeout: 1000
YAML

  wk_run --inputs 'l'

  assert_equal "$status" 0
  assert_equal "$output" $'\t\tfrom-yaml'
  assert_equal "$stderr" ''
}

@test "wk.yaml wins over wk.yml, which is not read at all" {
  write_local <<'YAML'
bindings:
  - key: l
    type: command
    buffer: from-yaml
YAML
  cat >"${PWD}/wk.yml" <<'YAML'
timeout: 1000
YAML

  wk_run --inputs 'l'

  assert_equal "$status" 0
  assert_equal "$output" $'\t\tfrom-yaml'
  assert_equal "$stderr" ''
}

@test "the v1 bindings.yaml and wk.bindings.yaml are no longer read" {
  cat >"${XDG_CONFIG_HOME}/wk/bindings.yaml" <<'YAML'
- key: g
  type: command
  buffer: from-v1-global
YAML
  cat >"${PWD}/wk.bindings.yaml" <<'YAML'
- key: l
  type: command
  buffer: from-v1-local
YAML

  wk_run --inputs 'g'
  assert_equal "$status" 5
  assert_equal "$stderr" '"g" is undefined'

  wk_run --inputs 'l'
  assert_equal "$status" 5
  assert_equal "$stderr" '"l" is undefined'
}

@test "local config overrides a global field and keeps the rest" {
  write_global <<'YAML'
config:
  outputDelimiter: ','
  timeout: 500
bindings:
  - key: g
    type: bindings
    desc: Git
    bindings:
      - key: p
        type: command
        buffer: git push
YAML
  write_local <<'YAML'
config:
  outputDelimiter: ';'
YAML

  wk_run --inputs 'g p'
  assert_equal "$status" 0
  assert_equal "$output" ';;git push'

  # The global timeout still applies: the local file did not reset it to 0.
  wk_run --inputs 'g'
  assert_equal "$status" 4
}

@test "a local config section does not put the defaults back over global values" {
  write_global <<'YAML'
config:
  outputDelimiter: ','
bindings:
  - key: l
    type: command
    buffer: ls -la
YAML
  write_local <<'YAML'
config:
  timeout: 0
YAML

  wk_run --inputs 'l'

  assert_equal "$status" 0
  assert_equal "$output" ',,ls -la'
}

@test "local config alone is enough" {
  write_local <<'YAML'
config:
  outputDelimiter: ','
bindings:
  - key: l
    type: command
    buffer: ls -la
YAML

  wk_run --inputs 'l'

  assert_equal "$status" 0
  assert_equal "$output" ',,ls -la'
}
