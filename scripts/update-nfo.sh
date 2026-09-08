#!/usr/bin/env bash
# Regenerate the committed baselines in nfo/ (checked by test/baselines.test.ts)
# plus the tracked-but-not-CI-checked cloc line counts. Run after deliberately
# changing fixtures or adding source files, and review the diff in the commit.
set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p nfo

# The src/ report must always show zero checks (exit 0); the tests tree holds
# the deliberate fixture specimens, so its run exits 1 - both are fine here.
deno run --allow-read --allow-env src/cli.ts src --stats-only --no-color > nfo/explicit.out
deno run --allow-read --allow-env src/cli.ts test --stats-only --no-color > nfo/tests.out || true

if command -v cloc > /dev/null; then
  cloc --quiet src > nfo/code_count_explicit.nfo
  cloc --quiet test > nfo/code_count_tests.nfo
else
  echo "cloc not found - skipping code_count_*.nfo" >&2
fi

echo "nfo/ regenerated:"
ls -1 nfo
