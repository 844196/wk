#!/usr/bin/env bats
#
# Where bindings and config come from, and what happens when they are missing.

setup() {
  load '../helpers/common'
  setup_wk_env
}

@test "with no bindings file every key is undefined" {
  wk_run --inputs 'z'

  assert_equal "$status" 5
  assert_equal "$stderr" '"z" is undefined'
}

@test "with no config file the defaults apply" {
  write_bindings <<'YAML'
- key: l
  type: command
  buffer: ls -la
YAML

  wk_run --inputs 'l'

  assert_equal "$status" 0
  # The default outputDelimiter is a tab.
  assert_equal "$output" $'\t\tls -la'
}

@test "a malformed bindings file is silently treated as empty" {
  # Records the current behaviour; see the FIXME in run.ts.
  write_bindings <<'YAML'
- key: l
   type: command
  buffer: ls -la
YAML

  wk_run --inputs 'l'

  assert_equal "$status" 5
  assert_equal "$stderr" '"l" is undefined'
}

@test "a malformed config file falls back to the defaults" {
  # Records the current behaviour; see the FIXME in run.ts.
  write_config <<'YAML'
outputDelimiter: ',
YAML
  write_bindings <<'YAML'
- key: l
  type: command
  buffer: ls -la
YAML

  wk_run --inputs 'l'

  assert_equal "$status" 0
  assert_equal "$output" $'\t\tls -la'
}

@test "global and local bindings are concatenated with global first" {
  write_bindings <<'YAML'
- key: l
  type: command
  buffer: from-global
YAML
  write_local_bindings <<'YAML'
- key: l
  type: command
  buffer: from-local
- key: x
  type: command
  buffer: local-only
YAML

  # Both files contribute, and the global definition of a shared key wins.
  wk_run --inputs 'l'
  assert_equal "$status" 0
  assert_equal "$output" $'\t\tfrom-global'

  wk_run --inputs 'x'
  assert_equal "$status" 0
  assert_equal "$output" $'\t\tlocal-only'
}

@test "local bindings alone are enough" {
  write_local_bindings <<'YAML'
- key: x
  type: command
  buffer: local-only
YAML

  wk_run --inputs 'x'

  assert_equal "$status" 0
  assert_equal "$output" $'\t\tlocal-only'
}

@test "local bindings are read from the working directory, not from elsewhere" {
  write_local_bindings <<'YAML'
- key: x
  type: command
  buffer: local-only
YAML
  mkdir -p elsewhere
  cd elsewhere || return 1

  wk_run --inputs 'x'

  assert_equal "$status" 5
}

@test "without XDG_CONFIG_HOME the global bindings come from ~/.config" {
  mkdir -p "${HOME}/.config/wk"
  cat >"${HOME}/.config/wk/bindings.yaml" <<'YAML'
- key: l
  type: command
  buffer: from-home
YAML
  unset XDG_CONFIG_HOME

  wk_run --inputs 'l'

  assert_equal "$status" 0
  assert_equal "$output" $'\t\tfrom-home'
}

@test "an empty bindings file crashes instead of being read as empty" {
  # Records the current behaviour; see the FIXME in run.ts. An empty document
  # parses to null, which .catch() never sees.
  : >"${XDG_CONFIG_HOME}/wk/bindings.yaml"

  wk_run --inputs 'l'

  assert_equal "$status" 1
  assert_stderr_contains "reading 'concat'"
}

@test "an empty local bindings file crashes later, while drawing the menu" {
  write_bindings <<'YAML'
- key: l
  type: command
  buffer: ls -la
YAML
  : >"${PWD}/wk.bindings.yaml"

  wk_run --inputs 'l'

  # concat(null) does not throw, so the null slips into the binding list and
  # only fails once a row is rendered.
  assert_equal "$status" 1
  assert_stderr_contains "reading 'icon'"
}

@test "an empty config file crashes instead of falling back to the defaults" {
  write_bindings <<'YAML'
- key: l
  type: command
  buffer: ls -la
YAML
  : >"${XDG_CONFIG_HOME}/wk/config.yaml"

  wk_run --inputs 'l'

  assert_equal "$status" 1
  assert_stderr_contains "reading 'symbols'"
}
