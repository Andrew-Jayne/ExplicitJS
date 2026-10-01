// Fixture: the `optional_param` check — every `name?: T` declaration. A
// parameter of an implementation or a concrete class field can carry `= null`;
// type-space declarations (interfaces, type literals, overload signatures)
// take the bare `| null` union and make every construction site state it.
// Parsed, never executed; marker grammar in test/README.md.

export function greet(name?: string): string { // expect: optional_param
  return withDefault(name);
}

export function farewell(name: string | null = null): string {
  return withDefault(name);
}

export interface GreeterOptions {
  label?: string; // expect: optional_param
  prefix: string | null;
  onDone?(): void; // expect: optional_param
}

export type Formatter = (value?: string) => string; // expect: optional_param

export class Greeter {
  private cachedLabel?: string; // expect: optional_param
  private readonly fallback: string | null = null;

  format(label?: string): string { // expect: optional_param
    return withDefault(label);
  }
}

export abstract class Formal {
  protected abstract honorific?: string; // expect: optional_param
}

export function shout(message?: string): string; // expect: optional_param
export function shout(message?: string): string { // expect: optional_param
  return withDefault(message);
}

export type Pair = [name: string, label?: string];
