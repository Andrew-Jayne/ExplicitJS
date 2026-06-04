/**
 * Central type registry for ExplicitJS.
 *
 * `CheckType` enumerates every check the analyzer can produce; its members are
 * also the valid `--exclude-type` values. `StyleCheck` is the record every
 * check produces. Adding a new check almost always starts here.
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
  OPTIONAL_CHAIN = "optional_chain",
  BOOL_OP = "bool_op",
  ARROW = "arrow",
  FILTER = "filter",
  LOOSE_EQUALITY = "loose_equality",
  SINGLE_LETTER_VAR = "single_letter_var",
  SINGLE_USE_VAR = "single_use_var",
  SINGLE_USE_FUNC = "single_use_func",
}

export const CHECK_TYPES: readonly CheckType[] = Object.values(CheckType);

export function isCheckType(value: string): value is CheckType {
  return (CHECK_TYPES as readonly string[]).includes(value);
}

/**
 * Checks that have a stricter, opt-in variant. By default each only flags an
 * ambiguous (implicit-boolean) use; listing it in `include-extra` upgrades it
 * to flag *every* occurrence (e.g. ban all arrow functions).
 */
export const EXTRA_CHECKS: ReadonlySet<CheckType> = new Set([CheckType.ARROW]);

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
