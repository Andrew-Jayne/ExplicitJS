/**
 * Unit tests for the bare-attribute markup scanner: the framework-specific
 * exemptions and the scan hazards (comments, quoted `>`, brace expressions)
 * that the fixtures cannot cover line by line.
 */

import { assertEquals } from "jsr:@std/assert@^1.0.19";
import { findBareMarkupAttrs, type MarkupFlavor } from "../src/markupAttrs.ts";

interface MarkupCase {
  name: string;
  flavor: MarkupFlavor;
  source: string;
  expected: string[];
}

const CASES: MarkupCase[] = [
  {
    name: "bare attribute flags; explicit and quoted values do not",
    flavor: "svelte",
    source: '<input disabled required={true} placeholder="type here" />',
    expected: ["disabled"],
  },
  {
    name: "svelte directives and shorthands are exempt",
    flavor: "svelte",
    source: "<Widget bind:open on:select={pick} class:active {label} {...rest} pure />",
    expected: ["pure"],
  },
  {
    name: "vue directives and shorthands are exempt",
    flavor: "vue",
    source: '<template #footer><MyWidget v-else v-once @open="show" clearable /></template>',
    expected: ["clearable"],
  },
  {
    name: "html comments are skipped",
    flavor: "svelte",
    source: "<!-- <input disabled> --><input readonly />",
    expected: ["readonly"],
  },
  {
    name: "quoted '>' does not end the tag early",
    flavor: "svelte",
    source: '<p title="a > b" hidden>text</p>',
    expected: ["hidden"],
  },
  {
    name: "brace blocks never read as tags",
    flavor: "svelte",
    source: "{#if a < b}<input multiple />{/if}",
    expected: ["multiple"],
  },
  {
    name: "vue mustaches never read as tags",
    flavor: "vue",
    source: "<span>{{ count < 5 }}</span><input loop >",
    expected: ["loop"],
  },
  {
    name: "script and style tags and contents are exempt",
    flavor: "vue",
    source:
      '<script setup lang="ts">const gt = 1 < 2;</script><style scoped>p { color: red; }</style>',
    expected: [],
  },
];

for (const markupCase of CASES) {
  Deno.test(`markup attrs: ${markupCase.name}`, () => {
    assertEquals(
      findBareMarkupAttrs(markupCase.source, "case.file", markupCase.flavor).map(
        (check) => check.code,
      ),
      markupCase.expected,
    );
  });
}
