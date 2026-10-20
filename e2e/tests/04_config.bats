#!/usr/bin/env bats
#
# Where bindings and config come from, how the global and local files combine,
# and what happens when they are missing. Reading and merging a given file is in
# src/config.test.ts; this covers where the files are looked for and how a
# failure is reported.

setup() {
  load '../helpers/common'
  setup_wk_env
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

@test "--config replaces the global and local files, layering repeats in order" {
  write_global <<'YAML'
bindings:
  - key: g
    type: command
    buffer: from-global
YAML
  write_local <<'YAML'
bindings:
  - key: l
    type: command
    buffer: from-local
YAML
  cat >base.yaml <<'YAML'
config:
  outputDelimiter: ','
bindings:
  - key: t
    type: command
    buffer: from-base
YAML
  cat >tmux.yaml <<'YAML'
bindings:
  - key: t
    type: command
    buffer: from-tmux
YAML

  wk_run --config base.yaml -c tmux.yaml --inputs 't'
  assert_equal "$status" 0
  assert_equal "$output" ',,from-tmux'

  wk_run --config base.yaml --inputs 'g'
  assert_equal "$status" 5

  wk_run --config base.yaml --inputs 'l'
  assert_equal "$status" 5
}

@test "a missing file named by --config stops wk" {
  write_global <<'YAML'
bindings:
  - key: l
    type: command
    buffer: ls
YAML

  wk_run --config tmux.yaml --inputs 'l'

  assert_equal "$status" 7
  assert_equal "$stderr" 'tmux.yaml: no such file or directory'
}
