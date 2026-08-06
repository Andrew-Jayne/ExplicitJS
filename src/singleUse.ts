/**
 * Scope-level checks: single-use variables and single-use functions.
 *
 * This is the JS/TS analogue of the Python tool's `single_use.py`. It runs a
 * two-pass, binding-aware analysis: pass one builds a scope tree recording the
 * names each scope binds (declarations, parameters, imports, catch bindings)
 * along with every raw read and write; pass two resolves each reference to its
 * nearest enclosing binding, so uses inside nested closures count toward the
 * variable they actually capture instead of vanishing at the scope boundary.
 *
 * A definition is flagged only when it has exactly one read in its own scope
 * and none from nested scopes. A reference inside a nested function (or a
 * deferred class-member initializer) needs the shared binding — inlining would
 * change capture or evaluation-order semantics — so such definitions are
 * exempt rather than counted as extra uses.
 *
 * Exemptions, mirroring the Python tool:
 *   - UPPER_SNAKE_CASE constants are never flagged as single-use vars.
 *   - Exported names (the module's public surface) and `package.json` `bin`
 *     entry points are never flagged as single-use functions, since references
 *     from outside the file are invisible to a single-file analysis.
 */

import ts from "npm:typescript@^6.0.3";
import { CheckType, type StyleCheck } from "./constructs.ts";

const EXCLUDED_NAMES: ReadonlySet<string> = new Set(["_"]);

interface Position {
  line: number;
  column: number;
}

interface PendingWrite {
  name: string;
  at: Position;
}

interface Scope {
  parent: Scope | undefined;
  isClass: boolean;
  declared: Set<string>;
  varDefs: Map<string, Position[]>;
  funcDefs: Map<string, Position[]>;
  reads: string[];
  writes: PendingWrite[];
  ownReads: Map<string, number>;
  nestedReads: Map<string, number>;
}

interface ScopeContext {
  filename: string;
  sourceFile: ts.SourceFile;
  results: StyleCheck[];
  entryPoints: ReadonlySet<string>;
  exportedNames: ReadonlySet<string>;
  scopes: Scope[];
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
    scopes: [],
  };

  // The SourceFile node itself seeds the walk: its children are the top-level
  // statements, so the default traversal collects them into the module scope.
  collect(sourceFile, createScope(undefined, false, ctx), ctx);

  resolveWrites(ctx.scopes);
  resolveReads(ctx.scopes);

  for (const scope of ctx.scopes) {
    flagScope(scope, ctx);
  }
  return ctx.results;
}

// --- scope tree construction ------------------------------------------------

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

function createScope(
  parent: Scope | undefined,
  isClass: boolean,
  ctx: ScopeContext,
): Scope {
  const scope: Scope = {
    parent,
    isClass,
    declared: new Set(),
    varDefs: new Map(),
    funcDefs: new Map(),
    reads: [],
    writes: [],
    ownReads: new Map(),
    nestedReads: new Map(),
  };
  ctx.scopes.push(scope);
  return scope;
}

