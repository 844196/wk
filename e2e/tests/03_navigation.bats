#!/usr/bin/env bats
#
# Key handling and movement through the binding tree.

setup() {
  load '../helpers/common'
  setup_wk_env
  load_fixture nested.bindings.yaml "${XDG_CONFIG_HOME}/wk/bindings.yaml"
}

@test "descending two levels selects the leaf command" {
  wk_run --inputs 'g p f'

  assert_equal "$status" 0
  assert_equal "$output" $'\t\tgit push --force'
}

@test "backspace goes up one level so another branch can be taken" {
  wk_run --inputs 'g \x7f d p'

  assert_equal "$status" 0
  assert_equal "$output" $'\t\tdocker compose pull'
}

@test "ctrl-w behaves like backspace" {
  wk_run --inputs 'g p \x17 y'

  assert_equal "$status" 0
  assert_equal "$output" $'\t\tgit pull'
}

@test "ctrl-u returns all the way to the root" {
  wk_run --inputs 'g p \x15 l'

  assert_equal "$status" 0
  assert_equal "$output" $'\t\tls -la'
}

@test "other ctrl combinations are ignored and the menu stays open" {
  # Ctrl+G is printable-ASCII once decoded, so it hits the ignore branch.
  wk_run --inputs '\x07 l'

  assert_equal "$status" 0
  assert_equal "$output" $'\t\tls -la'
}

@test "a shifted key matches an uppercase binding key" {
  write_bindings <<'YAML'
- key: G
  type: command
  buffer: git status
YAML

  wk_run --inputs 'G'

  assert_equal "$status" 0
  assert_equal "$output" $'\t\tgit status'
}

@test "return, space and tab match their key names" {
  write_bindings <<'YAML'
- key: return
  type: command
  buffer: buffer-return
- key: space
  type: command
  buffer: buffer-space
- key: tab
  type: command
  buffer: buffer-tab
YAML

  wk_run --inputs '\x0d'
  assert_equal "$status" 0
  assert_equal "$output" $'\t\tbuffer-return'

  # --inputs is split on spaces before unescaping, so the space key has to be
  # written as an escape.
  wk_run --inputs '\x20'
  assert_equal "$status" 0
  assert_equal "$output" $'\t\tbuffer-space'

  wk_run --inputs '\x09'
  assert_equal "$status" 0
  assert_equal "$output" $'\t\tbuffer-tab'
}

@test "an arrow key matches the up binding key" {
  write_bindings <<'YAML'
- key: up
  type: command
  buffer: buffer-up
YAML

  wk_run --inputs '\x1b[A'

  assert_equal "$status" 0
  assert_equal "$output" $'\t\tbuffer-up'
}

@test "a duplicated key resolves to the first definition" {
  write_bindings <<'YAML'
- key: l
  type: command
  buffer: first
- key: l
  type: command
  buffer: second
YAML

  wk_run --inputs 'l'

  assert_equal "$status" 0
  assert_equal "$output" $'\t\tfirst'
}
