export const flag = true;
export const yes = 1;
export const no = 0;
export const score = 5;

flag ? yes : no; // expect: ternary
score > 0 ? yes : no; // expect: ternary
const nested = flag ? (score > 0 ? yes : no) : no; // expect: ternary, ternary
