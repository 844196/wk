#!/usr/bin/env bash
# wk driver — launch and poke the real binary from an agent shell.
#
# The bats suite in e2e/ is the acceptance spec and runs in Docker. This driver
# is the opposite trade: no Docker, no image build, runs on the host in about a
# second, and prints what wk actually did so you can look at it. Use it to see a
# change working; use `mise run e2e` to prove it.
#
# keys, screen and widget run wk against a throwaway HOME / XDG_CONFIG_HOME /
# ZDOTDIR so your own ~/.config/wk/bindings.yaml never leaks in. That isolation
# is the whole reason this script exists instead of a one-liner. build and init
# read no config and run under your real environment.
#
#   ./.claude/skills/run-wk/driver.sh build
#   ./.claude/skills/run-wk/driver.sh keys g p
#   ./.claude/skills/run-wk/driver.sh screen g p
#   ./.claude/skills/run-wk/driver.sh widget g p
#   ./.claude/skills/run-wk/driver.sh init --leader ' '
#
# Env:
#   WK_BIN       binary to drive (default: dist/wk-$WK_TARGET)
#   WK_TARGET    deno compile target (default: x86_64-unknown-linux-gnu)
#   WK_BINDINGS  bindings.yaml to seed (default: e2e/fixtures/widget.bindings.yaml)
#   WK_CONFIG    config.yaml to seed (default: none)
#   WK_LOCAL_BINDINGS  wk.bindings.yaml to drop in the sandbox cwd (default: none)
#   WK_ZSHRC     file of extra zsh lines appended to the widget layer's .zshrc
#   WK_REAL_ACCEPT=1   widget layer: let `accept: true` really run the command
#   WK_BIND_GLOBAL=1   widget layer: `wk init --bind-global`, so the leader fires
#                      even when BUFFER is not empty
#   WK_PRETYPE   widget layer: text typed before the leader (the leader itself
#                then needs WK_BIND_GLOBAL to still fire)
#   WK_KEEP=1    keep the sandbox and print its path instead of deleting it
#                (keys writes out / err / status in there; widget writes dump.txt)
#   WK_TIMEOUT   seconds before keys gives up on wk (default: 15)
#   WK_UP_ONE_LINE  screen layer: --up-one-line value (default: auto)
#   WK_LEADER / WK_MAJOR_LEADER / WK_MAJOR_PREFIX
#                widget layer: keys passed to `wk init` (default: ' ' / ',' / 'm')
#   WK_COLS / WK_ROWS  tmux pane size (default: 80x24)
#   WK_SETTLE    seconds to wait after each key (default: 0.4 screen, 0.6 widget)
#
# Exit status:
#   `keys` exits with wk's own exit code (0/1/2/3/4/5/6, or 124 when wk was
#   still waiting for a key), so `driver.sh keys g p || ...` works from a
#   script. 1 is an uncaught error and is reachable from ordinary fixtures.
#   The other subcommands exit 0 on success. A driver-level failure — no binary,
#   a bad seed path, a menu that never drew — is always 125, which no wk exit
#   code uses, and always prints a `driver: ` line on stderr.
set -uo pipefail

# dirname(1), not ${...%/*}: the parameter expansion is a no-op on a bare
# filename, so `bash driver.sh ...` from this directory would leave $here empty
# and resolve $root to /. There is no `set -e` to catch it, and the failure
# would surface as a `//dist/wk-... not found` that points at the wrong problem.
here="$(cd "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)" ||
  { echo 'driver: could not resolve the script directory' >&2; exit 125; }
root="$(cd "${here}/../../.." && pwd)" ||
  { echo 'driver: could not resolve the repository root' >&2; exit 125; }

target="${WK_TARGET:-x86_64-unknown-linux-gnu}"
bin="${WK_BIN:-${root}/dist/wk-${target}}"
# `-` not `:-`: WK_BINDINGS= (explicitly empty) means "seed no bindings.yaml at
# all", which `:-` would silently turn back into the default fixture. wk folds
# an empty file into the same absent-file handling, so the two now behave
# alike, but seeding a file and seeding none stay separate cases to set up.
bindings="${WK_BINDINGS-${root}/e2e/fixtures/widget.bindings.yaml}"

# 125 is deliberately outside wk's range (0-6) and distinct from the 124 that
# `keys` reports for a wk still waiting on a key, so a caller can always tell
# "the driver could not run wk" from "wk ran and said this".
die() { echo "driver: $*" >&2; exit 125; }

