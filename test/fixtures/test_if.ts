export const value = true;
export const other = false;
export const count = 5;
export const items = [1, 2, 3];
export function getValue(): boolean {
  return false;
}

if (value) {
  /* */
} // expect: if
if (!value) {
  /* */
} // expect: if
if (getValue()) {
  /* */
} // expect: if
if (!getValue()) {
  /* */
} // expect: if
if (value === true) {
  /* */
}
if (count > 0) {
  /* */
}
if (!(count > 0)) {
  /* */
}
if (true) {
  /* */
}
if (items) {
  /* */
} // expect: if
if (items[0]) {
  /* */
} // expect: if
if (value && other) {
  /* */
} // expect: if, if, bool_op, bool_op
if (count > 0 && count < 10) {
  /* */
}
if (value && count > 0) {
  /* */
} // expect: if, bool_op
if (value || other) {
  /* */
} // expect: if, if, bool_op, bool_op
if (count > 0) {
  /* */
} else if (getValue()) {
  /* */
} // expect: if
