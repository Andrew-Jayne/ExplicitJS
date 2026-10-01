/**
 * Listing catalog: every check must be documented in list-checks.
 *
 * Adding a CheckType without a description fails these tests.
 */

import { assertEquals } from "jsr:@std/assert@^1.0.19";
import { CHECK_DESCRIPTIONS, CHECK_TYPES } from "../src/constructs.ts";
import { generateChecksListing } from "../src/reporters.ts";

Deno.test("list-checks documents every CheckType member, in registry order", () => {
  assertEquals(Object.keys(CHECK_DESCRIPTIONS), [...CHECK_TYPES]);
});

Deno.test("the rendered listing names every check it covers", () => {
  const checksListing = generateChecksListing();
  assertEquals(checksListing.length > 0, true);
  for (const checkType of CHECK_TYPES) {
    assertEquals(checksListing.includes(checkType), true, checkType);
  }
});
