#!/usr/bin/env bash
# Shared setup and the layer-1 runner (the compiled binary driven under a pty).
#
# The suite treats wk as a black box addressed through $WK_BIN, so it doubles as
# an acceptance spec for any future reimplementation. Nothing here may reference
# Deno.

bats_require_minimum_version 1.5.0

load '/opt/bats-support/load'
load '/opt/bats-assert/load'

WK_E2E_DIR="$(cd "${BASH_SOURCE[0]%/*}/.." && pwd)"

load "${WK_E2E_DIR}/helpers/wait"

# setup_wk_env — isolate HOME, XDG_CONFIG_HOME and the working directory.
# The working directory matters: `wk run` also reads $PWD/wk.bindings.yaml.
setup_wk_env() {
  : "${WK_BIN:?WK_BIN must point at a compiled wk binary}"

  export HOME="${BATS_TEST_TMPDIR}/home"
  export XDG_CONFIG_HOME="${BATS_TEST_TMPDIR}/xdg"

  mkdir -p "$HOME" "${XDG_CONFIG_HOME}/wk" "${BATS_TEST_TMPDIR}/cwd"
  cd "${BATS_TEST_TMPDIR}/cwd" || return 1
}

# write_bindings — write $XDG_CONFIG_HOME/wk/bindings.yaml from stdin.
write_bindings() {
  cat >"${XDG_CONFIG_HOME}/wk/bindings.yaml"
}

# write_local_bindings — write $PWD/wk.bindings.yaml from stdin.
write_local_bindings() {
  cat >"${PWD}/wk.bindings.yaml"
}

# write_config — write $XDG_CONFIG_HOME/wk/config.yaml from stdin.
write_config() {
  cat >"${XDG_CONFIG_HOME}/wk/config.yaml"
}

# load_fixture <name> <destination> — copy a fixture file into place.
load_fixture() {
  cp "${WK_E2E_DIR}/fixtures/$1" "$2"
}

# assert_stderr_contains <substring> — assert against wk_run's captured stderr.
assert_stderr_contains() {
  if [[ "$stderr" != *"$1"* ]]; then
    batslib_print_kv_single_or_multi 9 'substring' "$1" 'stderr' "$stderr" |
      batslib_decorate 'stderr does not contain substring' |
      fail
  fi
}

# wk_run <args...> — run `wk run` under a pty and capture the result.
#
# `--up-one-line false` is always injected: with `auto` the TUI emits CSI 6n and
# blocks forever, because nothing outside script(1)'s pty answers a DSR query.
# `07_render.bats` covers the `auto` path from the tmux layer, where a real
# terminal answers the query.
#
# Sets the same variables bats' own `run` does ($status, $output, $lines,
# $stderr, $stderr_lines) plus $wk_stdout_file / $wk_stderr_file for byte-exact
# assertions.
wk_run() {
  wk_stdout_file="${BATS_TEST_TMPDIR}/wk.stdout"
  wk_stderr_file="${BATS_TEST_TMPDIR}/wk.stderr"
  local status_file="${BATS_TEST_TMPDIR}/wk.status"
  rm -f "$wk_stdout_file" "$wk_stderr_file" "$status_file"

  local command
  command=$(printf '%q ' "$WK_BIN" run --up-one-line false "$@")
  command+=$(printf '>%q 2>%q; printf %%s "$?" >%q' \
    "$wk_stdout_file" "$wk_stderr_file" "$status_file")

  # script(1) supplies the /dev/tty that `wk run` opens. Its own output is
  # noise (pty echo), so it is discarded; the real streams are redirected
  # inside the pty and stay byte-exact.
  local script_status=0
  SHELL=/bin/bash timeout "${WK_E2E_RUN_TIMEOUT:-15}" \
    script -qec "$command" /dev/null >/dev/null 2>&1 || script_status=$?

  if [[ -f "$status_file" ]]; then
    status=$(cat "$status_file")
  elif [[ $script_status -eq 124 ]]; then
    # timeout(1) killed it, so wk was still waiting for a key.
    status=124
  else
    # No status file and no timeout means the pty command never ran; reporting
    # 124 here would let a test pass for entirely the wrong reason.
    fail "wk never ran: script(1) exited ${script_status}"
    return 1
  fi
  output=$(cat "$wk_stdout_file" 2>/dev/null || true)
  stderr=$(cat "$wk_stderr_file" 2>/dev/null || true)

  # Without these, assert_line after wk_run would read whatever a previous
  # `run` left behind and pass for the wrong reason.
  lines=()
  stderr_lines=()
  if [[ -n "$output" ]]; then
    mapfile -t lines <<<"$output"
  fi
  if [[ -n "$stderr" ]]; then
    mapfile -t stderr_lines <<<"$stderr"
  fi
}
