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

@test "rows are ordered by key regardless of declaration order or global/local origin" {
  write_bindings <<'YAML'
- key: l
  type: command
  desc: List
  buffer: ls -la
- key: g
  type: bindings
  desc: Git
  bindings:
    - key: p
      type: command
      desc: Push
      buffer: git push
YAML
  write_local_bindings <<'YAML'
- key: i
  type: command
  desc: Info
  buffer: info
YAML
  start_wk_session
  wait_for_screen 'List'

  run capture_screen
  # Declared l-then-g, and i comes from a separate (local) source, but
  # sorting interleaves all three by key: g, i, l.
  assert_line --index 1 ' g ➜ +Git'
  assert_line --index 2 ' i ➜ Info'
  assert_line --index 3 ' l ➜ List'
}

@test "a duplicated key renders as a single row" {
  write_bindings <<'YAML'
- key: l
  type: command
  desc: First
  buffer: first
- key: l
  type: command
  desc: Second
  buffer: second
YAML
  start_wk_session
  wait_for_screen 'First'

  run capture_screen
  # The row a keypress can never reach (main.ts's `find` always resolves to
  # the first definition) is dropped before rendering, not just shown twice.
  assert_line --index 1 ' l ➜ First'
  refute_line --partial 'Second'
}

@test "a duplicated key inside a nested group renders as a single row" {
  write_bindings <<'YAML'
- key: g
  type: bindings
  desc: Git
  bindings:
    - key: p
      type: command
      desc: First
      buffer: first
    - key: p
      type: command
      desc: Second
      buffer: second
YAML
  start_wk_session --inputs 'g'
  wait_for_screen 'First'

  run capture_screen
  # Deduping isn't only a top-level, pre-merge concern: it applies at every
  # nesting level, same as sorting.
  assert_line --index 1 ' p ➜ First'
  refute_line --partial 'Second'
}

@test "keys that collate as equal still sort deterministically" {
  write_bindings <<'YAML'
- key: "1"
  type: command
  desc: One
  buffer: one
- key: "01"
  type: command
  desc: ZeroOne
  buffer: zero-one
YAML
  start_wk_session
  wait_for_screen 'One'

  run capture_screen
  # `numeric` collation treats "01" and "1" as the same value; an exact
  # string tie-break is what keeps their order from being merge-order noise.
  assert_line --index 1 ' 01 ➜ ZeroOne'
  assert_line --index 2 ' 1  ➜ One'
}

@test "keys sort naturally, not lexicographically" {
  write_bindings <<'YAML'
- key: f10
  type: command
  desc: Ten
  buffer: ten
- key: f2
  type: command
  desc: Two
  buffer: two
- key: f1
  type: command
  desc: One
  buffer: one
YAML
  start_wk_session
  wait_for_screen 'Ten'

  run capture_screen
  assert_line --index 1 " 󱊫 ➜ One"
  assert_line --index 2 " 󱊬 ➜ Two"
  assert_line --index 3 " 󱊴 ➜ Ten"
}

@test "an uppercase key sorts before its lowercase counterpart" {
  write_bindings <<'YAML'
- key: g
  type: command
  desc: Lower
  buffer: lower
- key: G
  type: command
  desc: Upper
  buffer: upper
YAML
  start_wk_session
  wait_for_screen 'Upper'

  run capture_screen
  assert_line --index 1 ' G ➜ Upper'
  assert_line --index 2 ' g ➜ Lower'
}

@test "sorting is applied recursively to nested groups" {
  write_bindings <<'YAML'
- key: g
  type: bindings
  desc: Git
  bindings:
    - key: p
      type: command
      desc: Push
      buffer: git push
    - key: c
      type: command
      desc: Commit
      buffer: git commit
YAML
  start_wk_session --inputs 'g'
  wait_for_screen 'Commit'

  run capture_screen
  # Declared p-then-c, but c sorts first inside the group too.
  assert_line --index 1 ' c ➜ Commit'
  assert_line --index 2 ' p ➜ Push'
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
