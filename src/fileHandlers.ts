/**
 * `analyzeFile()` parses one source file into a TypeScript AST and runs the two
 * analysis passes (node visitor + scope-level single-use), returning the merged
 * list of checks. Entry-point names from config are threaded through to the
 * single-use pass so they are never flagged.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "npm:typescript@^6.0.3";
import { analyzeAst } from "./codeVisitor.ts";
import { findSingleUse } from "./singleUse.ts";
import { type StyleCheck } from "./constructs.ts";

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

export function analyzeSource(
  source: string,
  filename: string,
  options: {
    includeExtra?: ReadonlySet<string>;
    entryPoints?: ReadonlySet<string>;
  } = {},
): StyleCheck[] {
  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    scriptKindFor(filename),
  );

  const checks = analyzeAst(
    sourceFile,
    filename,
    options.includeExtra ?? new Set(),
  );
  checks.push(
    ...findSingleUse(sourceFile, filename, options.entryPoints ?? new Set()),
  );
  return checks;
}

export function analyzeFile(
  filepath: string,
  options: {
    includeExtra?: ReadonlySet<string>;
    entryPoints?: ReadonlySet<string>;
  } = {},
): StyleCheck[] {
  return analyzeSource(readFileSync(filepath, "utf-8"), filepath, options);
}
