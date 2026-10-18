#!/usr/bin/env bats
#
# What a field may hold. Every rejection is exit 7 with one line naming the path
# that failed, so that a bad field never reaches the drawing code.

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

@test "a multi-character outputDelimiter stops wk" {
  write_valid_bindings
  append_global <<'YAML'
config:
  outputDelimiter: '::'
YAML

  wk_run --inputs 'l'

  assert_equal "$status" 7
  assert_equal "$stderr" \
    "${XDG_CONFIG_HOME}/wk/config.yaml: config.outputDelimiter: expected a single character"
}

@test "a non-numeric timeout stops wk rather than silently never firing" {
  write_valid_bindings
  append_global <<'YAML'
config:
  timeout: 5s
YAML

  wk_run --inputs 'l'

  assert_equal "$status" 7
  assert_equal "$stderr" \
    "${XDG_CONFIG_HOME}/wk/config.yaml: config.timeout: expected a whole number of milliseconds"
}

@test "a malformed colour stops wk instead of crashing the drawing code" {
  write_valid_bindings
  append_global <<'YAML'
config:
  colors:
    prompt: {}
YAML

  wk_run --inputs 'l'

  assert_equal "$status" 7
  assert_equal "$stderr" "${XDG_CONFIG_HOME}/wk/config.yaml: config.colors.prompt: expected a color"
}

@test "a colour outside the ANSI range stops wk" {
  write_valid_bindings
  append_global <<'YAML'
config:
  colors:
    prompt: 999
YAML

  wk_run --inputs 'l'

  assert_equal "$status" 7
  assert_equal "$stderr" "${XDG_CONFIG_HOME}/wk/config.yaml: config.colors.prompt: expected a color"
}

@test "an unknown config field is left alone" {
  write_valid_bindings
  # Unlike the top level of the file, `config:` puts no ceiling on its fields,
  # so a field wk does not know is not wk's business.
  append_global <<'YAML'
config:
  unknownField: whatever
YAML

  wk_run --inputs 'l'

  assert_equal "$status" 0
  assert_equal "$output" $'\t\tls -la'
}

@test "an unknown config field that refers to itself is left alone too" {
  write_valid_bindings
  # A YAML alias can loop back on itself; wk must not walk into it.
  append_global <<'YAML'
config:
  extra: &loop
    self: *loop
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
  append_global <<'YAML'
config:
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
  write_global <<'YAML'
bindings:
  - key: 1
    type: command
    buffer: first
YAML

  wk_run --inputs '1'

  assert_equal "$status" 0
  assert_equal "$output" $'\t\tfirst'
}

@test "a binding without a type stops wk" {
  write_global <<'YAML'
bindings:
  - key: l
    buffer: ls -la
YAML

  wk_run --inputs 'l'

  assert_equal "$status" 7
  assert_equal "$stderr" \
    "${XDG_CONFIG_HOME}/wk/config.yaml: bindings[0].type: expected type \"command\" or \"bindings\""
}

@test "a non-string buffer stops wk" {
  write_global <<'YAML'
bindings:
  - key: l
    type: command
    buffer: 42
YAML

  wk_run --inputs 'l'

  assert_equal "$status" 7
  assert_equal "$stderr" "${XDG_CONFIG_HOME}/wk/config.yaml: bindings[0].buffer: expected a string"
}

@test "an empty binding delimiter stops wk" {
  write_global <<'YAML'
bindings:
  - key: l
    type: command
    buffer: ls -la
    delimiter: ''
YAML

  wk_run --inputs 'l'

  assert_equal "$status" 7
  assert_equal "$stderr" \
    "${XDG_CONFIG_HOME}/wk/config.yaml: bindings[0].delimiter: expected a single character"
}

@test "a non-string extra field on a command stops wk" {
  # The extra fields become the `key:value` pairs of the output protocol, which
  # only carries strings and booleans.
  write_global <<'YAML'
bindings:
  - key: l
    type: command
    buffer: ls -la
    note: 1
YAML

  wk_run --inputs 'l'

  assert_equal "$status" 7
  assert_equal "$stderr" \
    "${XDG_CONFIG_HOME}/wk/config.yaml: bindings[0].note: expected a string or a boolean"
}

@test "a list-valued extra field on a command stops wk" {
  write_global <<'YAML'
bindings:
  - key: l
    type: command
    buffer: ls -la
    arr: [a, b]
YAML

  wk_run --inputs 'l'

  assert_equal "$status" 7
  assert_equal "$stderr" \
    "${XDG_CONFIG_HOME}/wk/config.yaml: bindings[0].arr: expected a string or a boolean"
}

@test "a non-boolean eval stops wk" {
  # `eval` and `accept` are named in the schema rather than left to the catchall,
  # because the widget only acts on the literal `true`.
  write_global <<'YAML'
bindings:
  - key: l
    type: command
    buffer: ls -la
    eval: 'yes'
YAML

  wk_run --inputs 'l'

  assert_equal "$status" 7
  assert_equal "$stderr" "${XDG_CONFIG_HOME}/wk/config.yaml: bindings[0].eval: expected a boolean"
}

@test "a group without a description stops wk" {
  write_global <<'YAML'
bindings:
  - key: g
    type: bindings
    bindings:
      - key: p
        type: command
        buffer: git push
YAML

  wk_run --inputs 'g'

  assert_equal "$status" 7
  assert_equal "$stderr" "${XDG_CONFIG_HOME}/wk/config.yaml: bindings[0].desc: expected a string"
}

@test "a group whose bindings are not a list stops wk" {
  write_global <<'YAML'
bindings:
  - key: g
    desc: Git
    type: bindings
    bindings: oops
YAML

  wk_run --inputs 'g'

  assert_equal "$status" 7
  assert_equal "$stderr" \
    "${XDG_CONFIG_HOME}/wk/config.yaml: bindings[0].bindings: expected a list of bindings"
}

@test "an unknown field on a group stops wk, naming the field" {
  write_global <<'YAML'
bindings:
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
  assert_equal "$stderr" "${XDG_CONFIG_HOME}/wk/config.yaml: bindings[0]: unknown field \"oops\""
}

@test "a nested binding is checked too, and the path leads to it" {
  write_global <<'YAML'
bindings:
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
    "${XDG_CONFIG_HOME}/wk/config.yaml: bindings[0].bindings[0].bindings[0].key: expected a key name or a digit 0-9"
}

@test "an empty group stops wk" {
  write_global <<'YAML'
bindings:
  - key: g
    desc: Git
    type: bindings
    bindings: []
YAML

  wk_run --inputs 'g'

  assert_equal "$status" 7
  assert_equal "$stderr" \
    "${XDG_CONFIG_HOME}/wk/config.yaml: bindings[0].bindings: expected at least one binding"
}

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