function collect(node: ts.Node, scope: Scope, ctx: ScopeContext): void {
  if (ts.isFunctionDeclaration(node) === true) {
    if (node.name !== undefined) {
      scope.declared.add(node.name.text);
      if (node.name.text !== "main") {
        record(
          scope.funcDefs,
          node.name.text,
          position(node.name, ctx.sourceFile),
        );
      }
    }
    collectFunctionLike(node, scope, ctx);
    return;
  }

  if (FUNCTION_LIKE_KINDS.has(node.kind) === true) {
    collectFunctionLike(node as ts.FunctionLikeDeclaration, scope, ctx);
    return;
  }

  if (isClassLike(node) === true) {
    collectClass(node, scope, ctx);
    return;
  }

  if (ts.isVariableDeclaration(node) === true) {
    declareBindingName(node.name, scope);
    if (
      ts.isIdentifier(node.name) === true &&
      node.initializer !== undefined &&
      EXCLUDED_NAMES.has(node.name.text) === false
    ) {
      record(scope.varDefs, node.name.text, position(node.name, ctx.sourceFile));
    }
    ts.forEachChild(node, (child) => collect(child, scope, ctx));
    return;
  }

  if (ts.isBinaryExpression(node) === true) {
    if (
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left) === true
    ) {
      if (EXCLUDED_NAMES.has(node.left.text) === false) {
        scope.writes.push({
          name: node.left.text,
          at: position(node.left, ctx.sourceFile),
        });
      }
      collect(node.right, scope, ctx);
      return;
    }
    ts.forEachChild(node, (child) => collect(child, scope, ctx));
    return;
  }

  if (ts.isCatchClause(node) === true) {
    if (node.variableDeclaration !== undefined) {
      declareBindingName(node.variableDeclaration.name, scope);
    }
    for (const statement of node.block.statements) {
      collect(statement, scope, ctx);
    }
    return;
  }

  if (ts.isImportDeclaration(node) === true) {
    declareImports(node, scope);
    return;
  }

  if (ts.isEnumDeclaration(node) === true) {
    scope.declared.add(node.name.text);
    for (const member of node.members) {
      if (member.initializer !== undefined) {
        collect(member.initializer, scope, ctx);
      }
    }
    return;
  }

  if (
    ts.isInterfaceDeclaration(node) === true ||
    ts.isTypeAliasDeclaration(node) === true
  ) {
    // Pure type space: bind the name (it can shadow) but count no reads.
    scope.declared.add(node.name.text);
    return;
  }

  if (ts.isIdentifier(node) === true) {
    if (isReadReference(node) === true) {
      scope.reads.push(node.text);
    }
    return;
  }

  ts.forEachChild(node, (child) => collect(child, scope, ctx));
}

function collectFunctionLike(
  node: ts.FunctionLikeDeclaration,
  parentScope: Scope,
  ctx: ScopeContext,
): void {
  const scope = createScope(parentScope, false, ctx);

  // A named function expression's name is visible only inside itself.
  if (ts.isFunctionExpression(node) === true && node.name !== undefined) {
    scope.declared.add(node.name.text);
  }

  for (const parameter of node.parameters) {
    declareBindingName(parameter.name, scope);
    if (parameter.initializer !== undefined) {
      collect(parameter.initializer, scope, ctx);
    }
    if (parameter.type !== undefined) {
      collect(parameter.type, scope, ctx);
    }
  }

  const body = node.body;
  if (body === undefined) {
    return;
  }
  if (ts.isBlock(body) === true) {
    for (const statement of body.statements) {
      collect(statement, scope, ctx);
    }
  } else {
    // Concise arrow body: a single expression forms the whole scope.
    collect(body, scope, ctx);
  }
}

function collectClass(
  node: ts.ClassLikeDeclaration,
  parentScope: Scope,
  ctx: ScopeContext,
): void {
  // `extends` clauses evaluate immediately, in the enclosing scope.
  if (node.heritageClauses !== undefined) {
    for (const clause of node.heritageClauses) {
      collect(clause, parentScope, ctx);
    }
  }

  const scope = createScope(parentScope, true, ctx);
  if (node.name !== undefined) {
    if (ts.isClassExpression(node) === true) {
      scope.declared.add(node.name.text);
    } else {
      parentScope.declared.add(node.name.text);
    }
  }
  for (const member of node.members) {
    collect(member, scope, ctx);
  }
}

function declareBindingName(name: ts.BindingName, scope: Scope): void {
  if (ts.isIdentifier(name) === true) {
    scope.declared.add(name.text);
    return;
  }
  for (const element of name.elements) {
    if (ts.isBindingElement(element) === true) {
      declareBindingName(element.name, scope);
    }
  }
}

function declareImports(node: ts.ImportDeclaration, scope: Scope): void {
  const clause = node.importClause;
  if (clause === undefined) {
    return;
  }
  if (clause.name !== undefined) {
    scope.declared.add(clause.name.text);
  }
  const bindings = clause.namedBindings;
  if (bindings === undefined) {
    return;
  }
  if (ts.isNamespaceImport(bindings) === true) {
    scope.declared.add(bindings.name.text);
  } else {
    for (const element of bindings.elements) {
      scope.declared.add(element.name.text);
    }
  }
}

