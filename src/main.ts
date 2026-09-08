/**
 * Orchestration: resolve the effective settings (CLI flags win over the config
 * file), discover source files, run analysis, filter excluded checks, dispatch
 * to a reporter, and return a process exit code (non-zero when any check fires,
 * so it works as a CI gate).
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import type { Args } from "./cliArgs.ts";
import { type Config, loadConfig } from "./config.ts";
import { Colors, ReportFormat, type StyleCheck } from "./constructs.ts";
import { analyzeFile } from "./fileHandlers.ts";
import {
  formatReport,
  generateChecksListing,
  generateExtrasListing,
  generateStatisticsReport,
} from "./reporters.ts";

/** Exit-code contract (mirrors the Python tool): 0 clean, 1 findings, 20 unusable invocation. */
export const EXIT_OK = 0;
export const EXIT_CHECKS_FOUND = 1;
export const EXIT_ARGS_ERROR = 20;

function writeErr(message: string): void {
  process.stderr.write(message);
}
function writeOut(message: string): void {
  process.stdout.write(message);
}

const SOURCE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".svelte",
  ".vue",
]);

const SKIP_DIRS: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  "dist",
  "dist-test",
  "build",
  "out",
  "coverage",
  ".next",
  ".nuxt",
  ".cache",
  ".turbo",
  "vendor",
]);

const DECLARATION_RE = /\.d\.(ts|mts|cts)$/;

interface Settings {
  noColor: boolean;
  statsOnly: boolean;
  outputFormat: ReportFormat;
  includeExtra: Set<string>;
}

function resolveBool(cli: boolean | undefined, config: boolean | undefined): boolean {
  if (cli !== undefined) {
    return cli;
  }
  if (config !== undefined) {
    return config;
  }
  return false;
}

function mergeList(cli: string[] | undefined, config: string[] | undefined): string[] {
  const merged: string[] = [];
  if (config !== undefined) {
    merged.push(...config);
  }
  if (cli !== undefined) {
    merged.push(...cli);
  }
  return merged;
}

function resolveFormat(
  cli: ReportFormat | undefined,
  config: ReportFormat | undefined,
): ReportFormat {
  if (cli !== undefined) {
    return cli;
  }
  if (config !== undefined) {
    return config;
  }
  return ReportFormat.TEXT;
}

function resolveSettings(args: Args, config: Config): Settings {
  return {
    noColor: resolveBool(args.noColor, config.noColor),
    statsOnly: resolveBool(args.statsOnly, config.statsOnly),
    outputFormat: resolveFormat(args.format, config.format),
    includeExtra: new Set(mergeList(args.includeExtra, config.includeExtra)),
  };
}

function isSupportedFile(filepath: string): boolean {
  if (DECLARATION_RE.test(filepath) === true) {
    return false;
  }
  return SOURCE_EXTENSIONS.has(path.extname(filepath).toLowerCase());
}

function collectFiles(target: string): string[] {
  const files: string[] = [];

  if (statSync(target).isFile() === true) {
    if (isSupportedFile(target) === true) {
      files.push(target);
    }
    return files;
  }

  const pending: string[] = [target];
  while (pending.length > 0) {
    const dir = pending.pop();
    if (dir === undefined) {
      break;
    }
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() === true) {
        if (SKIP_DIRS.has(entry.name) === false && entry.name.startsWith(".") === false) {
          pending.push(full);
        }
      } else if (entry.isFile() === true && isSupportedFile(full) === true) {
        files.push(full);
      }
    }
  }
  files.sort();
  return files;
}

/** Print a `list-checks` / `list-extras` catalog. */
function printListing(listing: string, noColor: boolean | undefined): number {
  if (noColor !== true && process.stdout.isTTY === true) {
    Colors.enable();
  }
  writeOut(`${listing}\n`);
  return EXIT_OK;
}

export function run(args: Args): number {
  if (args.path === "list-checks") {
    return printListing(generateChecksListing(), args.noColor);
  }
  if (args.path === "list-extras") {
    return printListing(generateExtrasListing(), args.noColor);
  }

  if (args.path === undefined) {
    writeErr("error: no path provided (see --help)\n");
    return EXIT_ARGS_ERROR;
  }
  if (existsSync(args.path) === false) {
    writeErr(`error: path does not exist: ${args.path}\n`);
    return EXIT_ARGS_ERROR;
  }

  let configPath: string | null = null;
  if (args.config !== undefined) {
    configPath = args.config;
  }
  const config = loadConfig(args.path, configPath);
  const settings = resolveSettings(args, config);

  if (settings.noColor !== true && process.stdout.isTTY === true) {
    Colors.enable();
  }

  const files = collectFiles(args.path);
  if (files.length === 0) {
    writeErr("error: no supported source files found to analyze\n");
    return EXIT_ARGS_ERROR;
  }

  const allChecks: StyleCheck[] = [];
  for (const filepath of files) {
    allChecks.push(
      ...analyzeFile(filepath, {
        includeExtra: settings.includeExtra,
        entryPoints: config.entryPoints,
      }),
    );
  }

  let report: string;
  if (settings.statsOnly === true) {
    report = generateStatisticsReport(allChecks, files.length);
  } else {
    report = formatReport(allChecks, settings.outputFormat);
  }

  writeOut(`${report}\n`);

  if (allChecks.length > 0) {
    return EXIT_CHECKS_FOUND;
  }
  return EXIT_OK;
}
