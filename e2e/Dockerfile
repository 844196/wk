# Test runtime only. Deliberately contains no Deno: the wk binary and the test
# suite are bind-mounted, so this image stays stable and layer-cached even when
# the implementation language changes.
FROM debian:bookworm-slim@sha256:88200866dfff7ea7f5cbcb6ec7c8a701889efe6fe859fe64d6990e4b07ea4171

# Pinned to commits, not tags: a tag can be moved upstream, and this repo pins
# its base image by digest and its GitHub Actions by SHA for the same reason.
ARG BATS_CORE_COMMIT=eb7f42f8d608ac693d7a4b67474f6714ea68cfc5    # v1.14.0
ARG BATS_SUPPORT_COMMIT=24a72e14349690bcbf7c151b9d2d1cdd32d36eb1 # v0.3.0
ARG BATS_ASSERT_COMMIT=78fa631d1370562d2cd4a1390989e706158e7bf0  # v2.1.0

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    coreutils \
    git \
    tmux \
    util-linux \
    zsh \
  && rm -rf /var/lib/apt/lists/* \
  && command -v script >/dev/null

RUN set -eu; \
  for spec in \
    "bats-core:${BATS_CORE_COMMIT}:/tmp/bats-core" \
    "bats-support:${BATS_SUPPORT_COMMIT}:/opt/bats-support" \
    "bats-assert:${BATS_ASSERT_COMMIT}:/opt/bats-assert" \
  ; do \
    repo="${spec%%:*}"; rest="${spec#*:}"; commit="${rest%%:*}"; dest="${rest#*:}"; \
    git init -q "$dest"; \
    git -C "$dest" fetch -q --depth 1 "https://github.com/bats-core/${repo}.git" "$commit"; \
    git -C "$dest" checkout -q FETCH_HEAD; \
    rm -rf "$dest/.git"; \
  done; \
  /tmp/bats-core/install.sh /usr/local; \
  rm -rf /tmp/bats-core

# Pinned so rendering and formatting never depend on the host environment.
ENV LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    TZ=UTC \
    TERM=xterm-256color \
    SHELL=/bin/bash

WORKDIR /e2e
