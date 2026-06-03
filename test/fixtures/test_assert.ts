import assert from "node:assert";

export const ok1 = true;
export const num = 5;

assert(ok1); // expect: assert
assert(num > 0);
console.assert(ok1); // expect: assert
console.assert(num > 0);
assert.ok(ok1); // expect: assert
assert(!ok1); // expect: assert
