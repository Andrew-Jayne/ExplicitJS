/**
 * Tests for `.vue` handling: `extractVueScripts` block extraction and the
 * end-to-end path through `analyzeSource`, which routes `.vue` filenames
 * through extraction and newline-pads each block so check lines refer to the
 * original component.
 *
 * `blockAt`/`checkAt` unwrap indexed access explicitly — this repo lints
 * itself, so optional chaining is off the table even in tests.
 */

import { assertEquals } from "jsr:@std/assert@^1.0.19";
import type { StyleCheck } from "../src/constructs.ts";
import { analyzeSource } from "../src/fileHandlers.ts";
import { extractVueScripts, type VueScriptBlock } from "../src/vueParser.ts";

function blockAt(blocks: VueScriptBlock[], index: number): VueScriptBlock {
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
  assertEquals(extractVueScripts("<template>\n  <div>static</div>\n</template>\n"), []);
});

Deno.test("extract: script block is plain JS by default", () => {
  const blocks = extractVueScripts("<script>\nconsole.log(1);\n</script>\n");
  assertEquals(blocks.length, 1);
  assertEquals(blockAt(blocks, 0).lang, "js");
});

Deno.test("extract: lang attribute picks the dialect", () => {
  for (const [attr, lang] of [
    ['lang="ts"', "ts"],
    ["lang='ts'", "ts"],
    ["lang=ts", "ts"],
    ['lang="typescript"', "ts"],
    ['lang="tsx"', "tsx"],
    ['lang="jsx"', "jsx"],
    ['lang="coffee"', "js"],
  ]) {
    assertEquals(
      blockAt(extractVueScripts(`<script ${attr}>\nconsole.log(1);\n</script>\n`), 0).lang,
      lang,
      attr,
    );
  }
});

Deno.test("extract: plain script and script setup both come back", () => {
  const SOURCE = [
    '<script lang="ts">',
    "export const kind = 'options';",
    "</script>",
    '<script setup lang="ts">',
    "console.log(kind);",
    "</script>",
    "<template><div /></template>",
  ].join("\n");
  const blocks = extractVueScripts(SOURCE);
  assertEquals(blocks.length, 2);
  assertEquals(blockAt(blocks, 0).lang, "ts");
  assertEquals(blockAt(blocks, 1).lang, "ts");
});

Deno.test("extract: generic attribute may contain '>'", () => {
  const blocks = extractVueScripts(
    '<script setup lang="ts" generic="T extends Record<string, any>">\nconsole.log(1);\n</script>\n',
  );
  assertEquals(blocks.length, 1);
  assertEquals(blockAt(blocks, 0).lang, "ts");
  assertEquals(blockAt(blocks, 0).content.includes("console.log"), true);
});

Deno.test("extract: src attribute means external file, block skipped", () => {
  const blocks = extractVueScripts(
    '<script src="./external.js"></script>\n<script>\nconsole.log(1);\n</script>\n',
  );
  assertEquals(blocks.length, 1);
  assertEquals(blockAt(blocks, 0).content.includes("console.log"), true);
});

Deno.test("analyze: checks fire inside vue scripts with original lines", () => {
  const checks = analyzeSource(
    "<template>\n  <div />\n</template>\n<script setup>\nif (items) {}\n</script>\n",
    "case.vue",
  );
  assertEquals(checks.length, 1);
  assertEquals(checkAt(checks, 0).checkType, "if");
  assertEquals(checkAt(checks, 0).line, 5);
});

Deno.test("analyze: template is not analyzed", () => {
  assertEquals(
    analyzeSource(
      '<template>\n  <div v-if="visible">{{ value }}</div>\n</template>\n<script setup>\nif (items) {}\n</script>\n',
      "case.vue",
    ).length,
    1,
  );
});

Deno.test("analyze: lang=ts block parses TypeScript syntax", () => {
  const checks = analyzeSource(
    '<script setup lang="ts">\nif (items as boolean) {}\n</script>\n',
    "case.vue",
  );
  assertEquals(checks.length, 1);
  assertEquals(checkAt(checks, 0).checkType, "if");
});

Deno.test("analyze: checks from both script blocks merge", () => {
  const SOURCE = [
    "<script>",
    "if (settings) {}",
    "</script>",
    "<script setup>",
    "if (items) {}",
    "</script>",
  ].join("\n");
  const checks = analyzeSource(SOURCE, "case.vue");
  assertEquals(checks.length, 2);
  assertEquals(checkAt(checks, 0).line, 2);
  assertEquals(checkAt(checks, 1).line, 5);
});
