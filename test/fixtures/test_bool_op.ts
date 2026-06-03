export const x1 = true;
export const y1 = false;
export const z1 = true;
export const count = 4;

x1 && y1; // expect: bool_op, bool_op
x1 || y1; // expect: bool_op, bool_op
x1 && y1 && z1; // expect: bool_op, bool_op, bool_op
count > 0 && x1; // expect: bool_op
count > 0 && count < 10;
x1 && count > 0 || y1; // expect: bool_op, bool_op, bool_op
