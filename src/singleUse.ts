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
 * A variable is flagged only when it has exactly one read in its own scope
 * and none from nested scopes. A reference inside a nested function (or a
 * deferred class-member initializer) needs the shared binding — inlining would
 * change capture or evaluation-order semantics — so such variables are exempt
 * rather than counted as extra uses. Functions (declarations, and
 * function-valued bindings never reassigned) have no such semantics: one call
 * from any scope makes them single-use.
 *
 * Exemptions, mirroring the Python tool:
 *   - UPPER_SNAKE_CASE constants are never flagged as single-use vars.
 *   - Exported names (the module's public surface) and `package.json` `bin`
 *     entry points are never flagged as single-use functions, since references
 *     from outside the file are invisible to a single-file analysis.
 *
 * A single-name destructure (`const { profile } = user`) counts as a
 * definition like `const profile = ...`; patterns binding several names, or
 * using a rest or default, have no single inlining and are skipped. A no-op
 * statement (`value;`, `void value;`) is not a read.
 *
 * One deliberate divergence from Python: a function (or function-valued
 * variable) whose sole read passes it BY REFERENCE — `memo(Component)`,
 * `items.map(helper)`, `onClick={handler}`, a JSX tag — is exempt. "Inline at
 * the call site" would turn the named function into the anonymous expression
 * this tool tells people to avoid. Python never hits this: its analogue is the
 * decorator, which reads no name. Only a genuine call read (`helper()`) flags.
 */

import ts from "typescript";
import { CheckType, type StyleCheck } from "./constructs.ts";

const EXCLUDED_NAMES: ReadonlySet<string> = new Set(["_"]);

const LITERAL_KEYWORDS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.TrueKeyword,
  ts.SyntaxKind.FalseKeyword,
  ts.SyntaxKind.NullKeyword,
]);

// Built-in containers whose contents, not identity, make them constant.
const CONSTANT_CONSTRUCTORS: ReadonlySet<string> = new Set([
  "Set",
  "Map",
  "WeakSet",
  "WeakMap",
  "RegExp",
]);

// `helper.call(...)` / `helper.apply(...)` invoke the function on the spot.
const INVOKING_METHODS: ReadonlySet<string> = new Set(["call", "apply"]);

interface Position {
  line: number;
  column: number;
}

interface PendingWrite {
  name: string;
  at: Position;
  isConstantValue: boolean;
}

interface PendingRead {
  name: string;
  isCall: boolean;
  at: Position;
}

interface Scope {
  parent: Scope | undefined;
  isClass: boolean;
  declared: Set<string>;
  importedNames: Set<string>;
  discardReadAt: Position | null;
  varDefs: Map<string, Position[]>;
  funcDefs: Map<string, Position[]>;
  funcValuedVars: Set<string>;
  /** UPPER_SNAKE names bound to a value computed at runtime: no constant exemption. */
  runtimeConstants: Set<string>;
  reads: PendingRead[];
  writes: PendingWrite[];
  ownReads: Map<string, number>;
  nestedReads: Map<string, number>;
  bareReads: Map<string, number>;
}

interface ScopeContext {
  filename: string;
  sourceFile: ts.SourceFile;
  results: StyleCheck[];
  exportedNames: Set<string>;
  scopes: Scope[];
}

