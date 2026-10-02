/**
 * Expression/statement-level checks, implemented as a recursive walk over the
 * TypeScript AST. This is the JS/TS analogue of the Python tool's
 * `code_visitor.py`: it handles implicit-truthiness conditions (if/while/for/
 * assert), negation, ternaries, boolean operators, arrow/function expressions,
 * truthiness predicates (`.filter(Boolean)` and kin), non-null assertions,
 * loose equality, optional `name?: T` declarations, and single-letter names.
 *
 * Scope-level checks (single-use var/func) live in `singleUse.ts`.
 */

import ts from "typescript";
import { CheckType, type StyleCheck } from "./constructs.ts";

const MAX_CODE_LENGTH = 100;

const COMPARISON_TOKENS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.LessThanToken,
  ts.SyntaxKind.GreaterThanToken,
  ts.SyntaxKind.LessThanEqualsToken,
  ts.SyntaxKind.GreaterThanEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.InstanceOfKeyword,
  ts.SyntaxKind.InKeyword,
]);

const LOGICAL_TOKENS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
]);

const LOGICAL_ASSIGNMENT_TOKENS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
]);

// Array methods that coerce their callback's return value to a truth value.
const PREDICATE_METHODS: ReadonlySet<string> = new Set([
  "filter",
  "find",
  "findIndex",
  "findLast",
  "findLastIndex",
  "some",
  "every",
]);

// Built-ins that, passed as a predicate, are a bare truthiness test:
// `.filter(Boolean)`, and `.filter(String)` / `.filter(Number)` which drop
// `""` / `0` the same way.
const TRUTHINESS_FUNCTIONS: ReadonlySet<string> = new Set(["Boolean", "String", "Number"]);

const GLOBAL_OBJECTS: ReadonlySet<string> = new Set(["globalThis", "window", "self", "global"]);

// Canonical callee paths whose first argument is asserted for truthiness.
const ASSERT_CALLEES: ReadonlySet<string> = new Set([
  "assert",
  "assert.ok",
  "assert.strict",
  "assert.strict.ok",
  "console.assert",
]);

const ASSERT_MODULES: ReadonlySet<string> = new Set([
  "assert",
  "node:assert",
  "assert/strict",
  "node:assert/strict",
  "@std/assert",
  "jsr:@std/assert",
]);

// What a named import from an assert module refers to, as a canonical path.
const ASSERT_EXPORTS: ReadonlyMap<string, string> = new Map([
  ["default", "assert"],
  ["assert", "assert"],
  ["ok", "assert.ok"],
  ["strict", "assert.strict"],
]);

// Checks without an entry report the bare code as their message.
const CONTEXT_TEMPLATES: ReadonlyMap<CheckType, (code: string) => string> = new Map([
  [
    CheckType.IF,
    (code: string) =>
      `Implicit boolean: 'if (${code})' coerces the condition to a truth value - compare explicitly (=== null, .length > 0, ...)`,
  ],
  [
    CheckType.WHILE,
    (code: string) =>
      `Implicit boolean: 'while (${code})' coerces the condition to a truth value - compare explicitly (=== null, .length > 0, ...)`,
  ],
  [
    CheckType.ASSERT,
    (code: string) =>
      `Implicit boolean: 'assert(${code})' coerces the condition to a truth value - assert an explicit comparison`,
  ],
  [CheckType.ARROW, (code: string) => `() => ${code}`],
]);

function forConditionMessage(code: string): string {
  return `Implicit boolean: 'for (...; ${code}; ...)' coerces the condition to a truth value - compare explicitly (=== null, .length > 0, ...)`;
}

function truncate(code: string): string {
  const collapsed = code.replace(/\s+/g, " ");
  if (collapsed.length > MAX_CODE_LENGTH) {
    return `${collapsed.slice(0, MAX_CODE_LENGTH)}...`;
  }
  return collapsed;
}

function unwrapParens(expr: ts.Expression): ts.Expression {
  let current = expr;
  while (ts.isParenthesizedExpression(current) === true) {
    current = current.expression;
  }
  return current;
}

function isComparison(expr: ts.Expression): boolean {
  if (ts.isBinaryExpression(expr) === true) {
    return COMPARISON_TOKENS.has(expr.operatorToken.kind);
  }
  return false;
}

