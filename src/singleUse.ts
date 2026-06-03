/**
 * Scope-level checks: single-use variables and single-use functions.
 *
 * This is the JS/TS analogue of the Python tool's `single_use.py`. It needs a
 * two-pass, scope-aware analysis (collect definitions, count references, then
 * flag), which is why it is separate from the node visitor.
 *
 * Exemptions, mirroring the Python tool:
 *   - UPPER_SNAKE_CASE constants are never flagged as single-use vars.
 *   - Exported names (the module's public surface) and `package.json` `bin`
 *     entry points are never flagged as single-use functions, since references
 *     from outside the file are invisible to a single-file analysis.
 */

import ts from "typescript";
import { CheckType, type StyleCheck } from "@/constructs.js";

const EXCLUDED_NAMES: ReadonlySet<string> = new Set(["_"]);

interface Position {
  line: number;
  column: number;
}

interface ScopeContext {
  filename: string;
  sourceFile: ts.SourceFile;
  results: StyleCheck[];
  entryPoints: ReadonlySet<string>;
  exportedNames: ReadonlySet<string>;
}

export function findSingleUse(
  sourceFile: ts.SourceFile,
  filename: string,
  entryPoints: ReadonlySet<string> = new Set(),
): StyleCheck[] {
  const ctx: ScopeContext = {
    filename,
    sourceFile,
    results: [],
    entryPoints,
    exportedNames: collectExportedNames(sourceFile),
  };
  analyzeScope(sourceFile.statements, ctx, false);
  return ctx.results;
}

// --- scope traversal --------------------------------------------------------

const SCOPE_BOUNDARY_KINDS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.Constructor,
  ts.SyntaxKind.GetAccessor,
  ts.SyntaxKind.SetAccessor,
  ts.SyntaxKind.ClassDeclaration,
  ts.SyntaxKind.ClassExpression,
]);

const FUNCTION_LIKE_KINDS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.Constructor,
  ts.SyntaxKind.GetAccessor,
  ts.SyntaxKind.SetAccessor,
]);

function isClassLike(node: ts.Node): node is ts.ClassLikeDeclaration {
  return (
    node.kind === ts.SyntaxKind.ClassDeclaration ||
    node.kind === ts.SyntaxKind.ClassExpression
  );
}

function analyzeScope(
  statements: readonly ts.Node[],
  ctx: ScopeContext,
  isClass: boolean,
): void {
  for (const statement of statements) {
    findNestedScopes(statement, ctx);
  }

  if (isClass === true) {
    return;
  }

  const varDefs = new Map<string, Position[]>();
  const funcDefs = new Map<string, Position[]>();
  const refs = new Map<string, number>();

  for (const statement of statements) {
    walkDefs(statement, ctx, varDefs, funcDefs);
    walkRefs(statement, refs);
  }

  flagSingleUseVars(varDefs, refs, ctx);
  flagSingleUseFuncs(funcDefs, refs, ctx);
}

function findNestedScopes(node: ts.Node, ctx: ScopeContext): void {
  if (FUNCTION_LIKE_KINDS.has(node.kind) === true) {
    processFunctionScope(node as ts.FunctionLikeDeclaration, ctx);
    return;
  }
  if (isClassLike(node) === true) {
    for (const member of node.members) {
      findNestedScopes(member, ctx);
    }
    return;
  }
  ts.forEachChild(node, (child) => findNestedScopes(child, ctx));
}

function processFunctionScope(
  node: ts.FunctionLikeDeclaration,
  ctx: ScopeContext,
): void {
  for (const parameter of node.parameters) {
    findNestedScopes(parameter, ctx);
  }

  const body = node.body;
  if (body === undefined) {
    return;
  }
  if (ts.isBlock(body) === true) {
    analyzeScope(body.statements, ctx, false);
  } else {
    // Concise arrow body: a single expression forms the whole scope.
    analyzeScope([body], ctx, false);
  }
}

// --- definition collection --------------------------------------------------

