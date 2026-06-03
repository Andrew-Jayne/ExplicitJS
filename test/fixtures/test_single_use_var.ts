export function compute(): number {
  return 42;
}

export function demo1(): number {
  const result = compute(); // expect: single_use_var
  return result;
}

export function demo2(): number {
  const total = compute() + compute();
  return total + total;
}

export function demo3(): number {
  const value = compute();
  return value + value;
}

export const CONSTANT_THING = compute();