function isLogical(expr: ts.Expression): expr is ts.BinaryExpression {
  return (
    ts.isBinaryExpression(expr) === true && LOGICAL_TOKENS.has(expr.operatorToken.kind) === true
  );
}

function isBooleanLiteral(expr: ts.Expression): boolean {
  return expr.kind === ts.SyntaxKind.TrueKeyword || expr.kind === ts.SyntaxKind.FalseKeyword;
}

function isNotOperator(expr: ts.Expression): expr is ts.PrefixUnaryExpression {
  return (
    ts.isPrefixUnaryExpression(expr) === true && expr.operator === ts.SyntaxKind.ExclamationToken
  );
}

/** `filter` for `.filter(...)` and `["filter"](...)`; null for any other callee. */
function calledMethodName(callee: ts.Expression): string | null {
  if (ts.isPropertyAccessExpression(callee) === true) {
    return callee.name.text;
  }
  if (
    ts.isElementAccessExpression(callee) === true &&
    ts.isStringLiteralLike(callee.argumentExpression) === true
  ) {
    return callee.argumentExpression.text;
  }
  return null;
}

type AccessExpression =
  | ts.PropertyAccessExpression
  | ts.ElementAccessExpression
  | ts.CallExpression;

function isAccessExpression(node: ts.Node): node is AccessExpression {
  return (
    ts.isPropertyAccessExpression(node) === true ||
    ts.isElementAccessExpression(node) === true ||
    ts.isCallExpression(node) === true
  );
}

type OptionalMember =
  | ts.ParameterDeclaration
  | ts.PropertySignature
  | ts.PropertyDeclaration
  | ts.MethodSignature
  | ts.MethodDeclaration;

const NO_INITIALIZER_MODIFIERS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.AbstractKeyword,
  ts.SyntaxKind.DeclareKeyword,
]);

export class CodeVisitor {
  private readonly checks: StyleCheck[] = [];
  private readonly seenNames = new Set<string>();
  private readonly assertAliases: ReadonlyMap<string, string>;

  constructor(
    private readonly filename: string,
    private readonly sourceFile: ts.SourceFile,
  ) {
    // Local names bound by `import ... from "node:assert"` (and friends),
    // mapped to canonical paths.
    const aliases = new Map<string, string>();
    for (const statement of sourceFile.statements) {
      if (
        ts.isImportDeclaration(statement) === false ||
        ts.isStringLiteral(statement.moduleSpecifier) === false ||
        ASSERT_MODULES.has(statement.moduleSpecifier.text) === false
      ) {
        continue;
      }
      const clause = statement.importClause;
      if (clause === undefined) {
        continue;
      }
      if (clause.name !== undefined) {
        aliases.set(clause.name.text, "assert");
      }
      const bindings = clause.namedBindings;
      if (bindings === undefined) {
        continue;
      }
      if (ts.isNamespaceImport(bindings) === true) {
        aliases.set(bindings.name.text, "assert");
        continue;
      }
      for (const element of bindings.elements) {
        let imported = element.name.text;
        if (element.propertyName !== undefined) {
          imported = element.propertyName.text;
        }
        const canonical = ASSERT_EXPORTS.get(imported);
        if (canonical !== undefined) {
          aliases.set(element.name.text, canonical);
        }
      }
    }
    this.assertAliases = aliases;
  }

  analyze(): StyleCheck[] {
    this.visit(this.sourceFile);
    return this.checks;
  }