function walkDefs(
  node: ts.Node,
  ctx: ScopeContext,
  varDefs: Map<string, Position[]>,
  funcDefs: Map<string, Position[]>,
): void {
  if (node.kind === ts.SyntaxKind.FunctionDeclaration) {
    const fn = node as ts.FunctionDeclaration;
    if (fn.name !== undefined && fn.name.text !== "main") {
      record(funcDefs, fn.name.text, position(fn.name, ctx.sourceFile));
    }
    return;
  }

  // Any other scope boundary terminates this scope's definition collection.
  if (SCOPE_BOUNDARY_KINDS.has(node.kind) === true) {
    return;
  }

  if (ts.isVariableDeclaration(node) === true) {
    if (
      ts.isIdentifier(node.name) === true &&
      node.initializer !== undefined &&
      EXCLUDED_NAMES.has(node.name.text) === false
    ) {
      record(varDefs, node.name.text, position(node.name, ctx.sourceFile));
    }
  } else if (ts.isBinaryExpression(node) === true) {
    if (
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left) === true &&
      EXCLUDED_NAMES.has(node.left.text) === false
    ) {
      record(varDefs, node.left.text, position(node.left, ctx.sourceFile));
    }
  }

  ts.forEachChild(node, (child) => walkDefs(child, ctx, varDefs, funcDefs));
}

// --- reference counting -----------------------------------------------------

function walkRefs(node: ts.Node, refs: Map<string, number>): void {
  if (SCOPE_BOUNDARY_KINDS.has(node.kind) === true) {
    return;
  }

  if (ts.isIdentifier(node) === true && isReadReference(node) === true) {
    refs.set(node.text, (refs.get(node.text) ?? 0) + 1);
  }

  ts.forEachChild(node, (child) => walkRefs(child, refs));
}

function isReadReference(id: ts.Identifier): boolean {
  const parent = id.parent;
  if (parent === undefined) {
    return true;
  }

  // `obj.name` — the property name is not a variable reference.
  if (ts.isPropertyAccessExpression(parent) === true && parent.name === id) {
    return false;
  }
  if (ts.isQualifiedName(parent) === true && parent.right === id) {
    return false;
  }
  // Object literal key: `{ name: value }` (but `{ name }` shorthand IS a ref).
  if (ts.isPropertyAssignment(parent) === true && parent.name === id) {
    return false;
  }
  // The name side of a declaration is a write, not a read.
  if (isDeclarationName(parent, id) === true) {
    return false;
  }
  // Left-hand side of a plain assignment is the def, not a read.
  if (
    ts.isBinaryExpression(parent) === true &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    parent.left === id
  ) {
    return false;
  }

  return true;
}

type NamedMemberDeclaration =
  | ts.MethodDeclaration
  | ts.PropertyDeclaration
  | ts.GetAccessorDeclaration
  | ts.SetAccessorDeclaration;

function isNamedMemberDeclaration(node: ts.Node): node is NamedMemberDeclaration {
  return (
    ts.isMethodDeclaration(node) === true ||
    ts.isPropertyDeclaration(node) === true ||
    ts.isGetAccessorDeclaration(node) === true ||
    ts.isSetAccessorDeclaration(node) === true
  );
}

function isDeclarationName(parent: ts.Node, id: ts.Identifier): boolean {
  if (ts.isVariableDeclaration(parent) === true && parent.name === id) {
    return true;
  }
  if (ts.isFunctionDeclaration(parent) === true && parent.name === id) {
    return true;
  }
  if (isClassLike(parent) === true && parent.name === id) {
    return true;
  }
  if (ts.isParameter(parent) === true && parent.name === id) {
    return true;
  }
  if (ts.isBindingElement(parent) === true && parent.name === id) {
    return true;
  }
  if (isNamedMemberDeclaration(parent) === true && parent.name === id) {
    return true;
  }
  if (ts.isImportSpecifier(parent) === true && parent.name === id) {
    return true;
  }
  return false;
}

// --- flagging ---------------------------------------------------------------

