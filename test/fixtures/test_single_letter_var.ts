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

export const norm = ({ q }: { q: number }) => q * q; // expect: single_letter_var, single_letter_var

import { readFileSync as r } from "node:fs"; // expect: single_letter_var
import * as m from "node:path"; // expect: single_letter_var
import d from "node:os"; // expect: single_letter_var
report(r, r, m, m, d, d);

const 𝑟 = radius; // expect: single_letter_var
report(𝑟 * 𝑟);

class Calculator {
  f = (amount: number) => amount * 2; // expect: single_letter_var
  x = 0; // expect: single_letter_var
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

// No single-letter name anywhere, for any reason: types, generics, members,
// keys, enum members, labels, export aliases.
export function identity<T>(value: T): T { // expect: single_letter_var
  return value;
}
export type V = { label: string }; // expect: single_letter_var
export interface Q { // expect: single_letter_var
  z: number; // expect: single_letter_var
  m(): void; // expect: single_letter_var
}
export enum Direction {
  N = "north", // expect: single_letter_var
  South = "south",
}
export const origin = { w: 0, height: 0 }; // expect: single_letter_var
export const quoted = { "h": 1, "0": 2 }; // expect: single_letter_var
export class Vector {
  #j = 0; // expect: single_letter_var
  get k(): number { // expect: single_letter_var
    return this.#j;
  }
}
export type Keys<Shape> = { [P in keyof Shape]: Shape[P] }; // expect: single_letter_var
o: for (const entry of entries) { // expect: single_letter_var
  report(entry);
  break o;
}
export { origin as g }; // expect: single_letter_var
export { quoted };
const point = { x: 1 }; // expect: single_letter_var
report(point.x, point);
