// Fixture: JSDoc optionals in plain JS — `[name]` in a @param or @property
// tag is `name?: T` written in a comment (`optional_param`).
// Parsed, never executed; marker grammar in test/README.md.

/**
 * @param {string} name
 * @param {string} [label] // expect: optional_param
 * @param {string | null} title
 */
export function greet(name, label, title) {
  report(name, label, title);
}

/**
 * @typedef {object} Options
 * @property {string} host
 * @property {number} [retries] // expect: optional_param
 * @property {number | null} timeout
 */
export const DEFAULT_HOST = "localhost";
