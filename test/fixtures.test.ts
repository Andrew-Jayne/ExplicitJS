/**
 * The fixture harness: each fixture's markers must match the analyzer exactly.
 *
 * `default_checks/test_*` and `extra_checks/test_*` are fixtures, not tests —
 * real source annotated with `// expect:` markers (grammar: test/README.md,
 * parser: fixtureSpec.ts). Each fixture runs once per declared mode; the
 * multiset of (line, checkType) findings must equal the markers, catching both
 * regressions (a check stops firing) and false positives (something new fires).
 *
 * The syntax tests are the `py_compile` analogue from the Python suite: the
 * TypeScript parser recovers from almost anything, so a broken fixture would
 * otherwise silently assert nothing.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { extractSvelteScripts } from "../src/svelteParser.ts";
import { extractVueScripts } from "../src/vueParser.ts";
import {
  actualFor,
  countersEqual,
  discoverFixtures,
  formatDiff,
  parseFixture,
} from "./fixtureSpec.ts";

interface SyntaxCase {
  content: string;
  syntheticName: string;
}

function syntaxCasesFor(fixturePath: string): SyntaxCase[] {
  const source = readFileSync(fixturePath, "utf-8");
  const extension = path.extname(fixturePath).toLowerCase();
  if (extension === ".svelte") {
    const cases: SyntaxCase[] = [];
    for (const block of extractSvelteScripts(source)) {
      let syntheticName = "block.js";
      if (block.isTypeScript === true) {
        syntheticName = "block.ts";
      }
      cases.push({ content: block.content, syntheticName });
    }
    return cases;
  }
  if (extension === ".vue") {
    const cases: SyntaxCase[] = [];
    for (const block of extractVueScripts(source)) {
      cases.push({ content: block.content, syntheticName: `block.${block.lang}` });
    }
    return cases;
  }
  return [{ content: source, syntheticName: path.basename(fixturePath) }];
}

for (const fixturePath of discoverFixtures()) {
  const fixtureName = path.basename(fixturePath);
  const spec = parseFixture(fixturePath);

  for (const mode of spec.modes) {
    Deno.test(`fixture: ${fixtureName} [${mode}]`, () => {
      const expected = spec.expected.get(mode)!;
      const actual = actualFor(spec, mode);
      if (countersEqual(expected, actual) === false) {
        throw new Error(
          `\n${fixtureName} [${mode}] mismatch between markers and analyzer:\n${formatDiff(expected, actual)}`,
        );
      }
    });
  }

  Deno.test(`fixture syntax: ${fixtureName}`, () => {
    const cases = syntaxCasesFor(fixturePath);
    if (cases.length === 0) {
      throw new Error(`${fixtureName}: no script content extracted - fixture asserts nothing`);
    }
    for (const syntaxCase of cases) {
      let diagnostics = ts.transpileModule(syntaxCase.content, {
        fileName: syntaxCase.syntheticName,
        reportDiagnostics: true,
        compilerOptions: { target: ts.ScriptTarget.Latest, jsx: ts.JsxEmit.Preserve },
      }).diagnostics;
      if (diagnostics === undefined) {
        diagnostics = [];
      }
      if (diagnostics.length > 0) {
        const messages: string[] = [];
        for (const diagnostic of diagnostics) {
          messages.push(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
        }
        throw new Error(`${fixtureName}: fixture has syntax errors:\n${messages.join("\n")}`);
      }
    }
  });
}
