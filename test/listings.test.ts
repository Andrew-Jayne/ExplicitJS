/**
 * Listing catalogs: every check must be documented in list-checks / list-extras.
 *
 * Adding a CheckType or extra without a description fails these tests.
 */

import { assertEquals } from "jsr:@std/assert@^1.0.19";
import {
  CHECK_DESCRIPTIONS,
  CHECK_TYPES,
  EXTRA_CHECKS,
  EXTRA_DESCRIPTIONS,
} from "../src/constructs.ts";
import { generateChecksListing, generateExtrasListing } from "../src/reporters.ts";

Deno.test("list-checks documents every CheckType member, in registry order", () => {
  assertEquals(Object.keys(CHECK_DESCRIPTIONS), [...CHECK_TYPES]);
});

Deno.test("list-extras documents exactly the EXTRA_CHECKS members", () => {
  assertEquals(new Set(Object.keys(EXTRA_DESCRIPTIONS)), new Set(EXTRA_CHECKS));
});

Deno.test("each listing's rendered text names every check it covers", () => {
  const checksListing = generateChecksListing();
  assertEquals(checksListing.length > 0, true);
  for (const checkType of CHECK_TYPES) {
    assertEquals(checksListing.includes(checkType), true, checkType);
  }

  const extrasListing = generateExtrasListing();
  assertEquals(extrasListing.length > 0, true);
  for (const extra of EXTRA_CHECKS) {
    assertEquals(extrasListing.includes(extra), true, extra);
  }
});