  private visit(node: ts.Node): void {
    switch (node.kind) {
      case ts.SyntaxKind.IfStatement:
        this.implicitBoolCheck((node as ts.IfStatement).expression, CheckType.IF);
        break;
      case ts.SyntaxKind.WhileStatement:
        this.implicitBoolCheck((node as ts.WhileStatement).expression, CheckType.WHILE);
        break;
      case ts.SyntaxKind.DoStatement:
        this.implicitBoolCheck((node as ts.DoStatement).expression, CheckType.WHILE);
        break;
      case ts.SyntaxKind.ForStatement: {
        const condition = (node as ts.ForStatement).condition;
        if (condition !== undefined) {
          this.implicitBoolCheck(condition, CheckType.WHILE, forConditionMessage);
        }
        break;
      }
      case ts.SyntaxKind.PrefixUnaryExpression:
        this.checkNegation(node as ts.PrefixUnaryExpression);
        break;
      case ts.SyntaxKind.NonNullExpression:
        this.checkNonNull(node as ts.NonNullExpression);
        break;
      case ts.SyntaxKind.ConditionalExpression:
        this.addCheck(node, CheckType.TERNARY, this.ternaryMessage(node));
        break;
      case ts.SyntaxKind.BinaryExpression:
        this.visitBinary(node as ts.BinaryExpression);
        break;
      case ts.SyntaxKind.PropertyAccessExpression:
      case ts.SyntaxKind.ElementAccessExpression:
        this.checkOptionalChain(node);
        break;
      case ts.SyntaxKind.CallExpression:
        this.checkOptionalChain(node);
        this.visitCall(node as ts.CallExpression);
        break;
      case ts.SyntaxKind.ArrowFunction:
      case ts.SyntaxKind.FunctionExpression:
        this.visitFunctionLike(node as ts.ArrowFunction | ts.FunctionExpression);
        break;
      case ts.SyntaxKind.Parameter:
      case ts.SyntaxKind.PropertySignature:
      case ts.SyntaxKind.PropertyDeclaration:
      case ts.SyntaxKind.MethodSignature:
      case ts.SyntaxKind.MethodDeclaration:
        this.checkOptionalMember(node as OptionalMember);
        break;
      case ts.SyntaxKind.MappedType: {
        // `{ [Key in keyof T]?: T[Key] }` is `name?:` stamped onto every
        // field at once; `+?` is the same marker spelled out. `-?` removes
        // optionality (`Required<T>`), so it is the explicit direction.
        const marker = (node as ts.MappedTypeNode).questionToken;
        if (marker !== undefined && marker.kind !== ts.SyntaxKind.MinusToken) {
          this.addCheck(
            node,
            CheckType.OPTIONAL_PARAM,
            "Mapped type with '?:' makes every field optional - map to 'T[Key] | null' instead, so absence is named",
          );
        }
        break;
      }
      case ts.SyntaxKind.TypeReference: {
        // `Partial<T>` is the built-in spelling of that mapped type.
        const typeName = (node as ts.TypeReferenceNode).typeName;
        if (ts.isIdentifier(typeName) === true && typeName.text === "Partial") {
          this.addCheck(
            node,
            CheckType.OPTIONAL_PARAM,
            "Partial<T> makes every field optional - declare the shape with 'field: T | null' members, so absence is named",
          );
        }
        break;
      }
      case ts.SyntaxKind.JsxAttribute:
        this.checkJsxBoolAttr(node as ts.JsxAttribute);
        break;
      default:
        break;
    }

    this.checkSingleLetterFor(node);
    ts.forEachChild(node, (child) => this.visit(child));
  }

  // `<Widget active />` — JSX defaults a bare attribute to true, so the reader
  // has to supply the value from convention; `active={true}` states it.
  private checkJsxBoolAttr(node: ts.JsxAttribute): void {
    if (node.initializer !== undefined) {
      return;
    }
    this.addCheck(
      node,
      CheckType.BOOL_ATTR,
      `Bare JSX attribute relies on the implicit-true convention - write ${node.name.getText(this.sourceFile)}={true}`,
    );
  }

  // A ternary nested in JSX cannot become an if/else in place — statements are
  // illegal there — so the advice points outside the markup instead. The walk
  // stops at the nearest function boundary: inside a callback an if/else block
  // is possible again, even when the callback itself sits in JSX.
  private ternaryMessage(node: ts.Node): string {
    let current = node.parent;
    while (current !== undefined) {
      if (ts.isFunctionLike(current) === true) {
        break;
      }
      if (ts.isJsxExpression(current) === true) {
        return "Ternary expression in JSX - assign the branch with if/else before the return, or split into separate returns";
      }
      current = current.parent;
    }
    return "Ternary expression - use an explicit if/else block instead";
  }

  // --- implicit boolean -----------------------------------------------------

