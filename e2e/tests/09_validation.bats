#!/usr/bin/env bats
#
# What a field may hold. Every rejection is exit 7 with one line naming the path
# that failed, so that a bad field never reaches the drawing code.

setup() {
  load '../helpers/common'
  setup_wk_env
}

# A binding that is fine on its own, so that a config-only test still has
# something to press.
write_valid_bindings() {
  write_bindings <<'YAML'
- key: l
  type: command
  buffer: ls -la
YAML
}

# --- config ---------------------------------------------------------------

@test "a non-string outputDelimiter stops wk" {
  write_valid_bindings
  write_config <<'YAML'
outputDelimiter: 42
YAML

  wk_run --inputs 'l'

  assert_equal "$status" 7
  assert_equal "$stderr" \
    "${XDG_CONFIG_HOME}/wk/config.yaml: outputDelimiter: expected a single character"
}

@test "a multi-character outputDelimiter stops wk" {
  write_valid_bindings
  write_config <<'YAML'
outputDelimiter: '::'
YAML

  wk_run --inputs 'l'

  assert_equal "$status" 7
  assert_equal "$stderr" \
    "${XDG_CONFIG_HOME}/wk/config.yaml: outputDelimiter: expected a single character"
}

@test "a non-numeric timeout stops wk rather than silently never firing" {
  write_valid_bindings
  write_config <<'YAML'
timeout: 5s
YAML

  wk_run --inputs 'l'

  assert_equal "$status" 7
  assert_equal "$stderr" \
    "${XDG_CONFIG_HOME}/wk/config.yaml: timeout: expected a whole number of milliseconds"
}

@test "a malformed colour stops wk instead of crashing the drawing code" {
  write_valid_bindings
  write_config <<'YAML'
colors:
  prompt: {}
YAML

  wk_run --inputs 'l'

  assert_equal "$status" 7
  assert_equal "$stderr" "${XDG_CONFIG_HOME}/wk/config.yaml: colors.prompt: expected a color"
}

@test "a colour outside the ANSI range stops wk" {
  write_valid_bindings
  write_config <<'YAML'
colors:
  prompt: 999
YAML

  wk_run --inputs 'l'

  assert_equal "$status" 7
  assert_equal "$stderr" "${XDG_CONFIG_HOME}/wk/config.yaml: colors.prompt: expected a color"
}

@test "an unknown config field is left alone" {
  write_valid_bindings
  # The schema puts no ceiling on the top level, so a field wk does not know is
  # not wk's business.
  write_config <<'YAML'
unknownField: whatever
YAML

  wk_run --inputs 'l'

  assert_equal "$status" 0
  assert_equal "$output" $'\t\tls -la'
}

# --- bindings -------------------------------------------------------------

@test "a container written with nothing under it falls back to the defaults" {
  write_valid_bindings
  # Commenting out every entry under `colors:` leaves YAML null, which means the
  # same as never having written the key.
  write_config <<'YAML'
timeout: 500
colors:
  # bindingKey: 4
symbols:
  keys:
YAML

  wk_run --inputs 'l'

  assert_equal "$status" 0
  assert_equal "$output" $'\t\tls -la'
}

@test "an unquoted digit is accepted as a key" {
  # YAML reads it as a number; wk reads it back as the digit that was typed.
  write_bindings <<'YAML'
- key: 1
  type: command
  buffer: first
YAML

  wk_run --inputs '1'

  assert_equal "$status" 0
  assert_equal "$output" $'\t\tfirst'
}

@test "a binding without a type stops wk" {
  write_bindings <<'YAML'
- key: l
  buffer: ls -la
YAML

  wk_run --inputs 'l'

  assert_equal "$status" 7
  assert_equal "$stderr" \
    "${XDG_CONFIG_HOME}/wk/bindings.yaml: [0].type: expected type \"command\" or \"bindings\""
}

@test "a non-string buffer stops wk" {
  write_bindings <<'YAML'
- key: l
  type: command
  buffer: 42
YAML

  wk_run --inputs 'l'

  assert_equal "$status" 7
  assert_equal "$stderr" "${XDG_CONFIG_HOME}/wk/bindings.yaml: [0].buffer: expected a string"
}

