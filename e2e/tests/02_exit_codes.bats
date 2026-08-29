#!/usr/bin/env bats
#
# Exit codes are the other half of the widget contract: `_wk_widget` switches on
# them and falls back to `zle -M` for anything unexpected.

setup() {
  load '../helpers/common'
  setup_wk_env
  load_fixture basic.bindings.yaml "${XDG_CONFIG_HOME}/wk/bindings.yaml"
}

@test "selecting a command exits 0" {
  wk_run --inputs 'l'

  assert_equal "$status" 0
}

@test "escape aborts with 3 and writes nothing to stdout" {
  wk_run --inputs '\x1b'

  assert_equal "$status" 3
  assert_equal "$output" ''
}

@test "ctrl-c aborts with 3" {
  wk_run --inputs '\x03'

  assert_equal "$status" 3
  assert_equal "$output" ''
}

@test "an undefined key exits 5 and reports the whole key sequence on stderr" {
  wk_run --inputs 'g z'

  assert_equal "$status" 5
  assert_equal "$output" ''
  # Note: the keys are joined by a plain space, not by symbols.breadcrumb.
  assert_equal "$stderr" '"g z" is undefined'
}

@test "an undefined key at the root reports just that key" {
  wk_run --inputs 'z'

  assert_equal "$status" 5
  assert_equal "$stderr" '"z" is undefined'
}

@test "ctrl-d aborts with 3" {
  wk_run --inputs '\x04'

  assert_equal "$status" 3
}

@test "backspace at the root aborts with 3" {
  wk_run --inputs '\x7f'

  assert_equal "$status" 3
}

@test "ctrl-u at the root aborts with 3" {
  wk_run --inputs '\x15'

  assert_equal "$status" 3
}

@test "ctrl-w at the root aborts with 3" {
  wk_run --inputs '\x17'

  assert_equal "$status" 3
}

@test "running out of input exits 4 once the configured timeout elapses" {
  write_config <<'YAML'
timeout: 500
YAML

  wk_run --inputs 'g'

  assert_equal "$status" 4
  assert_equal "$output" ''
}

@test "timeout 0 disables the timer and wk keeps waiting" {
  write_config <<'YAML'
timeout: 0
YAML

  # 124 is the sentinel wk_run reports when timeout(1) had to kill the process,
  # i.e. wk was still waiting for a key.
  WK_E2E_RUN_TIMEOUT=3 wk_run --inputs 'g'

  assert_equal "$status" 124
}

@test "an unknown subcommand exits 2" {
  # Plain `run` merges stderr into $output; cliffy writes the error there.
  run "$WK_BIN" nope

  assert_equal "$status" 2
  assert_output --partial 'Unknown command "nope"'
}
