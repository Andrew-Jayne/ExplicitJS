/**
 * `analyzeFile()` parses one source file into a TypeScript AST and runs the two
 * analysis passes (node visitor + scope-level single-use), returning the merged
 * list of checks. `.svelte` and `.vue` components
 * are analyzed per `<script>` block — the blocks are extracted (newline-padded,
 * so check lines refer to the original file) and each runs through the same
 * passes.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { analyzeAst } from "./codeVisitor.ts";
import type { StyleCheck } from "./constructs.ts";
import { findBareMarkupAttrs } from "./markupAttrs.ts";
import { findSingleUse } from "./singleUse.ts";
import { extractSvelteScripts, type SvelteScriptBlock } from "./svelteParser.ts";
import { extractVueScripts, type VueScriptLang } from "./vueParser.ts";

const TSX_EXTENSIONS: ReadonlySet<string> = new Set([".tsx", ".jsx"]);

function scriptKindFor(filename: string): ts.ScriptKind {
  const ext = path.extname(filename).toLowerCase();
  if (TSX_EXTENSIONS.has(ext) === true) {
    return ts.ScriptKind.TSX;
  }
  if (ext === ".ts" || ext === ".mts" || ext === ".cts") {
    return ts.ScriptKind.TS;
  }
  return ts.ScriptKind.JS;
}

function blockScriptKind(block: SvelteScriptBlock): ts.ScriptKind {
  if (block.isTypeScript === true) {
    return ts.ScriptKind.TS;
  }
  return ts.ScriptKind.JS;
}

const VUE_SCRIPT_KINDS: Readonly<Record<VueScriptLang, ts.ScriptKind>> = {
  js: ts.ScriptKind.JS,
  ts: ts.ScriptKind.TS,
  jsx: ts.ScriptKind.JSX,
  tsx: ts.ScriptKind.TSX,
};

export function analyzeSource(source: string, filename: string): StyleCheck[] {
  const extension = path.extname(filename).toLowerCase();
  if (extension === ".svelte") {
    const checks: StyleCheck[] = [];
    for (const block of extractSvelteScripts(source)) {
      checks.push(...analyzeScript(block.content, filename, blockScriptKind(block)));
    }
    checks.push(...findBareMarkupAttrs(source, filename, "svelte"));
    return checks;
  }
  if (extension === ".vue") {
    const checks: StyleCheck[] = [];
    for (const block of extractVueScripts(source)) {
      checks.push(...analyzeScript(block.content, filename, VUE_SCRIPT_KINDS[block.lang]));
    }
    checks.push(...findBareMarkupAttrs(source, filename, "vue"));
    return checks;
  }
  return analyzeScript(source, filename, scriptKindFor(filename));
}

function analyzeScript(source: string, filename: string, scriptKind: ts.ScriptKind): StyleCheck[] {
  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    scriptKind,
  );

  const checks = analyzeAst(sourceFile, filename);
  checks.push(...findSingleUse(sourceFile, filename));
  return checks;
}

export function analyzeFile(filepath: string): StyleCheck[] {
  return analyzeSource(readFileSync(filepath, "utf-8"), filepath);
}
