/**
 * Listing catalog: every check must be documented in list-checks.
 *
 * Adding a CheckType without a description fails these tests.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { CHECK_DESCRIPTIONS, CHECK_TYPES } from "../src/constructs.ts";
import { generateChecksListing } from "../src/reporters.ts";

test("list-checks documents every CheckType member, in registry order", () => {
  assert.deepEqual(Object.keys(CHECK_DESCRIPTIONS), [...CHECK_TYPES]);
});

test("the rendered listing names every check it covers", () => {
  const checksListing = generateChecksListing();
  assert.deepEqual(checksListing.length > 0, true);
  for (const checkType of CHECK_TYPES) {
    assert.deepEqual(checksListing.includes(checkType), true, checkType);
  }
});