@test "an empty binding delimiter stops wk" {
  write_bindings <<'YAML'
- key: l
  type: command
  buffer: ls -la
  delimiter: ''
YAML

  wk_run --inputs 'l'

  assert_equal "$status" 7
  assert_equal "$stderr" \
    "${XDG_CONFIG_HOME}/wk/bindings.yaml: [0].delimiter: expected a single character"
}

@test "a non-string extra field on a command stops wk" {
  # The extra fields become the `key:value` pairs of the output protocol, which
  # only carries strings and booleans.
  write_bindings <<'YAML'
- key: l
  type: command
  buffer: ls -la
  note: 1
YAML

  wk_run --inputs 'l'

  assert_equal "$status" 7
  assert_equal "$stderr" \
    "${XDG_CONFIG_HOME}/wk/bindings.yaml: [0].note: expected a string or a boolean"
}

@test "a list-valued extra field on a command stops wk" {
  write_bindings <<'YAML'
- key: l
  type: command
  buffer: ls -la
  arr: [a, b]
YAML

  wk_run --inputs 'l'

  assert_equal "$status" 7
  assert_equal "$stderr" \
    "${XDG_CONFIG_HOME}/wk/bindings.yaml: [0].arr: expected a string or a boolean"
}

@test "a non-boolean eval stops wk" {
  # `eval` and `accept` are named in the schema rather than left to the catchall,
  # because the widget only acts on the literal `true`.
  write_bindings <<'YAML'
- key: l
  type: command
  buffer: ls -la
  eval: 'yes'
YAML

  wk_run --inputs 'l'

  assert_equal "$status" 7
  assert_equal "$stderr" "${XDG_CONFIG_HOME}/wk/bindings.yaml: [0].eval: expected a boolean"
}

@test "a group without a description stops wk" {
  write_bindings <<'YAML'
- key: g
  type: bindings
  bindings:
    - key: p
      type: command
      buffer: git push
YAML

  wk_run --inputs 'g'

  assert_equal "$status" 7
  assert_equal "$stderr" "${XDG_CONFIG_HOME}/wk/bindings.yaml: [0].desc: expected a string"
}

@test "a group whose bindings are not a list stops wk" {
  write_bindings <<'YAML'
- key: g
  desc: Git
  type: bindings
  bindings: oops
YAML

  wk_run --inputs 'g'

  assert_equal "$status" 7
  assert_equal "$stderr" \
    "${XDG_CONFIG_HOME}/wk/bindings.yaml: [0].bindings: expected a list of bindings"
}

@test "an unknown field on a group stops wk, naming the field" {
  write_bindings <<'YAML'
- key: g
  desc: Git
  type: bindings
  oops: 1
  bindings:
    - key: p
      type: command
      buffer: git push
YAML

  wk_run --inputs 'g'

  assert_equal "$status" 7
  assert_equal "$stderr" "${XDG_CONFIG_HOME}/wk/bindings.yaml: [0]: unknown field \"oops\""
}

@test "a nested binding is checked too, and the path leads to it" {
  write_bindings <<'YAML'
- key: g
  desc: Git
  type: bindings
  bindings:
    - key: p
      desc: Push/Pull
      type: bindings
      bindings:
        - key: {}
          type: command
          buffer: git push
YAML

  wk_run --inputs 'g'

  assert_equal "$status" 7
  assert_equal "$stderr" \
    "${XDG_CONFIG_HOME}/wk/bindings.yaml: [0].bindings[0].bindings[0].key: expected a key name or a digit 0-9"
}

@test "an empty group stops wk" {
  write_bindings <<'YAML'
- key: g
  desc: Git
  type: bindings
  bindings: []
YAML

  wk_run --inputs 'g'

  assert_equal "$status" 7
  assert_equal "$stderr" \
    "${XDG_CONFIG_HOME}/wk/bindings.yaml: [0].bindings: expected at least one binding"
}

@test "a local bindings file is validated the same way" {
  write_local_bindings <<'YAML'
- key: x
  type: command
  buffer: 42
YAML

  wk_run --inputs 'x'

  assert_equal "$status" 7
  assert_equal "$stderr" "${PWD}/wk.bindings.yaml: [0].buffer: expected a string"
}
