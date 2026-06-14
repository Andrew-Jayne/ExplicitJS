# ExplicitJS

A semantic clarity enforcer for production JavaScript & TypeScript.

ExplicitJS flags code where the author's intent is ambiguous — patterns that force the next reader (or LLM) to guess what was meant instead of knowing. It is the JS/TS counterpart of [`explicit`](https://github.com/Andrew-Jayne/explicit)for Python.

## Quick start

ExplicitJS runs with [Deno](https://deno.com/), straight from this repository — Deno fetches the import graph from the URL and caches it. No build step, no registry.

**Install as a Deno shim** (pinned, recommended):

```bash
deno install -g --allow-read --allow-env -n explicitjs https://raw.githubusercontent.com/Andrew-Jayne/ExplicitJS/v1beta1/src/cli.ts
explicitjs <path-to-scan>
```

**Run without installing, via a shell alias:**

```bash
# Pinned to a release tag — immutable, auditable at a fixed commit:
alias explicitjs="deno run --allow-read --allow-env https://raw.githubusercontent.com/Andrew-Jayne/ExplicitJS/v1beta1/src/cli.ts"

# Or track the latest on main (mutable):
alias explicitjs="deno run --allow-read --allow-env https://raw.githubusercontent.com/Andrew-Jayne/ExplicitJS/main/src/cli.ts"

explicitjs <path-to-scan>
```

Available tags are on the [Releases page](https://github.com/Andrew-Jayne/ExplicitJS/releases). Deno caches the source after the first fetch, so a pinned URL only resolves once per version.



`<path-to-scan>` is whatever file or directory you want analyzed — `src/`, `app.ts`, `.`, etc.

`--allow-env` is needed because the `typescript` package reads `TSC_*` watch-mode variables at init: we never use them, but Deno blocks the read without the flag.

## What it catches

| Check                                                                      | What's ambiguous                                                        | What to write instead                                                   |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **Implicit booleans** in `if` / `while` / `do…while`                       | `if (items)` — checking length? nullness?                               | `if (items.length > 0)` or `if (items !== undefined && items !== null)` |
| **`assert` truthiness** (`assert(x)`, `console.assert(x)`, `assert.ok(x)`) | relies on coercion                                                      | `assert(x !== undefined)`                                               |
| **Ternary expressions**                                                    | `cond ? x : y` buries control flow                                      | an explicit `if`/`else` block                                           |
| **Optional chaining**                                                      | `request?.headers?.auth?.token` — is a missing field expected or a bug? | validate the shape once (schema/type), then access directly             |
| **Boolean operators**                                                      | `a && b` / `a \|\| b` with non-boolean operands                         | explicit comparisons for each operand                                   |
| **Arrow / function expressions**                                           | anonymous logic with no name to describe intent                         | a named function                                                        |
| **`.filter(Boolean)`**                                                     | implicit truthiness as a filter predicate                               | an explicit predicate, e.g. `.filter((value) => value !== undefined)`   |
| **Loose equality** (`==`, `!=`)                                            | coerces operands silently                                               | `===` / `!==`                                                           |
| **Single-letter names**                                                    | `x`, `n`, `e` — no semantic meaning                                     | descriptive names                                                       |
| **Single-use variables**                                                   | `const r = compute(); return r;` — pointless indirection                | inline the expression                                                   |
| **Single-use functions**                                                   | a helper called exactly once                                            | inline at the call site                                                 |

It parses JavaScript and TypeScript (including JSX/TSX) with the TypeScript compiler, so no build step or `tsconfig` is required to analyze a file.

## Usage

```bash
# Analyze a file or a directory
explicitjs src/
explicitjs app.ts

# Statistics only
explicitjs . --stats-only

# Skip specific checks
explicitjs . --exclude-type ternary --exclude-type loose_equality

# Strict mode: flag every arrow / function expression, not just ambiguous ones
explicitjs . --include-extra arrow

# Redirect the report to a file with your shell
explicitjs src/ > report.txt
explicitjs src/ --format json > report.json
```

ExplicitJS exits non-zero when any check is found, so it works as a CI gate.
It analyzes `.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.mts`, `.cts` and skips `node_modules`, `dist`, `build`, dotfile directories, and `*.d.ts`.

## Configuration

ExplicitJS reads defaults from a `.explicitrc.json` file — discovered by walking up from the analyzed path, or pointed at explicitly with `--config`.
**Command-line flags always override the config file**; the two list settings (`exclude-type` and `include-extra`) are merged with their CLI counterparts.

```jsonc
// .explicitrc.json
{
  "format": "text", // text | json | csv
  "exclude-type": ["ternary", "single_use_var"], // turn checks off
  "include-extra": ["arrow"], // opt into stricter checks
  "no-color": false,
  "stats-only": false,
}
```

Two lists drive what runs:

- **`exclude-type`** turns a check off entirely.
- **`include-extra`** opts into the stricter variant of an "exotic" check. By default `arrow` only flags _ambiguous_ (implicit-boolean) arrow bodies; listing it here flags **every** arrow / function expression. (If a check appears in both lists, `exclude-type` wins — it is filtered out after analysis.)

See [explicit.example.json](explicit.example.json) for every setting and its default.

### What is exempt

The single-use checks deliberately ignore a few legitimate patterns:

- **Constants** — `UPPER_SNAKE_CASE` names are never flagged as single-use variables; a named constant documents intent even when used once.
- **Exports** — exported names (`export function`, `export const`, `export { … }`, `export default x`) are never flagged as single-use, since references from outside the file are invisible to a single-file analysis.
- **Entry points** — functions named `main` are never flagged as single-use functions (the conventional CLI entry).

## Output formats

- **Text** — grouped by file, color-coded by check type, with inline context.
- **JSON** — one object per check; suitable for CI integration or editor plugins.
- **CSV** — headers: `File, Line, Column, Type, Code, Context`.

## Philosophy

The Zen of Python says "explicit is better than implicit." This tool enforces that line in JavaScript and TypeScript.

Most of the patterns flagged here exist for one reason: saving keystrokes. That trade made more sense when you were typing every character yourself. It makes no sense now. Your editor has autocomplete. Your AI agent will write the verbose version just as fast as the clever one. The keystrokes are free. The ambiguity is not.

The goal is not style, it's semantic precision: code should say what it means so that the next person (or LLM) reading it can understand the intent without guessing.

## Development

```bash
deno task start <path-to-scan>   # run the CLI against any source
deno task test                   # run the test suite
deno task check                  # type-check
```

Tests live in [test/checks.test.ts](test/checks.test.ts) as table-driven cases: each is a self-contained source snippet paired with the exact `{ checkType: count }` it should produce. To add coverage, add a case to the `cases` array.

## Requirements

[Deno](https://deno.com/) >= 2.8 installed. Building from source needs the same.