  private implicitBoolCheck(
    expr: ts.Expression,
    checkType: CheckType,
    context: string | ((code: string) => string) | null = null,
  ): void {
    const subject = unwrapParens(expr);

    if (isComparison(subject) === true) {
      return;
    }
    if (isBooleanLiteral(subject) === true) {
      return;
    }
    if (isLogical(subject) === true) {
      this.implicitBoolCheck(subject.left, checkType, context);
      this.implicitBoolCheck(subject.right, checkType, context);
      return;
    }
    if (isNotOperator(subject) === true) {
      const operand = unwrapParens(subject.operand);
      // `!(a > b)` is explicit; `!value` / `!getValue()` is not.
      if (isComparison(operand) === true || isLogical(operand) === true) {
        return;
      }
    }

    const code = truncate(subject.getText(this.sourceFile));
    if (typeof context === "function") {
      this.addCheck(subject, checkType, context(code));
      return;
    }
    let message = context;
    if (message === null) {
      const template = CONTEXT_TEMPLATES.get(checkType);
      if (template !== undefined) {
        message = template(code);
      } else {
        message = code;
      }
    }
    this.addCheck(subject, checkType, message);
  }

  // --- binary expressions ---------------------------------------------------

  private visitBinary(node: ts.BinaryExpression): void {
    const op = node.operatorToken.kind;

    if (op === ts.SyntaxKind.EqualsEqualsToken || op === ts.SyntaxKind.ExclamationEqualsToken) {
      let symbol: string;
      let strict: string;
      if (op === ts.SyntaxKind.EqualsEqualsToken) {
        symbol = "==";
        strict = "===";
      } else {
        symbol = "!=";
        strict = "!==";
      }
      this.addCheck(
        node,
        CheckType.LOOSE_EQUALITY,
        `Loose equality '${symbol}' coerces operands - use '${strict}'`,
      );
      return;
    }

    if (op === ts.SyntaxKind.QuestionQuestionToken) {
      this.addCheck(
        node,
        CheckType.NULLISH_COALESCE,
        "Nullish coalescing '??' is an inline if - test === null / === undefined explicitly",
      );
      return;
    }
    if (op === ts.SyntaxKind.QuestionQuestionEqualsToken) {
      this.addCheck(
        node,
        CheckType.NULLISH_COALESCE,
        "Nullish assignment '??=' is an inline if - test === null / === undefined explicitly",
      );
      return;
    }

    // `a ||= b` / `a &&= b` are their expanded `a = a || b` forms in disguise,
    // so their operands get the same implicit-boolean treatment.
    if (
      op === ts.SyntaxKind.BarBarEqualsToken ||
      op === ts.SyntaxKind.AmpersandAmpersandEqualsToken
    ) {
      let symbol = "&&=";
      if (op === ts.SyntaxKind.BarBarEqualsToken) {
        symbol = "||=";
      }
      for (const operand of [node.left, node.right]) {
        this.implicitBoolCheck(
          operand,
          CheckType.BOOL_OP,
          `... ${symbol} ${truncate(operand.getText(this.sourceFile))} ...`,
        );
      }
      return;
    }

    if (LOGICAL_TOKENS.has(op) === false) {
      return;
    }

    // Only act on the top of a same-operator chain so a flattened `a && b && c`
    // produces one check per operand, matching the Python tool's BoolOp node.
    const parent = node.parent;
    if (
      parent !== undefined &&
      ts.isBinaryExpression(parent) === true &&
      parent.operatorToken.kind === op
    ) {
      return;
    }

    const operands: ts.Expression[] = [];
    this.collectChain(node, op, operands);
    let symbol: string;
    if (op === ts.SyntaxKind.AmpersandAmpersandToken) {
      symbol = "&&";
    } else {
      symbol = "||";
    }
    for (const operand of operands) {
      this.implicitBoolCheck(
        operand,
        CheckType.BOOL_OP,
        `... ${symbol} ${truncate(operand.getText(this.sourceFile))} ...`,
      );
    }
  }

  private collectChain(node: ts.BinaryExpression, op: ts.SyntaxKind, out: ts.Expression[]): void {
    for (const side of [node.left, node.right]) {
      const inner = unwrapParens(side);
      if (ts.isBinaryExpression(inner) === true && inner.operatorToken.kind === op) {
        this.collectChain(inner, op, out);
      } else {
        out.push(side);
      }
    }
  }

