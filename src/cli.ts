#!/usr/bin/env -S deno run --allow-read
/**
 * Executable entry point for ExplicitJS.
 */

import process from "node:process";
import { ArgError, type Args, helpText, parseArgs } from "./cliArgs.ts";
import { run } from "./main.ts";

const VERSION = "1beta3";

function writeErr(message: string): void {
  process.stderr.write(message);
}
function writeOut(message: string): void {
  process.stdout.write(message);
}

function main(): void {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof ArgError) {
      writeErr(`error: ${error.message}\n`);
      process.exit(2);
    }
    throw error;
  }

  if (args.showHelp === true) {
    writeOut(`${helpText()}\n`);
    process.exit(0);
  }
  if (args.showVersion === true) {
    writeOut(`ExplicitJS ${VERSION}\n`);
    process.exit(0);
  }

  process.exit(run(args));
}

main();
