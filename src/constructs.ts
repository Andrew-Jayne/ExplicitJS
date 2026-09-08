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
  BOOL_OP = "bool_op",
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
 * Opt-in checks, enabled via `include-extra`. `arrow` by default only flags an
 * ambiguous (implicit-boolean) use and is upgraded here to flag *every*
 * occurrence; `optional_param` runs only when opted in.
 */
export const EXTRA_CHECKS: ReadonlySet<CheckType> = new Set([
  CheckType.ARROW,
  CheckType.OPTIONAL_PARAM,
]);

/**
 * One-line explanation of every check in its default-mode behavior, shown by
 * the `list-checks` command. Every CheckType member must have an entry, in
 * registry order (asserted by the test suite).
 */
export const CHECK_DESCRIPTIONS: Readonly<Record<CheckType, string>> = {
  [CheckType.IF]:
    "Implicit truthiness in an if condition ('if (items)') - compare explicitly (=== null, .length > 0, ...)",
  [CheckType.WHILE]:
    "Implicit truthiness in a while/do-while condition - write an explicit comparison",
  [CheckType.ASSERT]:
    "Implicit truthiness in assert/console.assert/assert.ok - assert an explicit comparison",
  [CheckType.TERNARY]: "Inline conditional 'cond ? x : y' - use an explicit if/else block",
  [CheckType.NULLISH_COALESCE]:
    "'??' / '??=' inline null-defaulting - test === null / === undefined explicitly",
  [CheckType.OPTIONAL_CHAIN]:
    "Optional chaining 'a?.b' hides missing fields - validate the shape once, then access directly",
  [CheckType.BOOL_OP]:
    "'&&' / '||' (and '&&=' / '||=') with a non-boolean operand - write an explicit comparison for each operand",
  [CheckType.BOOL_ATTR]:
    "Bare attribute in JSX or a Svelte/Vue template ('<Widget active />') relies on the implicit-true convention - write the value out (active={true}, :active=\"true\")",
  [CheckType.ARROW]:
    "Arrow/function expression hiding an implicit-boolean body - use a named function (the 'arrow' extra bans all anonymous functions)",
  [CheckType.FILTER]:
    "'.filter(Boolean)' uses implicit truthiness as the predicate - pass an explicit predicate",
  [CheckType.LOOSE_EQUALITY]: "Loose '==' / '!=' coerces operands - use '===' / '!=='",
  [CheckType.SINGLE_LETTER_VAR]:
    "Single-letter name carries no semantic meaning - use a descriptive name",
  [CheckType.SINGLE_USE_VAR]:
    "Variable assigned then read exactly once - inline the expression (UPPER_SNAKE_CASE constants are exempt)",
  [CheckType.SINGLE_USE_FUNC]:
    "Function called exactly once - inline it at the call site (exports and 'main' are exempt)",
  [CheckType.OPTIONAL_PARAM]:
    "Off by default - opt in with the 'optional_param' extra (see 'explicitjs list-extras')",
};

/**
 * One-line explanation of what each opt-in extra adds over the default mode,
 * shown by the `list-extras` command. Every EXTRA_CHECKS member must have an
 * entry (asserted by the test suite).
 */
export const EXTRA_DESCRIPTIONS: Readonly<Partial<Record<CheckType, string>>> = {
  [CheckType.ARROW]:
    "Ban every arrow/function expression, not just ambiguous ones - anonymous logic has no name to describe intent; use named functions",
  [CheckType.OPTIONAL_PARAM]:
    "Ban 'arg?: T' in function implementations - 'arg: T | null = null' names the absent value and documents the default",
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
