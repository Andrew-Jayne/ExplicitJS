#!/usr/bin/env -S deno run --allow-read
/**
 * Executable entry point for ExplicitJS.
 */

import { ArgError, helpText, parseArgs } from "./cliArgs.ts";
import { run } from "./main.ts";

const VERSION = "1beta1";

const encoder = new TextEncoder();
function writeErr(message: string): void {
  Deno.stderr.writeSync(encoder.encode(message));
}
function writeOut(message: string): void {
  Deno.stdout.writeSync(encoder.encode(message));
}

function main(): void {
  let args;
  try {
    args = parseArgs(Deno.args);
  } catch (error) {
    if (error instanceof ArgError) {
      writeErr(`error: ${error.message}\n`);
      Deno.exit(2);
    }
    throw error;
  }

  if (args.showHelp === true) {
    writeOut(helpText() + "\n");
    Deno.exit(0);
  }
  if (args.showVersion === true) {
    writeOut(`ExplicitJS ${VERSION}\n`);
    Deno.exit(0);
  }

  Deno.exit(run(args));
}

main();
