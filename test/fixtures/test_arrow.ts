// explicit-test: modes=default,extra; extra=arrow
export const nums = [1, 2, 3];

const f1 = (val) => (val ? 1 : 0); // expect: arrow, ternary
const f2 = (val) => val && nums; // expect: arrow, bool_op, bool_op
const f3 = (val) => !val; // expect: arrow
const f4 = (val) => val === 0; // expect: arrow@extra
const f5 = (val) => val + 1; // expect: arrow@extra
const f6 = (val) => { return val; }; // expect: arrow@extra
nums.map(function (item) { return item; }); // expect: arrow@extra
