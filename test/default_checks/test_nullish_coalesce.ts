// Fixture: the `nullish_coalesce` check — `??` and `??=` inline null-defaulting.
// Parsed, never executed; marker grammar in test/README.md.

report(name ?? "anonymous"); // expect: nullish_coalesce

if (name === null) {
  reportAnonymous();
}

cachedTotal ??= computeTotal(); // expect: nullish_coalesce
