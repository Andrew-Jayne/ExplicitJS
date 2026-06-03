/**
 * Expression/statement-level checks, implemented as a recursive walk over the
 * TypeScript AST. This is the JS/TS analogue of the Python tool's
 * `code_visitor.py`: it handles implicit-truthiness conditions (if/while/assert),
 * ternaries, boolean operators, arrow/function expressions, `.filter(Boolean)`,
 * loose equality, and single-letter names.
 *
 * Scope-level checks (single-use var/func) live in `singleUse.ts`.
 */

import ts from "typescript";
import { CheckType, EXTRA_CHECKS, type StyleCheck } from "@/constructs.js";

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

const CONTEXT_TEMPLATES: Partial<Record<CheckType, (code: string) => string>> = {
  [CheckType.IF]: (code) => `if (${code})`,
  [CheckType.WHILE]: (code) => `while (${code})`,
  [CheckType.ASSERT]: (code) => `assert(${code})`,
  [CheckType.ARROW]: (code) => `() => ${code}`,
};

function truncate(code: string): string {
  const collapsed = code.replace(/\s+/g, " ");
  if (collapsed.length > MAX_CODE_LENGTH) {
    return collapsed.slice(0, MAX_CODE_LENGTH) + "...";
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
    ts.isBinaryExpression(expr) === true &&
    LOGICAL_TOKENS.has(expr.operatorToken.kind) === true
  );
}

function isBooleanLiteral(expr: ts.Expression): boolean {
  return (
    expr.kind === ts.SyntaxKind.TrueKeyword ||
    expr.kind === ts.SyntaxKind.FalseKeyword
  );
}

function isNotOperator(expr: ts.Expression): expr is ts.PrefixUnaryExpression {
  return (
    ts.isPrefixUnaryExpression(expr) === true &&
    expr.operator === ts.SyntaxKind.ExclamationToken
  );
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

export class CodeVisitor {
  private readonly checks: StyleCheck[] = [];
  private readonly seenNames = new Set<string>();
  private readonly includeExtra: ReadonlySet<string>;

  constructor(
    private readonly filename: string,
    private readonly sourceFile: ts.SourceFile,
    includeExtra: ReadonlySet<string> = new Set(),
  ) {
    this.includeExtra = includeExtra;
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
        this.implicitBoolCheck(
          (node as ts.WhileStatement).expression,
          CheckType.WHILE,
        );
        break;
      case ts.SyntaxKind.DoStatement:
        this.implicitBoolCheck(
          (node as ts.DoStatement).expression,
          CheckType.WHILE,
        );
        break;
      case ts.SyntaxKind.ConditionalExpression:
        this.addCheck(
          node,
          CheckType.TERNARY,
          "Ternary expression - use an explicit if/else block instead",
        );
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
      default:
        break;
    }

    this.checkSingleLetterFor(node);
    ts.forEachChild(node, (child) => this.visit(child));
  }

  // --- implicit boolean -----------------------------------------------------

  private implicitBoolCheck(
    expr: ts.Expression,
    checkType: CheckType,
    context?: string,
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

    let message = context;
    if (message === undefined) {
      const template = CONTEXT_TEMPLATES[checkType];
      if (template !== undefined) {
        message = template(truncate(subject.getText(this.sourceFile)));
      } else {
        message = truncate(subject.getText(this.sourceFile));
      }
    }
    this.addCheck(subject, checkType, message);
  }

  // --- binary expressions ---------------------------------------------------

  private visitBinary(node: ts.BinaryExpression): void {
    const op = node.operatorToken.kind;

    if (
      op === ts.SyntaxKind.EqualsEqualsToken ||
      op === ts.SyntaxKind.ExclamationEqualsToken
    ) {
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

  private collectChain(
    node: ts.BinaryExpression,
    op: ts.SyntaxKind,
    out: ts.Expression[],
  ): void {
    for (const side of [node.left, node.right]) {
      const inner = unwrapParens(side);
      if (ts.isBinaryExpression(inner) === true && inner.operatorToken.kind === op) {
        this.collectChain(inner, op, out);
      } else {
        out.push(side);
      }
    }
  }

  // --- calls: assert(...) and .filter(Boolean) ------------------------------

  private visitCall(node: ts.CallExpression): void {
    const calleeText = node.expression.getText(this.sourceFile);
    if (
      (calleeText === "assert" ||
        calleeText === "console.assert" ||
        calleeText === "assert.ok") &&
      node.arguments.length >= 1
    ) {
      this.implicitBoolCheck(node.arguments[0]!, CheckType.ASSERT);
    }

    if (
      ts.isPropertyAccessExpression(node.expression) === true &&
      node.expression.name.text === "filter" &&
      node.arguments.length >= 1
    ) {
      const first = unwrapParens(node.arguments[0]!);
      if (ts.isIdentifier(first) === true && first.text === "Boolean") {
        this.addCheck(
          node,
          CheckType.FILTER,
          ".filter(Boolean) - implicit truthiness filter; use an explicit predicate",
          ".filter(Boolean)",
        );
      }
    }
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

  private visitFunctionLike(
    node: ts.ArrowFunction | ts.FunctionExpression,
  ): void {
    if (this.includeExtra.has(CheckType.ARROW) === true) {
      let code: string;
      if (node.kind === ts.SyntaxKind.ArrowFunction) {
        code = "() => ...";
      } else {
        code = "function () { ... }";
      }
      this.addCheck(
        node,
        CheckType.ARROW,
        "Anonymous function - use a named function (arrow in include-extra)",
        code,
      );
      return;
    }

    // Default mode: only flag a concise arrow body that buries a boolean.
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
          this.flagIfSingleLetter(
            decl.name,
            "use a descriptive exception variable (not 'e')",
          );
        }
        break;
      }
      default:
        break;
    }
  }

  private flagIfSingleLetter(name: ts.BindingName, context: string): void {
    if (ts.isIdentifier(name) === true) {
      this.flagSingleLetterIdentifier(name, context);
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

  private flagSingleLetterIdentifier(
    name: ts.Identifier,
    context: string,
  ): void {
    const text = name.text;
    if (text.length === 1 && text !== "_") {
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
    code?: string,
  ): void {
    const { line, column } = this.position(node);
    this.checks.push({
      file: this.filename,
      line,
      column,
      code: code ?? truncate(node.getText(this.sourceFile)),
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

export function analyzeAst(
  sourceFile: ts.SourceFile,
  filename: string,
  includeExtra: ReadonlySet<string> = new Set(),
): StyleCheck[] {
  return new CodeVisitor(filename, sourceFile, includeExtra).analyze();
}
