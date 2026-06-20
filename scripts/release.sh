#!/usr/bin/env bash
#
# Release helper. Bumps the version, stamps the CHANGELOG,
# commits, tags v<version>, and pushes. Pushing the tag IS
# the release: .github/workflows/release.yml fires on the tag
# and does the real work, so nothing is built or published
# here.
#
# What release.yml does on the pushed tag:
#   - npm run check / lint / test
#   - npm run build + build:embed
#   - npm run emit:sri / check:bundle-size / check:reproducible
#   - npx playwright install + npm run seed + npm run a11y
#   - check the tag matches package.json, then
#     npm publish --provenance --access public
#   - attach the dist + dist-embed tarballs to the GitHub
#     release
#
# So this script only prepares and fires the tag; CI builds,
# tests, and publishes. With `gh` installed it then streams
# the run.
#
# Usage: bash scripts/release.sh [-M|-m|-p] [-k] [-n]
#   -M, --major        bump major (x.0.0), breaking changes
#   -m, --minor        bump minor (0.x.0), new features
#   -p, --patch        bump patch (0.0.x) [default]
#   -k, --keep-version re-release the current version as-is
#   -n, --dry-run      print the steps, change nothing
#   -h, --help         show this help

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

usage() {
  cat <<'EOF'
Release helper: bump version, stamp CHANGELOG, commit, tag,
push. The pushed tag triggers .github/workflows/release.yml,
which builds, tests, and publishes to npm.

Usage: npm run release -- [-M|-m|-p] [-k] [-n]
       bash scripts/release.sh [-M|-m|-p] [-k] [-n]

  -M, --major        bump major (x.0.0), breaking changes
  -m, --minor        bump minor (0.x.0), new features
  -p, --patch        bump patch (0.0.x) [default]
  -k, --keep-version re-release the current version as-is
  -n, --dry-run      print the steps, change nothing
  -h, --help         show this help
EOF
}

BUMP="patch"
KEEP=false
DRY=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    -M|--major) BUMP="major" ;;
    -m|--minor) BUMP="minor" ;;
    -p|--patch) BUMP="patch" ;;
    -k|--keep-version) KEEP=true ;;
    -n|--dry-run) DRY=true ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1 (use -h)" >&2; exit 1 ;;
  esac
  shift
done

# Echo every mutating step; run it only when not a dry run.
run() { echo "+ $*"; [ "$DRY" = true ] || "$@"; }

# Release from a clean main only.
branch="$(git rev-parse --abbrev-ref HEAD)"
[ "$branch" = "main" ] || { echo "Not on main (on $branch)." >&2; exit 1; }
git diff --quiet && git diff --cached --quiet || {
  echo "Working tree not clean; commit or stash first." >&2; exit 1
}

# Catch a broken release before it becomes a dangling tag.
# release.yml gates publish on these too, but failing locally
# saves a round-trip.
run npm run check
run npm run lint
run npm test

# Bump package.json + package-lock.json.
[ "$KEEP" = true ] || run npm version "$BUMP" --no-git-tag-version

VERSION="$(node -p "require('./package.json').version")"
TAG="v${VERSION}"
echo "Releasing ${TAG}"
git rev-parse "$TAG" >/dev/null 2>&1 && {
  echo "Tag ${TAG} already exists." >&2; exit 1
} || true

# Turn the accumulated [Unreleased] notes into a dated
# section for this version. Skipped when [Unreleased] is
# empty or when re-releasing the current version.
if [ "$KEEP" = false ] && grep -q '^## \[Unreleased\]' CHANGELOG.md; then
  body="$(awk '/^## \[Unreleased\]/{f=1;next} /^## /{f=0} f' CHANGELOG.md \
    | grep -c '[^[:space:]]' || true)"
  if [ "${body:-0}" -gt 0 ]; then
    run sed -i \
      "0,/^## \[Unreleased\]$/s//## [Unreleased]\n\n## [${VERSION}] - $(date +%F)/" \
      CHANGELOG.md
  else
    echo "Note: CHANGELOG [Unreleased] is empty; not stamping a section."
  fi
fi

# Commit, tag, push. The pushed tag triggers release.yml.
run git add package.json package-lock.json CHANGELOG.md
run git commit -m "Release ${VERSION}"
run git tag "$TAG"
run git push origin "$branch"
run git push origin "$TAG"

echo "Pushed ${TAG}; release.yml is building, testing, and publishing."
if [ "$DRY" = false ] && command -v gh >/dev/null 2>&1; then
  sleep 4
  gh run watch --exit-status 2>/dev/null \
    || echo "(could not attach automatically; try: gh run list)"
fi
