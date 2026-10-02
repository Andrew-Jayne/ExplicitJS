// Fixture: the `nullish_coalesce` check — `??` and `??=` inline null-defaulting.
// Parsed, never executed; marker grammar in test/README.md.

report(name ?? "anonymous"); // expect: nullish_coalesce

if (name === null) {
  reportAnonymous();
}

cachedTotal ??= computeTotal(); // expect: nullish_coalesce

// Default values fill in only on `undefined`: `??` in disguise.
export function listen(port = 3000): number { // expect: nullish_coalesce
  return port;
}
export function label(text: string | null = null): string | null {
  return text;
}
const { PORT = "3000", HOST } = env; // expect: nullish_coalesce
report(PORT, HOST, PORT, HOST);
const [firstValue = 0] = values; // expect: nullish_coalesce
report(firstValue, firstValue);
export const retriesOf = ({ retries = 3 }: Options) => retries; // expect: nullish_coalesce