need_bin() {
  [[ -x "$bin" ]] || die "$bin not found. Run: $0 build"
  # Every layer runs wk from inside the sandbox (`cd`, or tmux's `-c`), where a
  # relative WK_BIN no longer resolves. The failure would surface as env(1)'s
  # 127 dressed up as a wk exit code, so resolve it while $PWD is still the
  # caller's.
  case "$bin" in
    /*)  ;;
    */*) bin="$(cd "${bin%/*}" && pwd)/${bin##*/}" || die "could not resolve $bin" ;;
    *)   bin="${PWD}/${bin}" ;;
  esac
  # Resolve symlinks too. The widget layer invokes wk through Deno.execPath(),
  # which canonicalizes, so a symlinked WK_BIN would never match in
  # wk_owns_keyboard and every diagnosis that function drives would flip to the
  # wrong branch — silently, since both branches print a plausible sentence.
  local resolved
  resolved="$(readlink -f -- "$bin" 2>/dev/null)" && [[ -n "$resolved" ]] && bin="$resolved"
  return 0
}

# --- sandbox ---------------------------------------------------------------
# wk reads $XDG_CONFIG_HOME/wk/{bindings,config}.yaml and $PWD/wk.bindings.yaml.
# Without a sandbox you are testing the developer's own menu, not the fixture.
sandbox=''

# seed <source> <destination> — copy one named seed file into the sandbox.
# An empty source means "seed nothing" and is fine; a source that was named but
# does not exist is fatal. Seeding nothing on a typo would make a misspelled
# WK_BINDINGS byte-identical to the documented WK_BINDINGS= mode, and the
# resulting `"g" is undefined` would read as a wk bug rather than a bad path.
seed() {
  [[ -z "$1" ]] && return 0
  [[ -f "$1" ]] || die "seed file not found: $1"
  cp "$1" "$2" || die "could not copy $1 into the sandbox"
}

make_sandbox() {
  sandbox="$(mktemp -d "${TMPDIR:-/tmp}/wk-driver.XXXXXX")" ||
    die 'could not create the sandbox directory'
  # Guard the value too. There is no `set -e`, so an empty $sandbox would make
  # every path below absolute and mkdir /home /xdg /cwd /zdot at the root.
  [[ -n "$sandbox" ]] || die 'mktemp returned an empty path'
  mkdir -p "${sandbox}/home" "${sandbox}/xdg/wk" "${sandbox}/cwd" "${sandbox}/zdot" ||
    die "could not populate ${sandbox}"
  seed "$bindings" "${sandbox}/xdg/wk/bindings.yaml"
  seed "${WK_CONFIG:-}" "${sandbox}/xdg/wk/config.yaml"
  seed "${WK_LOCAL_BINDINGS:-}" "${sandbox}/cwd/wk.bindings.yaml"
  return 0
}

cleanup_sandbox() {
  [[ -z "$sandbox" ]] && return 0
  if [[ -n "${WK_KEEP:-}" ]]; then
    echo "--- sandbox kept: ${sandbox}" >&2
  else
    rm -rf "$sandbox"
  fi
}
trap cleanup_sandbox EXIT

# sandbox_env — the env every layer runs wk under.
#
# This is passed as an `env` PREFIX to the command, never via `tmux -e`:
# `tmux new-session -e XDG_CONFIG_HOME=...` silently loses to the value the tmux
# server already inherited, and the pane quietly reads your real config.
sandbox_env() {
  printf '%q ' env \
    "HOME=${sandbox}/home" \
    "XDG_CONFIG_HOME=${sandbox}/xdg" \
    "ZDOTDIR=${sandbox}/zdot" \
    'TERM=xterm-256color' \
    'LANG=C.UTF-8'
}

# --- tmux ------------------------------------------------------------------
# A private socket, and -f /dev/null so the developer's ~/.config/tmux/tmux.conf
# cannot change the pane geometry the screen assertions depend on.
sock="wk-driver-$$"
tmx() { tmux -L "$sock" "$@"; }