// --- reference resolution ---------------------------------------------------

function findDeclaringScope(scope: Scope, name: string): Scope | undefined {
  let current: Scope | undefined = scope;
  while (current !== undefined) {
    if (current.declared.has(name) === true) {
      return current;
    }
    current = current.parent;
  }
  return undefined;
}

function resolveWrites(scopes: readonly Scope[]): void {
  for (const scope of scopes) {
    for (const write of scope.writes) {
      const target = findDeclaringScope(scope, write.name) ?? scope;
      target.declared.add(write.name);
      record(target.varDefs, write.name, write.at);
    }
  }
}

function resolveReads(scopes: readonly Scope[]): void {
  for (const scope of scopes) {
    for (const name of scope.reads) {
      const target = findDeclaringScope(scope, name);
      if (target === undefined) {
        continue;
      }
      if (target === scope) {
        bump(target.ownReads, name);
      } else {
        bump(target.nestedReads, name);
      }
    }
  }
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
  // Labels name statements, not values.
  if (ts.isLabeledStatement(parent) === true && parent.label === id) {
    return false;
  }
  if (ts.isBreakOrContinueStatement(parent) === true && parent.label === id) {
    return false;
  }

  return true;
}

type NamedMemberDeclaration =
  | ts.MethodDeclaration
  | ts.PropertyDeclaration
  | ts.GetAccessorDeclaration
  | ts.SetAccessorDeclaration;

function isNamedMemberDeclaration(
  node: ts.Node,
): node is NamedMemberDeclaration {
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
  if (ts.isTypeParameterDeclaration(parent) === true && parent.name === id) {
    return true;
  }
  return false;
}

// --- flagging ---------------------------------------------------------------

function isFlaggableSingleUse(scope: Scope, name: string, positions: Position[]): boolean {
  if (positions.length !== 1) {
    return false;
  }
  if ((scope.ownReads.get(name) ?? 0) !== 1) {
    return false;
  }
  // A read from a nested scope needs the shared binding: inlining would change
  // capture or evaluation-order semantics, so the definition is exempt.
  return (scope.nestedReads.get(name) ?? 0) === 0;
}

function flagScope(scope: Scope, ctx: ScopeContext): void {
  if (scope.isClass === true) {
    return;
  }

  for (const [name, positions] of scope.varDefs) {
    if (EXCLUDED_NAMES.has(name) === true || isDunder(name) === true) {
      continue;
    }
    if (isConstant(name) === true) {
      continue;
    }
    if (ctx.exportedNames.has(name) === true) {
      continue;
    }
    if (isFlaggableSingleUse(scope, name, positions) === true) {
      const at = positions[0]!;
      ctx.results.push({
        file: ctx.filename,
        line: at.line,
        column: at.column,
        code: name,
        context:
          `Variable '${name}' is only used once - consider inlining the expression or marking as a DELIBERATE_CONSTANT`,
        checkType: CheckType.SINGLE_USE_VAR,
      });
    }
  }

  for (const [name, positions] of scope.funcDefs) {
    if (isDunder(name) === true) {
      continue;
    }
    if (
      ctx.entryPoints.has(name) === true ||
      ctx.exportedNames.has(name) === true
    ) {
      continue;
    }
    if (isFlaggableSingleUse(scope, name, positions) === true) {
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
    if (
      ts.isFunctionDeclaration(statement) === true &&
      statement.name !== undefined
    ) {
      names.add(statement.name.text);
    } else if (
      isClassLike(statement) === true &&
      statement.name !== undefined
    ) {
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

function bump(counter: Map<string, number>, name: string): void {
  counter.set(name, (counter.get(name) ?? 0) + 1);
}

function record(
  map: Map<string, Position[]>,
  name: string,
  at: Position,
): void {
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
