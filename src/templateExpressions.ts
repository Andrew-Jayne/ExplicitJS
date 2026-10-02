/**
 * Code checks for the expressions embedded in Svelte and Vue templates.
 *
 * `markupAttrs.ts` collects every template expression as a span tagged with
 * its role. Each span is parsed on its own, wrapped so the parser sees the
 * construct it really is — a `v-if` / `{#if}` value as an `if` condition, a
 * `v-for` alias as a parameter list, an `@event` value as a statement block —
 * and the regular node visitor runs over it. A template that can say
 * `v-if="items.length > 0"` gets no pass on `v-if="items"`.
 *
 * Positions map back to the component file: the wrapper's prefix shares the
 * span's first line, so only first-line columns shift. Spans that do not parse
 * (template syntax the wrappers do not model) are skipped - missed flags,
 * never false ones. The scope-level single-use checks do not run on templates;
 * instead every name a template reads is returned so the script's analysis
 * can count it as used.
 */

import ts from "typescript";
import { analyzeAst } from "./codeVisitor.ts";
import { CheckType, type StyleCheck } from "./constructs.ts";
import { type MarkupFlavor, scanMarkup, type TemplateRole } from "./markupAttrs.ts";

// The closing half starts on a new line so a trailing `// comment` in the
// span cannot swallow it.
const WRAPPERS: Readonly<Record<TemplateRole, { before: string; after: string }>> = {
  condition: { before: "if (", after: "\n) {}" },
  expression: { before: "(", after: "\n);" },
  handler: { before: "{", after: "\n}" },
  params: { before: "(", after: "\n) => {};" },
  declaration: { before: "const ", after: "\n;" },
};

export interface TemplateAnalysis {
  checks: StyleCheck[];
  /** Every identifier the template's code reads, for the script's single-use analysis. */
  readNames: Set<string>;
}

export function analyzeTemplate(
  source: string,
  filename: string,
  flavor: MarkupFlavor,
): TemplateAnalysis {
  const scan = scanMarkup(source, filename, flavor);
  const analysis: TemplateAnalysis = { checks: scan.attrs, readNames: new Set() };

  const lineStarts = [0];
  for (let offset = 0; offset < source.length; offset += 1) {
    if (source[offset] === "\n") {
      lineStarts.push(offset + 1);
    }
  }

  for (const span of scan.expressions) {
    const wrapper = WRAPPERS[span.role];
    const sourceFile = ts.createSourceFile(
      filename,
      `${wrapper.before}${span.text}${wrapper.after}`,
      ts.ScriptTarget.Latest,
      /* setParentNodes */ true,
      ts.ScriptKind.TS,
    );
    // Not public API, but the only way to tell a clean parse from a recovered
    // one without a full program.
    if (
      (sourceFile as unknown as { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics
        .length > 0
    ) {
      continue;
    }

    let spanLine = 0;
    while (spanLine + 1 < lineStarts.length && lineStarts[spanLine + 1]! <= span.start) {
      spanLine += 1;
    }
    for (const check of analyzeAst(sourceFile, filename)) {
      if (check.line === 1) {
        check.column = span.start - lineStarts[spanLine]! + check.column - wrapper.before.length;
      }
      check.line = spanLine + check.line;
      if (check.checkType === CheckType.IF && span.role === "condition") {
        check.context = `Implicit boolean: '${span.label.replace("%", check.code)}' coerces the condition to a truth value - compare explicitly (=== null, .length > 0, ...)`;
      } else if (check.checkType === CheckType.TERNARY) {
        check.context =
          "Ternary expression in a template - use v-if/v-else or {#if}/{:else} blocks, or compute the value in the script";
      }
      analysis.checks.push(check);
    }

    collectReadNames(sourceFile, analysis.readNames);
  }
  return analysis;
}

function collectReadNames(node: ts.Node, names: Set<string>): void {
  if (ts.isIdentifier(node) === true) {
    const parent = node.parent;
    if (
      parent === undefined ||
      ts.isPropertyAccessExpression(parent) === false ||
      parent.name !== node
    ) {
      names.add(node.text);
    }
    return;
  }
  ts.forEachChild(node, (child) => collectReadNames(child, names));
}
