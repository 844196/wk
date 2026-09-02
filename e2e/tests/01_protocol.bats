#!/usr/bin/env bats
#
# The stdout protocol between `wk run` and the zsh widget. Both sides have to
# agree byte for byte, so these assertions are deliberately literal.

setup() {
  load '../helpers/common'
  setup_wk_env
}

@test "the default delimiter is a tab and the payload is prefixed by two of them" {
  load_fixture basic.bindings.yaml "${XDG_CONFIG_HOME}/wk/bindings.yaml"

  wk_run --inputs 'g p'

  assert_equal "$status" 0
  # outputs = [delimiter, buffer, ...kv] joined by delimiter, so the line opens
  # with the delimiter twice. The widget relies on this: it reads res[1] as the
  # delimiter and splits ${res:2}.
  assert_equal "$(cat -A "$wk_stdout_file")" '^I^Igit push^Ieval:true$'
}

@test "key, desc, icon and type are stripped from the output" {
  write_bindings <<'YAML'
- key: l
  type: command
  desc: List
  icon: LS
  buffer: ls -la
YAML

  wk_run --inputs 'l'

  assert_equal "$status" 0
  assert_equal "$output" $'\t\tls -la'
}

@test "boolean fields are emitted as key:value" {
  write_bindings <<'YAML'
- key: l
  type: command
  buffer: ls -la
  eval: true
  accept: true
YAML

  wk_run --inputs 'l'

  assert_equal "$status" 0
  assert_equal "$output" $'\t\tls -la\teval:true\taccept:true'
}

@test "false is emitted explicitly rather than omitted" {
  write_bindings <<'YAML'
- key: l
  type: command
  buffer: ls -la
  eval: false
YAML

  wk_run --inputs 'l'

  assert_equal "$status" 0
  assert_equal "$output" $'\t\tls -la\teval:false'
}

@test "config outputDelimiter replaces the tab" {
  write_config <<'YAML'
outputDelimiter: ','
YAML
  write_bindings <<'YAML'
- key: l
  type: command
  buffer: ls -la
  eval: true
YAML

  wk_run --inputs 'l'

  assert_equal "$status" 0
  assert_equal "$output" ',,ls -la,eval:true'
}

@test "a binding delimiter wins over config outputDelimiter and is not emitted itself" {
  write_config <<'YAML'
outputDelimiter: ','
YAML
  write_bindings <<'YAML'
- key: l
  type: command
  buffer: ls -la
  delimiter: '|'
  eval: true
YAML

  wk_run --inputs 'l'

  assert_equal "$status" 0
  assert_equal "$output" '||ls -la|eval:true'
}

@test "an arbitrary string field is passed through as key:value" {
  write_bindings <<'YAML'
- key: l
  type: command
  buffer: ls -la
  note: hello world
YAML

  wk_run --inputs 'l'

  assert_equal "$status" 0
  assert_equal "$output" $'\t\tls -la\tnote:hello world'
}

@test "an empty buffer still produces the two leading delimiters" {
  write_bindings <<'YAML'
- key: l
  type: command
  buffer: ''
YAML

  wk_run --inputs 'l'

  assert_equal "$status" 0
  assert_equal "$(cat -A "$wk_stdout_file")" '^I^I$'
}

@test "a multibyte buffer survives unchanged" {
  write_bindings <<'YAML'
- key: l
  type: command
  buffer: 'echo こんにちは'
YAML

  wk_run --inputs 'l'

  assert_equal "$status" 0
  assert_equal "$output" $'\t\techo こんにちは'
}

@test "a buffer containing the delimiter is split, so the binding picks another one" {
  # The payload is joined without escaping, so a buffer holding the delimiter
  # arrives at the widget as several fields. That is what the per-binding
  # `delimiter` is for: choose one the buffer cannot contain.
  write_bindings <<'YAML'
- key: l
  type: command
  buffer: "a\tb"
- key: d
  type: command
  buffer: "a\tb"
  delimiter: '|'
YAML

  wk_run --inputs 'l'
  assert_equal "$status" 0
  assert_equal "$(cat -A "$wk_stdout_file")" '^I^Ia^Ib$'

  wk_run --inputs 'd'
  assert_equal "$status" 0
  assert_equal "$(cat -A "$wk_stdout_file")" '||a^Ib$'
}

