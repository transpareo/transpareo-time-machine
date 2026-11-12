#!/usr/bin/env bash
# transpareo-time-machine - open-source DPP renderer
# Copyright (C) 2026 Transpareo AG
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Runs the browser suite for one engine inside the Playwright
# container image, for a host that lacks the engine's system
# libraries (WebKit on most Linux distros). The image tag
# follows the installed @playwright/test.
#
# The container runs as the user who started the script, the
# one sudo was called by when it runs under sudo, so the files
# the run writes into the checkout stay theirs. Docker goes
# through sudo when its socket refuses this user; npm and node
# stay outside sudo, whose PATH may not hold them. DOCKER
# names another client (podman, or echo to print the command).
#
# Usage: npm run browser:webkit:docker
#        npm run browser:firefox:docker
#        bash scripts/browser-docker.sh webkit|firefox

set -euo pipefail

engine="${1:-}"
case "$engine" in
  webkit|firefox) ;;
  *) echo "usage: browser-docker.sh webkit|firefox" >&2; exit 2 ;;
esac

root="$(cd "$(dirname "$0")/.." && pwd)"
pkg="$root/node_modules/@playwright/test/package.json"
[ -f "$pkg" ] || { echo "run npm ci first: no $pkg" >&2; exit 1; }
version="$(sed -n 's/^  "version": "\([^"]*\)".*/\1/p' "$pkg")"

uid="${SUDO_UID:-$(id -u)}"
gid="${SUDO_GID:-$(id -g)}"

if [ -n "${DOCKER:-}" ]; then
  read -r -a docker <<< "$DOCKER"
elif docker info > /dev/null 2>&1; then
  docker=(docker)
else
  docker=(sudo docker)
fi

exec "${docker[@]}" run --rm --user "$uid:$gid" \
  -e HOME=/tmp -e npm_config_cache=/tmp/.npm \
  -v "$root":/w -w /w \
  "mcr.microsoft.com/playwright:v${version}-noble" \
  npm run "browser:$engine"
