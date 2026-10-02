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

function lookup(table: Record<string, unknown>, key: string): unknown {
  if (key in table) {
    return table[key];
  }
  return null;
}

export function loadConfig(start: string, configPath: string | null = null): Config {
  const config: Config = { format: null, ignoreNames: new Set(), ignorePaths: new Set() };

  let rcPath = configPath;
  if (rcPath === null) {
    // Walk up from the analyzed path (its directory, when it is a file) to the
    // filesystem root, stopping at the first `.explicitrc.json`.
    let current = path.resolve(start);
    if (existsSync(start) === true && statSync(start).isFile() === true) {
      current = path.dirname(path.resolve(start));
    }
    for (;;) {
      const candidate = path.join(current, ".explicitrc.json");
      if (existsSync(candidate) === true && statSync(candidate).isFile() === true) {
        rcPath = candidate;
        break;
      }
      const parent = path.dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }
  }
  if (rcPath === null) {
    return config;
  }

  let table: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(rcPath, "utf-8"));
    if (typeof parsed === "object" && parsed !== null) {
      table = parsed as Record<string, unknown>;
    }
  } catch {
    table = null;
  }
  if (table === null) {
    return config;
  }

  // Unknown keys are ignored, which includes the output flags (`--stats-only`,
  // `--no-color`) and anything that looks like a check name.
  const format = lookup(table, "format");
  if (typeof format === "string" && isReportFormat(format) === true) {
    config.format = format;
  }

  const ignore = lookup(table, "ignore");
  if (Array.isArray(ignore) === false) {
    return config;
  }
  for (const entry of ignore as unknown[]) {
    if (typeof entry !== "string") {
      continue;
    }
    const trimmed = entry.trim();
    if (trimmed === "") {
      continue;
    }
    // An entry with a separator is a path relative to the config file, so it
    // means the same directory wherever the tool is invoked from.
    if (trimmed.includes("/") === true || trimmed.includes("\\") === true) {
      config.ignorePaths.add(path.resolve(path.dirname(path.resolve(rcPath)), trimmed));
    } else {
      config.ignoreNames.add(trimmed);
    }
  }
  return config;
}
