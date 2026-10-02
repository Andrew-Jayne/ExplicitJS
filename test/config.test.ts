/**
 * Config tests: the two keys a `.explicitrc.json` may carry.
 *
 * `format` and `ignore` are the whole surface. Per-run choices (`--stats-only`,
 * `--no-color`) are flags only, and no key can turn a check on or off. These
 * drive the real CLI over a temp project, so directory discovery — what the
 * walk actually descends into — is exercised for real rather than mocked.
 */

import { assertEquals } from "jsr:@std/assert@^1.0.19";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./fixtureSpec.ts";

interface CliResult {
  stdout: string;
  code: number;
}

function runCli(cliArgs: string[]): CliResult {
  const finished = new Deno.Command(Deno.execPath(), {
    args: ["run", "--allow-read", "--allow-env", path.join(REPO_ROOT, "src", "cli.ts"), ...cliArgs],
    cwd: REPO_ROOT,
    stdout: "piped",
    stderr: "piped",
  }).outputSync();
  return { stdout: new TextDecoder().decode(finished.stdout), code: finished.code };
}

const PROJECT_DIRS: readonly string[] = [
  "src/app",
  "src/vendored",
  "src/generated",
  "node_modules",
];

/** A temp project: one violation per directory, plus the given config file. */
function makeProject(configText: string): string {
  const root = Deno.makeTempDirSync();
  for (const directory of PROJECT_DIRS) {
    mkdirSync(path.join(root, directory), { recursive: true });
    writeFileSync(path.join(root, directory, "sample.ts"), "if (value) {}\n");
  }
  writeFileSync(path.join(root, ".explicitrc.json"), configText);
  return root;
}

Deno.test("config: format comes from the file, and the flag still wins", () => {
  const root = makeProject('{ "format": "csv" }');
  try {
    assertEquals(runCli([root]).stdout.startsWith("File,Line,Column"), true);
    assertEquals(runCli([root, "--format", "json"]).stdout.trimStart().startsWith("["), true);
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("config: a bare ignore name skips that directory at any depth", () => {
  const root = makeProject('{ "ignore": ["generated"] }');
  try {
    const report = runCli([root, "--format", "json"]).stdout;
    assertEquals(report.includes(`${path.sep}generated${path.sep}`), false);
    assertEquals(report.includes(`${path.sep}vendored${path.sep}`), true);
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("config: an ignore entry with a separator resolves against the config file", () => {
  const root = makeProject('{ "ignore": ["src/vendored"] }');
  try {
    const report = runCli([root, "--format", "json"]).stdout;
    assertEquals(report.includes(`${path.sep}vendored${path.sep}`), false);
    assertEquals(report.includes(`${path.sep}app${path.sep}`), true);
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("config: --config is read from elsewhere, and its paths resolve against it", () => {
  const root = makeProject("{}");
  const configDir = Deno.makeTempDirSync();
  const configPath = path.join(configDir, "custom.json");
  writeFileSync(configPath, JSON.stringify({ ignore: [path.join(root, "src", "vendored")] }));
  try {
    const report = runCli([root, "--config", configPath, "--format", "json"]).stdout;
    assertEquals(report.includes(`${path.sep}vendored${path.sep}`), false);
    assertEquals(report.includes(`${path.sep}app${path.sep}`), true);
  } finally {
    Deno.removeSync(root, { recursive: true });
    Deno.removeSync(configDir, { recursive: true });
  }
});

Deno.test("config: the built-in skips hold whatever the file says", () => {
  const root = makeProject('{ "ignore": [] }');
  try {
    assertEquals(
      runCli([root, "--format", "json"]).stdout.includes("node_modules"),
      false,
      "node_modules must never be analyzed",
    );
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("config: per-run flags in the file are inert", () => {
  const root = makeProject('{ "stats-only": true, "no-color": true }');
  try {
    const result = runCli([root]);
    assertEquals(result.stdout.includes("Check Statistics"), false);
    assertEquals(result.code, 1);
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("config: no key can disable a check", () => {
  const root = makeProject('{ "include-extra": [], "disable": ["if"], "if": false }');
  try {
    assertEquals(runCli([root, "--format", "json"]).stdout.includes('"if"'), true);
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("walk: build-output names are skipped only where build tools put them", () => {
  const root = Deno.makeTempDirSync();
  try {
    writeFileSync(path.join(root, "package.json"), "{}\n");
    mkdirSync(path.join(root, "packages", "app"), { recursive: true });
    writeFileSync(path.join(root, "packages", "app", "package.json"), "{}\n");
    for (const directory of [
      "dist",
      "packages/app/build",
      "packages/app/src/features/build",
      "src/out",
      "src/vendor",
    ]) {
      mkdirSync(path.join(root, directory), { recursive: true });
      writeFileSync(path.join(root, directory, "sample.ts"), "if (value) {}\n");
    }
    const report = runCli([root, "--format", "json"]).stdout;
    // Beside a manifest: output, skipped.
    assertEquals(report.includes(`${root}${path.sep}dist${path.sep}`), false);
    assertEquals(report.includes(`app${path.sep}build${path.sep}`), false);
    // Anywhere else the same names are ordinary source directories.
    assertEquals(report.includes(`features${path.sep}build${path.sep}`), true);
    assertEquals(report.includes(`src${path.sep}out${path.sep}`), true);
    assertEquals(report.includes(`src${path.sep}vendor${path.sep}`), true);
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});