# send_literal <text> — type text into the pane as data.
#
# Bytes via -H, not -l. A lone `;` is tmux's own command separator and the
# parser eats it before -l ever sees it, so a `;` binding key would look like a
# wk that ignored the keypress. Escaping it is not enough either: tmux
# un-escapes `\;` only when it is the argument's last character, so a `;` in the
# middle of WK_PRETYPE would arrive with a literal backslash in front of it.
# Sending the bytes removes the question for every character at once.
send_literal() {
  local hex
  # -v: without it od collapses a run of identical lines to a bare `*`, so a
  # WK_PRETYPE of 32 identical characters would type 16 and the `*` would reach
  # the unquoted expansion below as a glob against the caller's cwd.
  hex=$(printf '%s' "$1" | od -An -v -tx1 | tr -s ' \n' ' ')
  [[ -n "${hex// /}" ]] || return 0
  # Word splitting is the point: -H takes one hex value per argument.
  # shellcheck disable=SC2086
  tmx send-keys -H $hex
}

# send_key <key> — one key into the pane, accepting the same `\xHH` spelling
# the keys layer takes. tmux's send-keys -l does no escape decoding, so without
# this `screen '\x1b'` would type four characters, wk would call `\` undefined
# and exit 5, and the driver's `(wk exited — ...)` line would read like an
# escape that aborted as intended.
send_key() {
  local rest="$1" hex=''
  while [[ -n "$rest" ]]; do
    case "$rest" in
      # Scan rather than match the whole argument: a key can be several tokens
      # (`\x1b\x5b`) or a mix (`\x1b.`), and matching only a lone `\xHH` would
      # type those spellings out as their own characters.
      '\x'[0-9a-fA-F][0-9a-fA-F]*)
        hex+=" ${rest:2:2}"
        rest="${rest:4}"
        ;;
      *)
        hex+=" $(printf '%s' "${rest:0:1}" | od -An -v -tx1 | tr -s ' \n' ' ')"
        rest="${rest:1}"
        ;;
    esac
  done
  [[ -n "${hex// /}" ]] || return 0
  # shellcheck disable=SC2086
  tmx send-keys -H $hex
}

# send_leader — type the leader key.
#
# WK_LEADER is handed to `wk init`, which takes zsh bindkey syntax, so `^G` is a
# legal leader (src/init.ts uses exactly that in its own example). tmux wants
# that as the key name `C-g`. Sent literally it would type the two characters
# `^` and `G`, the menu would never open, and the layer would still print a
# `BUFFER=` line that reads like a real result.
# ctrl_letter <bindkey spec> — the control letter a spec names, or empty.
# bindkey reads `^X` and `\C-X` as the same binding, so anything that reasons
# about a control leader has to accept both spellings.
ctrl_letter() {
  case "$1" in
    '^'[A-Za-z]) printf '%s' "${1#^}" ;;
    '\C-'[A-Za-z]) printf '%s' "${1#\\C-}" ;;
  esac
}

send_leader() {
  local letter
  letter="$(ctrl_letter "$leader")"
  if [[ -n "$letter" ]]; then
    tmx send-keys "C-$(printf '%s' "$letter" | tr 'A-Z' 'a-z')"
  else
    send_literal "$leader"
  fi
}

# kill-server leaves the socket file behind, so /tmp/tmux-$UID fills up with
# dead wk-driver-* sockets across runs. Unlink it explicitly.
kill_tmux() {
  tmux -L "$sock" kill-server 2>/dev/null
  rm -f "${TMUX_TMPDIR:-/tmp}/tmux-$(id -u)/${sock}"
  return 0
}

wait_for_screen() {
  local needle="$1" i
  for ((i = 0; i < 100; i++)); do
    if tmx capture-pane -p 2>/dev/null | grep -qF -- "$needle"; then
      # A crashing wk writes a Deno stack trace carrying the sandbox path before
      # its pane dies, and a one-character needle can match inside it. Requiring
      # a live pane keeps that from being read as a drawn menu.
      pane_alive && return 0
      return 1
    fi
    pane_alive || return 1
    sleep 0.05
  done
  return 1
}

# capture-pane strips trailing whitespace and tmux has already resolved the ANSI
# colours away. The first line looks empty but is not: the default prompt symbol
# in src/types/Context.ts is a Nerd Font glyph (U+F460), which most terminals and
# every grep-based assertion render as nothing useful. Match on a binding row
# instead of the prompt.
# The widget layer's startup marker (below) is scaffolding, not evidence; drop
# it so `=== prompt ===` shows the prompt and nothing else.
screen() {
  tmx capture-pane -p 2>/dev/null |
    sed -e 's/[[:space:]]*$//' -e '/^[[:space:]]*$/d' -e "/${READY_MARKER}/d"
}

