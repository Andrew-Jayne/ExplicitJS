#!/usr/bin/env node
/**
 * Executable entry point for ExplicitJS (the npx target).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ArgError, helpText, parseArgs } from "@/cliArgs.js";
import { run } from "@/main.js";

function packageVersion(): string {
  try {
    const pkg: unknown = JSON.parse(
      readFileSync(
        path.join(
          path.dirname(fileURLToPath(import.meta.url)),
          "..",
          "package.json",
        ),
        "utf-8",
      ),
    );
    if (typeof pkg === "object" && pkg !== null && "version" in pkg) {
      return String((pkg as { version: unknown }).version);
    }
  } catch {
    // fall through
  }
  return "unknown";
}

function main(): void {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof ArgError) {
      process.stderr.write(`error: ${error.message}\n`);
      process.exit(2);
    }
    throw error;
  }

  if (args.showHelp === true) {
    process.stdout.write(helpText() + "\n");
    process.exit(0);
  }
  if (args.showVersion === true) {
    process.stdout.write(`ExplicitJS ${packageVersion()}\n`);
    process.exit(0);
  }

  process.exit(run(args));
}

main();
