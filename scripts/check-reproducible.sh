#!/usr/bin/env bash
# transpareo-time-machine - open-source DPP renderer
# Copyright (C) 2026 Transpareo AG
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Build the lib bundle twice from a clean tree and
# fail if the sha256-hex values in dist/integrity.json
# diverge across the two runs. A divergence is a
# reproducibility regression (timestamps, RNG, cache
# bleed-through, etc.) the README's "reproducible
# from source" claim cannot tolerate.
#
# Builds the lib bundle twice from scratch (never reusing a
# pre-existing dist/, which could be from another commit and
# make a reproducible build look broken), moves the first
# build aside, diffs the manifests, then restores the first
# build for downstream steps.
set -euo pipefail

# Both passes emit their own integrity manifest before
# being compared; this keeps the script self-contained so a
# caller doesn't have to remember the build, emit:sri,
# check-reproducible ordering.
# Pass 1: always build fresh from the current source.
npm run build
npm run emit:sri
cp dist/integrity.json /tmp/tm-integrity-1.json

# Snapshot the dist tree so the rebuild starts from
# the same empty state every time. `vite build`'s lib
# mode wipes dist/ on each run, but we move it aside
# explicitly so a partial rebuild can never poison the
# comparison.
rm -rf /tmp/tm-dist-1
mv dist /tmp/tm-dist-1

npm run build
npm run emit:sri
cp dist/integrity.json /tmp/tm-integrity-2.json

if diff -u /tmp/tm-integrity-1.json /tmp/tm-integrity-2.json; then
  echo "[reproducible] ok: both builds produced identical hashes"
  rm -rf dist
  mv /tmp/tm-dist-1 dist
  exit 0
fi

echo "[reproducible] FAIL: build is not reproducible" >&2
exit 1
