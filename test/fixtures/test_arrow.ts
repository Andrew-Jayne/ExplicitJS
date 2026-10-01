// Fixture: the `arrow` check — only an arrow whose concise body buries a
// boolean is ambiguous; anonymity itself is not, so named and anonymous
// callbacks alike pass as long as the body is explicit.
// Parsed, never executed; marker grammar in test/README.md.

report(values.map((value) => value + 1));
report(values.map(function double(value) {
  return value + value;
}));
report(values.some((value) => value && value.ready)); // expect: arrow, bool_op, bool_op
report(values.some((value) => !value)); // expect: arrow
report(values.some((value) => (value.ready ? value.ok : false))); // expect: arrow, ternary
report(values.some((value) => value.count > 0));

export function namedHelper(value: number): number {
  return value + value;
}
report(namedHelper(seed));
