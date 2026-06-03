/**
 * Assertion harness that turns the fixture files into real tests.
 *
 * The `test/fixtures/*.ts` files are *fixtures*: real JS/TS source whose lines
 * are annotated with inline expectation markers describing what `explicit-ts`
 * should flag. This harness reads those markers, runs the analyzer over each
 * fixture, and asserts that the multiset of `(line, checkType)` checks matches
 * the markers exactly — catching both regressions and false positives.
 *
 * The fixtures are excluded from compilation (see tsconfig.test.json); the
 * harness only ever reads them as text and parses them via `analyzeSource`.
 *
 * Marker grammar
 * --------------
 * Per-line expectation, written as a trailing `// expect:` comment on the line
 * where the check is reported (the construct's starting line):
 *
 *     if (value) {}                  // expect: if
 *     if (a && b) {}                 // expect: if, if, bool_op, bool_op
 *
 * Repeat a name to assert multiplicity. A line with no marker must produce
 * zero checks. A few checks (`arrow`) have a stricter opt-in variant; a fixture
 * declares modes in a header comment:
 *
 *     // explicit-test: modes=default,extra; extra=arrow
 *
 * and per-item mode qualifiers restrict an expectation: `arrow@extra`.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { CHECK_TYPES } from "@/constructs.js";
import { analyzeSource } from "@/fileHandlers.js";

const VALID_MODES = new Set(["default", "extra"]);
const VALID_CHECK_TYPES = new Set<string>(CHECK_TYPES);

const HARNESS_DIR = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(HARNESS_DIR, "..", "..", "test", "fixtures");

const HEADER_RE = /\/\/\s*explicit-test:\s*(.*)$/;
const EXPECT_RE = /\/\/\s*expect:\s*(.*?)\s*$/;

type CheckKey = string; // `${line}:${type}`

interface FixtureSpec {
  path: string;
  modes: string[];
  extras: Set<string>;
  expected: Map<string, Map<CheckKey, number>>;
}

function increment(counter: Map<CheckKey, number>, key: CheckKey): void {
  counter.set(key, (counter.get(key) ?? 0) + 1);
}

function parseHeader(spec: FixtureSpec, body: string): void {
  for (const rawClause of body.split(";")) {
    const clause = rawClause.trim();
    if (clause === "") {
      continue;
    }
    const eq = clause.indexOf("=");
    const key = clause.slice(0, eq).trim();
    const value = clause.slice(eq + 1);
    const items = value
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item !== "");
    if (key === "modes") {
      spec.modes = items;
    } else if (key === "extra") {
      spec.extras = new Set(items);
    } else {
      throw new Error(`${spec.path}: unknown header key '${key}'`);
    }
  }
  for (const mode of spec.modes) {
    if (VALID_MODES.has(mode) === false) {
      throw new Error(`${spec.path}: unknown mode '${mode}'`);
    }
  }
}

function parseExpectation(spec: FixtureSpec, lineNumber: number, expr: string): void {
  for (const rawItem of expr.split(",")) {
    const item = rawItem.trim();
    if (item === "") {
      continue;
    }
    const at = item.indexOf("@");
    const name = (at === -1 ? item : item.slice(0, at)).trim();
    const itemMode = at === -1 ? "" : item.slice(at + 1).trim();

    if (VALID_CHECK_TYPES.has(name) === false) {
      throw new Error(`${spec.path}:${lineNumber}: unknown check type '${name}'`);
    }
    const targetModes = itemMode === "" ? spec.modes : [itemMode];
    for (const mode of targetModes) {
      const counter = spec.expected.get(mode);
      if (counter === undefined) {
        throw new Error(
          `${spec.path}:${lineNumber}: marker mode '${mode}' not in fixture modes`,
        );
      }
      increment(counter, `${lineNumber}:${name}`);
    }
  }
}

function parseFixture(fixturePath: string): FixtureSpec {
  const spec: FixtureSpec = {
    path: fixturePath,
    modes: ["default"],
    extras: new Set(),
    expected: new Map(),
  };
  const lines = readFileSync(fixturePath, "utf-8").split(/\r?\n/);

  for (const raw of lines.slice(0, 10)) {
    const headerMatch = HEADER_RE.exec(raw);
    if (headerMatch !== null) {
      parseHeader(spec, headerMatch[1]!);
      break;
    }
  }

  for (const mode of spec.modes) {
    spec.expected.set(mode, new Map());
  }

  lines.forEach((raw, index) => {
    const expectMatch = EXPECT_RE.exec(raw);
    if (expectMatch !== null) {
      parseExpectation(spec, index + 1, expectMatch[1]!);
    }
  });

  return spec;
}

function actualFor(spec: FixtureSpec, mode: string): Map<CheckKey, number> {
  const includeExtra = mode === "extra" ? spec.extras : new Set<string>();
  const source = readFileSync(spec.path, "utf-8");
  const checks = analyzeSource(source, spec.path, { includeExtra });
  const counter = new Map<CheckKey, number>();
  for (const check of checks) {
    increment(counter, `${check.line}:${check.checkType}`);
  }
  return counter;
}

function diff(
  expected: Map<CheckKey, number>,
  actual: Map<CheckKey, number>,
): string {
  const lines: string[] = [];
  const missing: string[] = [];
  const unexpected: string[] = [];
  const keys = new Set([...expected.keys(), ...actual.keys()]);
  for (const key of [...keys].sort()) {
    const exp = expected.get(key) ?? 0;
    const act = actual.get(key) ?? 0;
    if (act < exp) {
      missing.push(`    ${key} x${exp - act}`);
    } else if (act > exp) {
      unexpected.push(`    ${key} x${act - exp}`);
    }
  }
  if (missing.length > 0) {
    lines.push("  expected but NOT reported:", ...missing);
  }
  if (unexpected.length > 0) {
    lines.push("  reported but NOT expected:", ...unexpected);
  }
  return lines.join("\n");
}

function countersEqual(
  expected: Map<CheckKey, number>,
  actual: Map<CheckKey, number>,
): boolean {
  if (expected.size !== actual.size) {
    return false;
  }
  for (const [key, value] of expected) {
    if (actual.get(key) !== value) {
      return false;
    }
  }
  return true;
}

const fixtures = readdirSync(FIXTURES_DIR)
  .filter((name) => name.startsWith("test_") && name.endsWith(".ts"))
  .sort();

if (fixtures.length === 0) {
  throw new Error(`no fixtures found in ${FIXTURES_DIR}`);
}

for (const name of fixtures) {
  const spec = parseFixture(path.join(FIXTURES_DIR, name));
  for (const mode of spec.modes) {
    test(`${name} [${mode}]`, () => {
      const expected = spec.expected.get(mode)!;
      const actual = actualFor(spec, mode);
      assert.ok(
        countersEqual(expected, actual),
        `\n${name} [${mode}] mismatch:\n${diff(expected, actual)}`,
      );
    });
  }
}
