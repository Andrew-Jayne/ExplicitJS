/**
 * Central type registry for ExplicitJS.
 *
 * `CheckType` enumerates every check the analyzer can produce. `StyleCheck` is
 * the record every check produces. Adding a new check almost always starts
 * here — and every member needs a `CHECK_DESCRIPTIONS` entry (asserted by the
 * test suite).
 */

export enum ReportFormat {
  TEXT = "text",
  JSON = "json",
  CSV = "csv",
}

export const REPORT_FORMATS: readonly ReportFormat[] = [
  ReportFormat.TEXT,
  ReportFormat.JSON,
  ReportFormat.CSV,
];

export function isReportFormat(value: string): value is ReportFormat {
  return (REPORT_FORMATS as readonly string[]).includes(value);
}

export enum CheckType {
  IF = "if",
  WHILE = "while",
  ASSERT = "assert",
  TERNARY = "ternary",
  NULLISH_COALESCE = "nullish_coalesce",
  OPTIONAL_CHAIN = "optional_chain",
  NON_NULL = "non_null",
  BOOL_OP = "bool_op",
  NOT = "not",
  BOOL_ATTR = "bool_attr",
  ARROW = "arrow",
  FILTER = "filter",
  LOOSE_EQUALITY = "loose_equality",
  SINGLE_LETTER_VAR = "single_letter_var",
  SINGLE_USE_VAR = "single_use_var",
  SINGLE_USE_FUNC = "single_use_func",
  OPTIONAL_PARAM = "optional_param",
}

export const CHECK_TYPES: readonly CheckType[] = Object.values(CheckType);

export function isCheckType(value: string): value is CheckType {
  return (CHECK_TYPES as readonly string[]).includes(value);
}

/**
 * One-line explanation of every check, shown by the `list-checks` command.
 * Every CheckType member must have an entry, in registry order (asserted by
 * the test suite).
 */
export const CHECK_DESCRIPTIONS: Readonly<Record<CheckType, string>> = {
  [CheckType.IF]:
    "Implicit truthiness in an if condition ('if (items)') - compare explicitly (=== null, .length > 0, ...)",
  [CheckType.WHILE]:
    "Implicit truthiness in a while/do-while/for condition - write an explicit comparison",
  [CheckType.ASSERT]:
    "Implicit truthiness in assert/console.assert/assert.ok/assert.strict (however imported or spelled) or expect(...).toBeTruthy()/.toBeFalsy() - assert an explicit comparison",
  [CheckType.TERNARY]: "Inline conditional 'cond ? x : y' - use an explicit if/else block",
  [CheckType.NULLISH_COALESCE]:
    "'??' / '??=' inline null-defaulting, and default values that do the same ('const { port = 3000 } = env', 'function listen(port = 3000)') - test === null / === undefined explicitly; a parameter's '= null' is the one allowed default",
  [CheckType.OPTIONAL_CHAIN]:
    "Optional chaining 'a?.b' hides missing fields - validate the shape once, then access directly",
  [CheckType.NON_NULL]:
    "Non-null assertion 'a!.b' or definite assignment 'token!: T' claims presence instead of checking it - validate the shape or test explicitly ('items[0]!' index access is exempt)",
  [CheckType.BOOL_OP]:
    "'&&' / '||' (and '&&=' / '||=') with a non-boolean operand - write an explicit comparison for each operand",
  [CheckType.NOT]:
    "Negation '!value' anywhere outside a condition ('const missing = !items', '!items === true') - compare explicitly (=== false, === null, ...)",
  [CheckType.BOOL_ATTR]:
    "Bare attribute in JSX or a Svelte/Vue template ('<Widget active />') relies on the implicit-true convention - write the value out (active={true}, :active=\"true\")",
  [CheckType.ARROW]:
    "Arrow/function expression hiding an implicit-boolean body - use a named function with explicit comparisons",
  [CheckType.FILTER]:
    "Truthiness predicate in .filter/.find/.some/.every ('Boolean', 'String', 'Number', or a callback returning a bare value) - pass an explicit predicate",
  [CheckType.LOOSE_EQUALITY]: "Loose '==' / '!=' coerces operands - use '===' / '!=='",
  [CheckType.SINGLE_LETTER_VAR]:
    "Single-letter name anywhere (variables, parameters, properties, object keys, types, generic parameters, enum members, labels, ...) carries no semantic meaning - use a descriptive name",
  [CheckType.SINGLE_USE_VAR]:
    "Variable assigned then read exactly once - inline the expression (UPPER_SNAKE_CASE names bound to constant values are exempt)",
  [CheckType.SINGLE_USE_FUNC]:
    "Function, or private class method, called exactly once - inline it at the call site (exports and 'main' are exempt)",
  [CheckType.OPTIONAL_PARAM]:
    "Optional 'name?: T' parameter, property or method (or JSDoc '[name]'), or optional-everything via Partial<T> / a '?:' mapped type - write 'name: T | null' (plus '= null' where a default is legal) so the absent value is named and callers must handle it",
};

export interface StyleCheck {
  file: string;
  line: number;
  column: number;
  code: string;
  context: string;
  checkType: CheckType;
}

/** ANSI escape codes for terminal colors. */
export class Colors {
  static readonly RESET = "\x1b[0m";
  static readonly BOLD = "\x1b[1m";
  static readonly DIM = "\x1b[2m";

  static readonly RED = "\x1b[91m";
  static readonly GREEN = "\x1b[92m";
  static readonly YELLOW = "\x1b[93m";
  static readonly BLUE = "\x1b[94m";
  static readonly MAGENTA = "\x1b[95m";
  static readonly CYAN = "\x1b[96m";
  static readonly WHITE = "\x1b[97m";
  static readonly GRAY = "\x1b[90m";

  private static enabled = false;

  /** Opt in to color. Call once when stdout is a TTY and --no-color was not set. */
  static enable(): void {
    Colors.enabled = true;
  }

  /** Wrap `text` in `code`/RESET, but only when colors are enabled. */
  static paint(code: string, text: string): string {
    if (Colors.enabled === false) {
      return text;
    }
    return `${code}${text}${Colors.RESET}`;
  }
}
