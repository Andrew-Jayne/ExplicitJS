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

// Calls spelled indirectly are still calls.
function viaCall(amount: number): number { // expect: single_use_func
  return amount * 2;
}
report(viaCall.call(null, 21));

function viaParens(): string { // expect: single_use_func
  return "parenthesized";
}
report((viaParens)());

function viaTag(parts: TemplateStringsArray): string { // expect: single_use_func
  return parts.join("");
}
report(viaTag`tagged`);

function ViaNew(): void { // expect: single_use_func
  this.ready = true;
}
report(new ViaNew());

function passedByName(entry: string): string {
  return entry;
}
report(entries.map(passedByName));

function boundOnce(): string {
  return "bound";
}
report(boundOnce.bind(null));
