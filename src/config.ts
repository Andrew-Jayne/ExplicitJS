/**
 * Project configuration discovery. Settings come from a `.explicitrc.json` file, discovered by walking up from the analyzed path (or pointed at explicitly with `--config`). The file holds what the project knows — how it reports and what it does not scan — so there are exactly two keys: `format` and `ignore`. Per-run choices (`--stats-only`, `--no-color`) are flags only, and no key can turn a check on or off. `format` defaults to `null` ("not specified") so the CLI layer can tell an explicit choice from a fallback.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { isReportFormat, type ReportFormat } from "./constructs.ts";

export interface Config {
  format: ReportFormat | null;
  /** Bare directory names from `ignore`, skipped at any depth. */
  ignoreNames: Set<string>;
  /** Entries from `ignore` that carry a separator, resolved against the config file. */
  ignorePaths: Set<string>;
}

function emptyConfig(): Config {
  return { format: null, ignoreNames: new Set(), ignorePaths: new Set() };
}

function directoryOf(start: string): string {
  if (existsSync(start) === true && statSync(start).isFile() === true) {
    return path.dirname(path.resolve(start));
  }
  return path.resolve(start);
}

function findUp(start: string, filename: string): string | undefined {
  let current = directoryOf(start);
  for (;;) {
    const candidate = path.join(current, filename);
    if (existsSync(candidate) === true && statSync(candidate).isFile() === true) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

export function loadConfig(start: string, configPath: string | null = null): Config {
  const config = emptyConfig();

  if (configPath !== null) {
    applyRcFile(configPath, config);
    return config;
  }

  const rcPath = findUp(start, ".explicitrc.json");
  if (rcPath !== undefined) {
    applyRcFile(rcPath, config);
  }

  return config;
}

function readJson(filepath: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(filepath, "utf-8"));
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

function applyRcFile(filepath: string, config: Config): void {
  const data = readJson(filepath);
  if (data === null) {
    return;
  }
  applyTable(data, config, path.dirname(path.resolve(filepath)));
}

/**
 * Apply one config table. `baseDir` is the directory holding the config file:
 * an `ignore` entry with a separator in it is a path relative to that file, so
 * it means the same directory wherever the tool is invoked from. Unknown keys
 * are ignored, which includes the output flags (`--stats-only`, `--no-color`)
 * and anything that looks like a check name.
 */
function applyTable(table: Record<string, unknown>, config: Config, baseDir: string): void {
  const format = lookupString(table, "format");
  if (format !== null && isReportFormat(format) === true) {
    config.format = format;
  }

  const ignore = lookupArray(table, "ignore");
  if (ignore === null) {
    return;
  }
  for (const entry of ignore) {
    const trimmed = entry.trim();
    if (trimmed === "") {
      continue;
    }
    if (trimmed.includes("/") === true || trimmed.includes("\\") === true) {
      config.ignorePaths.add(path.resolve(baseDir, trimmed));
    } else {
      config.ignoreNames.add(trimmed);
    }
  }
}

function lookup(table: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (key in table) {
      return table[key];
    }
  }
  return null;
}

function lookupString(table: Record<string, unknown>, ...keys: string[]): string | null {
  const value = lookup(table, ...keys);
  if (typeof value === "string") {
    return value;
  }
  return null;
}

function lookupArray(table: Record<string, unknown>, ...keys: string[]): string[] | null {
  const value = lookup(table, ...keys);
  if (Array.isArray(value) === false) {
    return null;
  }
  const items: string[] = [];
  for (const item of value as unknown[]) {
    if (typeof item === "string") {
      items.push(item);
    }
  }
  return items;
}
