#!/usr/bin/env bats
#
# Menu rendering. Deliberately shallow: only structure and configured symbols
# are asserted, never column widths, and colours only to tell whether the
# global or the local file's value took effect. Sorting and the rows themselves
# are in src/config.test.ts and src/ui.test.ts.

setup() {
  load '../helpers/common'
  load '../helpers/tmux'
  setup_wk_env
}

teardown() {
  stop_zsh_session
}

@test "rows are ordered commands first, then by key, regardless of declaration order or global/local origin" {
  write_global <<'YAML'
bindings:
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
  write_local <<'YAML'
bindings:
  - key: i
    type: command
    desc: Info
    buffer: info
YAML
  start_wk_session
  wait_for_screen 'List'

  run capture_screen
  # Declared l-then-g, and i comes from a separate (local) source, but
  # sorting interleaves the commands by key and puts the group last: i, l, g.
  assert_line --index 1 ' i ➜ Info'
  assert_line --index 2 ' l ➜ List'
  assert_line --index 3 ' g ➜ +Git'
}

@test "the breadcrumb joins the keys entered so far" {
  load_fixture nested.yaml "${XDG_CONFIG_HOME}/wk/config.yaml"
  append_global <<'YAML'
config:
  symbols:
    prompt: 'WK>'
YAML
  start_wk_session --inputs 'g p'
  wait_for_screen 'Force'

  run capture_screen
  assert_line --index 0 'WK>g » p'
}

@test "the cursor rests after a full-width symbols.prompt, counted in columns" {
  write_global <<'YAML'
config:
  symbols:
    prompt: 'あ>'
bindings:
  - key: l
    type: command
    desc: List
    buffer: ls -la
YAML
  start_wk_session
  wait_for_screen 'List'

  # あ takes two columns, so the cursor sits at column 3 (0-based), not 2.
  run wk_tmux display-message -p '#{cursor_x}'
  assert_output '3'
}

@test "up-one-line auto keeps the menu below a partially written line" {
  write_global <<'YAML'
config:
  symbols:
    prompt: 'WK>'
bindings:
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
  write_global <<'YAML'
config:
  symbols:
    prompt: 'WK>'
bindings:
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

@test "a local colour overrides one global colour and keeps the others" {
  write_global <<'YAML'
config:
  symbols:
    prompt: 'WK>'
  colors:
    prompt: 196
    group: 46
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
  colors:
    prompt: 21
YAML
  start_wk_session
  wait_for_screen 'Git'

  run capture_screen_colors
  # The global prompt symbol survives a local file that only sets a colour.
  assert_line --index 0 --partial $'\e[38;5;21mWK>'
  assert_line --index 1 --partial $'\e[38;5;46m+'
}

