// Fixture: the `assert` check — implicit truthiness in assert calls.
// Parsed, never executed; marker grammar in test/README.md.

assert(value); // expect: assert
assert(value !== null);
console.assert(flag); // expect: assert
console.assert(flag === true);
assert.ok(records); // expect: assert
assert.ok(records.length > 0);
assert(first && second); // expect: assert, assert, bool_op, bool_op
