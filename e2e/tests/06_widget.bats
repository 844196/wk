#!/usr/bin/env bats
#
# The zsh widget driven for real, inside tmux. This is the layer that proves the
# run/widget contract end to end.

setup() {
  load '../helpers/common'
  load '../helpers/tmux'
  setup_wk_env
  load_fixture widget.bindings.yaml "${XDG_CONFIG_HOME}/wk/bindings.yaml"
}

teardown() {
  stop_zsh_session
}

@test "the leader opens the menu and the selection lands in BUFFER" {
  write_zshrc --leader ' '
  start_zsh_session

  send_keys ' '
  wait_for_screen 'Git'
  send_keys 'g'
  wait_for_screen 'Push'
  send_keys 'p'
  wait_for_screen '% git push'

  # CURSOR is always moved to the end of BUFFER.
  assert_equal "$(dump_buffer)" 'BUFFER=[git push] CURSOR=[8]'
}

@test "the leader self-inserts while the buffer is not empty" {
  write_zshrc --leader ' '
  start_zsh_session

  send_keys 'ec'
  wait_for_screen '% ec'
  # capture-pane trims trailing spaces, so a following character makes the
  # self-inserted space observable on screen.
  send_keys ' '
  send_keys 'z'
  wait_for_screen '% ec z'

  assert_equal "$(dump_buffer)" 'BUFFER=[ec z] CURSOR=[4]'
}

@test "bind-global opens the menu even when the buffer is not empty" {
  write_zshrc --leader ' ' --bind-global
  start_zsh_session

  send_keys 'ec'
  wait_for_screen '% ec'
  send_keys ' '
  wait_for_screen 'Git'
  send_keys 'l'
  wait_for_screen '% ecls -la'

  assert_equal "$(dump_buffer)" 'BUFFER=[ecls -la] CURSOR=[8]'
}

@test "the selection is inserted between LBUFFER and RBUFFER" {
  write_zshrc --leader ' ' --bind-global
  start_zsh_session

  send_keys 'ab'
  wait_for_screen '% ab'
  send_key 'C-b' # put the cursor between a and b
  send_keys ' '
  wait_for_screen 'Insert X'
  send_keys 'x'
  wait_for_screen '% aXb'

  assert_equal "$(dump_buffer)" 'BUFFER=[aXb] CURSOR=[3]'
}

@test "eval true expands parameters and command substitutions" {
  write_zshrc --leader ' '
  append_zshrc <<'ZSHRC'
WK_TEST_VAR=expanded
ZSHRC
  start_zsh_session

  send_keys ' '
  wait_for_screen 'Expand'
  send_keys 'e'
  wait_for_screen '% expanded'
  assert_equal "$(dump_buffer)" 'BUFFER=[expanded] CURSOR=[8]'

  send_key 'C-u'
  send_keys ' '
  wait_for_screen 'Substitute'
  send_keys 's'
  wait_for_screen '% substituted'
  assert_equal "$(dump_buffer)" 'BUFFER=[substituted] CURSOR=[11]'
}

@test "without eval the buffer is inserted literally" {
  write_zshrc --leader ' '
  append_zshrc <<'ZSHRC'
WK_TEST_VAR=expanded
ZSHRC
  start_zsh_session

  send_keys ' '
  wait_for_screen 'Literal'
  send_keys 'E'
  wait_for_screen '% $WK_TEST_VAR'

  assert_equal "$(dump_buffer)" 'BUFFER=[$WK_TEST_VAR] CURSOR=[12]'
}

@test "accept true runs the widget named by the accept-widget zstyle" {
  write_zshrc --leader ' '
  append_zshrc <<'ZSHRC'
zstyle ':wk:*' accept-widget _wk_fake_accept
ZSHRC
  start_zsh_session

  clear_dump
  send_keys ' '
  wait_for_screen 'Accept'
  send_keys 'a'

  # The stand-in widget captures the buffer instead of running the command.
  assert_equal "$(read_dump)" 'ACCEPT BUFFER=[printf "accepted-%s\n" ok]'
}

