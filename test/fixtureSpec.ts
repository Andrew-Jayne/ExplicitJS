/**
 * Shared test helpers: the fixture-marker parser and fixture discovery.
 *
 * Not itself a test file — the `*.test.ts` harnesses import from it. The
 * marker grammar the parser reads is documented in test/README.md: fixtures
 * are real source files annotated with trailing `// expect: <check, check>`
 * comments, optionally qualified per mode (`if@default`), plus an optional
 * `// explicit-test: modes=...; extra=...` header within the first 10 lines.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type CheckType, EXTRA_CHECKS, isCheckType } from "../src/constructs.ts";
import { analyzeFile } from "../src/fileHandlers.ts";

export const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.dirname(TESTS_DIR);

// Fixtures are grouped by the tier of check they exercise: default_checks/ for
// the always-on set, extra_checks/ for the opt-in --include-extra set (those
// fixtures typically declare both modes, since the stock variant still applies).
const FIXTURE_DIRS: readonly string[] = [
  path.join(TESTS_DIR, "default_checks"),
  path.join(TESTS_DIR, "extra_checks"),
];

const FIXTURE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".svelte",
  ".vue",
]);

const VALID_MODES: ReadonlySet<string> = new Set(["default", "extra"]);
const HEADER_SEARCH_LINES = 10;
const HEADER_RE = /\/\/\s*explicit-test:\s*(.*)$/;
const EXPECT_RE = /\/\/\s*expect:\s*(.*?)\s*$/;

/** Multiset of findings, keyed `<line>:<checkType>` -> count. */
export type CheckCounter = Map<string, number>;

export interface FixtureSpec {
  path: string;
  modes: string[];
  extras: Set<string>;
  /** mode -> expected findings for that analyzer configuration. */
  expected: Map<string, CheckCounter>;
}

export function incrementCount(counter: CheckCounter, key: string): void {
  const current = counter.get(key);
  if (current === undefined) {
    counter.set(key, 1);
  } else {
    counter.set(key, current + 1);
  }
}

/** Parse one fixture's header directive and per-line expectation markers. */
export function parseFixture(fixturePath: string): FixtureSpec {
  const spec: FixtureSpec = {
    path: fixturePath,
    modes: ["default"],
    extras: new Set(),
    expected: new Map(),
  };
  const fixtureName = path.basename(fixturePath);
  const lines = readFileSync(fixturePath, "utf-8").split("\n");

  // Header directive (search the first handful of lines).
  for (const raw of lines.slice(0, HEADER_SEARCH_LINES)) {
    const headerMatch = HEADER_RE.exec(raw);
    if (headerMatch === null) {
      continue;
    }
    for (const rawClause of headerMatch[1]!.split(";")) {
      const clause = rawClause.trim();
      if (clause === "") {
        continue;
      }
      const separator = clause.indexOf("=");
      if (separator === -1) {
        throw new Error(`${fixtureName}: malformed header clause '${clause}'`);
      }
      const key = clause.slice(0, separator).trim();
      const items: string[] = [];
      for (const piece of clause.slice(separator + 1).split(",")) {
        if (piece.trim() !== "") {
          items.push(piece.trim());
        }
      }
      if (key === "modes") {
        spec.modes = items;
      } else if (key === "extra") {
        spec.extras = new Set(items);
      } else {
        throw new Error(`${fixtureName}: unknown header key '${key}'`);
      }
    }
    break;
  }
  for (const mode of spec.modes) {
    if (VALID_MODES.has(mode) === false) {
      throw new Error(`${fixtureName}: unknown mode '${mode}'`);
    }
    spec.expected.set(mode, new Map());
  }
  for (const extra of spec.extras) {
    if (isCheckType(extra) === false || EXTRA_CHECKS.has(extra as CheckType) === false) {
      throw new Error(`${fixtureName}: unknown extra check '${extra}'`);
    }
  }

  // Per-line expectation markers.
  for (const [index, raw] of lines.entries()) {
    const expectMatch = EXPECT_RE.exec(raw);
    if (expectMatch === null) {
      continue;
    }
    const lineNumber = index + 1;
    for (const rawItem of expectMatch[1]!.split(",")) {
      const item = rawItem.trim();
      if (item === "") {
        continue;
      }
      const qualifier = item.indexOf("@");
      let name = item;
      let itemMode = "";
      if (qualifier !== -1) {
        name = item.slice(0, qualifier).trim();
        itemMode = item.slice(qualifier + 1).trim();
      }
      if (isCheckType(name) === false) {
        throw new Error(`${fixtureName}:${lineNumber}: unknown check type '${name}'`);
      }
      if (itemMode !== "" && spec.modes.includes(itemMode) === false) {
        throw new Error(
          `${fixtureName}:${lineNumber}: marker mode '${itemMode}' not in fixture modes [${spec.modes.join(", ")}]`,
        );
      }
      let targetModes = spec.modes;
      if (itemMode !== "") {
        targetModes = [itemMode];
      }
      for (const mode of targetModes) {
        incrementCount(spec.expected.get(mode)!, `${lineNumber}:${name}`);
      }
    }
  }
  return spec;
}

export function discoverFixtures(): string[] {
  const fixtures: string[] = [];
  for (const directory of FIXTURE_DIRS) {
    for (const entry of readdirSync(directory)) {
      if (
        entry.startsWith("test_") === true &&
        FIXTURE_EXTENSIONS.has(path.extname(entry)) === true
      ) {
        fixtures.push(path.join(directory, entry));
      }
    }
  }
  fixtures.sort();
  if (fixtures.length === 0) {
    throw new Error(`no fixtures found under ${FIXTURE_DIRS.join(", ")}`);
  }
  return fixtures;
}

export function fixturesWithMode(mode: string): string[] {
  const matching: string[] = [];
  for (const fixturePath of discoverFixtures()) {
    if (parseFixture(fixturePath).modes.includes(mode) === true) {
      matching.push(fixturePath);
    }
  }
  return matching;
}

export function includeExtraFor(spec: FixtureSpec, mode: string): Set<string> {
  if (mode === "extra") {
    return new Set(spec.extras);
  }
  return new Set();
}

/** Run the analyzer over the fixture in one mode and count its findings. */
export function actualFor(spec: FixtureSpec, mode: string): CheckCounter {
  const counter: CheckCounter = new Map();
  for (const check of analyzeFile(spec.path, { includeExtra: includeExtraFor(spec, mode) })) {
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

function compareCounterKeys(left: string, right: string): number {
  const leftLine = Number(left.slice(0, left.indexOf(":")));
  const rightLine = Number(right.slice(0, right.indexOf(":")));
  if (leftLine !== rightLine) {
    return leftLine - rightLine;
  }
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function appendCounterDiff(
  output: string[],
  title: string,
  left: CheckCounter,
  right: CheckCounter,
): void {
  const rows: string[] = [];
  for (const key of [...left.keys()].sort(compareCounterKeys)) {
    const leftCount = left.get(key)!;
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
