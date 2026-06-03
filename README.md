# explicit-ts

A semantic clarity enforcer for production JavaScript & TypeScript.

`explicit-ts` flags code where the author's intent is ambiguous — patterns that
force the next reader (or LLM) to guess what was meant instead of knowing. It is
the JS/TS counterpart of [`explicit`](https://github.com/Andrew-Jayne/explicit)
for Python.

## Quick start

No install required — run it straight from GitHub with `npx` (needs Node.js >= 24):

```bash
npx github:Andrew-Jayne/ExplicitJS src/
```

> Not published to npm yet, so the command runs from the repo. `npx` clones it
> and runs the build automatically (via the `prepare` script). Once it's on npm
> this becomes the shorter `npx explicit-ts src/`.

## What it catches

| Check | What's ambiguous | What to write instead |
|---|---|---|
| **Implicit booleans** in `if` / `while` / `do…while` | `if (items)` — checking length? nullness? | `if (items.length > 0)` or `if (items !== undefined && items !== null)` |
| **`assert` truthiness** (`assert(x)`, `console.assert(x)`, `assert.ok(x)`) | relies on coercion | `assert(x !== undefined)` |
| **Ternary expressions** | `cond ? x : y` buries control flow | an explicit `if`/`else` block |
| **Optional chaining** | `request?.headers?.auth?.token` — is a missing field expected or a bug? | validate the shape once (schema/type), then access directly |
| **Boolean operators** | `a && b` / `a \|\| b` with non-boolean operands | explicit comparisons for each operand |
| **Arrow / function expressions** | anonymous logic with no name to describe intent | a named function |
| **`.filter(Boolean)`** | implicit truthiness as a filter predicate | an explicit predicate, e.g. `.filter((value) => value !== undefined)` |
| **Loose equality** (`==`, `!=`) | coerces operands silently | `===` / `!==` |
| **Single-letter names** | `x`, `n`, `e` — no semantic meaning | descriptive names |
| **Single-use variables** | `const r = compute(); return r;` — pointless indirection | inline the expression |
| **Single-use functions** | a helper called exactly once | inline at the call site |

It parses JavaScript and TypeScript (including JSX/TSX) with the TypeScript
compiler, so no build step or `tsconfig` is required to analyze a file.

## Usage

The examples below use `explicit-ts` as the command name. Until it's published
to npm, either swap `npx explicit-ts` for `npx github:Andrew-Jayne/ExplicitJS`, or
install it once to get the `explicit-ts` command:

```bash
npm install -g github:Andrew-Jayne/ExplicitJS
```

```bash
# Analyze a file or a directory
npx explicit-ts src/
npx explicit-ts app.ts

# JSON / CSV output (for CI / tooling)
npx explicit-ts . --format json
npx explicit-ts . --format csv

# Statistics only
npx explicit-ts . --stats-only

# Skip specific checks
npx explicit-ts . --exclude-type ternary --exclude-type loose_equality

# Strict mode: flag every arrow / function expression, not just ambiguous ones
npx explicit-ts . --include-extra arrow

# Write the report to a file (colors stripped)
npx explicit-ts . -o report.txt

# Print version / help
npx explicit-ts --version
npx explicit-ts --help
```

`explicit-ts` exits non-zero when any check is found, so it works as a CI gate.
It analyzes `.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.mts`, `.cts` and
skips `node_modules`, `dist`, `build`, dotfile directories, and `*.d.ts`.

## Configuration

`explicit-ts` reads defaults from an `"explicit"` key in your `package.json`, or
from a `.explicitrc.json` file — discovered by walking up from the analyzed path,
or pointed at explicitly with `--config`. **Command-line flags always override
the config file**; the two list settings (`exclude-type` and `include-extra`)
are merged with their CLI counterparts.

```jsonc
// package.json
{
  "explicit": {
    "format": "text",                                  // text | json | csv
    "exclude-type": ["ternary", "single_use_var"],     // turn checks off
    "include-extra": ["arrow"],                         // opt into stricter checks
    "no-color": false,
    "stats-only": false
  }
}
```

Two lists drive what runs:

- **`exclude-type`** turns a check off entirely.
- **`include-extra`** opts into the stricter variant of an "exotic" check. By
  default `arrow` only flags *ambiguous* (implicit-boolean) arrow bodies;
  listing it here flags **every** arrow / function expression. (If a check
  appears in both lists, `exclude-type` wins — it is filtered out after
  analysis.)

See [explicit.example.json](explicit.example.json) for every setting and its
default.

### What is exempt

The single-use checks deliberately ignore a few legitimate patterns:

- **Constants** — `UPPER_SNAKE_CASE` names are never flagged as single-use
  variables; a named constant documents intent even when used once.
- **Exports** — exported names (`export function`, `export const`,
  `export { … }`, `export default x`) are never flagged as single-use, since
  references from outside the file are invisible to a single-file analysis.
- **Entry points** — functions named `main`, and (when a `package.json` `bin`
  field is present) the conventional `main` entry, are never flagged as
  single-use functions.

## Output formats

- **Text** — grouped by file, color-coded by check type, with inline context.
- **JSON** — one object per check; suitable for CI integration or editor plugins.
- **CSV** — headers: `File, Line, Column, Type, Code, Context`.

## Philosophy

The Zen of Python says "explicit is better than implicit." This tool enforces
that line in JavaScript and TypeScript.

Most of the patterns flagged here exist for one reason: saving keystrokes. That
trade made more sense when you were typing every character yourself. It makes no
sense now. Your editor has autocomplete. Your AI agent will write the verbose
version just as fast as the clever one. The keystrokes are free. The ambiguity
is not.

The goal is not style, it's semantic precision: code should say what it means so
that the next person (or LLM) reading it can understand the intent without
guessing.

## Development

```bash
npm install
npm run build      # compile src/ -> dist/ (tsc + tsc-alias for the @/ path alias)
npm test           # build fixtures harness and run node --test
```

Tests live in [test/fixtures/](test/fixtures/) as annotated source files; the
harness in [test/harness.test.ts](test/harness.test.ts) asserts the analyzer's
output matches the inline `// expect:` markers exactly.

## Requirements

Node.js >= 24.
