/**
 * Hand-rolled argument parser (no dependencies). Flag-backed fields default to
 * `undefined` ("not specified") so a config-file value can fill them in;
 * resolution happens in `main.ts`, where the CLI always wins.
 */

import {
  CHECK_TYPES,
  CheckType,
  EXTRA_CHECKS,
  isCheckType,
  isReportFormat,
  REPORT_FORMATS,
  ReportFormat,
} from "./constructs.ts";

export interface Args {
  path?: string;
  config?: string;
  format?: ReportFormat;
  excludeType?: string[];
  includeExtra?: string[];
  statsOnly?: boolean;
  noColor?: boolean;
  showHelp: boolean;
  showVersion: boolean;
}

export class ArgError extends Error {}

const HELP_TEXT = `ExplicitJS - Enforce semantic clarity in JavaScript/TypeScript code

Usage:
  explicitjs <path> [options]

Arguments:
  path                       File or directory to analyze

Options:
  -f, --format <fmt>         Output format: ${REPORT_FORMATS.join(" | ")} (default: text)
      --exclude-type <type>  Turn a check off entirely (repeatable)
      --include-extra <type> Opt into a stricter check that flags every
                             occurrence, not just ambiguous ones (repeatable):
                             ${[...EXTRA_CHECKS].join(", ")}
      --config <path>        Path to a config file (package.json / .explicitrc.json)
      --stats-only           Show only statistics, not individual checks
      --no-color             Disable colored output
      --version              Print version and exit
  -h, --help                 Show this help and exit

Check types:
  ${CHECK_TYPES.join(", ")}

Redirect output to a file with your shell:
  explicitjs src/ > report.txt

Examples:
  explicitjs src/
  explicitjs app.ts --format json
  explicitjs . --exclude-type ternary --exclude-type loose_equality
  explicitjs . --include-extra arrow`;

export function helpText(): string {
  return HELP_TEXT;
}

function requireValue(flag: string, value: string | undefined): string {
  if (value === undefined) {
    throw new ArgError(`Option ${flag} requires a value`);
  }
  return value;
}

export function parseArgs(argv: readonly string[]): Args {
  const args: Args = { showHelp: false, showVersion: false };
  const positionals: string[] = [];

  let index = 0;
  while (index < argv.length) {
    const token = argv[index]!;
    index += 1;

    // Support `--flag=value` form.
    let inlineValue: string | undefined = undefined;
    let flag = token;
    if (token.startsWith("--") === true && token.includes("=") === true) {
      const eq = token.indexOf("=");
      flag = token.slice(0, eq);
      inlineValue = token.slice(eq + 1);
    }

    const next = (): string => {
      if (inlineValue !== undefined) {
        return inlineValue;
      }
      index += 1;
      return requireValue(flag, argv[index - 1]);
    };

    switch (flag) {
      case "-h":
      case "--help":
        args.showHelp = true;
        break;
      case "--version":
        args.showVersion = true;
        break;
      case "-f":
      case "--format": {
        const value = next();
        if (isReportFormat(value) === false) {
          throw new ArgError(
            `Invalid format '${value}'. Choose one of: ${REPORT_FORMATS.join(", ")}`,
          );
        }
        args.format = value as ReportFormat;
        break;
      }
      case "--exclude-type": {
        const value = next();
        if (isCheckType(value) === false) {
          throw new ArgError(
            `Invalid check type '${value}'. Choose one of: ${CHECK_TYPES.join(", ")}`,
          );
        }
        (args.excludeType ??= []).push(value);
        break;
      }
      case "--include-extra": {
        const value = next();
        if (
          isCheckType(value) === false ||
          EXTRA_CHECKS.has(value as CheckType) === false
        ) {
          throw new ArgError(
            `Invalid extra check '${value}'. Choose one of: ${[...EXTRA_CHECKS].join(", ")}`,
          );
        }
        (args.includeExtra ??= []).push(value);
        break;
      }
      case "--config":
        args.config = next();
        break;
      case "--stats-only":
        args.statsOnly = true;
        break;
      case "--no-color":
        args.noColor = true;
        break;
      default:
        if (flag.startsWith("-") === true && flag !== "-") {
          throw new ArgError(`Unknown option '${flag}'`);
        }
        positionals.push(token);
        break;
    }
  }

  if (positionals.length > 0) {
    args.path = positionals[0];
  }
  return args;
}