function flagSingleUseVars(
  varDefs: Map<string, Position[]>,
  refs: Map<string, number>,
  ctx: ScopeContext,
): void {
  for (const [name, positions] of varDefs) {
    if (EXCLUDED_NAMES.has(name) === true || isDunder(name) === true) {
      continue;
    }
    if (isConstant(name) === true) {
      continue;
    }
    if (ctx.exportedNames.has(name) === true) {
      continue;
    }
    if (positions.length === 1 && (refs.get(name) ?? 0) === 1) {
      const at = positions[0]!;
      ctx.results.push({
        file: ctx.filename,
        line: at.line,
        column: at.column,
        code: name,
        context: `Variable '${name}' is only used once - consider inlining the expression`,
        checkType: CheckType.SINGLE_USE_VAR,
      });
    }
  }
}

function flagSingleUseFuncs(
  funcDefs: Map<string, Position[]>,
  refs: Map<string, number>,
  ctx: ScopeContext,
): void {
  for (const [name, positions] of funcDefs) {
    if (isDunder(name) === true) {
      continue;
    }
    if (ctx.entryPoints.has(name) === true || ctx.exportedNames.has(name) === true) {
      continue;
    }
    if (positions.length === 1 && (refs.get(name) ?? 0) === 1) {
      const at = positions[0]!;
      ctx.results.push({
        file: ctx.filename,
        line: at.line,
        column: at.column,
        code: `function ${name}(...)`,
        context: `Function '${name}' is only used once - consider inlining at the call site`,
        checkType: CheckType.SINGLE_USE_FUNC,
      });
    }
  }
}

// --- exports ----------------------------------------------------------------

function collectExportedNames(sourceFile: ts.SourceFile): ReadonlySet<string> {
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    collectExportsFromStatement(statement, names);
  }
  return names;
}

function hasExportKeyword(statement: ts.Statement): boolean {
  if (ts.canHaveModifiers(statement) === false) {
    return false;
  }
  const modifiers = ts.getModifiers(statement);
  if (modifiers === undefined) {
    return false;
  }
  for (const modifier of modifiers) {
    if (modifier.kind === ts.SyntaxKind.ExportKeyword) {
      return true;
    }
  }
  return false;
}

function collectExportsFromStatement(
  statement: ts.Statement,
  names: Set<string>,
): void {
  if (hasExportKeyword(statement) === true) {
    if (ts.isFunctionDeclaration(statement) === true && statement.name !== undefined) {
      names.add(statement.name.text);
    } else if (isClassLike(statement) === true && statement.name !== undefined) {
      names.add(statement.name.text);
    } else if (ts.isVariableStatement(statement) === true) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) === true) {
          names.add(declaration.name.text);
        }
      }
    }
  }

  if (
    ts.isExportDeclaration(statement) === true &&
    statement.exportClause !== undefined
  ) {
    if (ts.isNamedExports(statement.exportClause) === true) {
      for (const element of statement.exportClause.elements) {
        names.add((element.propertyName ?? element.name).text);
        names.add(element.name.text);
      }
    }
  }

  if (
    ts.isExportAssignment(statement) === true &&
    ts.isIdentifier(statement.expression) === true
  ) {
    names.add(statement.expression.text);
  }
}

// --- helpers ----------------------------------------------------------------

function record(map: Map<string, Position[]>, name: string, at: Position): void {
  const existing = map.get(name);
  if (existing === undefined) {
    map.set(name, [at]);
  } else {
    existing.push(at);
  }
}

function position(node: ts.Node, sourceFile: ts.SourceFile): Position {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(
    node.getStart(sourceFile),
  );
  return { line: line + 1, column: character };
}

function isDunder(name: string): boolean {
  return (
    name.length > 4 &&
    name.startsWith("__") === true &&
    name.endsWith("__") === true
  );
}

function hasLetter(name: string): boolean {
  return /[a-zA-Z]/.test(name);
}

function isConstant(name: string): boolean {
  return name === name.toUpperCase() && hasLetter(name) === true;
}
