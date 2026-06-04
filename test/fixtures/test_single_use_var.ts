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

export function demo4(): number {
  // ALL_CAPS constant used exactly once: exempt (a named constant documents
  // intent). `attempts` is the same shape but lowercase, so it IS flagged.
  const MAX_RETRIES = compute();
  const attempts = compute(); // expect: single_use_var
  return MAX_RETRIES + attempts;
}

export const CONSTANT_THING = compute();