  // --- calls: assert(...) and truthiness predicates ----------------------------

  private visitCall(node: ts.CallExpression): void {
    if (this.isAssertCall(node) === true) {
      this.implicitBoolCheck(node.arguments[0]!, CheckType.ASSERT);
    }

    const method = calledMethodName(node.expression);
    if (method === null || PREDICATE_METHODS.has(method) === false || node.arguments.length === 0) {
      return;
    }
    const predicate = unwrapParens(node.arguments[0]!);
    // `Boolean` / `globalThis.Boolean` (or String / Number) as the predicate.
    let builtin: string | null = null;
    if (ts.isIdentifier(predicate) === true) {
      builtin = predicate.text;
    } else if (
      ts.isPropertyAccessExpression(predicate) === true &&
      ts.isIdentifier(predicate.expression) === true &&
      GLOBAL_OBJECTS.has(predicate.expression.text) === true
    ) {
      builtin = predicate.name.text;
    }
    if (builtin !== null && TRUTHINESS_FUNCTIONS.has(builtin) === true) {
      this.addCheck(
        node,
        CheckType.FILTER,
        `.${method}(${builtin}) - implicit truthiness predicate; use an explicit predicate`,
        `.${method}(${builtin})`,
      );
      return;
    }
    if (ts.isArrowFunction(predicate) === true || ts.isFunctionExpression(predicate) === true) {
      for (const returned of this.returnedExpressions(predicate)) {
        this.checkPredicateResult(returned, method);
      }
    }
  }

  /**
   * True for `assert(x)`, `assert.ok(x)`, `console.assert(x)` and the same
   * callees reached through parentheses, bracket access, `globalThis.`, or an
   * import alias (`import { ok } from "node:assert"`). Matching on the
   * resolved path, not the source text, keeps spacing and comments out of it.
   */
  private isAssertCall(node: ts.CallExpression): boolean {
    if (node.arguments.length === 0) {
      return false;
    }
    let callee = this.calleePath(node.expression);
    if (callee === null) {
      return false;
    }
    for (const globalName of GLOBAL_OBJECTS) {
      if (callee.startsWith(`${globalName}.`) === true) {
        callee = callee.slice(globalName.length + 1);
        break;
      }
    }
    return ASSERT_CALLEES.has(callee);
  }

  private calleePath(expr: ts.Expression): string | null {
    const subject = unwrapParens(expr);
    if (ts.isIdentifier(subject) === true) {
      const alias = this.assertAliases.get(subject.text);
      if (alias !== undefined) {
        return alias;
      }
      return subject.text;
    }
    if (
      ts.isPropertyAccessExpression(subject) === false &&
      ts.isElementAccessExpression(subject) === false
    ) {
      return null;
    }
    const member = calledMethodName(subject);
    if (member === null) {
      return null;
    }
    const base = this.calleePath(subject.expression);
    if (base === null) {
      return null;
    }
    return `${base}.${member}`;
  }

  /** A concise arrow body, or every `return` of a block body (not of nested functions). */
  private returnedExpressions(fn: ts.ArrowFunction | ts.FunctionExpression): ts.Expression[] {
    if (ts.isBlock(fn.body) === false) {
      return [fn.body as ts.Expression];
    }
    const returned: ts.Expression[] = [];
    ts.forEachChild(fn.body, (child) => this.collectReturns(child, returned));
    return returned;
  }

  private collectReturns(node: ts.Node, out: ts.Expression[]): void {
    if (ts.isFunctionLike(node) === true || ts.isClassLike(node) === true) {
      return;
    }
    if (ts.isReturnStatement(node) === true && node.expression !== undefined) {
      out.push(node.expression);
    }
    ts.forEachChild(node, (child) => this.collectReturns(child, out));
  }

  // `.filter((user) => user.email)` is `.filter(Boolean)` with extra steps.
  // Negations, `&&`/`||` and ternaries are left to their own checks.
  private checkPredicateResult(returned: ts.Expression, method: string): void {
    const subject = unwrapParens(returned);
    if (
      isComparison(subject) === true ||
      isBooleanLiteral(subject) === true ||
      isLogical(subject) === true ||
      isNotOperator(subject) === true ||
      ts.isConditionalExpression(subject) === true
    ) {
      return;
    }
    this.addCheck(
      subject,
      CheckType.FILTER,
      `'.${method}' callback returns '${truncate(subject.getText(this.sourceFile))}', which the predicate coerces to a truth value - return an explicit comparison`,
    );
  }

