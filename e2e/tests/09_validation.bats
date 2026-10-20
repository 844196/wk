#!/usr/bin/env bats
#
# What a field may hold. Every rejection is exit 7 with one line naming the path
# that failed, so that a bad field never reaches the drawing code. Each field's
# checks are in src/schema.test.ts; these pin the exit code and the line's shape.

setup() {
  load '../helpers/common'
  setup_wk_env
}

# A binding that is fine on its own, so that a config-only test still has
# something to press. The test then appends its `config:` with append_global.
write_valid_bindings() {
  write_global <<'YAML'
bindings:
  - key: l
    type: command
    buffer: ls -la
YAML
}

# --- config ---------------------------------------------------------------

@test "a non-string outputDelimiter stops wk" {
  write_valid_bindings
  append_global <<'YAML'
config:
  outputDelimiter: 42
YAML

  wk_run --inputs 'l'

  assert_equal "$status" 7
  assert_equal "$stderr" \
    "${XDG_CONFIG_HOME}/wk/config.yaml: config.outputDelimiter: expected a single character"
}

# --- bindings -------------------------------------------------------------

@test "the bindings in a local file are validated the same way" {
  write_local <<'YAML'
bindings:
  - key: x
    type: command
    buffer: 42
YAML

  wk_run --inputs 'x'

  assert_equal "$status" 7
  assert_equal "$stderr" "${PWD}/wk.yaml: bindings[0].buffer: expected a string"
}
