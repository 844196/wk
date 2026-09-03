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

@test "a malformed bindings file stops wk" {
  write_bindings <<'YAML'
- key: l
   type: command
  buffer: ls -la
YAML

  wk_run --inputs 'l'

  assert_equal "$status" 7
  # The wording comes from the YAML parser, so only the shape wk adds is pinned.
  assert_stderr_contains "${XDG_CONFIG_HOME}/wk/bindings.yaml: "
  assert_stderr_contains 'at line 2, column 8'
}

@test "a malformed config file stops wk" {
  write_config <<'YAML'
outputDelimiter: ',
YAML
  write_bindings <<'YAML'
- key: l
  type: command
  buffer: ls -la
YAML

  wk_run --inputs 'l'

  assert_equal "$status" 7
  assert_stderr_contains "${XDG_CONFIG_HOME}/wk/config.yaml: "
  assert_stderr_contains 'at line 2, column 1'
}

@test "a malformed local bindings file stops wk" {
  write_bindings <<'YAML'
- key: l
  type: command
  buffer: ls -la
YAML
  write_local_bindings <<'YAML'
- key: x
   type: command
YAML

  # The local layer is not treated any more leniently than the global one.
  wk_run --inputs 'l'

  assert_equal "$status" 7
  assert_stderr_contains "${PWD}/wk.bindings.yaml: "
}

@test "a bindings file holding a mapping stops wk" {
  write_bindings <<'YAML'
foo: bar
YAML

  wk_run --inputs 'l'

  assert_equal "$status" 7
  assert_equal "$stderr" "${XDG_CONFIG_HOME}/wk/bindings.yaml: expected a list of bindings"
}

@test "a bindings entry without a key stops wk, naming the entry" {
  write_bindings <<'YAML'
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
    "${XDG_CONFIG_HOME}/wk/bindings.yaml: [1].key: expected a key name or a digit 0-9"
}

@test "a config file holding a scalar stops wk" {
  write_config <<'YAML'
42
YAML

  wk_run --inputs 'l'

  assert_equal "$status" 7
  assert_equal "$stderr" "${XDG_CONFIG_HOME}/wk/config.yaml: expected a mapping"
}

@test "config is read before bindings, so the first broken file wins" {
  write_config <<'YAML'
42
YAML
  write_bindings <<'YAML'
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

@test "a path under HOME is reported with a tilde" {
  mkdir -p "${HOME}/.config/wk"
  cat >"${HOME}/.config/wk/bindings.yaml" <<'YAML'
foo: bar
YAML
  unset XDG_CONFIG_HOME

  wk_run --inputs 'l'

  assert_equal "$status" 7
  assert_equal "$stderr" '~/.config/wk/bindings.yaml: expected a list of bindings'
}

@test "local bindings override global ones with the same key" {
  write_bindings <<'YAML'
- key: l
  type: command
  buffer: from-global
- key: g
  type: command
  buffer: global-only
YAML
  write_local_bindings <<'YAML'
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
  write_bindings <<'YAML'
- key: g
  type: bindings
  desc: Git (global)
  bindings:
    - key: p
      type: command
      buffer: git push
YAML
  write_local_bindings <<'YAML'
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

@test "an empty bindings file is read as empty" {
  : >"${XDG_CONFIG_HOME}/wk/bindings.yaml"

  wk_run --inputs 'l'

  assert_equal "$status" 5
  assert_equal "$stderr" '"l" is undefined'
}

@test "an empty local bindings file leaves the global bindings alone" {
  write_bindings <<'YAML'
- key: l
  type: command
  buffer: ls -la
YAML
  : >"${PWD}/wk.bindings.yaml"

  wk_run --inputs 'l'

  assert_equal "$status" 0
  assert_equal "$output" $'\t\tls -la'
}

@test "an empty config file falls back to the defaults" {
  write_bindings <<'YAML'
- key: l
  type: command
  buffer: ls -la
YAML
  : >"${XDG_CONFIG_HOME}/wk/config.yaml"

  wk_run --inputs 'l'

  assert_equal "$status" 0
  assert_equal "$output" $'\t\tls -la'
}

@test "a bindings file holding only comments is read as empty" {
  # "Empty" is wider than zero bytes: a lone newline, whitespace, comments,
  # `---`, `null` and `~` all parse to null too.
  write_bindings <<'YAML'
# TODO: add some bindings
YAML

  wk_run --inputs 'l'

  assert_equal "$status" 5
  assert_equal "$stderr" '"l" is undefined'
}
