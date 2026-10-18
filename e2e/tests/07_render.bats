#!/usr/bin/env bats
#
# Menu rendering. Deliberately shallow: only structure and configured symbols
# are asserted, never column widths, and colours only to tell whether the
# global or the local file's value took effect.

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

@test "commands come before groups, and letters before symbols" {
  write_global <<'YAML'
bindings:
  - key: '"'
    type: bindings
    desc: Quote
    bindings:
      - key: q
        type: command
        desc: Quoted
        buffer: quoted
  - key: g
    type: bindings
    desc: Git
    bindings:
      - key: s
        type: command
        desc: Status
        buffer: git status
  - key: space
    type: command
    desc: Space
    buffer: spaced
  - key: z
    type: command
    desc: Zed
    buffer: zed
YAML
  start_wk_session
  wait_for_screen 'Zed'

  run capture_screen
  # `space` shows as ␣, a symbol, so it follows z despite sorting before it
  # by name.
  assert_line --index 1 --regexp '^ z +➜ Zed$'
  assert_line --index 2 --regexp '^ ␣ +➜ Space$'
  assert_line --index 3 --regexp '^ g +➜ \+Git$'
  assert_line --index 4 --regexp '^ " +➜ \+Quote$'
}

@test "commands come before groups inside a nested group too" {
  write_global <<'YAML'
bindings:
  - key: g
    type: bindings
    desc: Git
    bindings:
      - key: b
        type: bindings
        desc: Branch
        bindings:
          - key: l
            type: command
            desc: List branches
            buffer: git branch
      - key: c
        type: command
        desc: Commit
        buffer: git commit
YAML
  start_wk_session --inputs 'g'
  wait_for_screen 'Commit'

  run capture_screen
  assert_line --index 1 --regexp '^ c +➜ Commit$'
  assert_line --index 2 --regexp '^ b +➜ \+Branch$'
}

@test "a duplicated key renders as a single row" {
  write_global <<'YAML'
bindings:
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
  write_global <<'YAML'
bindings:
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
  write_global <<'YAML'
bindings:
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
  write_global <<'YAML'
bindings:
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
  write_global <<'YAML'
bindings:
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
  write_global <<'YAML'
bindings:
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
  write_global <<'YAML'
bindings:
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

@test "key names are rendered through symbols.keys" {
  write_global <<'YAML'
bindings:
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
  write_global <<'YAML'
bindings:
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
  write_global <<'YAML'
config:
  symbols:
    keys:
      return: 'RET'
bindings:
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
  write_global <<'YAML'
config:
  symbols:
    prompt: 'WK>'
    separator: '::'
    group: '@'
bindings:
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

@test "symbols.keys from the local file merge with the global ones per key" {
  write_global <<'YAML'
config:
  symbols:
    keys:
      return: 'RET'
bindings:
  - key: return
    type: command
    desc: Enter
    buffer: entered
  - key: space
    type: command
    desc: Space
    buffer: spaced
  - key: tab
    type: command
    desc: Tab
    buffer: tabbed
YAML
  write_local <<'YAML'
config:
  symbols:
    keys:
      tab: 'TAB'
YAML
  start_wk_session
  wait_for_screen 'Enter'

  run capture_screen
  # A key with no symbol on either side keeps its built-in one.
  assert_line --index 1 ' RET ➜ Enter'
  assert_line --index 2 ' TAB ➜ Tab'
  assert_line --index 3 --regexp '^ ␣ +➜ Space$'
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

@test "a local colour replaces a global { color, attrs } whole" {
  write_global <<'YAML'
config:
  symbols:
    prompt: 'WK>'
  colors:
    prompt:
      color: 196
      attrs: [underline]
bindings:
  - key: l
    type: command
    buffer: ls -la
YAML
  write_local <<'YAML'
config:
  colors:
    prompt: 21
YAML
  start_wk_session
  wait_for_screen 'WK>'

  run capture_screen_colors
  assert_line --index 0 --partial $'\e[38;5;21mWK>'
  # The global attrs do not carry over onto the local colour.
  refute_line --index 0 --partial $'\e[4m'
}
