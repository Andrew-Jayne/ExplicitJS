/**
 * Project configuration discovery. Settings come from a `.explicitrc.json` file, discovered by walking up from the analyzed path (or pointed at explicitly with `--config`). Every flag-backed field defaults to `undefined` ("not specified") so the CLI layer can tell an explicit choice from a fallback.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  CheckType,
  EXTRA_CHECKS,
  isCheckType,
  isReportFormat,
  ReportFormat,
} from "./constructs.ts";

export interface Config {
  format?: ReportFormat;
  excludeType?: string[];
  includeExtra?: string[];
  noColor?: boolean;
  statsOnly?: boolean;
  entryPoints: Set<string>;
}

function emptyConfig(): Config {
  return { entryPoints: new Set() };
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
    if (
      existsSync(candidate) === true &&
      statSync(candidate).isFile() === true
    ) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

export function loadConfig(start: string, configPath?: string): Config {
  const config = emptyConfig();

  if (configPath !== undefined) {
    applyRcFile(configPath, config);
    return config;
  }

  const rcPath = findUp(start, ".explicitrc.json");
  if (rcPath !== undefined) {
    applyRcFile(rcPath, config);
  }

  return config;
}

function readJson(filepath: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(filepath, "utf-8"));
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function applyRcFile(filepath: string, config: Config): void {
  const data = readJson(filepath);
  if (data === undefined) {
    return;
  }
  applyTable(data, config);
}

function isEnabledExtra(value: string): boolean {
  return (
    isCheckType(value) === true && EXTRA_CHECKS.has(value as CheckType) === true
  );
}

function applyTable(table: Record<string, unknown>, config: Config): void {
  const format = lookupString(table, "format");
  if (format !== undefined && isReportFormat(format) === true) {
    config.format = format;
  }

  const excludeType = lookupArray(table, "exclude-type", "excludeType");
  if (excludeType !== undefined) {
    config.excludeType = excludeType.filter((value) => isCheckType(value));
  }

  const includeExtra = lookupArray(table, "include-extra", "includeExtra");
  if (includeExtra !== undefined) {
    config.includeExtra = includeExtra.filter(isEnabledExtra);
  }

  const noColor = lookupBool(table, "no-color", "noColor");
  if (noColor !== undefined) {
    config.noColor = noColor;
  }

  const statsOnly = lookupBool(table, "stats-only", "statsOnly");
  if (statsOnly !== undefined) {
    config.statsOnly = statsOnly;
  }
}

function lookup(table: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (key in table) {
      return table[key];
    }
  }
  return undefined;
}

function lookupString(
  table: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  const value = lookup(table, ...keys);
  if (typeof value === "string") {
    return value;
  }
  return undefined;
}

function lookupBool(
  table: Record<string, unknown>,
  ...keys: string[]
): boolean | undefined {
  const value = lookup(table, ...keys);
  if (typeof value === "boolean") {
    return value;
  }
  return undefined;
}

function lookupArray(
  table: Record<string, unknown>,
  ...keys: string[]
): string[] | undefined {
  const value = lookup(table, ...keys);
  if (Array.isArray(value) === true) {
    return value.filter((item): item is string => typeof item === "string");
  }
  return undefined;
}
