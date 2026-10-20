#!/usr/bin/env bats
#
# `wk init` renders the zsh widget. It needs no TTY, so it is driven directly.

setup() {
  load '../helpers/common'
  setup_wk_env
}

# assert_valid_zsh — the rendered widget has to at least parse as zsh.
assert_valid_zsh() {
  printf '%s\n' "$1" >"${BATS_TEST_TMPDIR}/widget.zsh"
  run zsh -n "${BATS_TEST_TMPDIR}/widget.zsh"
  assert_success
}

@test "without a leader no key is bound" {
  run "$WK_BIN" init

  assert_success
  refute_output --partial 'bindkey'
  assert_output --partial 'zle -N _wk_widget'
  assert_valid_zsh "$output"
}

@test "a leader is bound through the self-insert wrapper" {
  run "$WK_BIN" init --leader ' '

  assert_success
  assert_output --partial "bindkey ' ' _wk_self_insert_or_wk"
  assert_output --partial 'zle -N _wk_self_insert_or_wk'
  assert_valid_zsh "$output"
}

@test "bind-global binds the widget itself so a non-empty buffer still opens the menu" {
  run "$WK_BIN" init --leader ' ' --bind-global

  assert_success
  assert_output --partial "bindkey ' ' _wk_widget"
  refute_output --partial '_wk_self_insert_or_wk'
  assert_valid_zsh "$output"
}

@test "a major leader gets its own binding" {
  run "$WK_BIN" init --leader ' ' --major-leader ','

  assert_success
  assert_output --partial "bindkey ',' _wk_self_insert_or_wk_major"
  assert_valid_zsh "$output"
}

@test "bind-global applies to the major leader too" {
  run "$WK_BIN" init --major-leader ',' --bind-global

  assert_success
  assert_output --partial "bindkey ',' _wk_widget_major"
  assert_valid_zsh "$output"
}

@test "the major prefix is embedded in the major widget as an --inputs argument" {
  run "$WK_BIN" init --major-leader ',' --major-prefix 'x'

  assert_success
  assert_output --partial "zle _wk_widget -- --inputs 'x'"
  assert_valid_zsh "$output"
}

@test "the major prefix defaults to m" {
  run "$WK_BIN" init

  assert_success
  assert_output --partial "zle _wk_widget -- --inputs 'm'"
}

@test "a single quote leader is quoted with double quotes" {
  run "$WK_BIN" init --leader "'"

  assert_success
  assert_output --partial 'bindkey "'"'"'" _wk_self_insert_or_wk'
  assert_valid_zsh "$output"
}

@test "the widget invokes the binary by its own absolute path" {
  run "$WK_BIN" init

  assert_success
  assert_output --partial "${WK_BIN} run"
}
