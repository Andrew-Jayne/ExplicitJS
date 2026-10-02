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

const { x, y } = point; // expect: single_letter_var, single_letter_var
report(x + y + x + y);

for (const [k, v] of pairs) { // expect: single_letter_var, single_letter_var
  report(k, v, k, v);
}

for (const [key, value] of pairs) {
  report(key, value, key, value);
}

const [_, second] = pair;
report(second, second);

export const norm = ({ q }: { q: number }) => q * q; // expect: single_letter_var

import { readFileSync as r } from "node:fs"; // expect: single_letter_var
import * as m from "node:path"; // expect: single_letter_var
import d from "node:os"; // expect: single_letter_var
report(r, r, m, m, d, d);

const 𝑟 = radius; // expect: single_letter_var
report(𝑟 * 𝑟);

class Calculator {
  f = (amount: number) => amount * 2; // expect: single_letter_var
  x = 0;
}
report(new Calculator(), Calculator);

try {
  riskyOperation();
} catch ({ message: z }) { // expect: single_letter_var
  report(z, z);
}

const _ = loadDiscarded();
report(_.size); // expect: single_letter_var
items.forEach((_, index) => report(index));