  // --- negation and non-null assertion ---------------------------------------

  /**
   * `!value` coerces its operand just as `if (value)` does, wherever it
   * appears — `const missing = !items` or `!items === true` launders the
   * coercion past the condition checks. Positions another check already
   * reports (conditions, assert arguments, `&&`/`||` operands, concise arrow
   * bodies, ternary conditions, the inner half of `!!x`) are skipped so one
   * construct yields one finding.
   */
  private checkNegation(node: ts.PrefixUnaryExpression): void {
    if (node.operator !== ts.SyntaxKind.ExclamationToken) {
      return;
    }
    const operand = unwrapParens(node.operand);
    if (isComparison(operand) === true || isLogical(operand) === true) {
      return;
    }
    // The node the negation ultimately sits in, skipping any parentheses.
    let outermost: ts.Node = node;
    while (
      outermost.parent !== undefined &&
      ts.isParenthesizedExpression(outermost.parent) === true
    ) {
      outermost = outermost.parent;
    }
    if (this.isReportedElsewhere(outermost) === true) {
      return;
    }
    this.addCheck(
      node,
      CheckType.NOT,
      "Negation '!value' coerces its operand to a truth value - compare explicitly (=== false, === null, .length === 0, ...)",
    );
  }

  private isReportedElsewhere(node: ts.Node): boolean {
    const parent = node.parent;
    if (parent === undefined) {
      return false;
    }
    if (
      ts.isPrefixUnaryExpression(parent) === true &&
      parent.operator === ts.SyntaxKind.ExclamationToken
    ) {
      return true;
    }
    if (
      (ts.isIfStatement(parent) === true ||
        ts.isWhileStatement(parent) === true ||
        ts.isDoStatement(parent) === true) &&
      parent.expression === node
    ) {
      return true;
    }
    if (ts.isForStatement(parent) === true && parent.condition === node) {
      return true;
    }
    if (ts.isConditionalExpression(parent) === true && parent.condition === node) {
      return true;
    }
    if (ts.isArrowFunction(parent) === true && parent.body === node) {
      return true;
    }
    if (
      ts.isBinaryExpression(parent) === true &&
      (LOGICAL_TOKENS.has(parent.operatorToken.kind) === true ||
        LOGICAL_ASSIGNMENT_TOKENS.has(parent.operatorToken.kind) === true)
    ) {
      return true;
    }
    return (
      ts.isCallExpression(parent) === true &&
      parent.arguments[0] === node &&
      this.isAssertCall(parent) === true
    );
  }

  // `request!.headers` asserts presence instead of checking it. `items[0]!` is
  // exempt: under noUncheckedIndexedAccess that is the type system's idiom for
  // an index already bounds-checked, not a skipped validation.
  private checkNonNull(node: ts.NonNullExpression): void {
    if (ts.isElementAccessExpression(unwrapParens(node.expression)) === true) {
      return;
    }
    this.addCheck(
      node,
      CheckType.NON_NULL,
      "Non-null assertion '!' claims a value is present instead of checking - validate the shape or test === null / === undefined explicitly",
    );
  }

  // --- optional chaining ----------------------------------------------------

  /**
   * Flag an optional-chaining expression (`a?.b?.c`, `a?.[k]`, `a?.()`) once,
   * at the top of the access chain — `request?.headers?.auth?.token` is a
   * single finding, not one per `?.`. Deeply optional access hides whether a
   * missing field is expected or a bug; validate the shape against a schema or
   * type once, then access fields directly.
   */
  private checkOptionalChain(node: ts.Node): void {
    if (this.isAccessChainLink(node) === true) {
      return;
    }
    if (this.chainHasOptional(node) === true) {
      this.addCheck(
        node,
        CheckType.OPTIONAL_CHAIN,
        "Optional chaining hides missing/optional fields - validate the shape against a schema/type, then access directly",
      );
    }
  }