@test "accept true falls back to accept-line when no zstyle is set" {
  write_zshrc --leader ' '
  start_zsh_session

  send_keys ' '
  wait_for_screen 'Accept'
  send_keys 'a'

  # accept-line actually submits the line, so the command output shows up.
  # The buffer prints a string it does not itself contain, which keeps this
  # from matching the echoed command line.
  wait_for_screen 'accepted-ok'
}

@test "the options zstyle is forwarded to wk run" {
  write_zshrc --leader ' '
  append_zshrc <<'ZSHRC'
zstyle ':wk:*' options '--up-one-line' 'false' '--inputs' 'l'
ZSHRC
  start_zsh_session

  # --inputs already resolves the key, so the leader alone completes it.
  send_keys ' '
  wait_for_screen '% ls -la'

  assert_equal "$(dump_buffer)" 'BUFFER=[ls -la] CURSOR=[6]'
}

@test "an options value containing a space is word-split" {
  write_zshrc --leader ' '
  append_zshrc <<'ZSHRC'
zstyle ':wk:*' options '--up-one-line' 'false' '--inputs' 'g p'
ZSHRC
  start_zsh_session

  send_keys ' '

  # The widget expands the zstyle with ${=opts}, so 'g p' becomes two words and
  # `p` arrives as a positional argument. wk exits 2 and the widget reports it
  # through zle -M, which also covers the "unexpected exit code" branch.
  wait_for_screen 'No arguments allowed'
}

@test "escape leaves the buffer untouched and shows no error" {
  write_zshrc --leader ' ' --bind-global
  start_zsh_session

  send_keys 'abc'
  wait_for_screen '% abc'
  send_keys ' '
  wait_for_screen 'Git'
  send_key 'Escape'
  wait_for_screen_gone 'Git'

  assert_equal "$(dump_buffer)" 'BUFFER=[abc] CURSOR=[3]'

  run capture_screen
  refute_output --partial 'wk:'
}

@test "an undefined key surfaces through zle -M" {
  write_zshrc --leader ' '
  start_zsh_session

  send_keys ' '
  wait_for_screen 'Git'
  send_keys 'z'

  wait_for_screen 'wk: "z" is undefined'
}

@test "a timeout leaves the buffer untouched" {
  # Long enough that the open menu is reliably observed before the timer fires,
  # even on a loaded machine.
  write_config <<'YAML'
timeout: 3000
YAML
  write_zshrc --leader ' ' --bind-global
  start_zsh_session

  send_keys 'abc'
  wait_for_screen '% abc'
  send_keys ' '
  wait_for_screen 'Git'
  wait_for_screen_gone 'Git' # the timer fires and wk exits 4

  assert_equal "$(dump_buffer)" 'BUFFER=[abc] CURSOR=[3]'
}

@test "the major leader opens the menu already inside the major prefix" {
  write_zshrc --leader ' ' --major-leader ',' --major-prefix 'm'
  start_zsh_session

  send_keys ','
  # --inputs 'm' is consumed first, then wk falls through to real key input.
  # This is the only path that exercises that fallthrough.
  wait_for_screen 'Test'
  send_keys 't'
  wait_for_screen '% make test'

  assert_equal "$(dump_buffer)" 'BUFFER=[make test] CURSOR=[9]'
}

@test "closing the menu restores the prompt line and the cursor" {
  write_zshrc --leader ' '
  start_zsh_session

  send_keys ' '
  wait_for_screen 'Git'
  send_key 'Escape'
  wait_for_screen_gone 'Git'

  # Nothing but the prompt is left behind.
  assert_equal "$(capture_screen | sed '/^$/d')" '%'

  run wk_tmux display-message -p '#{cursor_flag}'
  assert_output '1'
}
