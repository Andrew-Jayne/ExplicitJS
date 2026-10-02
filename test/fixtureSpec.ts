/**
 * Shared test helpers: the fixture-marker parser and fixture discovery.
 *
 * Not itself a test file — the `*.test.ts` harnesses import from it. The
 * marker grammar the parser reads is documented in test/README.md: fixtures
 * are real source files annotated with trailing `// expect: <check, check>`
 * comments. Every check is mandatory, so there is nothing to configure per
 * fixture — one run, one expected multiset.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isCheckType } from "../src/constructs.ts";
import { analyzeFile } from "../src/fileHandlers.ts";

export const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.dirname(TESTS_DIR);

const FIXTURES_DIR = path.join(TESTS_DIR, "fixtures");

const FIXTURE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".svelte",
  ".vue",
]);

const EXPECT_RE = /\/\/\s*expect:\s*(.*?)\s*$/;

/** Multiset of findings, keyed `<line>:<checkType>` -> count. */
export type CheckCounter = Map<string, number>;

export interface FixtureSpec {
  path: string;
  expected: CheckCounter;
}

export function incrementCount(counter: CheckCounter, key: string): void {
  const current = counter.get(key);
  if (current === undefined) {
    counter.set(key, 1);
  } else {
    counter.set(key, current + 1);
  }
}

/** Parse one fixture's per-line expectation markers. */
export function parseFixture(fixturePath: string): FixtureSpec {
  const spec: FixtureSpec = { path: fixturePath, expected: new Map() };
  for (const [index, raw] of readFileSync(fixturePath, "utf-8").split("\n").entries()) {
    const expectMatch = EXPECT_RE.exec(raw);
    if (expectMatch === null) {
      continue;
    }
    const lineNumber = index + 1;
    for (const rawItem of expectMatch[1]!.split(",")) {
      const name = rawItem.trim();
      if (name === "") {
        continue;
      }
      if (isCheckType(name) === false) {
        throw new Error(
          `${path.basename(fixturePath)}:${lineNumber}: unknown check type '${name}'`,
        );
      }
      incrementCount(spec.expected, `${lineNumber}:${name}`);
    }
  }
  return spec;
}

export function discoverFixtures(): string[] {
  const fixtures: string[] = [];
  for (const entry of readdirSync(FIXTURES_DIR)) {
    if (
      entry.startsWith("test_") === true &&
      FIXTURE_EXTENSIONS.has(path.extname(entry)) === true
    ) {
      fixtures.push(path.join(FIXTURES_DIR, entry));
    }
  }
  fixtures.sort();
  if (fixtures.length === 0) {
    throw new Error(`no fixtures found under ${FIXTURES_DIR}`);
  }
  return fixtures;
}

/** Run the analyzer over the fixture and count its findings. */
export function actualFor(spec: FixtureSpec): CheckCounter {
  const counter: CheckCounter = new Map();
  for (const check of analyzeFile(spec.path)) {
    incrementCount(counter, `${check.line}:${check.checkType}`);
  }
  return counter;
}

export function countersEqual(left: CheckCounter, right: CheckCounter): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const [key, count] of left) {
    if (right.get(key) !== count) {
      return false;
    }
  }
  return true;
}

function appendCounterDiff(
  output: string[],
  title: string,
  left: CheckCounter,
  right: CheckCounter,
): void {
  const rows: string[] = [];
  for (const [key, leftCount] of [...left.entries()].sort((first, second) => {
    const firstLine = Number(first[0].slice(0, first[0].indexOf(":")));
    const secondLine = Number(second[0].slice(0, second[0].indexOf(":")));
    if (firstLine !== secondLine) {
      return firstLine - secondLine;
    }
    if (first[0] < second[0]) {
      return -1;
    }
    if (first[0] > second[0]) {
      return 1;
    }
    return 0;
  })) {
    let rightCount = right.get(key);
    if (rightCount === undefined) {
      rightCount = 0;
    }
    if (leftCount > rightCount) {
      const separator = key.indexOf(":");
      rows.push(
        `    line ${key.slice(0, separator)}: ${key.slice(separator + 1)} x${leftCount - rightCount}`,
      );
    }
  }
  if (rows.length > 0) {
    output.push(`  ${title}`);
    output.push(...rows);
  }
}

export function formatDiff(expected: CheckCounter, actual: CheckCounter): string {
  const output: string[] = [];
  appendCounterDiff(output, "expected but NOT reported:", expected, actual);
  appendCounterDiff(output, "reported but NOT expected:", actual, expected);
  return output.join("\n");
}
