// Fixture: the `single_use_func` check — a function defined once and called
// exactly once (exports and the `main` entry point are exempt).
// Parsed, never executed.

function formatOnce(): string { // expect: single_use_func
  return "formatted once";
}
report(formatOnce());

function formatTwice(): string {
  return "formatted twice";
}
report(formatTwice());
archive(formatTwice());

export function formatExported(): string {
  return "exported";
}
report(formatExported());

function main(): void {
  report("entry point");
}
main();
