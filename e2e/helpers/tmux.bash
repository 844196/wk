#!/usr/bin/env bash
# Layer 3: drive the real zsh widget inside tmux.
#
# Two kinds of assertion are used, deliberately:
#   * a dump widget writes $BUFFER / $CURSOR to a file — deterministic, and the
#     only way BUFFER is ever checked;
#   * capture-pane -p reads the screen — for menu rendering, `zle -M` messages
#     and the cleanup after the menu closes.

# A dedicated socket, so a developer's own tmux server is never touched, and a
# per-test one, so teardown's kill-server can never reach another test's session
# under `bats --jobs`.
wk_tmux() {
  tmux -L "wk-e2e-${BATS_SUITE_TEST_NUMBER:-0}" "$@"
}

# write_zshrc <wk-init-args...> — write the rc that the tmux session will read.
write_zshrc() {
  export ZDOTDIR="${BATS_TEST_TMPDIR}/zdot"
  WK_DUMP_FILE="${BATS_TEST_TMPDIR}/dump.txt"
  mkdir -p "$ZDOTDIR"

  # printf '%q ' with no arguments emits '', which cliffy rejects as a
  # positional argument, leaving the widget undefined.
  local init_args=''
  if [[ $# -gt 0 ]]; then
    init_args=$(printf '%q ' "$@")
  fi

  {
    # A one-character prompt keeps screen assertions readable.
    echo "PS1='%% '"
    echo "export XDG_CONFIG_HOME=$(printf '%q' "$XDG_CONFIG_HOME")"
    echo "WK_DUMP_FILE=$(printf '%q' "$WK_DUMP_FILE")"
    # Layer-1 already covers `auto`; here it would depend on where the prompt
    # happens to sit, so pin it unless a test overrides the zstyle.
    echo "zstyle ':wk:*' options '--up-one-line' 'false'"
    echo '_wk_dump() { print -r -- "BUFFER=[$BUFFER] CURSOR=[$CURSOR]" >"$WK_DUMP_FILE" }'
    echo 'zle -N _wk_dump'
    echo "bindkey '^X' _wk_dump"
    # Stands in for accept-line so `accept: true` never runs a real command.
    echo '_wk_fake_accept() { print -r -- "ACCEPT BUFFER=[$BUFFER]" >"$WK_DUMP_FILE" }'
    echo 'zle -N _wk_fake_accept'
    echo "eval \"\$($(printf '%q' "$WK_BIN") init ${init_args})\""
  } >"${ZDOTDIR}/.zshrc"
}

# append_zshrc — append extra zsh lines (from stdin) to the rc.
append_zshrc() {
  cat >>"${ZDOTDIR}/.zshrc"
}

# start_zsh_session — start zsh under tmux and wait for its first prompt.
start_zsh_session() {
  # `zsh -f` would skip the rc entirely (NO_RCS); -d only disables /etc/z*.
  wk_tmux new-session -d -x 80 -y 24 \
    -e "ZDOTDIR=${ZDOTDIR}" \
    -e "HOME=${HOME}" \
    -e "XDG_CONFIG_HOME=${XDG_CONFIG_HOME}" \
    -e 'TERM=xterm-256color' \
    -c "$PWD" \
    'zsh -d -i'

  # capture-pane trims trailing whitespace, so the prompt reads as a bare '%'.
  wait_for_screen '%'
}

# start_wk_session <wk-run-args...> — run wk directly in a pane, with no zsh.
# Used by the rendering tests, where the widget is not the subject.
start_wk_session() {
  local args=("$@")

  # Default to `false` for the same reason layer 1 does, but let a test opt into
  # `auto`: a tmux pane is a real terminal and does answer the CSI 6n query.
  case " $* " in
    *' --up-one-line '*) ;;
    *) args=(--up-one-line false "$@") ;;
  esac

  start_command_session "$(printf '%q ' "$WK_BIN" run "${args[@]}")"
}

# start_command_session <shell-command> — run an arbitrary command in a pane.
# Used when the state of the terminal before wk starts is part of the test.
start_command_session() {
  wk_tmux new-session -d -x 80 -y 24 \
    -e "HOME=${HOME}" \
    -e "XDG_CONFIG_HOME=${XDG_CONFIG_HOME}" \
    -e 'TERM=xterm-256color' \
    -c "$PWD" \
    "$1"
}

# stop_zsh_session — always call this from teardown.
stop_zsh_session() {
  wk_tmux kill-server 2>/dev/null || true
}

# send_keys <literal> — send characters literally (no key-name lookup).
send_keys() {
  wk_tmux send-keys -l "$@"
}

# send_key <name> — send a named key such as C-x or Escape.
send_key() {
  wk_tmux send-keys "$@"
}

# capture_screen — the visible pane content, with ANSI already stripped by tmux.
capture_screen() {
  wk_tmux capture-pane -p
}

_screen_has() {
  capture_screen | grep -qF -- "$1"
}

_screen_lacks() {
  ! _screen_has "$1"
}

_dump_screen() {
  echo '--- screen ---' >&2
  capture_screen >&2
}

# wait_for_screen <substring> — poll the pane until the text shows up.
wait_for_screen() {
  wait_until "'$1' on screen" _screen_has "$1" || {
    _dump_screen
    return 1
  }
}

# wait_for_screen_gone <substring> — poll the pane until the text disappears.
wait_for_screen_gone() {
  wait_until "'$1' to leave the screen" _screen_lacks "$1" || {
    _dump_screen
    return 1
  }
}

# clear_dump — discard any earlier dump. Call this before the action under
# test, or read_dump can return a stale result and pass for the wrong reason.
clear_dump() {
  : "${WK_DUMP_FILE:?write_zshrc must run before the dump helpers}"
  rm -f "$WK_DUMP_FILE"
}

# dump_buffer — trigger the dump widget and return what it wrote.
dump_buffer() {
  clear_dump
  send_key 'C-x'
  read_dump
}

# read_dump — read whatever the dump or fake-accept widget wrote.
read_dump() {
  : "${WK_DUMP_FILE:?write_zshrc must run before the dump helpers}"
  wait_for_file "$WK_DUMP_FILE" || return 1
  cat "$WK_DUMP_FILE"
}
