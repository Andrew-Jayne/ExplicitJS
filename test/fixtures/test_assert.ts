// Fixture: the `assert` check — implicit truthiness in assert calls.
// Parsed, never executed; marker grammar in test/README.md.

assert(value); // expect: assert
assert(value !== null);
console.assert(flag); // expect: assert
console.assert(flag === true);
assert.ok(records); // expect: assert
assert.ok(records.length > 0);
assert(first && second); // expect: assert, assert, bool_op, bool_op

// The same callees however they are reached: import aliases, parentheses,
// bracket access, whitespace, `globalThis.`, and the `strict` variants.
import { ok as check } from "node:assert";
import strictAssert from "node:assert/strict";
check(value); // expect: assert
check(value !== null);
strictAssert(value); // expect: assert
(assert)(value); // expect: assert
assert .ok(value); // expect: assert
console["assert"](value); // expect: assert
globalThis.console.assert(value); // expect: assert
assert.strict(value); // expect: assert
assert.strict.ok(value); // expect: assert
assert.equal(value, true);

// Test-runner truthiness matchers are assert(x) by another name.
expect(user).toBeTruthy(); // expect: assert
expect(user).not.toBeFalsy(); // expect: assert
await expect(loadUser()).resolves.toBeTruthy(); // expect: assert
expect(user).toBe(true);
expect(user).not.toBeNull();
