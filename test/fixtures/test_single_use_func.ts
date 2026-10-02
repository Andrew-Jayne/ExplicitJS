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

// Private methods are callable only inside their class, so every call is in
// view: one call makes a single-use helper. Public methods are exempt.
export class Job {
  #double(amount: number): number { // expect: single_use_func
    return amount * 2;
  }
  private triple(amount: number): number { // expect: single_use_func
    return amount * 3;
  }
  private halve(amount: number): number {
    return amount / 2;
  }
  #format(amount: number): string {
    return `${amount}`;
  }
  public quadruple(amount: number): number {
    return amount * 4;
  }
  run(): number[] {
    report([1].map(this.#format));
    return [this.#double(1), this.triple(1), this.halve(1), this.halve(2), this.quadruple(1)];
  }
}
