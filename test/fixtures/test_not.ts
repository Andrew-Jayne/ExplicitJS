// Fixture: the `not` check — `!value` coercion outside the conditions that
// the if/while/assert/bool_op/arrow checks already report.
// Parsed, never executed; marker grammar in test/README.md.

const isMissing = !items; // expect: not
report(isMissing, isMissing);

if (!items === true) { // expect: not
  report(items);
}

if (!!items === true) { // expect: not
  report(items);
}

export function isEmpty(value: string): boolean {
  return !value; // expect: not
}

switch (true) {
  case !!name: // expect: not
    report(name);
}

report(!(count > 0));
report(!(ready === true));
report(value === false);

// Reported by the condition / operator checks instead, once each.
if (!items) { // expect: if
  report(items);
}
while (!done) { // expect: while
  step();
}
report(!ready && loaded); // expect: bool_op, bool_op
const check = (entry: string) => !entry; // expect: arrow
report(check, check);
report(!ready ? "wait" : "go"); // expect: ternary
