#!/usr/bin/env bats
#
# Key handling and movement through the binding tree, end to end. Each key's
# handling is in src/main.test.ts and src/tui.test.ts.

setup() {
  load '../helpers/common'
  setup_wk_env
  load_fixture nested.yaml "${XDG_CONFIG_HOME}/wk/config.yaml"
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

