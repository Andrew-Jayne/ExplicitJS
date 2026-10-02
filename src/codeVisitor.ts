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

const TRUTHINESS_MATCHERS: ReadonlySet<string> = new Set(["toBeTruthy", "toBeFalsy"]);
const MATCHER_MODIFIERS: ReadonlySet<string> = new Set(["not", "resolves", "rejects"]);
const EXPECT_CALLEES: ReadonlySet<string> = new Set(["expect", "expect.soft"]);

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

const SINGLE_LETTER_CONTEXTS: ReadonlyMap<ts.SyntaxKind, string> = new Map([
  [ts.SyntaxKind.FunctionDeclaration, "use a descriptive function name"],
  [ts.SyntaxKind.FunctionExpression, "use a descriptive function name"],
  [ts.SyntaxKind.MethodDeclaration, "use a descriptive method name"],
  [ts.SyntaxKind.MethodSignature, "use a descriptive method name"],
  [ts.SyntaxKind.GetAccessor, "use a descriptive accessor name"],
  [ts.SyntaxKind.SetAccessor, "use a descriptive accessor name"],
  [ts.SyntaxKind.PropertyDeclaration, "use a descriptive property name"],
  [ts.SyntaxKind.PropertySignature, "use a descriptive property name"],
  [ts.SyntaxKind.PropertyAssignment, "use a descriptive property name"],
  [ts.SyntaxKind.ClassDeclaration, "use a descriptive class name"],
  [ts.SyntaxKind.ClassExpression, "use a descriptive class name"],
  [ts.SyntaxKind.InterfaceDeclaration, "use a descriptive interface name"],
  [ts.SyntaxKind.TypeAliasDeclaration, "use a descriptive type name"],
  [ts.SyntaxKind.TypeParameter, "use a descriptive type parameter name (<Item>, not <T>)"],
  [ts.SyntaxKind.EnumDeclaration, "use a descriptive enum name"],
  [ts.SyntaxKind.EnumMember, "use a descriptive enum member name"],
  [ts.SyntaxKind.ModuleDeclaration, "use a descriptive namespace name"],
  [ts.SyntaxKind.ImportClause, "use a descriptive import name"],
  [ts.SyntaxKind.NamespaceImport, "use a descriptive import name"],
  [ts.SyntaxKind.ImportSpecifier, "use a descriptive import name"],
  [ts.SyntaxKind.NamespaceExport, "use a descriptive export name"],
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
      case ts.SyntaxKind.PrefixUnaryExpression: {
        // `!value` coerces its operand just as `if (value)` does, wherever it
        // appears — `const missing = !items` or `!items === true` launders the
        // coercion past the condition checks. Positions another check already
        // reports (conditions, assert arguments, `&&`/`||` operands, concise
        // arrow bodies, ternary conditions, the inner half of `!!x`) are
        // skipped so one construct yields one finding.
        const negation = node as ts.PrefixUnaryExpression;
        if (negation.operator !== ts.SyntaxKind.ExclamationToken) {
          break;
        }
        const operand = unwrapParens(negation.operand);
        if (isComparison(operand) === true || isLogical(operand) === true) {
          break;
        }
        // The node the negation ultimately sits in, skipping any parentheses.
        let outermost: ts.Node = negation;
        while (
          outermost.parent !== undefined &&
          ts.isParenthesizedExpression(outermost.parent) === true
        ) {
          outermost = outermost.parent;
        }
        const parent = outermost.parent;
        let reportedElsewhere = false;
        if (parent === undefined) {
          reportedElsewhere = false;
        } else if (
          ts.isPrefixUnaryExpression(parent) === true &&
          parent.operator === ts.SyntaxKind.ExclamationToken
        ) {
          reportedElsewhere = true;
        } else if (
          (ts.isIfStatement(parent) === true ||
            ts.isWhileStatement(parent) === true ||
            ts.isDoStatement(parent) === true) &&
          parent.expression === outermost
        ) {
          reportedElsewhere = true;
        } else if (ts.isForStatement(parent) === true && parent.condition === outermost) {
          reportedElsewhere = true;
        } else if (ts.isConditionalExpression(parent) === true && parent.condition === outermost) {
          reportedElsewhere = true;
        } else if (ts.isArrowFunction(parent) === true && parent.body === outermost) {
          reportedElsewhere = true;
        } else if (
          ts.isBinaryExpression(parent) === true &&
          (LOGICAL_TOKENS.has(parent.operatorToken.kind) === true ||
            LOGICAL_ASSIGNMENT_TOKENS.has(parent.operatorToken.kind) === true)
        ) {
          reportedElsewhere = true;
        } else {
          reportedElsewhere =
            ts.isCallExpression(parent) === true &&
            parent.arguments[0] === outermost &&
            this.isAssertCall(parent) === true;
        }
        if (reportedElsewhere === false) {
          this.addCheck(
            negation,
            CheckType.NOT,
            "Negation '!value' coerces its operand to a truth value - compare explicitly (=== false, === null, .length === 0, ...)",
          );
        }
        break;
      }
      case ts.SyntaxKind.NonNullExpression:
        // `request!.headers` asserts presence instead of checking it.
        // `items[0]!` is exempt: under noUncheckedIndexedAccess that is the
        // type system's idiom for an index already bounds-checked, not a
        // skipped validation.
        if (
          ts.isElementAccessExpression(unwrapParens((node as ts.NonNullExpression).expression)) ===
          false
        ) {
          this.addCheck(
            node,
            CheckType.NON_NULL,
            "Non-null assertion '!' claims a value is present instead of checking - validate the shape or test === null / === undefined explicitly",
          );
        }
        break;
      case ts.SyntaxKind.ConditionalExpression: {
        // A ternary nested in JSX cannot become an if/else in place —
        // statements are illegal there — so the advice points outside the
        // markup instead. The walk stops at the nearest function boundary:
        // inside a callback an if/else block is possible again, even when the
        // callback itself sits in JSX.
        let message = "Ternary expression - use an explicit if/else block instead";
        let current = node.parent;
        while (current !== undefined) {
          if (ts.isFunctionLike(current) === true) {
            break;
          }
          if (ts.isJsxExpression(current) === true) {
            message =
              "Ternary expression in JSX - assign the branch with if/else before the return, or split into separate returns";
            break;
          }
          current = current.parent;
        }
        this.addCheck(node, CheckType.TERNARY, message);
        break;
      }
      case ts.SyntaxKind.BinaryExpression: {
        const binary = node as ts.BinaryExpression;
        const operator = binary.operatorToken.kind;
        if (
          operator === ts.SyntaxKind.EqualsEqualsToken ||
          operator === ts.SyntaxKind.ExclamationEqualsToken
        ) {
          let symbol: string;
          let strict: string;
          if (operator === ts.SyntaxKind.EqualsEqualsToken) {
            symbol = "==";
            strict = "===";
          } else {
            symbol = "!=";
            strict = "!==";
          }
          this.addCheck(
            binary,
            CheckType.LOOSE_EQUALITY,
            `Loose equality '${symbol}' coerces operands - use '${strict}'`,
          );
        } else if (operator === ts.SyntaxKind.QuestionQuestionToken) {
          this.addCheck(
            binary,
            CheckType.NULLISH_COALESCE,
            "Nullish coalescing '??' is an inline if - test === null / === undefined explicitly",
          );
        } else if (operator === ts.SyntaxKind.QuestionQuestionEqualsToken) {
          this.addCheck(
            binary,
            CheckType.NULLISH_COALESCE,
            "Nullish assignment '??=' is an inline if - test === null / === undefined explicitly",
          );
        } else if (LOGICAL_ASSIGNMENT_TOKENS.has(operator) === true) {
          // `a ||= b` / `a &&= b` are their expanded `a = a || b` forms in
          // disguise, so their operands get the same implicit-boolean treatment.
          let symbol = "&&=";
          if (operator === ts.SyntaxKind.BarBarEqualsToken) {
            symbol = "||=";
          }
          for (const side of [binary.left, binary.right]) {
            this.implicitBoolCheck(
              side,
              CheckType.BOOL_OP,
              `... ${symbol} ${truncate(side.getText(this.sourceFile))} ...`,
            );
          }
        } else if (LOGICAL_TOKENS.has(operator) === true) {
          // Only act on the top of a same-operator chain so a flattened
          // `a && b && c` produces one check per operand, matching the Python
          // tool's BoolOp node.
          const parent = binary.parent;
          if (
            parent === undefined ||
            ts.isBinaryExpression(parent) === false ||
            parent.operatorToken.kind !== operator
          ) {
            const operands: ts.Expression[] = [];
            this.collectChain(binary, operator, operands);
            let symbol = "||";
            if (operator === ts.SyntaxKind.AmpersandAmpersandToken) {
              symbol = "&&";
            }
            for (const chained of operands) {
              this.implicitBoolCheck(
                chained,
                CheckType.BOOL_OP,
                `... ${symbol} ${truncate(chained.getText(this.sourceFile))} ...`,
              );
            }
          }
        }
        break;
      }
      case ts.SyntaxKind.PropertyAccessExpression:
      case ts.SyntaxKind.ElementAccessExpression:
        this.checkOptionalChain(node);
        break;
      case ts.SyntaxKind.CallExpression: {
        this.checkOptionalChain(node);
        const call = node as ts.CallExpression;
        if (this.isAssertCall(call) === true) {
          this.implicitBoolCheck(call.arguments[0]!, CheckType.ASSERT);
        }

        // `expect(user).toBeTruthy()` is `assert(user)` in test-runner
        // clothes; `.not` / `.resolves` / `.rejects` between them change nothing.
        if (
          ts.isPropertyAccessExpression(call.expression) === true &&
          TRUTHINESS_MATCHERS.has(call.expression.name.text) === true &&
          call.arguments.length === 0
        ) {
          let subject = call.expression.expression;
          while (
            ts.isPropertyAccessExpression(subject) === true &&
            MATCHER_MODIFIERS.has(subject.name.text) === true
          ) {
            subject = subject.expression;
          }
          if (
            ts.isCallExpression(subject) === true &&
            subject.arguments.length > 0 &&
            EXPECT_CALLEES.has(subject.expression.getText(this.sourceFile)) === true
          ) {
            this.addCheck(
              call,
              CheckType.ASSERT,
              `Implicit boolean: '.${call.expression.name.text}()' asserts truthiness - assert an explicit value (.toBe(true), .not.toBeNull(), .toBeGreaterThan(0), ...)`,
            );
          }
        }

        // Truthiness predicates: `.filter(Boolean)` and kin.
        const method = calledMethodName(call.expression);
        if (
          method === null ||
          PREDICATE_METHODS.has(method) === false ||
          call.arguments.length === 0
        ) {
          break;
        }
        const predicate = unwrapParens(call.arguments[0]!);
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
            call,
            CheckType.FILTER,
            `.${method}(${builtin}) - implicit truthiness predicate; use an explicit predicate`,
            `.${method}(${builtin})`,
          );
          break;
        }
        if (
          ts.isArrowFunction(predicate) === false &&
          ts.isFunctionExpression(predicate) === false
        ) {
          break;
        }
        // A concise arrow body, or every `return` of a block body (not of
        // nested functions).
        const returned: ts.Expression[] = [];
        if (ts.isBlock(predicate.body) === true) {
          ts.forEachChild(predicate.body, (child) => this.collectReturns(child, returned));
        } else {
          returned.push(predicate.body as ts.Expression);
        }
        // `.filter((user) => user.email)` is `.filter(Boolean)` with extra
        // steps. Negations, `&&`/`||` and ternaries are left to their own checks.
        for (const result of returned) {
          const subject = unwrapParens(result);
          if (
            isComparison(subject) === false &&
            isBooleanLiteral(subject) === false &&
            isLogical(subject) === false &&
            isNotOperator(subject) === false &&
            ts.isConditionalExpression(subject) === false
          ) {
            this.addCheck(
              subject,
              CheckType.FILTER,
              `'.${method}' callback returns '${truncate(subject.getText(this.sourceFile))}', which the predicate coerces to a truth value - return an explicit comparison`,
            );
          }
        }
        break;
      }
      case ts.SyntaxKind.ArrowFunction: {
        // Anonymity itself is not ambiguous — only a concise arrow body that
        // buries a boolean is, so that is all this flags.
        const arrow = node as ts.ArrowFunction;
        if (ts.isBlock(arrow.body) === true) {
          break;
        }
        const body = unwrapParens(arrow.body as ts.Expression);
        if (ts.isConditionalExpression(body) === true) {
          this.implicitBoolCheck(body.condition, CheckType.ARROW);
        } else if (isLogical(body) === true || isNotOperator(body) === true) {
          this.addCheck(
            arrow,
            CheckType.ARROW,
            "Arrow function with an implicit boolean body - use a named function",
            `() => ${truncate(body.getText(this.sourceFile))}`,
          );
        }
        break;
      }
      case ts.SyntaxKind.Parameter: {
        this.checkOptionalMember(node as OptionalMember);
        const parameter = node as ts.ParameterDeclaration;
        // `port = 3000` fills in only when the argument is undefined: `??` in
        // disguise. `= null` is the one default allowed, the explicit form the
        // optional_param check asks for.
        if (
          parameter.initializer !== undefined &&
          parameter.initializer.kind !== ts.SyntaxKind.NullKeyword
        ) {
          this.addCheck(
            parameter,
            CheckType.NULLISH_COALESCE,
            `Parameter default '= ${truncate(parameter.initializer.getText(this.sourceFile))}' is an inline undefined-check like '??' - declare 'name: T | null = null' and test === null in the body`,
          );
        }
        // `@param {string} [label]` is `label?: string` written in a comment.
        for (const tag of ts.getJSDocParameterTags(parameter)) {
          if (tag.isBracketed === true) {
            this.addCheck(
              tag,
              CheckType.OPTIONAL_PARAM,
              `JSDoc optional parameter '[${tag.name.getText(this.sourceFile)}]' leaves absence implicit - document it as '{T | null}' and pass null explicitly`,
            );
          }
        }
        break;
      }
      case ts.SyntaxKind.BindingElement: {
        const element = node as ts.BindingElement;
        if (element.initializer !== undefined) {
          this.addCheck(
            element,
            CheckType.NULLISH_COALESCE,
            `Destructuring default '= ${truncate(element.initializer.getText(this.sourceFile))}' is an inline undefined-check like '??' - destructure without it and test === undefined explicitly`,
          );
        }
        break;
      }
      case ts.SyntaxKind.PropertyDeclaration:
      case ts.SyntaxKind.VariableDeclaration: {
        if (node.kind === ts.SyntaxKind.PropertyDeclaration) {
          this.checkOptionalMember(node as OptionalMember);
        }
        // `token!: string` is the declaration-side twin of `token!.length`:
        // it switches off the compiler's proof that the value was ever set.
        if (
          (node as ts.PropertyDeclaration | ts.VariableDeclaration).exclamationToken !== undefined
        ) {
          this.addCheck(
            node,
            CheckType.NON_NULL,
            "Definite assignment '!:' claims the value is set before use without proof - initialize it, or type it 'T | null = null'",
          );
        }
        break;
      }
      case ts.SyntaxKind.PropertySignature:
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
        // `<Widget active />` — JSX defaults a bare attribute to true, so the
        // reader has to supply the value from convention; `active={true}`
        // states it.
        if ((node as ts.JsxAttribute).initializer === undefined) {
          this.addCheck(
            node,
            CheckType.BOOL_ATTR,
            `Bare JSX attribute relies on the implicit-true convention - write ${(node as ts.JsxAttribute).name.getText(this.sourceFile)}={true}`,
          );
        }
        break;
      default:
        break;
    }

    // --- single-letter names ------------------------------------------------
    // No name anywhere may be a single letter: variables, parameters,
    // functions, classes, methods, properties, object keys, types,
    // interfaces, enums and their members, generic parameters (`<T>`),
    // namespaces, labels, imports and export aliases. Usages are not flagged —
    // only the declaration that chose the name — so `{ x }` shorthand and
    // `export { x }` report nothing beyond the binding they refer to.
    switch (node.kind) {
      case ts.SyntaxKind.VariableDeclaration:
      case ts.SyntaxKind.Parameter:
      case ts.SyntaxKind.BindingElement: {
        // Destructured names (`const { x } = point`, `[k, v]`) bind locals
        // too; each BindingElement is visited in turn, so only identifiers
        // are checked here.
        const name = (node as ts.VariableDeclaration | ts.ParameterDeclaration | ts.BindingElement)
          .name;
        let context = "use a descriptive variable name";
        if (node.kind === ts.SyntaxKind.Parameter) {
          context = "use a descriptive parameter name";
        }
        if (ts.isIdentifier(name) === true) {
          this.flagIfSingleLetter(name, context);
        }
        break;
      }
      case ts.SyntaxKind.CatchClause: {
        const declaration = (node as ts.CatchClause).variableDeclaration;
        if (declaration !== undefined && ts.isIdentifier(declaration.name) === true) {
          this.flagIfSingleLetter(
            declaration.name,
            "use a descriptive exception variable (not 'e')",
          );
        }
        break;
      }
      case ts.SyntaxKind.LabeledStatement:
        this.flagIfSingleLetter((node as ts.LabeledStatement).label, "use a descriptive label");
        break;
      case ts.SyntaxKind.ExportSpecifier:
        // `export { local as x }` chooses a name; `export { x }` only reuses one.
        if ((node as ts.ExportSpecifier).propertyName !== undefined) {
          this.flagIfSingleLetter(
            (node as ts.ExportSpecifier).name,
            "use a descriptive export name",
          );
        }
        break;
      default: {
        const context = SINGLE_LETTER_CONTEXTS.get(node.kind);
        if (context !== undefined) {
          const name = ts.getNameOfDeclaration(node as ts.Declaration);
          if (name !== undefined) {
            this.flagIfSingleLetter(name, context);
          }
        }
        break;
      }
    }

    if (
      node.parent !== undefined &&
      (ts.isSourceFile(node.parent) === true ||
        ts.isBlock(node.parent) === true ||
        ts.isModuleBlock(node.parent) === true)
    ) {
      // `@typedef` + `@property {T} [name]` is an optional field in a comment.
      for (const tag of ts.getJSDocTags(node)) {
        if (
          ts.isJSDocTypedefTag(tag) === true &&
          tag.typeExpression !== undefined &&
          ts.isJSDocTypeLiteral(tag.typeExpression) === true &&
          tag.typeExpression.jsDocPropertyTags !== undefined
        ) {
          for (const property of tag.typeExpression.jsDocPropertyTags) {
            if (property.isBracketed === true) {
              this.addCheck(
                property,
                CheckType.OPTIONAL_PARAM,
                `JSDoc optional property '[${property.name.getText(this.sourceFile)}]' leaves absence implicit - document it as '{T | null}'`,
              );
            }
          }
        }
      }
    }
    ts.forEachChild(node, (child) => this.visit(child));
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

  // --- logical chains -------------------------------------------------------

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

  // --- calls: assert(...) and predicate callbacks ----------------------------

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

  private collectReturns(node: ts.Node, out: ts.Expression[]): void {
    if (ts.isFunctionLike(node) === true || ts.isClassLike(node) === true) {
      return;
    }
    if (ts.isReturnStatement(node) === true && node.expression !== undefined) {
      out.push(node.expression);
    }
    ts.forEachChild(node, (child) => this.collectReturns(child, out));
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
    // A link inside a longer chain (`a?.b` within `a?.b.c`) is reported by the
    // top of that chain.
    const parent = node.parent;
    if (parent !== undefined && isAccessExpression(parent) === true && parent.expression === node) {
      return;
    }
    let current: ts.Node = node;
    while (isAccessExpression(current) === true) {
      if (current.questionDotToken !== undefined) {
        this.addCheck(
          node,
          CheckType.OPTIONAL_CHAIN,
          "Optional chaining hides missing/optional fields - validate the shape against a schema/type, then access directly",
        );
        return;
      }
      current = current.expression;
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

  private flagIfSingleLetter(name: ts.Node, context: string): void {
    let text: string | null = null;
    if (ts.isIdentifier(name) === true) {
      text = name.text;
    } else if (ts.isPrivateIdentifier(name) === true) {
      text = name.text.slice(1);
    } else if (ts.isStringLiteral(name) === true && /^\p{L}$/u.test(name.text) === true) {
      // `{ "x": 1 }` is the same key as `{ x: 1 }`; digits are not letters.
      text = name.text;
    }
    // Count code points, not UTF-16 units: `𝑥` is one letter in two units.
    // `_` is the discard name, not a letter; reading it back is flagged by
    // the single-use pass.
    if (text === null || [...text].length !== 1 || text === "_") {
      return;
    }
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
