/**
 * Table-driven tests for the analyzer.
 *
 * Each case is a self-contained snippet of source plus the exact multiset of
 * checks it should produce, expressed as a `{ checkType: count }` map (omit a
 * type to assert zero). `analyzeSource` only parses — it never resolves imports
 * or executes — so snippets can reference undeclared identifiers freely; that
 * keeps expression-level cases (if/while/ternary/…) free of scaffolding noise.
 * Declaration-based checks (single_use_*, single_letter_var) use real bindings.
 *
 * `extra` opts a case into the stricter `include-extra` variant of a check
 * (currently only `arrow`), mirroring the CLI's `--include-extra` flag.
 */

import { assertEquals } from "jsr:@std/assert@^1.0.19";
import { CHECK_TYPES, type CheckType } from "../src/constructs.ts";
import { analyzeSource } from "../src/fileHandlers.ts";

type Counts = Partial<Record<CheckType, number>>;

interface Case {
  name: string;
  source: string;
  expect: Counts;
  extra?: CheckType[];
}

const VALID = new Set<string>(CHECK_TYPES);

function countByType(source: string, extra: CheckType[]): Counts {
  const checks = analyzeSource(source, "case.ts", {
    includeExtra: new Set(extra),
  });
  const counts: Counts = {};
  for (const check of checks) {
    counts[check.checkType] = (counts[check.checkType] ?? 0) + 1;
  }
  return counts;
}

