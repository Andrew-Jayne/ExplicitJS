// Fixture: the `loose_equality` check — coercing `==` / `!=` comparisons.
// Parsed, never executed; marker grammar in test/README.md.

report(left == right); // expect: loose_equality
report(left != right); // expect: loose_equality
report(left === right);
report(left !== right);

if (left == null) { // expect: loose_equality
  handleNullish();
}
