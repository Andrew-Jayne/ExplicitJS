/**
 * Orchestration: resolve the effective settings (CLI flags win over the config
 * file), discover source files, run analysis, filter excluded checks, dispatch
 * to a reporter, and return a process exit code (non-zero when any check fires,
 * so it works as a CI gate).
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { type Args } from "./cliArgs.ts";
import { type Config, loadConfig } from "./config.ts";
import { Colors, ReportFormat, type StyleCheck } from "./constructs.ts";
import { analyzeFile } from "./fileHandlers.ts";
import { formatReport, generateStatisticsReport } from "./reporters.ts";

const encoder = new TextEncoder();
function writeErr(message: string): void {
  Deno.stderr.writeSync(encoder.encode(message));
}
function writeOut(message: string): void {
  Deno.stdout.writeSync(encoder.encode(message));
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
  excludeType: string[];
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

function resolveSettings(args: Args, config: Config): Settings {
  return {
    noColor: resolveBool(args.noColor, config.noColor),
    statsOnly: resolveBool(args.statsOnly, config.statsOnly),
    outputFormat: args.format ?? config.format ?? ReportFormat.TEXT,
    excludeType: mergeList(args.excludeType, config.excludeType),
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
        if (
          SKIP_DIRS.has(entry.name) === false &&
          entry.name.startsWith(".") === false
        ) {
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

export function run(args: Args): number {
  if (args.path === undefined) {
    writeErr("error: no path provided (see --help)\n");
    return 1;
  }
  if (existsSync(args.path) === false) {
    writeErr(`error: path does not exist: ${args.path}\n`);
    return 1;
  }

  const config = loadConfig(args.path, args.config);
  const settings = resolveSettings(args, config);

  if (settings.noColor === true || Deno.stdout.isTerminal() === false) {
    Colors.disable();
  }

  const files = collectFiles(args.path);
  if (files.length === 0) {
    writeErr("error: no JavaScript/TypeScript files found to analyze\n");
    return 1;
  }

  let allChecks: StyleCheck[] = [];
  for (const filepath of files) {
    allChecks.push(
      ...analyzeFile(filepath, {
        includeExtra: settings.includeExtra,
        entryPoints: config.entryPoints,
      }),
    );
  }

  if (settings.excludeType.length > 0) {
    const excluded = new Set(settings.excludeType);
    allChecks = allChecks.filter((check) => excluded.has(check.checkType) === false);
  }

  let report: string;
  if (settings.statsOnly === true) {
    report = generateStatisticsReport(allChecks, files.length);
  } else {
    report = formatReport(allChecks, settings.outputFormat);
  }

  writeOut(report + "\n");

  if (allChecks.length > 0) {
    return 1;
  }
  return 0;
}
