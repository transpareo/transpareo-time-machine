#!/usr/bin/env bash
# transpareo-time-machine - open-source DPP renderer
# Copyright (C) 2026 Transpareo AG
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Populate local fixture data after cloning the repo.
# Reads every `fixtures/*.yml`, validates the schema,
# downloads any referenced images, and emits the signed
# JSON artefacts (manifest, per-version snapshots, EPCIS
# document, branding assets, key resolution docs) into
# `public/<id>/...`. Any stale `src/fixtures/_generated/`
# tree from older seed runs is deleted. The output is
# gitignored, every dev re-runs the seed after pulling a
# fixture change.
#
# Run: `npm run seed` (or `./scripts/seed.sh`).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
npx tsx scripts/seed/generate.ts
