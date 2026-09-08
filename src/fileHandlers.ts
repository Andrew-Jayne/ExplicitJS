/**
 * `analyzeFile()` parses one source file into a TypeScript AST and runs the two
 * analysis passes (node visitor + scope-level single-use), returning the merged
 * list of checks. Entry-point names from config are threaded through to the
 * single-use pass so they are never flagged. `.svelte` and `.vue` components
 * are analyzed per `<script>` block — the blocks are extracted (newline-padded,
 * so check lines refer to the original file) and each runs through the same
 * passes.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { analyzeAst, type SuppressedLines } from "./codeVisitor.ts";
import { type CheckType, EXTRA_CHECKS, isCheckType, type StyleCheck } from "./constructs.ts";
import { findBareMarkupAttrs } from "./markupAttrs.ts";
import { findSingleUse } from "./singleUse.ts";
import { extractSvelteScripts, type SvelteScriptBlock } from "./svelteParser.ts";
import { extractVueScripts, type VueScriptLang } from "./vueParser.ts";

// An `explicit: allow-<name>[, allow-<name>...]` trailing-comment suppression
// directive, e.g. `// explicit: allow-arrow`. Only the names of opt-in extra
// checks (EXTRA_CHECKS) are honored — the stock checks are always mandatory —
// and every item must carry the `allow-` prefix: naming exactly what is being
// allowed is itself an explicitness requirement.
const ALLOW_DIRECTIVE_RE = /explicit\s*:\s*([A-Za-z0-9_\- \t,]+)/;
const ALLOW_PREFIX = "allow-";

function allowedNamesIn(commentText: string): Set<string> {
  const names = new Set<string>();
  const match = ALLOW_DIRECTIVE_RE.exec(commentText);
  if (match === null) {
    return names;
  }
  for (const rawItem of match[1]!.split(",")) {
    const item = rawItem.trim();
    if (item.startsWith(ALLOW_PREFIX) === false) {
      continue;
    }
    const name = item.slice(ALLOW_PREFIX.length);
    if (isCheckType(name) === true && EXTRA_CHECKS.has(name as CheckType) === true) {
      names.add(name);
    }
  }
  return names;
}

/**
 * Map line number -> extra-check names allowed by a directive comment there.
 *
 * Comments are found with the TypeScript scanner (not a per-line regex) so a
 * directive inside a string literal is never mistaken for a real one. Items
 * without the `allow-` prefix and names that are not extra checks are ignored.
 */
function collectAllowLines(sourceFile: ts.SourceFile): Map<number, Set<string>> {
  const suppressed = new Map<number, Set<string>>();
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    /* skipTrivia */ false,
    ts.LanguageVariant.Standard,
    sourceFile.text,
  );
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    if (
      kind !== ts.SyntaxKind.SingleLineCommentTrivia &&
      kind !== ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      continue;
    }
    const names = allowedNamesIn(scanner.getTokenText());
    if (names.size === 0) {
      continue;
    }
    const lineNumber = sourceFile.getLineAndCharacterOfPosition(scanner.getTokenStart()).line + 1;
    let existing = suppressed.get(lineNumber);
    if (existing === undefined) {
      existing = new Set();
      suppressed.set(lineNumber, existing);
    }
    for (const name of names) {
      existing.add(name);
    }
  }
  return suppressed;
}

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

interface AnalyzeOptions {
  includeExtra?: ReadonlySet<string>;
  entryPoints?: ReadonlySet<string>;
}

export function analyzeSource(
  source: string,
  filename: string,
  options: AnalyzeOptions = {},
): StyleCheck[] {
  const extension = path.extname(filename).toLowerCase();
  if (extension === ".svelte") {
    const checks: StyleCheck[] = [];
    for (const block of extractSvelteScripts(source)) {
      checks.push(...analyzeScript(block.content, filename, blockScriptKind(block), options));
    }
    checks.push(...findBareMarkupAttrs(source, filename, "svelte"));
    return checks;
  }
  if (extension === ".vue") {
    const checks: StyleCheck[] = [];
    for (const block of extractVueScripts(source)) {
      checks.push(...analyzeScript(block.content, filename, VUE_SCRIPT_KINDS[block.lang], options));
    }
    checks.push(...findBareMarkupAttrs(source, filename, "vue"));
    return checks;
  }
  return analyzeScript(source, filename, scriptKindFor(filename), options);
}

function analyzeScript(
  source: string,
  filename: string,
  scriptKind: ts.ScriptKind,
  options: AnalyzeOptions,
): StyleCheck[] {
  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    scriptKind,
  );

  let includeExtra = options.includeExtra;
  if (includeExtra === undefined) {
    includeExtra = new Set();
  }
  let entryPoints = options.entryPoints;
  if (entryPoints === undefined) {
    entryPoints = new Set();
  }

  // allow-directives only ever affect the opt-in extra checks, so the comment
  // scan is skipped entirely when no extras are enabled.
  let suppressed: SuppressedLines = new Map();
  if (includeExtra.size > 0) {
    suppressed = collectAllowLines(sourceFile);
  }

  const checks = analyzeAst(sourceFile, filename, includeExtra, suppressed);
  checks.push(...findSingleUse(sourceFile, filename, entryPoints));
  return checks;
}

export function analyzeFile(filepath: string, options: AnalyzeOptions = {}): StyleCheck[] {
  return analyzeSource(readFileSync(filepath, "utf-8"), filepath, options);
}
