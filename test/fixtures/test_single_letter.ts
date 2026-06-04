export const x = 1; // expect: single_letter_var
export function fn(a, b): number {
  // expect: single_letter_var, single_letter_var
  return a + b;
}
export class C {} // expect: single_letter_var
for (let i = 0; i < 3; i = i + 1) {
  /* */
} // expect: single_letter_var
try {
  /* */
} catch (e) {
  /* */
} // expect: single_letter_var
const _ = 5;
export const label = "ok";