# Printed from the widget layer's own precmd, defined after the WK_ZSHRC append.
# Waiting on the prompt text would hard-code the PS1 written above that append,
# and WK_ZSHRC is documented as able to override anything above it — a caller
# who sets their own PS1 would hang the layer and get `zsh never reached its
# prompt` next to a screen plainly showing one. precmd fires once per prompt, so
# the marker also means zle is about to take keys, which a marker printed at the
# end of .zshrc would not.
READY_MARKER='__wk_driver_ready__'

pane_alive() { tmx has-session 2>/dev/null; }

# wk_owns_keyboard — true while a `wk run` process is still alive in the pane.
#
# Asking the process table beats reading the screen. Every screen needle is
# config-dependent (the `➜` separator and the prompt glyph are both redefinable)
# or fixture-dependent, and once the keys descend into a submenu the top-level
# keys are no longer drawn at all — so no needle taken from the fixture's first
# entry survives the descent.
#
# The widget layer runs wk from a command substitution inside zle, so wk is a
# child of the pane's zsh and never becomes the pane's foreground command;
# #{pane_current_command} stays `zsh` throughout. Look for the child instead.
wk_owns_keyboard() {
  local pane_pid pid
  pane_pid="$(tmx display-message -p -F '#{pane_pid}' 2>/dev/null)"
  [[ -n "$pane_pid" ]] || return 1
  for pid in $(pgrep -P "$pane_pid" 2>/dev/null); do
    # Compare argv as a fixed string. `pgrep -f "$bin"` would read the path as
    # an ERE, so a checkout under `repo(1)/` or `c++/` would never match and the
    # one distinction this function exists to make would silently collapse.
    local argv
    argv="$(ps -o args= -p "$pid" 2>/dev/null)"
    # Slice, not `== "$bin"*`: an unquoted right-hand side is a glob, so a
    # checkout under `wk[1]/` would never match and every diagnosis this drives
    # would quietly flip.
    [[ "${argv:0:${#bin}}" == "$bin" ]] && return 0
  done
  return 1
}

# wk_owns_keyboard is the whole diagnosis in the widget layer, and its "no" is
# indistinguishable from a pgrep(1) that is missing or broken: the run would
# carry on and report a fully drawn menu as `no menu`, which is the silent
# branch flip the comments above exist to prevent. Probe it once instead.
# pgrep exits 1 for "no match", which is the expected answer here; anything
# above that is the tool failing.
need_procps() {
  pgrep -P $$ >/dev/null 2>&1
  (($? <= 1)) && ps -o args= -p $$ >/dev/null 2>&1 ||
    die 'pgrep(1)/ps(1) are unavailable (procps). The widget layer needs them to tell whether wk is holding the keyboard.'
}

# --- build -----------------------------------------------------------------
cmd_build() {
  ( cd "$root" && mise run "build:internal" "$target" ) || die 'build failed'
  echo "built: dist/wk-${target}"
}