  private isAccessChainLink(node: ts.Node): boolean {
    const parent = node.parent;
    if (parent === undefined) {
      return false;
    }
    if (isAccessExpression(parent) === true) {
      return parent.expression === node;
    }
    return false;
  }

  private chainHasOptional(node: ts.Node): boolean {
    let current: ts.Node = node;
    for (;;) {
      if (isAccessExpression(current) === false) {
        return false;
      }
      if (current.questionDotToken !== undefined) {
        return true;
      }
      current = current.expression;
    }
  }

  // --- arrow / function expressions -----------------------------------------

  private visitFunctionLike(node: ts.ArrowFunction | ts.FunctionExpression): void {
    // Anonymity itself is not ambiguous — only a concise arrow body that
    // buries a boolean is, so that is all this flags.
    if (ts.isArrowFunction(node) === false) {
      return;
    }
    if (ts.isBlock(node.body) === true) {
      return;
    }

    const body = unwrapParens(node.body as ts.Expression);
    if (ts.isConditionalExpression(body) === true) {
      this.implicitBoolCheck(body.condition, CheckType.ARROW);
    } else if (isLogical(body) === true || isNotOperator(body) === true) {
      this.addCheck(
        node,
        CheckType.ARROW,
        "Arrow function with an implicit boolean body - use a named function",
        `() => ${truncate(body.getText(this.sourceFile))}`,
      );
    }
  }

  // --- optional parameters, properties and methods --------------------------

  /**
   * Flag every `name?: T` declaration: whether the absent value is meaningful
   * or accidental is invisible at the call site, and an optional field is what
   * makes `response?.data?.messages` look reasonable downstream. `name: T |
   * null` names the absent value and forces an explicit null check instead.
   *
   * Where a default is legal — a parameter of an implementation, a concrete
   * class field — the advice adds `= null`, so existing callers keep working.
   * Type-space declarations (interfaces, type literals, overload signatures,
   * abstract and `declare` fields) cannot carry one, so there the advice stops
   * at the union and every construction site states the field.
   */
  private checkOptionalMember(node: OptionalMember): void {
    if (node.questionToken === undefined) {
      return;
    }
    if (ts.isParameter(node) === true && ts.isFunctionLike(node.parent) === false) {
      return;
    }

    const name = node.name.getText(this.sourceFile);
    if (ts.isMethodSignature(node) === true || ts.isMethodDeclaration(node) === true) {
      this.addCheck(
        node,
        CheckType.OPTIONAL_PARAM,
        `Optional method '${name}?()' leaves absence implicit - declare it required, or as a '${name}: <signature> | null' property`,
        `${name}?()`,
      );
      return;
    }

    let kind = "property";
    if (ts.isParameter(node) === true) {
      kind = "parameter";
    }
    let typeText = "T";
    if (node.type !== undefined) {
      typeText = truncate(node.type.getText(this.sourceFile));
    }
    // `= null` only where `name: T | null = null` is legal, not just
    // `name: T | null`: an implementation's parameter, or a class field that
    // is neither abstract nor `declare`.
    let suffix = "";
    if (ts.isParameter(node) === true) {
      if ((node.parent as ts.FunctionLikeDeclaration).body !== undefined) {
        suffix = " = null";
      }
    } else if (ts.isPropertyDeclaration(node) === true) {
      let canCarryDefault = true;
      if (node.modifiers !== undefined) {
        for (const modifier of node.modifiers) {
          if (NO_INITIALIZER_MODIFIERS.has(modifier.kind) === true) {
            canCarryDefault = false;
          }
        }
      }
      if (canCarryDefault === true) {
        suffix = " = null";
      }
    }
    this.addCheck(
      node,
      CheckType.OPTIONAL_PARAM,
      `Optional ${kind} '${name}?' leaves absence implicit - use '${name}: ${typeText} | null${suffix}'`,
    );
  }

  // --- single-letter names --------------------------------------------------

