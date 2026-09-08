/**
 * The self check: ExplicitJS's own source must pass its own linter.
 *
 * Every file in src/ must produce zero findings under the repo's dogfood
 * configuration (.explicitrc.json: the optional_param extra enabled). This is
 * MANDATORY — never relax this test; fix the source instead (the usual
 * offender is a single-use local: inline it).
 */

import { readdirSync } from "node:fs";
import path from "node:path";
import { CheckType } from "../src/constructs.ts";
import { analyzeFile } from "../src/fileHandlers.ts";
import { REPO_ROOT } from "./fixtureSpec.ts";

const SRC_DIR = path.join(REPO_ROOT, "src");

// Mirrors the repo's .explicitrc.json, which `deno task lint` applies.
const SELF_INCLUDE_EXTRA: ReadonlySet<string> = new Set([CheckType.OPTIONAL_PARAM]);

const SOURCE_FILES: string[] = [];
for (const entry of readdirSync(SRC_DIR)) {
  if (entry.endsWith(".ts") === true) {
    SOURCE_FILES.push(path.join(SRC_DIR, entry));
  }
}
SOURCE_FILES.sort();
if (SOURCE_FILES.length === 0) {
  throw new Error(`no source files found in ${SRC_DIR}`);
}

for (const sourcePath of SOURCE_FILES) {
  Deno.test(`self: ${path.basename(sourcePath)}`, () => {
    const checks = analyzeFile(sourcePath, { includeExtra: SELF_INCLUDE_EXTRA });
    if (checks.length > 0) {
      const failure: string[] = [];
      failure.push(
        `SELF-CHECK FAILURE: ${path.basename(sourcePath)} violates ExplicitJS's own rules:`,
      );
      for (const check of checks) {
        failure.push(`  line ${check.line}: [${check.checkType}] ${check.code} - ${check.context}`);
      }
      throw new Error(`\n${failure.join("\n")}`);
    }
  });
}
