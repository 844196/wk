#!/usr/bin/env bash
# Build the test image and run the suite against a compiled wk binary.
# This is the single entry point for the suite; drive it from mise, not by
# calling docker directly.
set -euo pipefail

here="$(cd "${BASH_SOURCE[0]%/*}" && pwd)"
root="$(cd "${here}/.." && pwd)"
target="${WK_E2E_TARGET:-x86_64-unknown-linux-gnu}"
binary="dist/wk-${target}"

# The image has to match the binary's architecture. Without this, an arm64 host
# silently pairs an arm64 image with an x86_64 binary and every test dies with
# "exec format error".
case "$target" in
  x86_64-*-linux-*) platform='linux/amd64' ;;
  aarch64-*-linux-*) platform='linux/arm64' ;;
  *)
    echo "e2e can only run linux targets, got: ${target}" >&2
    exit 1
    ;;
esac

if [[ ! -x "${root}/${binary}" ]]; then
  echo "${binary} not found. Run: mise run build:internal ${target}" >&2
  exit 1
fi

# bats runs inside the container, where the suite is mounted at /e2e. Translate
# host-side paths so that `./e2e/run.sh e2e/tests/01_protocol.bats` works too.
# Sort arguments into bats flags and test targets. A flag's value must never be
# mistaken for a target, or the default target is dropped and bats runs nothing.
value_taking_flags=' -f --filter --filter-status --filter-tags -j --jobs -o --output --report-formatter --line-reference-format --gather-test-outputs-in '

bats_targets=()
given_target=0
expect_value=0
for arg in "$@"; do
  if [[ $expect_value -eq 1 ]]; then
    bats_targets+=("$arg")
    expect_value=0
    continue
  fi

  if [[ "$arg" == -* ]]; then
    bats_targets+=("$arg")
    if [[ "$value_taking_flags" == *" ${arg} "* ]]; then
      expect_value=1
    fi
    continue
  fi

  # The suite is mounted at /e2e, so host-side paths need translating.
  case "$arg" in
    "${here}"/*)
      bats_targets+=("/e2e${arg#"${here}"}")
      given_target=1
      ;;
    ./e2e/*)
      bats_targets+=("/${arg#./}")
      given_target=1
      ;;
    e2e/*)
      bats_targets+=("/${arg}")
      given_target=1
      ;;
    /e2e/*)
      bats_targets+=("$arg")
      given_target=1
      ;;
    *.bats)
      echo "test paths must live under ${here}, got: ${arg}" >&2
      exit 1
      ;;
    *)
      bats_targets+=("$arg")
      ;;
  esac
done
if [[ $given_target -eq 0 ]]; then
  bats_targets+=('/e2e/tests')
fi

docker build --quiet --platform "$platform" --tag wk-e2e "${here}" >/dev/null

# The image holds only the test runtime; the binary and the suite are mounted so
# that editing either needs no rebuild.
exec docker run --init --rm --platform "$platform" \
  --volume "${root}/dist:/dist:ro" \
  --volume "${here}:/e2e:ro" \
  --env "WK_BIN=/dist/wk-${target}" \
  wk-e2e \
  bats "${bats_targets[@]}"
