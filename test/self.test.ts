/**
 * The self check: ExplicitJS's own source must pass its own linter.
 *
 * Every file in src/ must produce zero findings. Every check is mandatory and
 * none can be suppressed, so there is nothing to configure here. This test is
 * MANDATORY — never relax it; fix the source instead (the usual offender is a
 * single-use local: inline it).
 */

import { readdirSync } from "node:fs";
import path from "node:path";
import { analyzeFile } from "../src/fileHandlers.ts";
import { REPO_ROOT } from "./fixtureSpec.ts";

const SRC_DIR = path.join(REPO_ROOT, "src");

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
    const checks = analyzeFile(sourcePath);
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