  private checkSingleLetterFor(node: ts.Node): void {
    switch (node.kind) {
      case ts.SyntaxKind.VariableDeclaration:
        this.flagIfSingleLetter(
          (node as ts.VariableDeclaration).name,
          "use a descriptive variable name",
        );
        break;
      case ts.SyntaxKind.Parameter:
        this.flagIfSingleLetter(
          (node as ts.ParameterDeclaration).name,
          "use a descriptive parameter name",
        );
        break;
      case ts.SyntaxKind.FunctionDeclaration:
      case ts.SyntaxKind.FunctionExpression:
        this.flagIfSingleLetterName(
          (node as ts.FunctionDeclaration).name,
          "use a descriptive function name",
        );
        break;
      case ts.SyntaxKind.MethodDeclaration:
        this.flagIfSingleLetterName(
          (node as ts.MethodDeclaration).name,
          "use a descriptive method name",
        );
        break;
      case ts.SyntaxKind.PropertyDeclaration: {
        // `f = () => ...` is a method in all but syntax; plain data fields
        // (`x = 0` on a Point) keep their conventional names.
        const property = node as ts.PropertyDeclaration;
        if (
          property.initializer !== undefined &&
          (ts.isArrowFunction(property.initializer) === true ||
            ts.isFunctionExpression(property.initializer) === true)
        ) {
          this.flagIfSingleLetterName(property.name, "use a descriptive method name");
        }
        break;
      }
      case ts.SyntaxKind.ImportClause:
        this.flagIfSingleLetterName(
          (node as ts.ImportClause).name,
          "use a descriptive import name",
        );
        break;
      case ts.SyntaxKind.NamespaceImport:
      case ts.SyntaxKind.ImportSpecifier:
        this.flagIfSingleLetterName(
          (node as ts.NamespaceImport | ts.ImportSpecifier).name,
          "use a descriptive import name",
        );
        break;
      case ts.SyntaxKind.ClassDeclaration:
      case ts.SyntaxKind.ClassExpression:
        this.flagIfSingleLetterName(
          (node as ts.ClassDeclaration).name,
          "use a descriptive class name",
        );
        break;
      case ts.SyntaxKind.CatchClause: {
        const decl = (node as ts.CatchClause).variableDeclaration;
        if (decl !== undefined) {
          this.flagIfSingleLetter(decl.name, "use a descriptive exception variable (not 'e')");
        }
        break;
      }
      default:
        break;
    }
  }

  // Destructured names (`const { x } = point`, `[k, v]`) bind locals too.
  private flagIfSingleLetter(name: ts.BindingName, context: string): void {
    if (ts.isIdentifier(name) === true) {
      this.flagSingleLetterIdentifier(name, context);
      return;
    }
    for (const element of name.elements) {
      if (ts.isBindingElement(element) === true) {
        this.flagIfSingleLetter(element.name, context);
      }
    }
  }

  private flagIfSingleLetterName(
    name: ts.PropertyName | ts.Identifier | undefined,
    context: string,
  ): void {
    if (name !== undefined && ts.isIdentifier(name) === true) {
      this.flagSingleLetterIdentifier(name, context);
    }
  }

  private flagSingleLetterIdentifier(name: ts.Identifier, context: string): void {
    const text = name.text;
    // Count code points, not UTF-16 units: `𝑥` is one letter in two units.
    if ([...text].length === 1 && text !== "_") {
      const { line, column } = this.position(name);
      const key = `${text}:${line}:${column}`;
      if (this.seenNames.has(key) === false) {
        this.seenNames.add(key);
        this.checks.push({
          file: this.filename,
          line,
          column,
          code: text,
          context: `Single-letter name '${text}' - ${context}`,
          checkType: CheckType.SINGLE_LETTER_VAR,
        });
      }
    }
  }

  // --- helpers --------------------------------------------------------------

  private addCheck(
    node: ts.Node,
    checkType: CheckType,
    context: string,
    code: string | null = null,
  ): void {
    let codeText = code;
    if (codeText === null) {
      codeText = truncate(node.getText(this.sourceFile));
    }
    const { line, column } = this.position(node);
    this.checks.push({
      file: this.filename,
      line,
      column,
      code: codeText,
      context,
      checkType,
    });
  }

  private position(node: ts.Node): { line: number; column: number } {
    const { line, character } = this.sourceFile.getLineAndCharacterOfPosition(
      node.getStart(this.sourceFile),
    );
    return { line: line + 1, column: character };
  }
}

export function analyzeAst(sourceFile: ts.SourceFile, filename: string): StyleCheck[] {
  return new CodeVisitor(filename, sourceFile).analyze();
}
