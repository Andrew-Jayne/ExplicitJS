// explicit-test: modes=default,extra; extra=arrow
// Fixture: the `arrow` check — default mode flags only implicit-boolean
// bodies; the `arrow` extra bans every anonymous function, and a trailing
// `// explicit: allow-arrow` directive lifts only that opt-in ban.
// Parsed, never executed; marker grammar in test/README.md.

report(values.map((value) => value + 1)); // expect: arrow@extra
report(values.map(function double(value) { // expect: arrow@extra
  return value + value;
}));
report(values.some((value) => value && value.ready)); // expect: arrow, bool_op, bool_op
report(values.some((value) => !value)); // explicit: allow-arrow // expect: arrow
report(values.map((value) => value - 1)); // explicit: allow-arrow

export function namedHelper(value: number): number {
  return value + value;
}
report(namedHelper(seed));
