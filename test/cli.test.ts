/**
 * CLI end-to-end tests: the real executable, real JSON, real exit codes.
 *
 * These cover what the in-process harness cannot: argument parsing, config
 * discovery, the JSON reporter, the listing commands, and the exit-code
 * contract (0 clean, 1 findings, 20 bad args).
 */

import { assertEquals, assertNotEquals } from "jsr:@std/assert@^1.0.19";
import path from "node:path";
import { CHECK_TYPES, EXTRA_CHECKS } from "../src/constructs.ts";
import {
  type CheckCounter,
  countersEqual,
  fixturesWithMode,
  formatDiff,
  incrementCount,
  parseFixture,
  REPO_ROOT,
} from "./fixtureSpec.ts";

interface CliResult {
  stdout: string;
  stderr: string;
  code: number;
}

function runCli(cliArgs: string[]): CliResult {
  const finished = new Deno.Command(Deno.execPath(), {
    args: ["run", "--allow-read", "--allow-env", path.join(REPO_ROOT, "src", "cli.ts"), ...cliArgs],
    cwd: REPO_ROOT,
    stdout: "piped",
    stderr: "piped",
  }).outputSync();
  const decoder = new TextDecoder();
  return {
    stdout: decoder.decode(finished.stdout),
    stderr: decoder.decode(finished.stderr),
    code: finished.code,
  };
}

interface JsonCheck {
  line: number;
  check_type: string;
}

function jsonToCounter(stdout: string): CheckCounter {
  const counter: CheckCounter = new Map();
  for (const item of JSON.parse(stdout) as JsonCheck[]) {
    incrementCount(counter, `${item.line}:${item.check_type}`);
  }
  return counter;
}

function assertCliMatchesMarkers(fixturePath: string, mode: string): void {
  const spec = parseFixture(fixturePath);
  const expected = spec.expected.get(mode)!;

  const cliArgs = [fixturePath, "--format", "json"];
  if (mode === "extra") {
    for (const extra of [...spec.extras].sort()) {
      cliArgs.push("--include-extra", extra);
    }
  }
  const result = runCli(cliArgs);
  const actual = jsonToCounter(result.stdout);

  if (countersEqual(expected, actual) === false) {
    throw new Error(
      `\n${path.basename(fixturePath)} [${mode}] CLI JSON mismatch:\n${formatDiff(expected, actual)}`,
    );
  }
  if (expected.size > 0) {
    assertEquals(result.code, 1);
  } else {
    assertEquals(result.code, 0);
  }
}

for (const fixturePath of fixturesWithMode("default")) {
  Deno.test(`cli json: ${path.basename(fixturePath)} [default]`, () => {
    assertCliMatchesMarkers(fixturePath, "default");
  });
}

for (const fixturePath of fixturesWithMode("extra")) {
  Deno.test(`cli json: ${path.basename(fixturePath)} [extra]`, () => {
    assertCliMatchesMarkers(fixturePath, "extra");
  });
}

Deno.test("cli exit code: clean file exits 0", () => {
  const tempDir = Deno.makeTempDirSync();
  try {
    Deno.writeTextFileSync(path.join(tempDir, "clean.ts"), 'export const GREETING = "hello";\n');
    assertEquals(runCli([tempDir]).code, 0);
  } finally {
    Deno.removeSync(tempDir, { recursive: true });
  }
});

Deno.test("cli exit code: unusable invocations exit 20", () => {
  const noPath = runCli([]);
  assertEquals(noPath.code, 20);
  assertNotEquals(noPath.stderr, "");

  assertEquals(runCli(["--bogus-flag"]).code, 20);
  assertEquals(runCli(["this_file_does_not_exist.ts"]).code, 20);
});

Deno.test("cli listing commands print their catalogs and exit 0", () => {
  const checksResult = runCli(["list-checks"]);
  assertEquals(checksResult.code, 0);
  for (const checkType of CHECK_TYPES) {
    assertEquals(checksResult.stdout.includes(checkType), true, checkType);
  }

  const extrasResult = runCli(["list-extras"]);
  assertEquals(extrasResult.code, 0);
  for (const extra of EXTRA_CHECKS) {
    assertEquals(extrasResult.stdout.includes(extra), true, extra);
  }
});
