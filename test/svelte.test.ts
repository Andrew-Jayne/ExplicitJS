/**
 * Tests for `.svelte` handling: `extractSvelteScripts` block extraction and
 * the end-to-end path through `analyzeSource`, which routes `.svelte`
 * filenames through extraction and newline-pads each block so check lines
 * refer to the original component.
 *
 * `blockAt`/`checkAt` unwrap indexed access explicitly — this repo lints
 * itself, so optional chaining is off the table even in tests.
 */

import { assertEquals } from "jsr:@std/assert@^1.0.19";
import type { StyleCheck } from "../src/constructs.ts";
import { analyzeSource } from "../src/fileHandlers.ts";
import { extractSvelteScripts, type SvelteScriptBlock } from "../src/svelteParser.ts";

function blockAt(blocks: SvelteScriptBlock[], index: number): SvelteScriptBlock {
  const block = blocks[index];
  if (block === undefined) {
    throw new Error(`expected a script block at index ${index}, found ${blocks.length} block(s)`);
  }
  return block;
}

function checkAt(checks: StyleCheck[], index: number): StyleCheck {
  const check = checks[index];
  if (check === undefined) {
    throw new Error(`expected a check at index ${index}, found ${checks.length} check(s)`);
  }
  return check;
}

Deno.test("extract: no script block yields no blocks", () => {
  assertEquals(extractSvelteScripts("<div>static</div>\n"), []);
});

Deno.test("extract: unterminated script block yields no blocks", () => {
  assertEquals(extractSvelteScripts("<script>\nif (items) {}\n"), []);
});

Deno.test("extract: instance script is plain JS by default", () => {
  const blocks = extractSvelteScripts("<script>\nconsole.log(1);\n</script>\n<div />\n");
  assertEquals(blocks.length, 1);
  assertEquals(blockAt(blocks, 0).isTypeScript, false);
});

Deno.test("extract: lang attribute marks TypeScript in any quote style", () => {
  for (const attr of ['lang="ts"', "lang='ts'", "lang=ts", 'lang="typescript"']) {
    assertEquals(
      blockAt(extractSvelteScripts(`<script ${attr}>\nconsole.log(1);\n</script>\n`), 0)
        .isTypeScript,
      true,
      attr,
    );
  }
  assertEquals(
    blockAt(extractSvelteScripts('<script lang="coffee">\nconsole.log(1);\n</script>\n'), 0)
      .isTypeScript,
    false,
  );
});

Deno.test("extract: module and instance scripts both come back", () => {
  const SOURCE = [
    '<script context="module" lang="ts">',
    "export const kind = 'module';",
    "</script>",
    '<script lang="ts">',
    "console.log(kind);",
    "</script>",
    "<div />",
  ].join("\n");
  const blocks = extractSvelteScripts(SOURCE);
  assertEquals(blocks.length, 2);
  assertEquals(blockAt(blocks, 0).isTypeScript, true);
  assertEquals(blockAt(blocks, 1).isTypeScript, true);
});

Deno.test("extract: generics attribute may contain '>'", () => {
  const blocks = extractSvelteScripts(
    '<script lang="ts" generics="T extends Record<string, unknown>">\nconsole.log(1);\n</script>\n',
  );
  assertEquals(blocks.length, 1);
  assertEquals(blockAt(blocks, 0).isTypeScript, true);
  assertEquals(blockAt(blocks, 0).content.includes("console.log"), true);
});

Deno.test("extract: src attribute means external file, block skipped", () => {
  const blocks = extractSvelteScripts(
    '<script src="./external.js"></script>\n<script>\nconsole.log(1);\n</script>\n',
  );
  assertEquals(blocks.length, 1);
  assertEquals(blockAt(blocks, 0).content.includes("console.log"), true);
});

Deno.test("extract: padding preserves original line numbers", () => {
  // Two newlines of padding, then the block's own leading newline: the
  // `console.log` call sits on line 4, exactly as in the component.
  assertEquals(
    blockAt(
      extractSvelteScripts("<!-- header -->\n<div />\n<script>\nconsole.log(1);\n</script>\n"),
      0,
    ).content.split("\n")[3],
    "console.log(1);",
  );
});

Deno.test("analyze: checks fire inside svelte scripts with original lines", () => {
  const checks = analyzeSource(
    "<!-- header -->\n<script>\nif (items) {}\n</script>\n<div />\n",
    "case.svelte",
  );
  assertEquals(checks.length, 1);
  assertEquals(checkAt(checks, 0).checkType, "if");
  assertEquals(checkAt(checks, 0).line, 3);
});

Deno.test("analyze: template is not analyzed", () => {
  assertEquals(
    analyzeSource(
      "<script>\nif (items) {}\n</script>\n{#if visible}<div>{value}</div>{/if}\n",
      "case.svelte",
    ).length,
    1,
  );
});

Deno.test("analyze: lang=ts block parses TypeScript syntax", () => {
  const checks = analyzeSource(
    '<script lang="ts">\nif (items as boolean) {}\n</script>\n',
    "case.svelte",
  );
  assertEquals(checks.length, 1);
  assertEquals(checkAt(checks, 0).checkType, "if");
});

Deno.test("analyze: checks from module and instance scripts merge", () => {
  const SOURCE = [
    '<script context="module">',
    "if (settings) {}",
    "</script>",
    "<script>",
    "if (items) {}",
    "</script>",
  ].join("\n");
  const checks = analyzeSource(SOURCE, "case.svelte");
  assertEquals(checks.length, 2);
  assertEquals(checkAt(checks, 0).line, 2);
  assertEquals(checkAt(checks, 1).line, 5);
});
