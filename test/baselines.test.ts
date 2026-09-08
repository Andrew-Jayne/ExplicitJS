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

import { assertEquals } from "jsr:@std/assert@^1.0.19";
import { readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./fixtureSpec.ts";

const NFO_DIR = path.join(REPO_ROOT, "nfo");

function liveOutput(target: string): string {
  return new TextDecoder()
    .decode(
      new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "--allow-read",
          "--allow-env",
          path.join(REPO_ROOT, "src", "cli.ts"),
          target,
          "--stats-only",
          "--no-color",
        ],
        cwd: REPO_ROOT,
        stdout: "piped",
        stderr: "piped",
      }).outputSync().stdout,
    )
    .trim();
}

function committed(name: string): string {
  return readFileSync(path.join(NFO_DIR, name), "utf-8").trim();
}

Deno.test("baseline: src/ report never changes (always zero checks)", () => {
  const baseline = committed("explicit.out");
  assertEquals(liveOutput("src"), baseline);
  assertEquals(baseline.includes("Total checks found: 0"), true);
});

Deno.test("baseline: tests tree stats match nfo (exactly the fixture specimens)", () => {
  assertEquals(liveOutput("test"), committed("tests.out"));
});
