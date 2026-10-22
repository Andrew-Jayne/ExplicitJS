/**
 * CLI end-to-end tests: the real executable, real JSON, real exit codes.
 *
 * These cover what the in-process harness cannot: argument parsing, config
 * discovery, the JSON reporter, the list-checks command, and the exit-code
 * contract (0 clean, 1 findings, 20 bad args).
 */

import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { CHECK_TYPES } from "../src/constructs.ts";
import {
  type CheckCounter,
  countersEqual,
  discoverFixtures,
  formatDiff,
  incrementCount,
  makeTempDir,
  parseFixture,
  removeDir,
  runCli,
} from "./fixtureSpec.ts";

interface JsonCheck {
  line: number;
  check_type: string;
}

for (const fixturePath of discoverFixtures()) {
  test(`cli json: ${path.basename(fixturePath)}`, () => {
    const expected = parseFixture(fixturePath).expected;
    const result = runCli([fixturePath, "--format", "json"]);
    const actual: CheckCounter = new Map();
    for (const item of JSON.parse(result.stdout) as JsonCheck[]) {
      incrementCount(actual, `${item.line}:${item.check_type}`);
    }

    if (countersEqual(expected, actual) === false) {
      throw new Error(
        `\n${path.basename(fixturePath)} CLI JSON mismatch:\n${formatDiff(expected, actual)}`,
      );
    }
    if (expected.size > 0) {
      assert.deepEqual(result.code, 1);
    } else {
      assert.deepEqual(result.code, 0);
    }
  });
}

test("cli exit code: clean file exits 0", () => {
  const tempDir = makeTempDir();
  try {
    writeFileSync(path.join(tempDir, "clean.ts"), 'export const GREETING = "hello";\n');
    assert.deepEqual(runCli([tempDir]).code, 0);
  } finally {
    removeDir(tempDir);
  }
});

test("cli exit code: unusable invocations exit 20", () => {
  const noPath = runCli([]);
  assert.deepEqual(noPath.code, 20);
  assert.notDeepEqual(noPath.stderr, "");

  assert.deepEqual(runCli(["--bogus-flag"]).code, 20);
  assert.deepEqual(runCli(["this_file_does_not_exist.ts"]).code, 20);
});

test("cli list-checks prints the catalog and exits 0", () => {
  const checksResult = runCli(["list-checks"]);
  assert.deepEqual(checksResult.code, 0);
  for (const checkType of CHECK_TYPES) {
    assert.deepEqual(checksResult.stdout.includes(checkType), true, checkType);
  }
});
