/**
 * Hand-rolled argument parser (no dependencies). Flag-backed fields default to
 * `null` ("not specified") so a config-file value can fill them in; resolution
 * happens in `main.ts`, where the CLI always wins.
 */

import { CHECK_TYPES, isReportFormat, REPORT_FORMATS, type ReportFormat } from "./constructs.ts";

export interface Args {
  path: string | null;
  config: string | null;
  format: ReportFormat | null;
  statsOnly: boolean | null;
  noColor: boolean | null;
  showHelp: boolean;
  showVersion: boolean;
}

export class ArgError extends Error {}

const HELP_TEXT = `ExplicitJS - Enforce semantic clarity in JavaScript/TypeScript code

Usage:
  explicitjs <path> [options]
  explicitjs list-checks     Describe every check

Arguments:
  path                       File or directory to analyze

Options:
  -f, --format <fmt>         Output format: ${REPORT_FORMATS.join(" | ")} (default: text)
      --config <path>        Path to a config file (.explicitrc.json)
      --stats-only           Show only statistics, not individual checks
      --no-color             Disable colored output
      --version              Print version and exit
  -h, --help                 Show this help and exit

Checks (all of them always on - none can be disabled or suppressed):
  ${CHECK_TYPES.join(", ")}

Redirect output to a file with your shell:
  explicitjs src/ > report.txt

Examples:
  explicitjs src/
  explicitjs app.ts --format json
  explicitjs src/ --stats-only`;

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
  const args: Args = {
    path: null,
    config: null,
    format: null,
    statsOnly: null,
    noColor: null,
    showHelp: false,
    showVersion: false,
  };
  const positionals: string[] = [];

  let index = 0;
  while (index < argv.length) {
    const token = argv[index]!;
    index += 1;

    // Support `--flag=value` form.
    let inlineValue: string | undefined;
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

  if (positionals.length > 1) {
    throw new ArgError(`Unexpected extra argument '${positionals[1]}' - only one path is allowed`);
  }
  if (positionals.length > 0) {
    args.path = positionals[0]!;
  }
  return args;
}