export function findSingleUse(
  sourceFile: ts.SourceFile,
  filename: string,
  templateReads: ReadonlySet<string>,
): StyleCheck[] {
  const ctx: ScopeContext = {
    filename,
    sourceFile,
    results: [],
    // Names a component's template reads are used where this script cannot
    // see, exactly like exports, so they share the exemption.
    exportedNames: new Set(templateReads),
    scopes: [],
  };

  // --- exports --------------------------------------------------------------
  // The module's public surface: references from outside the file are
  // invisible to a single-file analysis, so these names are never flagged.
  for (const statement of sourceFile.statements) {
    let hasExportKeyword = false;
    if (ts.canHaveModifiers(statement) === true) {
      const modifiers = ts.getModifiers(statement);
      if (modifiers !== undefined) {
        for (const modifier of modifiers) {
          if (modifier.kind === ts.SyntaxKind.ExportKeyword) {
            hasExportKeyword = true;
          }
        }
      }
    }
    if (hasExportKeyword === true) {
      if (ts.isFunctionDeclaration(statement) === true && statement.name !== undefined) {
        ctx.exportedNames.add(statement.name.text);
      } else if (isClassLike(statement) === true && statement.name !== undefined) {
        ctx.exportedNames.add(statement.name.text);
      } else if (ts.isVariableStatement(statement) === true) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name) === true) {
            ctx.exportedNames.add(declaration.name.text);
          }
        }
      }
    }

    if (ts.isExportDeclaration(statement) === true && statement.exportClause !== undefined) {
      if (ts.isNamedExports(statement.exportClause) === true) {
        for (const element of statement.exportClause.elements) {
          if (element.propertyName !== undefined) {
            ctx.exportedNames.add(element.propertyName.text);
          }
          ctx.exportedNames.add(element.name.text);
        }
      }
    }

    if (
      ts.isExportAssignment(statement) === true &&
      ts.isIdentifier(statement.expression) === true
    ) {
      ctx.exportedNames.add(statement.expression.text);
    }
  }

  // The SourceFile node itself seeds the walk: its children are the top-level
  // statements, so the default traversal collects them into the module scope.
  collect(sourceFile, createScope(undefined, false, ctx), ctx);

  // --- reference resolution -------------------------------------------------
  // Every write resolves before any read, so reads see the complete bindings.
  for (const scope of ctx.scopes) {
    for (const write of scope.writes) {
      let target = findDeclaringScope(scope, write.name);
      if (target === undefined) {
        target = scope;
      }
      target.declared.add(write.name);
      record(target.varDefs, write.name, write.at);
      if (write.isConstantValue === false) {
        target.runtimeConstants.add(write.name);
      }
    }
  }

  for (const scope of ctx.scopes) {
    for (const read of scope.reads) {
      const target = findDeclaringScope(scope, read.name);
      if (target === undefined) {
        continue;
      }
      // `_` is the conventional discard name, so both single-letter and
      // single-use skip it; reading it back makes it a real variable hiding
      // behind that pass. An imported `_` (lodash) is a library namespace,
      // not a discard.
      if (
        read.name === "_" &&
        target.importedNames.has("_") === false &&
        target.discardReadAt === null
      ) {
        target.discardReadAt = read.at;
      }
      if (read.isCall === false) {
        bump(target.bareReads, read.name);
      }
      if (target === scope) {
        bump(target.ownReads, read.name);
      } else {
        bump(target.nestedReads, read.name);
      }
    }
  }

  // --- flagging -------------------------------------------------------------
  for (const scope of ctx.scopes) {
    if (scope.discardReadAt !== null) {
      ctx.results.push({
        file: ctx.filename,
        line: scope.discardReadAt.line,
        column: scope.discardReadAt.column,
        code: "_",
        context:
          "'_' marks a discarded value, but it is read here - give the variable a descriptive name",
        checkType: CheckType.SINGLE_LETTER_VAR,
      });
    }
    if (scope.isClass === true) {
      continue;
    }

    for (const [name, positions] of scope.varDefs) {
      if (EXCLUDED_NAMES.has(name) === true) {
        continue;
      }
      // UPPER_SNAKE_CASE (with at least one letter) marks a deliberate
      // constant - but only a value that is one. `const USER = await
      // fetchUser()` is a runtime value in capitals, not a constant.
      const isUpperName = name === name.toUpperCase() && /[a-zA-Z]/.test(name) === true;
      if (isUpperName === true && scope.runtimeConstants.has(name) === false) {
        continue;
      }
      if (ctx.exportedNames.has(name) === true) {
        continue;
      }
      let flaggable = false;
      if (scope.funcValuedVars.has(name) === true) {
        // A function-valued binding gets the function rule: read by reference
        // it is exempt (inlining would create the anonymous expression this
        // tool discourages), and one call from any scope makes it single-use.
        flaggable = isCalledOnce(scope, name, positions);
      } else {
        // A read from a nested scope needs the shared binding: inlining would
        // change capture or evaluation-order semantics, so the definition is
        // exempt. Counts start at 1, so an absent entry means zero nested reads.
        flaggable =
          positions.length === 1 &&
          scope.ownReads.get(name) === 1 &&
          scope.nestedReads.get(name) === undefined;
      }
      if (flaggable === true) {
        const at = positions[0]!;
        let context = `Variable '${name}' is only used once, consider inlining the expression or declare it in UPPER_SNAKE_CASE to mark as a deliberate constant`;
        if (isUpperName === true) {
          context = `Variable '${name}' is only used once - UPPER_SNAKE_CASE exempts only constant values (literals, and constants built from them), and this one is computed at runtime; inline the expression`;
        }
        ctx.results.push({
          file: ctx.filename,
          line: at.line,
          column: at.column,
          code: name,
          context,
          checkType: CheckType.SINGLE_USE_VAR,
        });
      }
    }

    for (const [name, positions] of scope.funcDefs) {
      if (ctx.exportedNames.has(name) === true) {
        continue;
      }
      // A reference read — `memo(Component)`, `items.map(helper)`, a JSX tag —
      // passes the function by name, which is exactly what this tool asks for
      // instead of an anonymous expression; only a call read (`helper()`) flags.
      if (isCalledOnce(scope, name, positions) === true) {
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
    node.kind === ts.SyntaxKind.ClassDeclaration || node.kind === ts.SyntaxKind.ClassExpression
  );
}

function createScope(parent: Scope | undefined, isClass: boolean, ctx: ScopeContext): Scope {
  const scope: Scope = {
    parent,
    isClass,
    declared: new Set(),
    importedNames: new Set(),
    discardReadAt: null,
    varDefs: new Map(),
    funcDefs: new Map(),
    funcValuedVars: new Set(),
    runtimeConstants: new Set(),
    reads: [],
    writes: [],
    ownReads: new Map(),
    nestedReads: new Map(),
    bareReads: new Map(),
  };
  ctx.scopes.push(scope);
  return scope;
}

function collect(node: ts.Node, scope: Scope, ctx: ScopeContext): void {
  if (ts.isFunctionDeclaration(node) === true) {
    if (node.name !== undefined) {
      scope.declared.add(node.name.text);
      // Bodyless declarations (ambient `declare function`, overload
      // signatures) have nothing to inline, so they are never single-use.
      if (node.name.text !== "main" && node.body !== undefined) {
        record(scope.funcDefs, node.name.text, position(node.name, ctx.sourceFile));
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
    // `extends` clauses evaluate immediately, in the enclosing scope.
    if (node.heritageClauses !== undefined) {
      for (const clause of node.heritageClauses) {
        collect(clause, scope, ctx);
      }
    }

    const classScope = createScope(scope, true, ctx);
    if (node.name !== undefined) {
      if (ts.isClassExpression(node) === true) {
        classScope.declared.add(node.name.text);
      } else {
        scope.declared.add(node.name.text);
      }
    }
    for (const member of node.members) {
      collect(member, classScope, ctx);
    }

    // A `#private` (or TypeScript `private`) method is callable only inside
    // its own class, so unlike a public method every caller is in view: one
    // call makes it a single-use helper. Uses are counted by member name
    // across the class body; passing it by name (`.map(this.#format)`)
    // exempts it, as for functions.
    const privateMethods = new Map<string, ts.MethodDeclaration>();
    for (const member of node.members) {
      if (
        ts.isMethodDeclaration(member) === true &&
        member.body !== undefined &&
        (ts.isPrivateIdentifier(member.name) === true ||
          (ts.isIdentifier(member.name) === true &&
            (ts.getCombinedModifierFlags(member) & ts.ModifierFlags.Private) !== 0))
      ) {
        privateMethods.set(member.name.text, member);
      }
    }
    if (privateMethods.size > 0) {
      const calls = new Map<string, number>();
      const bareUses = new Map<string, number>();
      const pending: ts.Node[] = [...node.members];
      let current = pending.pop();
      while (current !== undefined) {
        if (
          ts.isPropertyAccessExpression(current) === true &&
          privateMethods.has(current.name.text) === true
        ) {
          if (isInvoked(current) === true) {
            bump(calls, current.name.text);
          } else {
            bump(bareUses, current.name.text);
          }
        } else if (
          ts.isElementAccessExpression(current) === true &&
          ts.isStringLiteralLike(current.argumentExpression) === true &&
          privateMethods.has(current.argumentExpression.text) === true
        ) {
          bump(bareUses, current.argumentExpression.text);
        }
        ts.forEachChild(current, (child) => {
          pending.push(child);
        });
        current = pending.pop();
      }
      for (const [name, method] of privateMethods) {
        if (calls.get(name) === 1 && bareUses.get(name) === undefined) {
          const at = position(method.name, ctx.sourceFile);
          ctx.results.push({
            file: ctx.filename,
            line: at.line,
            column: at.column,
            code: `${name}(...)`,
            context: `Private method '${name}' is only called once - inline it at the call site`,
            checkType: CheckType.SINGLE_USE_FUNC,
          });
        }
      }
    }
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
      if (
        ts.isArrowFunction(node.initializer) === true ||
        ts.isFunctionExpression(node.initializer) === true
      ) {
        scope.funcValuedVars.add(node.name.text);
      }
      if (isConstantExpression(node.initializer) === false) {
        scope.runtimeConstants.add(node.name.text);
      }
    } else if (ts.isIdentifier(node.name) === false && node.initializer !== undefined) {
      // `const { profile } = user` is `user.profile` with a detour; a pattern
      // binding several names (or a rest/default) has no single inlining.
      const names: ts.Identifier[] = [];
      if (collectPatternNames(node.name, names) === true && names.length === 1) {
        const sole = names[0]!;
        if (EXCLUDED_NAMES.has(sole.text) === false) {
          record(scope.varDefs, sole.text, position(sole, ctx.sourceFile));
        }
      }
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
          isConstantValue: isConstantExpression(node.right),
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
    const clause = node.importClause;
    if (clause !== undefined) {
      const names: string[] = [];
      if (clause.name !== undefined) {
        names.push(clause.name.text);
      }
      const bindings = clause.namedBindings;
      if (bindings !== undefined) {
        if (ts.isNamespaceImport(bindings) === true) {
          names.push(bindings.name.text);
        } else {
          for (const element of bindings.elements) {
            names.push(element.name.text);
          }
        }
      }
      for (const name of names) {
        scope.declared.add(name);
        scope.importedNames.add(name);
      }
    }
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

  if (ts.isInterfaceDeclaration(node) === true || ts.isTypeAliasDeclaration(node) === true) {
    // Pure type space: bind the name (it can shadow) but count no reads.
    scope.declared.add(node.name.text);
    return;
  }

  // `result;` / `void result;` does nothing but pad a variable's read count.
  if (ts.isExpressionStatement(node) === true) {
    let subject = node.expression;
    while (
      ts.isParenthesizedExpression(subject) === true ||
      ts.isVoidExpression(subject) === true
    ) {
      subject = subject.expression;
    }
    if (ts.isIdentifier(subject) === true) {
      return;
    }
  }

  if (ts.isIdentifier(node) === true) {
    const parent = node.parent;
    let isRead = true;
    if (parent !== undefined) {
      // `obj.name` — the property name is not a variable reference.
      if (ts.isPropertyAccessExpression(parent) === true && parent.name === node) {
        isRead = false;
      }
      // `<Widget value={x}/>` — the attribute name is not a variable reference.
      if (ts.isJsxAttribute(parent) === true && parent.name === node) {
        isRead = false;
      }
      // `<svg xlink:href={x}/>` — neither half of a namespaced name is one.
      if (ts.isJsxNamespacedName(parent) === true) {
        isRead = false;
      }
      if (ts.isQualifiedName(parent) === true && parent.right === node) {
        isRead = false;
      }
      // Object literal key: `{ name: value }` (but `{ name }` shorthand IS a ref).
      if (ts.isPropertyAssignment(parent) === true && parent.name === node) {
        isRead = false;
      }
      // Type-member names (`user: { profile: Profile }`) name fields, not values.
      if (
        (ts.isPropertySignature(parent) === true || ts.isMethodSignature(parent) === true) &&
        parent.name === node
      ) {
        isRead = false;
      }
      // The name side of a declaration is a write, not a read.
      if (
        (ts.isVariableDeclaration(parent) === true ||
          ts.isFunctionDeclaration(parent) === true ||
          isClassLike(parent) === true ||
          ts.isParameter(parent) === true ||
          ts.isBindingElement(parent) === true ||
          ts.isMethodDeclaration(parent) === true ||
          ts.isPropertyDeclaration(parent) === true ||
          ts.isGetAccessorDeclaration(parent) === true ||
          ts.isSetAccessorDeclaration(parent) === true ||
          ts.isImportSpecifier(parent) === true ||
          ts.isTypeParameterDeclaration(parent) === true) &&
        parent.name === node
      ) {
        isRead = false;
      }
      // Left-hand side of a plain assignment is the def, not a read.
      if (
        ts.isBinaryExpression(parent) === true &&
        parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        parent.left === node
      ) {
        isRead = false;
      }
      // Labels name statements, not values.
      if (ts.isLabeledStatement(parent) === true && parent.label === node) {
        isRead = false;
      }
      if (ts.isBreakOrContinueStatement(parent) === true && parent.label === node) {
        isRead = false;
      }
    }

    if (isRead === true) {
      scope.reads.push({
        name: node.text,
        isCall: isInvoked(node),
        at: position(node, ctx.sourceFile),
      });
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

/** Gathers a pattern's bound names; false when a rest or default element rules out inlining. */
function collectPatternNames(pattern: ts.BindingPattern, out: ts.Identifier[]): boolean {
  for (const element of pattern.elements) {
    if (ts.isBindingElement(element) === false) {
      continue;
    }
    if (element.dotDotDotToken !== undefined || element.initializer !== undefined) {
      return false;
    }
    if (ts.isIdentifier(element.name) === true) {
      out.push(element.name);
    } else if (collectPatternNames(element.name, out) === false) {
      return false;
    }
  }
  return true;
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

// --- flagging ---------------------------------------------------------------

/**
 * A function is single-use when it is called exactly once from anywhere: a
 * module-level helper whose one call sits inside another function is the
 * canonical case. Unlike a variable, a function binding that is never
 * reassigned has no capture or evaluation-order semantics to preserve, so a
 * nested call counts as the use rather than exempting it.
 */
function isCalledOnce(scope: Scope, name: string, positions: Position[]): boolean {
  if (positions.length !== 1 || scope.bareReads.get(name) !== undefined) {
    return false;
  }
  let reads = 0;
  for (const counter of [scope.ownReads, scope.nestedReads]) {
    const count = counter.get(name);
    if (count !== undefined) {
      reads += count;
    }
  }
  return reads === 1;
}

// --- helpers ----------------------------------------------------------------

/**
 * True when the expression is invoked rather than passed along: `helper()`,
 * and the same call spelled `(helper)()`, `helper.call(...)` /
 * `helper.apply(...)`, ``helper`...` ``, or `new Helper()`.
 */
function isInvoked(expression: ts.Node): boolean {
  let callee: ts.Node = expression;
  while (callee.parent !== undefined && ts.isParenthesizedExpression(callee.parent) === true) {
    callee = callee.parent;
  }
  const parent = callee.parent;
  if (parent === undefined) {
    return false;
  }
  if (ts.isCallExpression(parent) === true || ts.isNewExpression(parent) === true) {
    return parent.expression === callee;
  }
  if (ts.isTaggedTemplateExpression(parent) === true) {
    return parent.tag === callee;
  }
  if (
    ts.isPropertyAccessExpression(parent) === true &&
    parent.expression === callee &&
    INVOKING_METHODS.has(parent.name.text) === true
  ) {
    const grandparent = parent.parent;
    return (
      grandparent !== undefined &&
      ts.isCallExpression(grandparent) === true &&
      grandparent.expression === parent
    );
  }
  return false;
}

/**
 * A value fixed before the program runs: literals, and arrays, objects,
 * templates, operators, `new Set/Map/RegExp(...)` and member accesses built
 * only from literals and other UPPER_SNAKE constants. Calls, `await`,
 * functions, and reads of ordinary variables are runtime values.
 */
function isConstantExpression(expression: ts.Expression): boolean {
  if (
    ts.isParenthesizedExpression(expression) === true ||
    ts.isAsExpression(expression) === true ||
    ts.isSatisfiesExpression(expression) === true ||
    ts.isTypeAssertionExpression(expression) === true
  ) {
    return isConstantExpression(expression.expression);
  }
  if (
    ts.isLiteralExpression(expression) === true ||
    LITERAL_KEYWORDS.has(expression.kind) === true
  ) {
    return true;
  }
  if (ts.isIdentifier(expression) === true) {
    return (
      expression.text === "undefined" ||
      (expression.text === expression.text.toUpperCase() &&
        /[a-zA-Z]/.test(expression.text) === true)
    );
  }
  if (ts.isPropertyAccessExpression(expression) === true) {
    return isConstantExpression(expression.expression);
  }
  if (ts.isPrefixUnaryExpression(expression) === true) {
    return isConstantExpression(expression.operand);
  }
  if (ts.isBinaryExpression(expression) === true) {
    return (
      isConstantExpression(expression.left) === true &&
      isConstantExpression(expression.right) === true
    );
  }
  if (ts.isTemplateExpression(expression) === true) {
    return expression.templateSpans.every((span) => isConstantExpression(span.expression) === true);
  }
  if (ts.isArrayLiteralExpression(expression) === true) {
    return expression.elements.every((element) => {
      if (ts.isSpreadElement(element) === true) {
        return isConstantExpression(element.expression) === true;
      }
      return isConstantExpression(element) === true;
    });
  }
  if (ts.isObjectLiteralExpression(expression) === true) {
    return expression.properties.every((property) => {
      if (ts.isPropertyAssignment(property) === true) {
        return (
          (ts.isComputedPropertyName(property.name) === false ||
            isConstantExpression(property.name.expression) === true) &&
          isConstantExpression(property.initializer) === true
        );
      }
      if (ts.isShorthandPropertyAssignment(property) === true) {
        return isConstantExpression(property.name) === true;
      }
      if (ts.isSpreadAssignment(property) === true) {
        return isConstantExpression(property.expression) === true;
      }
      return false;
    });
  }
  if (
    ts.isNewExpression(expression) === true &&
    ts.isIdentifier(expression.expression) === true &&
    CONSTANT_CONSTRUCTORS.has(expression.expression.text) === true
  ) {
    if (expression.arguments === undefined) {
      return true;
    }
    return expression.arguments.every((argument) => isConstantExpression(argument) === true);
  }
  return false;
}

function bump(counter: Map<string, number>, name: string): void {
  const current = counter.get(name);
  if (current === undefined) {
    counter.set(name, 1);
  } else {
    counter.set(name, current + 1);
  }
}

function record(map: Map<string, Position[]>, name: string, at: Position): void {
  const existing = map.get(name);
  if (existing === undefined) {
    map.set(name, [at]);
  } else {
    existing.push(at);
  }
}

function position(node: ts.Node, sourceFile: ts.SourceFile): Position {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return { line: line + 1, column: character };
}
