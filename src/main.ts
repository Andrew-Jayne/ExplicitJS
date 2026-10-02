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
import { loadConfig } from "./config.ts";
import { Colors, ReportFormat, type StyleCheck } from "./constructs.ts";
import { analyzeFile } from "./fileHandlers.ts";
import { formatReport, generateChecksListing, generateStatisticsReport } from "./reporters.ts";

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

// Always skipped, whatever the config says: no `ignore` list can re-enable a
// dependency or build tree, it can only add to these sets. Dependency trees
// (and every dotfile directory) are skipped at any depth.
const DEPENDENCY_DIRS: ReadonlySet<string> = new Set(["node_modules"]);

// Build-output names are also ordinary words (`src/features/build/`), so they
// are skipped only where tools put them: beside a project manifest, or
// directly under the analyzed root. Elsewhere they are source and get checked.
const OUTPUT_DIRS: ReadonlySet<string> = new Set([
  "dist",
  "dist-test",
  "build",
  "out",
  "coverage",
  "vendor",
]);

const PROJECT_MANIFESTS: readonly string[] = ["package.json", "deno.json", "deno.jsonc"];

const DECLARATION_RE = /\.d\.(ts|mts|cts)$/;

function isSupportedFile(filepath: string): boolean {
  if (DECLARATION_RE.test(filepath) === true) {
    return false;
  }
  return SOURCE_EXTENSIONS.has(path.extname(filepath).toLowerCase());
}

export function run(args: Args): number {
  if (args.path === "list-checks") {
    // Print the `list-checks` catalog.
    if (args.noColor !== true && process.stdout.isTTY === true) {
      Colors.enable();
    }
    writeOut(`${generateChecksListing()}\n`);
    return EXIT_OK;
  }
  if (args.path === null) {
    writeErr("error: no path provided (see --help)\n");
    return EXIT_ARGS_ERROR;
  }
  if (existsSync(args.path) === false) {
    writeErr(`error: path does not exist: ${args.path}\n`);
    return EXIT_ARGS_ERROR;
  }

  const config = loadConfig(args.path, args.config);

  if (args.noColor !== true && process.stdout.isTTY === true) {
    Colors.enable();
  }

  // Discover source files: the target itself, or a walk of its tree.
  const target = args.path;
  const files: string[] = [];
  if (statSync(target).isFile() === true) {
    if (isSupportedFile(target) === true) {
      files.push(target);
    }
  } else {
    const pending: string[] = [target];
    while (pending.length > 0) {
      const dir = pending.pop();
      if (dir === undefined) {
        break;
      }
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory() === true) {
          let ignored = false;
          if (DEPENDENCY_DIRS.has(entry.name) === true || entry.name.startsWith(".") === true) {
            ignored = true;
          } else if (OUTPUT_DIRS.has(entry.name) === true) {
            const parent = path.dirname(full);
            if (path.resolve(parent) === path.resolve(target)) {
              ignored = true;
            }
            for (const manifest of PROJECT_MANIFESTS) {
              if (existsSync(path.join(parent, manifest)) === true) {
                ignored = true;
              }
            }
          }
          if (config.ignoreNames.has(entry.name) === true) {
            ignored = true;
          }
          if (config.ignorePaths.has(path.resolve(full)) === true) {
            ignored = true;
          }
          if (ignored === false) {
            pending.push(full);
          }
        } else if (entry.isFile() === true && isSupportedFile(full) === true) {
          files.push(full);
        }
      }
    }
    files.sort();
  }
  if (files.length === 0) {
    writeErr("error: no supported source files found to analyze\n");
    return EXIT_ARGS_ERROR;
  }

  const allChecks: StyleCheck[] = [];
  for (const filepath of files) {
    allChecks.push(...analyzeFile(filepath));
  }

  // CLI flags win over the config file; text is the fallback.
  let outputFormat = ReportFormat.TEXT;
  if (args.format !== null) {
    outputFormat = args.format;
  } else if (config.format !== null) {
    outputFormat = config.format;
  }

  let report: string;
  if (args.statsOnly === true) {
    report = generateStatisticsReport(allChecks, files.length);
  } else {
    report = formatReport(allChecks, outputFormat);
  }

  writeOut(`${report}\n`);

  if (allChecks.length > 0) {
    return EXIT_CHECKS_FOUND;
  }
  return EXIT_OK;
}
