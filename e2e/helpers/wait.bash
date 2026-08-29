#!/usr/bin/env bash
# Polling waits. Never use a fixed `sleep`: polling is fast when things go well
# and still survives a slow CI machine.

WK_E2E_POLL_INTERVAL="${WK_E2E_POLL_INTERVAL:-0.05}"
WK_E2E_POLL_TIMEOUT="${WK_E2E_POLL_TIMEOUT:-10}"

# wait_until <description> <command...> — poll until the command succeeds.
wait_until() {
  local description="$1"
  shift

  local deadline=$(($(date +%s) + WK_E2E_POLL_TIMEOUT))

  while :; do
    if "$@"; then
      return 0
    fi
    if [[ $(date +%s) -ge $deadline ]]; then
      echo "timed out after ${WK_E2E_POLL_TIMEOUT}s waiting for: ${description}" >&2
      return 1
    fi
    sleep "$WK_E2E_POLL_INTERVAL"
  done
}

# wait_for_file <path> — poll until the file exists and is non-empty.
wait_for_file() {
  wait_until "file to appear: $1" test -s "$1"
}

# wait_for_text <path> <substring> — poll until the file contains the substring.
wait_for_text() {
  wait_until "'$2' in $1" grep -qF -- "$2" "$1"
}
