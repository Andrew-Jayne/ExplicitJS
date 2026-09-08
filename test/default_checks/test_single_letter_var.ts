// Fixture: the `single_letter_var` check — one-character names on
// declarations, parameters, and catch variables. Parsed, never executed.

let n = 0; // expect: single_letter_var
n = n + 1;
report(n);

let total = 0;
total = total + 1;
report(total);

try {
  riskyOperation();
} catch (e) { // expect: single_letter_var
  report(e);
  log(e);
}

try {
  riskyOperation();
} catch (error) {
  report(error);
  log(error);
}

export function scale(v: number): number { // expect: single_letter_var
  return v + v;
}