const cases: Case[] = [
  // --- if: truthiness in an if condition --------------------------------
  { name: "if: bare identifier", source: "if (items) {}", expect: { if: 1 } },
  { name: "if: negated identifier", source: "if (!value) {}", expect: { if: 1 } },
  { name: "if: call expression", source: "if (getValue()) {}", expect: { if: 1 } },
  { name: "if: negated call", source: "if (!getValue()) {}", expect: { if: 1 } },
  { name: "if: element access", source: "if (items[0]) {}", expect: { if: 1 } },
  { name: "if: comparison is explicit", source: "if (count > 0) {}", expect: {} },
  { name: "if: strict equality is explicit", source: "if (value === true) {}", expect: {} },
  { name: "if: negated comparison is explicit", source: "if (!(count > 0)) {}", expect: {} },
  { name: "if: boolean literal is explicit", source: "if (true) {}", expect: {} },
  {
    name: "if: && of two implicit booleans",
    source: "if (value && other) {}",
    expect: { if: 2, bool_op: 2 },
  },
  { name: "if: && of two comparisons", source: "if (count > 0 && count < 10) {}", expect: {} },
  {
    name: "if: mixed && (implicit + comparison)",
    source: "if (value && count > 0) {}",
    expect: { if: 1, bool_op: 1 },
  },
  {
    name: "if: || of two implicit booleans",
    source: "if (value || other) {}",
    expect: { if: 2, bool_op: 2 },
  },
  {
    name: "if: else-if implicit boolean",
    source: "if (count > 0) {} else if (getValue()) {}",
    expect: { if: 1 },
  },

  // --- while / do-while -------------------------------------------------
  { name: "while: bare identifier", source: "while (queue) { break; }", expect: { while: 1 } },
  { name: "while: call expression", source: "while (poll()) { break; }", expect: { while: 1 } },
  { name: "while: negated identifier", source: "while (!ready) { break; }", expect: { while: 1 } },
  { name: "while: comparison is explicit", source: "while (size > 0) { break; }", expect: {} },
  {
    name: "while: strict equality is explicit",
    source: "while (ready === true) { break; }",
    expect: {},
  },
  { name: "do-while: bare identifier", source: "do {} while (queue);", expect: { while: 1 } },
  { name: "do-while: comparison is explicit", source: "do {} while (size > 0);", expect: {} },

  // --- assert truthiness ------------------------------------------------
  { name: "assert: bare identifier", source: "assert(ok1);", expect: { assert: 1 } },
  { name: "assert: comparison is explicit", source: "assert(num > 0);", expect: {} },
  { name: "assert: console.assert", source: "console.assert(ok1);", expect: { assert: 1 } },
  { name: "assert: console.assert comparison", source: "console.assert(num > 0);", expect: {} },
  { name: "assert: assert.ok", source: "assert.ok(ok1);", expect: { assert: 1 } },
  { name: "assert: negated identifier", source: "assert(!ok1);", expect: { assert: 1 } },

  // --- ternary ----------------------------------------------------------
  { name: "ternary: implicit condition", source: "flag ? yes : no;", expect: { ternary: 1 } },
  {
    name: "ternary: comparison condition",
    source: "score > 0 ? yes : no;",
    expect: { ternary: 1 },
  },
  {
    name: "ternary: nested",
    source: "flag ? (score > 0 ? yes : no) : no;",
    expect: { ternary: 2 },
  },

  // --- optional chaining ------------------------------------------------
  { name: "optional_chain: single", source: "request?.headers;", expect: { optional_chain: 1 } },
  {
    name: "optional_chain: deep chain counts once",
    source: "request?.headers?.auth?.token;",
    expect: { optional_chain: 1 },
  },
  { name: "optional_chain: none present", source: "request.headers.auth.token;", expect: {} },
  {
    name: "optional_chain: leading only",
    source: "request?.headers.auth.token;",
    expect: { optional_chain: 1 },
  },
  {
    name: "optional_chain: computed access",
    source: 'request?.["headers"]?.auth;',
    expect: { optional_chain: 1 },
  },
  { name: "optional_chain: call", source: "request?.fn?.();", expect: { optional_chain: 1 } },

  // --- boolean operators ------------------------------------------------
  { name: "bool_op: && of two", source: "x1 && y1;", expect: { bool_op: 2 } },
  { name: "bool_op: || of two", source: "x1 || y1;", expect: { bool_op: 2 } },
  { name: "bool_op: && of three", source: "x1 && y1 && z1;", expect: { bool_op: 3 } },
  { name: "bool_op: one implicit operand", source: "count > 0 && x1;", expect: { bool_op: 1 } },
  { name: "bool_op: both comparisons", source: "count > 0 && count < 10;", expect: {} },
  {
    name: "bool_op: mixed nested",
    source: "(x1 && count > 0) || y1;",
    expect: { bool_op: 3 },
  },

  // --- .filter(Boolean) -------------------------------------------------
  { name: "filter: Boolean predicate", source: "values.filter(Boolean);", expect: { filter: 1 } },
  {
    name: "filter: explicit predicate",
    source: "values.filter((value) => value > 0);",
    expect: {},
  },
  {
    name: "filter: chained Boolean",
    source: "values.map((value) => value).filter(Boolean);",
    expect: { filter: 1 },
  },

  // --- loose equality ---------------------------------------------------
  { name: "loose_equality: ==", source: "a2 == b2;", expect: { loose_equality: 1 } },
  { name: "loose_equality: !=", source: "a2 != b2;", expect: { loose_equality: 1 } },
  { name: "loose_equality: === is clean", source: "a2 === b2;", expect: {} },
  { name: "loose_equality: !== is clean", source: "a2 !== b2;", expect: {} },

  // --- single-letter names ----------------------------------------------
  {
    name: "single_letter_var: const (export does not exempt)",
    source: "export const x = 1;",
    expect: { single_letter_var: 1 },
  },
  {
    name: "single_letter_var: params",
    source: "export function fn(a, b): number { return a + b; }",
    expect: { single_letter_var: 2 },
  },
  {
    name: "single_letter_var: class name",
    source: "export class C {}",
    expect: { single_letter_var: 1 },
  },
  {
    name: "single_letter_var: for-loop index",
    source: "for (let i = 0; i < 3; i = i + 1) {}",
    expect: { single_letter_var: 1 },
  },
  {
    name: "single_letter_var: catch binding",
    source: "try {} catch (e) {}",
    expect: { single_letter_var: 1 },
  },
  { name: "single_letter_var: underscore is exempt", source: "const _ = 5;", expect: {} },
  {
    name: "single_letter_var: multi-letter is clean",
    source: 'export const label = "ok";',
    expect: {},
  },

  // --- single-use variables ---------------------------------------------
  {
    name: "single_use_var: assigned once, read once",
    source: "export function demo(): number { const result = compute(); return result; }",
    expect: { single_use_var: 1 },
  },
  {
    name: "single_use_var: read twice (expression reused)",
    source:
      "export function demo(): number { const total = compute() + compute(); return total + total; }",
    expect: {},
  },
  {
    name: "single_use_var: read twice",
    source: "export function demo(): number { const value = compute(); return value + value; }",
    expect: {},
  },
  {
    name: "single_use_var: ALL_CAPS constant is exempt, lowercase is not",
    source:
      "export function demo(): number { const MAX_RETRIES = compute(); const attempts = compute(); return MAX_RETRIES + attempts; }",
    expect: { single_use_var: 1 },
  },
  {
    name: "single_use_var: exported binding is exempt",
    source: "export const CONSTANT_THING = compute();",
    expect: {},
  },

  // --- single-use functions ---------------------------------------------
  {
    name: "single_use_func: nested helper called once",
    source:
      "export function caller(): number { function helper(): number { return 1; } return helper(); }",
    expect: { single_use_func: 1 },
  },
  {
    name: "single_use_func: called twice",
    source:
      "export function caller(): number { function twice(): number { return 2; } return twice() + twice(); }",
    expect: {},
  },
  {
    name: "single_use_func: main entry point is exempt",
    source: "function main(): void { doStuff(); } function doStuff(): void {}",
    expect: {},
  },

  // --- arrow / function expressions (default vs. extra) -----------------
  {
    name: "arrow: ternary body is ambiguous (default)",
    source: "(val) => (val ? 1 : 0);",
    expect: { arrow: 1, ternary: 1 },
  },
  {
    name: "arrow: && body is ambiguous (default)",
    source: "(val) => val && nums;",
    expect: { arrow: 1, bool_op: 2 },
  },
  {
    name: "arrow: negation body is ambiguous (default)",
    source: "(val) => !val;",
    expect: { arrow: 1 },
  },
  {
    name: "arrow: comparison body not flagged by default",
    source: "(val) => val === 0;",
    expect: {},
  },
  {
    name: "arrow: comparison body flagged with extra",
    source: "(val) => val === 0;",
    extra: ["arrow" as CheckType],
    expect: { arrow: 1 },
  },
  {
    name: "arrow: arithmetic body not flagged by default",
    source: "(val) => val + 1;",
    expect: {},
  },
  {
    name: "arrow: arithmetic body flagged with extra",
    source: "(val) => val + 1;",
    extra: ["arrow" as CheckType],
    expect: { arrow: 1 },
  },
  {
    name: "arrow: block body not flagged by default",
    source: "(val) => { return val; };",
    expect: {},
  },
  {
    name: "arrow: block body flagged with extra",
    source: "(val) => { return val; };",
    extra: ["arrow" as CheckType],
    expect: { arrow: 1 },
  },
  {
    name: "arrow: function expression not flagged by default",
    source: "nums.map(function (item) { return item; });",
    expect: {},
  },
  {
    name: "arrow: function expression flagged with extra",
    source: "nums.map(function (item) { return item; });",
    extra: ["arrow" as CheckType],
    expect: { arrow: 1 },
  },
];

for (const testCase of cases) {
  for (const key of Object.keys(testCase.expect)) {
    if (VALID.has(key) === false) {
      throw new Error(`${testCase.name}: unknown check type in expect: '${key}'`);
    }
  }

  Deno.test(testCase.name, () => {
    assertEquals(countByType(testCase.source, testCase.extra ?? []), testCase.expect);
  });
}
