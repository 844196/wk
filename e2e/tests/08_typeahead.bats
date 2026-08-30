#!/usr/bin/env bats

setup() {
  load '../helpers/common'
  load '../helpers/tmux'
  setup_wk_env

  WK_GATE_FILE="${BATS_TEST_TMPDIR}/gate"
  WK_OUT_FILE="${BATS_TEST_TMPDIR}/wk.stdout"
  WK_ERR_FILE="${BATS_TEST_TMPDIR}/wk.stderr"
  WK_STATUS_FILE="${BATS_TEST_TMPDIR}/wk.status"

  write_bindings <<'YAML'
- key: l
  type: command
  desc: List
  buffer: ls -la
YAML
}

teardown() {
  stop_zsh_session
}

# Without the keep-alive the pane dies with wk and capture_screen has nothing left to read.
wk_pane_command() {
  local command
  command=$(printf '%q ' "$WK_BIN" run "$@")
  command+=$(printf '>%q 2>%q; printf %%s "$?" >%q; exec tail -f /dev/null' \
    "$WK_OUT_FILE" "$WK_ERR_FILE" "$WK_STATUS_FILE")
  printf '%s' "$command"
}

# Holds wk until open_gate, so send_keys reaches the tty queue before wk opens /dev/tty.
# `stty` matches the state zle leaves, and the ten-character marker parks the cursor at
# column 11: a single-digit column hides the bug.
start_gated_wk_session() {
  local command="stty -echo -icanon min 1 time 0; printf %s 'ready:0123'"
  command+="; while [ ! -e $(printf '%q' "$WK_GATE_FILE") ]; do sleep 0.02; done; "
  command+=$(wk_pane_command "$@")

  start_command_session "$command"
  wait_for_screen 'ready:0123'
}

open_gate() {
  : >"$WK_GATE_FILE"
}

read_wk_result() {
  wait_for_file "$WK_STATUS_FILE" || return 1
  status=$(cat "$WK_STATUS_FILE")
  output=$(cat "$WK_OUT_FILE" 2>/dev/null || true)
  stderr=$(cat "$WK_ERR_FILE" 2>/dev/null || true)
}

@test "a key typed before the menu opens selects its binding" {
  start_gated_wk_session --up-one-line auto

  send_keys 'l'
  open_gate

  read_wk_result
  assert_equal "$status" 0
  assert_equal "$stderr" ''
  assert_equal "$output" $'\t\tls -la'
}

@test "a query the terminal never answers still gives way to ctrl+c" {
  local fifo="${BATS_TEST_TMPDIR}/stdin"
  local ready="${BATS_TEST_TMPDIR}/raw"
  mkfifo "$fifo"

  # Nothing outside script(1)'s pty answers a DSR query.
  # The key goes only once `stty raw` has taken: before that a ctrl+c kills the shell.
  local command="stty raw -echo; printf x >$(printf '%q' "$ready"); "
  command+=$(printf '%q ' "$WK_BIN" run --up-one-line auto)
  command+=$(printf '>%q 2>%q; printf %%s "$?" >%q' \
    "$WK_OUT_FILE" "$WK_ERR_FILE" "$WK_STATUS_FILE")

  # Held open, or the pty reports EOF and ends the wait for the wrong reason.
  exec 9<>"$fifo"

  SHELL=/bin/bash timeout "${WK_E2E_RUN_TIMEOUT:-15}" \
    script -qec "$command" /dev/null <"$fifo" >/dev/null 2>&1 &
  local script_pid=$!

  wait_for_file "$ready"
  printf '\003' >&9

  wait "$script_pid" || true
  exec 9>&-

  read_wk_result
  assert_equal "$status" 3
}

@test "a whole chord typed in one burst reaches the leaf command" {
  load_fixture nested.bindings.yaml "${XDG_CONFIG_HOME}/wk/bindings.yaml"
  start_gated_wk_session --up-one-line auto

  send_keys 'gpf'
  open_gate

  read_wk_result
  assert_equal "$status" 0
  assert_equal "$stderr" ''
  assert_equal "$output" $'\t\tgit push --force'
}

@test "the cursor position reply is never taken for a key" {
  # Row 10, column 101 makes the reply nine bytes: one more than a single read hands back.
  WK_TMUX_WIDTH=200
  start_command_session "printf '\033[10;101H'; $(wk_pane_command --up-one-line auto)"
  wait_for_screen 'List'

  send_keys 'l'

  read_wk_result
  assert_equal "$status" 0
  assert_equal "$stderr" ''
  assert_equal "$output" $'\t\tls -la'
}