# --- layer 1: the binary under a pty --------------------------------------
# `wk run` opens /dev/tty itself, so it needs a pty even when nothing is
# watching; script(1) supplies one. --up-one-line false is mandatory here:
# `auto` emits CSI 6n and blocks forever, because script(1)'s pty never answers
# a cursor-position query. Use `screen` if you need to see `auto` work.
cmd_keys() {
  need_bin
  make_sandbox
  local out="${sandbox}/out" err="${sandbox}/err" st="${sandbox}/status"
  local inner
  inner=$(sandbox_env)
  inner+=$(printf '%q ' "$bin" run --up-one-line false)
  [[ $# -gt 0 ]] && inner+=$(printf '%q %q ' --inputs "$*")
  inner+=$(printf '>%q 2>%q; printf %%s "$?" >%q' "$out" "$err" "$st")

  # script(1)'s own output is pty echo noise and is discarded; the real streams
  # are redirected inside the pty by $inner and stay byte-exact.
  # -k: wk under script(1)'s pty does not die on the TERM that timeout sends,
  # so a plain `timeout N` overshoots N by a couple of seconds. Follow up with a
  # KILL half a second later; the exit code stays 124 either way.
  # The extra subshell exists only to own the "Killed" job notice bash prints
  # when timeout's KILL lands: that notice comes from the shell that waits, so
  # it can only be silenced one level out. Without it the notice is the first
  # thing on stderr and reads as a driver crash rather than a wk timeout.
  local script_status=0
  ( ( cd "${sandbox}/cwd" && SHELL=/bin/bash timeout -k 0.5 "${WK_TIMEOUT:-15}" \
      script -qec "$inner" /dev/null >/dev/null 2>&1 ) ) 2>/dev/null || script_status=$?

  local status
  if [[ -f "$st" ]]; then
    status="$(cat "$st")"
  elif [[ $script_status -eq 124 || $script_status -eq 137 ]]; then
    # timeout(1) killed it, so wk was still waiting for a key. 137 is the KILL
    # from -k landing first; both mean the same thing, so report one code.
    status=124
  else
    # No status file and no timeout means wk never ran at all. Reporting 124
    # here would dress a broken sandbox up as a phantom timeout, and returning 0
    # would hide it from any script driving this.
    die "wk never ran; script(1) exited ${script_status}"
  fi
  echo "exit:   ${status}  $(explain_exit "$status")"
  # The protocol is delimiter-separated and the default delimiter is a tab, so
  # print it escaped or you cannot see the field boundaries at all.
  # awk, not `sed 's/\t/.../'`: only GNU sed reads `\t` on the left-hand side as
  # a tab. Elsewhere it matches the letter `t`, and the one line this layer
  # exists to show would come out quietly mangled.
  printf 'stdout: %s\n' "$(awk '{ gsub(/\t/, "\\t"); print }' "$out" 2>/dev/null)"
  printf 'stderr: %s\n' "$(cat "$err" 2>/dev/null)"
  # Exit with wk's own code. Printing it and returning 0 would make every
  # `driver.sh keys ... || fail` in a script silently pass, including the exit 1
  # crashes in the Gotchas.
  return "$status"
}

explain_exit() {
  case "$1" in
    0) echo '(selected a command)' ;;
    1) echo '(uncaught error — read stderr; a non-array bindings.yaml and a blank --inputs both land here)' ;;
    2) echo '(bad CLI arguments)' ;;
    3) echo '(abort: escape / ctrl-c / ctrl-d / backspace at root)' ;;
    4) echo '(timeout — config.yaml timeout elapsed)' ;;
    5) echo '(undefined key)' ;;
    6) echo '(key parse failure)' ;;
    124) echo '(driver timeout: wk was still waiting for a key)' ;;
    *) echo '(unknown)' ;;
  esac
}

# --- layer 2: the TUI on a real terminal ----------------------------------
# A tmux pane answers CSI 6n, so this is the only layer where --up-one-line auto
# works. Keys are sent one at a time and the screen is dumped after each, which
# is what "take a screenshot" means for a TUI.
cmd_screen() {
  need_bin
  make_sandbox
  trap 'kill_tmux; cleanup_sandbox' EXIT

  local upone="${WK_UP_ONE_LINE:-auto}"
  tmx -f /dev/null new-session -d -x "${WK_COLS:-80}" -y "${WK_ROWS:-24}" -c "${sandbox}/cwd" \
    "$(sandbox_env)$(printf '%q ' "$bin" run --up-one-line "$upone")" ||
    die 'tmux could not start a session. Check that tmux is installed and that WK_COLS/WK_ROWS are numbers'

  # The menu is drawn before any key is read; wait for anything to land on the
  # screen. A needle taken from the fixture's raw text cannot do this job: the
  # menu draws each key through config.yaml's `symbols.keys`, so a fixture key
  # of `g` rendered as `★` would never match and a fully drawn menu would be
  # reported as one that never appeared. Every drawn menu — down to the bare
  # prompt glyph an empty binding set leaves — makes the capture non-empty.
  local i drew=0
  for ((i = 0; i < 100; i++)); do
    pane_alive || break
    [[ -n "$(screen)" ]] && { drew=1; break; }
    sleep 0.05
  done
  if ((drew == 0)); then
    # A wk that crashed takes the pane with it. Saying "menu never appeared"
    # there sends the reader after the fixture path, when the answer is a stack
    # trace only the keys layer can show.
    pane_alive ||
      die 'wk exited before drawing a menu. Run the same fixture through `keys` for its exit code and stderr'
    screen
    die 'menu never appeared'
  fi
  echo "=== menu ==="; screen

  local k
  for k in "$@"; do
    send_key "$k" 2>/dev/null
    sleep "${WK_SETTLE:-0.4}"
    # Picking a `type: command` binding ends the process, which ends the pane.
    # That is success, not a crash — but there is no screen left to read.
    if ! pane_alive; then
      echo "=== after '${k}' ==="
      echo '(wk exited — a command binding, an abort, an undefined key, or a crash. Use `keys` for the exit code.)'
      return 0
    fi
    echo "=== after '${k}' ==="; screen
  done
  return 0
}

