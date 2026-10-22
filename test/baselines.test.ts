/**
 * Baseline outputs: live runs must match the committed files in nfo/.
 *
 * The policy: everything that is not a deliberate, marker-asserted fixture
 * violation must pass the linter. nfo/explicit.out is the lint report for
 * src/ and must NEVER change — it always shows zero checks (only the file
 * count moves, when sources are added or removed). nfo/tests.out is the stats
 * summary of the tests tree: exactly the deliberate fixture specimens; it
 * changes only when fixtures deliberately change. Regenerate both with
 * scripts/update-nfo.sh and review the diff in the commit.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { REPO_ROOT, runCli } from "./fixtureSpec.ts";

const NFO_DIR = path.join(REPO_ROOT, "nfo");

function liveOutput(target: string): string {
  return runCli([target, "--stats-only", "--no-color"]).stdout.trim();
}

function committed(name: string): string {
  return readFileSync(path.join(NFO_DIR, name), "utf-8").trim();
}

test("baseline: src/ report never changes (always zero checks)", () => {
  const baseline = committed("explicit.out");
  assert.deepEqual(liveOutput("src"), baseline);
  assert.deepEqual(baseline.includes("Total checks found: 0"), true);
});

test("baseline: tests tree stats match nfo (exactly the fixture specimens)", () => {
  assert.deepEqual(liveOutput("test"), committed("tests.out"));
});

// The stats baseline only pins totals, so a real violation in the harness can
// hide inside them as if it were a specimen. This names any finding outside
// the fixtures by file and line; the fixtures' own findings are asserted line
// by line against their markers in fixtures.test.ts.
const FIXTURES_PREFIX = `${path.join("test", "fixtures")}${path.sep}`;

test("baseline: the only findings in the tests tree are fixture specimens", () => {
  const strays: string[] = [];
  for (const finding of JSON.parse(runCli(["test", "--format", "json"]).stdout) as {
    file: string;
    line: number;
    check_type: string;
  }[]) {
    if (finding.file.startsWith(FIXTURES_PREFIX) === false) {
      strays.push(`${finding.file}:${finding.line} ${finding.check_type}`);
    }
  }
  assert.deepEqual(strays, []);
});
