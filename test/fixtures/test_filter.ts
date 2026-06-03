export const values = [1, 0, 2];

values.filter(Boolean); // expect: filter
values.filter((value) => value > 0);
values.map((value) => value).filter(Boolean); // expect: filter