# --- layer 3: the real zsh widget -----------------------------------------
# The contract between `wk run` and _wk_widget only exists here. BUFFER is read
# back through a dump widget on C-x rather than off the screen, because the
# screen shows the prompt too and cannot tell you where CURSOR is.
cmd_widget() {
  need_bin
  need_procps
  # WK_ZSHRC is appended rather than copied, so it never reaches seed(). Check
  # it here anyway: a typo'd path would otherwise drop the caller's overrides
  # and still run to completion with rc 0.
  [[ -z "${WK_ZSHRC:-}" || -f "${WK_ZSHRC}" ]] || die "seed file not found: ${WK_ZSHRC}"
  make_sandbox
  trap 'kill_tmux; cleanup_sandbox' EXIT

  local dump="${sandbox}/dump.txt" accepted="${sandbox}/accepted.txt"
  local leader="${WK_LEADER:- }"

  # The dump binding below claims ^X before `wk init` runs, so wk's own widget
  # would win a leader of ^X: the closing C-x reopens the menu instead of
  # dumping, and a contract that worked gets reported as a failure. Both leaders
  # reach the same bindkey, so both have to be checked.
  case "$(ctrl_letter "$leader")" in
    [Xx]) die 'WK_LEADER claims ^X, which the dump widget needs. Pick another leader.' ;;
  esac
  case "$(ctrl_letter "${WK_MAJOR_LEADER:-,}")" in
    [Xx]) die 'WK_MAJOR_LEADER claims ^X, which the dump widget needs. Pick another leader.' ;;
  esac
  local -a init_argv=(
    --leader "$leader"
    --major-leader "${WK_MAJOR_LEADER:-,}"
    --major-prefix "${WK_MAJOR_PREFIX:-m}"
  )
  # Without --bind-global the leader is bound to _wk_self_insert_or_wk, which
  # only opens the menu when BUFFER is empty. That hides the widget's actual
  # insert: BUFFER="${LBUFFER}...${RBUFFER}" puts the selection at the cursor,
  # not over the whole line. Pair this with WK_PRETYPE to see that.
  [[ -n "${WK_BIND_GLOBAL:-}" ]] && init_argv+=(--bind-global)
  local init_args
  init_args=$(printf '%q ' "${init_argv[@]}")

  # `zsh -d -i` reads $ZDOTDIR/.zshrc; `zsh -f` would set NO_RCS and read none.
  {
    echo "PS1='%% '"
    # e2e/fixtures/widget.bindings.yaml binds `e` and `E` to $WK_TEST_VAR to
    # contrast eval:true against a literal insert. That only says anything once
    # the variable holds something, so define it exactly as
    # e2e/tests/06_widget.bats does — otherwise `widget e` yields an empty
    # BUFFER and reads as a broken eval rather than an undefined variable.
    echo 'WK_TEST_VAR=expanded'
    echo "_wk_dump() { print -r -- \"BUFFER=[\$BUFFER] CURSOR=[\$CURSOR]\" >${dump@Q} }"
    echo 'zle -N _wk_dump'
    echo "bindkey '^X' _wk_dump"
    if [[ -n "${WK_REAL_ACCEPT:-}" ]]; then
      # Opt-in: the binding's command actually runs. Only for bindings whose
      # buffer you have read.
      # Record what accept-line actually ran. Without this the closing report
      # can only see that no stub fired, which is true for every binding — and
      # it would tell the caller a command ran when nothing did.
      echo "preexec() { print -r -- \"\$1\" >${accepted@Q} }"
    else
      # accept: true would otherwise run the command for real. Stub it.
      echo "_wk_fake_accept() { print -r -- \"ACCEPT BUFFER=[\$BUFFER]\" >${dump@Q} }"
      echo 'zle -N _wk_fake_accept'
      echo "zstyle ':wk:*' accept-widget _wk_fake_accept"
    fi
    # Pinned: `auto` would depend on where the prompt happens to sit.
    echo "zstyle ':wk:*' options '--up-one-line' 'false'"
    echo "eval \"\$($(printf '%q' "$bin") init ${init_args})\""
    # Extra zsh lines, appended last so they can override anything above. The
    # trailing echo is load-bearing: a WK_ZSHRC without a final newline would
    # fuse into the line below, and the resulting zsh errors would surface as
    # `zsh never reached its prompt` — a driver failure pointing at nothing.
    [[ -n "${WK_ZSHRC:-}" ]] && { cat "$WK_ZSHRC"; echo; }
    # A hook, not a bare precmd(): defining the function here would silently
    # clobber one from WK_ZSHRC, which is documented as able to override
    # anything above it. Printing from the end of .zshrc instead would fire
    # before zle exists, and the leader would be typed into a shell that is not
    # yet reading keys.
    echo 'autoload -Uz add-zsh-hook'
    echo "_wk_driver_ready() { print -r -- ${READY_MARKER@Q} }"
    echo 'add-zsh-hook precmd _wk_driver_ready'
  } >"${sandbox}/zdot/.zshrc"

  tmx -f /dev/null new-session -d -x "${WK_COLS:-80}" -y "${WK_ROWS:-24}" -c "${sandbox}/cwd" \
    "$(sandbox_env)zsh -d -i" ||
    die 'tmux could not start a session. Check that tmux is installed and that WK_COLS/WK_ROWS are numbers'
  wait_for_screen "$READY_MARKER" || { screen; die 'zsh never reached its prompt'; }
  # precmd fires just before zle takes over, so give the line editor a beat to
  # start reading. This floor is deliberately not WK_SETTLE: at WK_SETTLE=0 the
  # leader would be typed into a shell that is not yet listening and vanish,
  # and every heading below would then describe a run that never happened.
  sleep 0.3
  echo '=== prompt ==='; screen

  # saw_wk drives the diagnosis after the leader. It starts here because a
  # pretype can itself open wk — typing the major leader is how you reach that
  # widget — and "the leader did not open wk" says nothing about a menu that was
  # already up.
  local saw_wk=0

  # Text typed before the leader, so LBUFFER/RBUFFER are non-empty when the
  # selection lands. That case needs WK_BIND_GLOBAL, or the leader just
  # self-inserts. A pretype that is itself a leader key (the major leader, say)
  # opens wk right here on an empty BUFFER and needs no --bind-global.
  if [[ -n "${WK_PRETYPE:-}" ]]; then
    send_literal "$WK_PRETYPE"
    sleep "${WK_SETTLE:-0.6}"
    echo "=== after pretype ==="; screen
    wk_owns_keyboard && saw_wk=1
    # A pretype carrying a leader key opens wk and can run a binding to
    # completion right here. Report that under its own heading and clear it:
    # left in place it would be read out at the end as the result of the keys,
    # which by then are a different run against a freshly opened menu.
    # Both kinds of evidence are written after wk exits, and WK_SETTLE is a
    # knob the caller can set to 0. Poll for the write rather than trusting the
    # sleep above, or the file lands mid-run and is read out at the end as the
    # result of the keys — the very thing this block exists to prevent. Gate on
    # liveness, not on saw_wk: an accept has already exited by now, so saw_wk is
    # 0 for exactly the case worth catching.
    # Both kinds of evidence are written after wk exits, so a pretype that left
    # wk running needs a beat before the check below can see them. This floor is
    # deliberately not WK_SETTLE: at WK_SETTLE=0 the write would land after the
    # check, and the end of the run would then read it out as the result of the
    # keys — the very thing this block exists to prevent. Gate it on saw_wk so
    # the ordinary text pretype, which never reaches wk, pays nothing.
    ((saw_wk == 1)) && sleep 0.3
    if [[ -s "$dump" || -s "$accepted" ]]; then
      echo '=== BUFFER (from the pretype, before the leader) ==='
      [[ -s "$dump" ]] && cat "$dump"
      [[ -s "$accepted" ]] && echo "(WK_REAL_ACCEPT=1: accept-line ran $(cat "$accepted"))"
      : >"$dump"
      : >"$accepted"
    fi
  fi

  # Without --bind-global the leader is only bound when BUFFER is empty
  # (_wk_self_insert_or_wk), so it must be the first thing typed.
  local before_leader
  before_leader="$(screen)"
  send_leader
  # Poll for the screen to change, not merely for wk to exist: the process is up
  # before its key reader is, and the next key sent into that gap is lost. A
  # bare sleep here would race a knob the caller controls — at WK_SETTLE=0 every
  # heading below would describe a run that never happened. Any drawn menu
  # changes the screen, whatever the fixture, the symbols, or the depth the
  # major leader jumps to.
  # saw_wk is the diagnosis below, kept separately from the readiness break: wk
  # can open and then exit on its own (a config.yaml timeout does exactly that),
  # and a liveness probe taken afterwards would call that "never started".
  local w
  for ((w = 0; w < 60; w++)); do
    wk_owns_keyboard && saw_wk=1
    [[ "$(screen)" != "$before_leader" ]] && break
    sleep 0.05
  done
  sleep "${WK_SETTLE:-0.6}"
  echo "=== after leader ==="; screen

  # Without --bind-global the leader self-inserts whenever BUFFER is not empty,
  # so the menu never opens. The heading above still prints and the closing
  # BUFFER dump still looks like wk produced it, so say plainly that it did not.
  # Ask whether wk ever ran rather than looking for the fixture's first key on
  # screen: the major leader jumps straight into a group, where that key is not
  # drawn at all, and the check would call a working run a menu that never
  # opened — directly beneath the menu.
  if ((saw_wk == 0)) && ! wk_owns_keyboard; then
    if [[ -n "${WK_BIND_GLOBAL:-}" ]]; then
      echo '(no menu — the leader did not open wk.)'
    else
      echo '(no menu — the leader did not open wk. Without WK_BIND_GLOBAL it only fires on an empty BUFFER.)'
    fi
  fi

  local k
  for k in "$@"; do
    send_key "$k"
    sleep "${WK_SETTLE:-0.6}"
    echo "=== after '${k}' ==="; screen
  done

  # Both kinds of accept evidence are written after wk exits, so wait for it to
  # let go before reading either. A C-x sent while wk is still reading is
  # swallowed too, so this same wait covers the dump path below.
  for ((w = 0; w < 40; w++)); do wk_owns_keyboard || break; sleep 0.05; done
  # Then a short bounded poll for the accept path, which writes on its own.
  # Trusting the WK_SETTLE sleep instead would put the accept result under the
  # C-x heading at WK_SETTLE=0, and the C-x dump would overwrite it.
  for ((w = 0; w < 10; w++)); do [[ -s "$dump" || -s "$accepted" ]] && break; sleep 0.05; done

  # An `accept: true` binding has already fired _wk_fake_accept and written the
  # dump. Read that first — clearing it and pressing C-x would silently replace
  # the one piece of evidence that the accept path ran.
  if [[ -s "$dump" ]]; then
    echo '=== BUFFER (via accept-widget) ==='; cat "$dump"
    return 0
  fi

  # Gate on a command having actually run, not on the knob being set: under
  # WK_REAL_ACCEPT no stub is installed, so $dump is empty for every binding and
  # a bare `-n "$WK_REAL_ACCEPT"` would claim a run for `widget x` too.
  if [[ -s "$accepted" ]]; then
    # accept-line already ran the command and left a fresh prompt, so a C-x dump
    # would report an empty BUFFER and read as a failure. The screen above is
    # the evidence.
    echo '=== BUFFER ==='
    echo "(WK_REAL_ACCEPT=1: accept-line ran $(cat "$accepted"). Read the screen above.)"
    return 0
  fi

  tmx send-keys 'C-x'
  local i
  for ((i = 0; i < 100; i++)); do [[ -s "$dump" ]] && break; sleep 0.05; done
  echo '=== BUFFER ==='
  if [[ -s "$dump" ]]; then
    cat "$dump"
  elif wk_owns_keyboard; then
    # wk still owns the keyboard and ignores C-x, so it never reached zle. There
    # is no BUFFER yet — the keys given did not reach a `type: command` leaf.
    echo '(wk is still waiting for a key. The keys given never reached a command, so there is no BUFFER yet.)'
  else
    echo '(dump widget wrote nothing)'
  fi
  return 0
}

# --- wk init (no tty needed) ----------------------------------------------
cmd_init() {
  need_bin
  "$bin" init "$@"
}

case "${1:-}" in
  build)  shift; cmd_build "$@" ;;
  keys)   shift; cmd_keys "$@" ;;
  screen) shift; cmd_screen "$@" ;;
  widget) shift; cmd_widget "$@" ;;
  init)   shift; cmd_init "$@" ;;
  '')
    sed -n '2,/^set -uo/p' "${BASH_SOURCE[0]}" | sed -e '$d' -e 's/^# \?//'
    ;;
  *)
    # Exiting 1 here would collide with wk's own "uncaught error" code, making a
    # typo'd subcommand indistinguishable from a wk crash to a calling script.
    sed -n '2,/^set -uo/p' "${BASH_SOURCE[0]}" | sed -e '$d' -e 's/^# \?//' >&2
    die "unknown subcommand: $1"
    ;;
esac
