#!/usr/bin/env bats
#
# Menu rendering. Deliberately shallow: only structure and configured symbols
# are asserted, never colours or column widths.

setup() {
  load '../helpers/common'
  load '../helpers/tmux'
  setup_wk_env
}

teardown() {
  stop_zsh_session
}

@test "each row is the key, the separator and the description, in binding order" {
  write_bindings <<'YAML'
- key: g
  type: bindings
  desc: Git
  bindings:
    - key: p
      type: command
      desc: Push
      buffer: git push
- key: l
  type: command
  desc: List
  buffer: ls -la
YAML
  start_wk_session
  wait_for_screen 'List'

  run capture_screen
  # A group is marked with symbols.group in front of its description.
  assert_line --index 1 ' g ➜ +Git'
  assert_line --index 2 ' l ➜ List'
}

@test "a command without a description falls back to its buffer" {
  write_bindings <<'YAML'
- key: n
  type: command
  buffer: no-desc-buffer
YAML
  start_wk_session
  wait_for_screen 'no-desc-buffer'

  run capture_screen
  assert_line --index 1 ' n ➜ no-desc-buffer'
}

@test "the breadcrumb joins the keys entered so far" {
  load_fixture nested.bindings.yaml "${XDG_CONFIG_HOME}/wk/bindings.yaml"
  write_config <<'YAML'
symbols:
  prompt: 'WK>'
YAML
  start_wk_session --inputs 'g p'
  wait_for_screen 'Force'

  run capture_screen
  assert_line --index 0 'WK>g » p'
}

@test "key names are rendered through symbols.keys" {
  write_bindings <<'YAML'
- key: return
  type: command
  desc: Enter
  buffer: entered
YAML
  start_wk_session
  wait_for_screen 'Enter'

  run capture_screen
  assert_line --index 1 ' ⏎ ➜ Enter'
}

@test "a built-in function key symbol resolves for a lowercase key" {
  write_bindings <<'YAML'
- key: f1
  type: command
  desc: Help
  buffer: man wk
YAML
  start_wk_session
  wait_for_screen 'Help'

  run capture_screen
  assert_line --index 1 ' 󱊫 ➜ Help'
}

@test "symbols.keys can be overridden from config" {
  write_config <<'YAML'
symbols:
  keys:
    return: 'RET'
YAML
  write_bindings <<'YAML'
- key: return
  type: command
  desc: Enter
  buffer: entered
YAML
  start_wk_session
  wait_for_screen 'Enter'

  run capture_screen
  assert_line --index 1 ' RET ➜ Enter'
}

@test "symbols.prompt, symbols.separator and symbols.group come from config" {
  write_config <<'YAML'
symbols:
  prompt: 'WK>'
  separator: '::'
  group: '@'
YAML
  write_bindings <<'YAML'
- key: g
  type: bindings
  desc: Git
  bindings:
    - key: p
      type: command
      desc: Push
      buffer: git push
YAML
  start_wk_session
  wait_for_screen 'Git'

  run capture_screen
  assert_line --index 0 'WK>'
  assert_line --index 1 ' g :: @Git'
}

@test "up-one-line auto keeps the menu below a partially written line" {
  write_config <<'YAML'
symbols:
  prompt: 'WK>'
YAML
  write_bindings <<'YAML'
- key: l
  type: command
  desc: List
  buffer: ls -la
YAML
  # A tmux pane is a real terminal, so it answers the CSI 6n query that
  # getCursorPosition() sends. This is the only place `auto` can be exercised:
  # outside a real terminal it blocks forever.
  start_command_session "printf 'xy'; $(printf '%q' "$WK_BIN") run --up-one-line auto"
  wait_for_screen 'List'

  run capture_screen
  # The cursor sat past column 1, so wk moved down before drawing.
  assert_line --index 0 'xy'
  assert_line --index 1 'WK>'
  assert_line --index 2 ' l ➜ List'
}

@test "up-one-line auto draws in place at the start of a line" {
  write_config <<'YAML'
symbols:
  prompt: 'WK>'
YAML
  write_bindings <<'YAML'
- key: l
  type: command
  desc: List
  buffer: ls -la
YAML
  start_wk_session --up-one-line auto
  wait_for_screen 'List'

  run capture_screen
  assert_line --index 0 'WK>'
  assert_line --index 1 ' l ➜ List'
}
