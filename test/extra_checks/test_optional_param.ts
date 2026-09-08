// explicit-test: modes=default,extra; extra=optional_param
// Fixture: the `optional_param` check — `arg?: T` in function implementations,
// flagged only when the `optional_param` extra is enabled. Type-space
// signatures are exempt (they cannot carry defaults), and a trailing
// `// explicit: allow-optional_param` directive suppresses a flagged line.
// Parsed, never executed; marker grammar in test/README.md.

export function greet(name?: string): string { // expect: optional_param@extra
  return withDefault(name);
}

export function farewell(name: string | null = null): string {
  return withDefault(name);
}

export function shout(message?: string): string { // explicit: allow-optional_param
  return withDefault(message);
}

export interface GreeterOptions {
  label?: string;
}

export type Formatter = (value?: string) => string;
