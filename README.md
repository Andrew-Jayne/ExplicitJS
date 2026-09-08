# ExplicitJS

A semantic clarity enforcer for production JavaScript & TypeScript.

ExplicitJS flags code where the author's intent is ambiguous — patterns that force the next reader (or LLM) to guess what was meant instead of knowing. It is the JS/TS counterpart of [`explicit`](https://github.com/Andrew-Jayne/explicit)for Python.

## Quick start

ExplicitJS runs with [Deno](https://deno.com/), straight from this repository — Deno fetches the import graph from the URL and caches it. No build step, no registry.

**Install as a Deno shim** (pinned, recommended):

```bash
deno install -g --allow-read --allow-env -n explicitjs https://raw.githubusercontent.com/Andrew-Jayne/ExplicitJS/v1beta4/src/cli.ts
explicitjs <path-to-scan>
```

**Run without installing, via a shell alias:**

```bash
# Pinned to a release tag — immutable, auditable at a fixed commit:
alias explicitjs="deno run --allow-read --allow-env https://raw.githubusercontent.com/Andrew-Jayne/ExplicitJS/v1beta4/src/cli.ts"

# Or track the latest on main (mutable):
alias explicitjs="deno run --allow-read --allow-env https://raw.githubusercontent.com/Andrew-Jayne/ExplicitJS/main/src/cli.ts"

explicitjs <path-to-scan>
```

Available tags are on the [Releases page](https://github.com/Andrew-Jayne/ExplicitJS/releases). Deno caches the source after the first fetch, so a pinned URL only resolves once per version.

**Prefer Bun or npm?** ExplicitJS isn't published to any package registry — but every [GitHub Release](https://github.com/Andrew-Jayne/ExplicitJS/releases) has a prebuilt, npm-installable tarball attached.

```bash
# Bun — add as a dev dependency
bun add -d https://github.com/Andrew-Jayne/ExplicitJS/releases/download/v1beta4/explicitjs-1beta4.tgz
bunx explicitjs <path-to-scan>

# npm — global install
npm install -g https://github.com/Andrew-Jayne/ExplicitJS/releases/download/v1beta4/explicitjs-1beta4.tgz
explicitjs <path-to-scan>
```

Adding it as a dev dependency means every developer on the project gets the same version, and you can wire it into a `package.json` script or CI step:

```jsonc
// package.json
{
  "scripts": {
    "lint:explicit": "explicitjs src/"
  }
}
```

```bash
bun run lint:explicit
```

Check the [Releases page](https://github.com/Andrew-Jayne/ExplicitJS/releases) for the exact tarball filename per version — it's `explicitjs-<version>.tgz`, matching the `version` in that release's `package.json`.

Contributing or building from source instead? Clone the repo and use the source tree directly:

```bash
git clone https://github.com/Andrew-Jayne/ExplicitJS.git && cd ExplicitJS

# Bun runs the TypeScript source directly, no extra tooling needed:
bun install
bun src/cli.ts <path-to-scan>

# npm needs a TS runner (tsx) since plain Node can't execute this source yet
# — package.json wires that up for you:
npm install
npm start -- <path-to-scan>
```

Don't mix the two inside one invocation: `bun run start` (as opposed to `bun src/cli.ts`) will fail — the `start` script shells out to `tsx`, which isn't Bun-compatible. Bun doesn't need `tsx` at all, so just run the file directly.



`<path-to-scan>` is whatever file or directory you want analyzed — `src/`, `app.ts`, `.`, etc.

`--allow-env` is needed because the `typescript` package reads `TSC_*` watch-mode variables at init: we never use them, but Deno blocks the read without the flag.

## What it catches

| Check                                                                      | What's ambiguous                                                        | What to write instead                                                   |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **Implicit booleans** in `if` / `while` / `do…while`                       | `if (items)` — checking length? nullness?                               | `if (items.length > 0)` or `if (items !== undefined && items !== null)` |
| **`assert` truthiness** (`assert(x)`, `console.assert(x)`, `assert.ok(x)`) | relies on coercion                                                      | `assert(x !== undefined)`                                               |
| **Ternary expressions**                                                    | `cond ? x : y` buries control flow                                      | an explicit `if`/`else` block                                           |
| **Nullish coalescing** (`??`, `??=`)                                       | `env.PORT ?? 3000` — an inline if in disguise                           | an explicit `=== null` / `=== undefined` check with `if`/`else`         |
| **Optional chaining**                                                      | `request?.headers?.auth?.token` — is a missing field expected or a bug? | validate the shape once (schema/type), then access directly             |
| **Boolean operators**                                                      | `a && b`, `a \|\| b`, `a \|\|= b`, `a &&= b` with non-boolean operands  | explicit comparisons for each operand                                   |
| **Bare attributes** (JSX, Svelte/Vue templates)                            | `<Widget active />` — `true` only by convention                         | `<Widget active={true} />` / `:active="true"`                           |
| **Arrow / function expressions**                                           | anonymous logic with no name to describe intent                         | a named function                                                        |
| **`.filter(Boolean)`**                                                     | implicit truthiness as a filter predicate                               | an explicit predicate, e.g. `.filter((value) => value !== undefined)`   |
| **Loose equality** (`==`, `!=`)                                            | coerces operands silently                                               | `===` / `!==`                                                           |
| **Single-letter names**                                                    | `x`, `n`, `e` — no semantic meaning                                     | descriptive names                                                       |
| **Single-use variables**                                                   | `const r = compute(); return r;` — pointless indirection                | inline the expression                                                   |
| **Single-use functions**                                                   | a helper called exactly once                                            | inline at the call site                                                 |
| **Optional parameters** (opt-in)                                           | `arg?: T` — is an absent value meaningful or an accident?               | `arg: T \| null = null` — names the absent value, documents the default |

It parses JavaScript and TypeScript (including JSX/TSX) with the TypeScript compiler, so no build step or `tsconfig` is required to analyze a file.

## Usage

```bash
# Analyze a file or a directory
explicitjs src/
explicitjs app.ts

# Statistics only
explicitjs . --stats-only

# Describe every check / the opt-in extras
explicitjs list-checks
explicitjs list-extras

# Strict mode: flag every arrow / function expression, not just ambiguous ones
explicitjs . --include-extra arrow

# Ban optional parameters (arg?: T) in favor of explicit defaults (arg: T | null = null)
explicitjs . --include-extra optional_param

# Redirect the report to a file with your shell
explicitjs src/ > report.txt
explicitjs src/ --format json > report.json
```

ExplicitJS exits non-zero when any check is found, so it works as a CI gate: `0` clean, `1` checks found, `20` unusable invocation (bad flag, missing path, no source files).
It analyzes `.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.mts`, `.cts`, plus `.svelte` and `.vue` components — their `<script>` blocks as code, and their template markup for bare attributes — and skips `node_modules`, `dist`, `build`, dotfile directories, and `*.d.ts`.

**The default checks are always on — they cannot be disabled or suppressed.** If a construct the default mode flags is in your code, the report says so; the only way to a clean run is to rewrite the construct. The opt-in extras are the sole configuration surface: enable them with `--include-extra`, and silence an extra on one specific line with a trailing `// explicit: allow-<name>` directive (which names exactly what is being allowed — the directive is ignored for default checks).

## Configuration

ExplicitJS reads defaults from a `.explicitrc.json` file — discovered by walking up from the analyzed path, or pointed at explicitly with `--config`.
**Command-line flags always override the config file**; the `include-extra` list is merged with its `--include-extra` CLI counterpart.

```jsonc
// .explicitrc.json
{
  "format": "text", // text | json | csv
  "include-extra": ["arrow"], // opt into stricter checks
  "no-color": false,
  "stats-only": false,
}
```

- **`include-extra`** opts into stricter checks. `arrow` by default only flags _ambiguous_ (implicit-boolean) arrow bodies; listing it here flags **every** arrow / function expression. `optional_param` runs only when listed here: it flags `arg?: T` in function implementations, where `arg: T | null = null` states the default explicitly (type-space signatures such as interfaces and overload declarations are exempt — they cannot carry defaults).

See [explicit.example.json](explicit.example.json) for every setting and its default.

### What is exempt

The single-use checks deliberately ignore a few legitimate patterns:

- **Constants** — `UPPER_SNAKE_CASE` names are never flagged as single-use variables; a named constant documents intent even when used once.
- **Exports** — exported names (`export function`, `export const`, `export { … }`, `export default x`) are never flagged as single-use, since references from outside the file are invisible to a single-file analysis.
- **Entry points** — functions named `main` are never flagged as single-use functions (the conventional CLI entry).
- **Function references** — a function (or function-valued `const`) whose only use passes it **by name** — `React.memo(Component)`, `items.map(helper)`, `onClick={handler}`, a `<Component />` JSX tag — is never flagged as single-use. A named reference is exactly the explicit style this tool asks for instead of an anonymous expression; only a genuine call (`helper()`) counts as an inlinable use. Ambient `declare function` signatures have no body to inline and are exempt for the same reason.

## Output formats

- **Text** — grouped by file, color-coded by check type, with inline context.
- **JSON** — one object per check; suitable for CI integration or editor plugins.
- **CSV** — headers: `File, Line, Column, Type, Code, Context`.

## Philosophy

The Zen of Python says "explicit is better than implicit." This tool enforces that line in JavaScript and TypeScript.

Most of the patterns flagged here exist for one reason: saving keystrokes. That trade made more sense when you were typing every character yourself. It makes no sense now. Your editor has autocomplete. Your AI agent will write the verbose version just as fast as the clever one. The keystrokes are free. The ambiguity is not.

The goal is not style, it's semantic precision: code should say what it means so that the next person (or LLM) reading it can understand the intent without guessing.

## Development

| Task                        | Deno                | Bun                    | npm                 |
| ---------------------------- | -------------------- | ----------------------- | --------------------- |
| Run the CLI against any source | `deno task start <path>` | `bun src/cli.ts <path>` | `npm start -- <path>` |
| Dogfood: lint ExplicitJS's own source | `deno task lint` | `bun src/cli.ts src` | `npm run lint` |
| Run the test suite | `deno task test` | — (Deno-only, see below) | — |
| Type-check | `deno task check` | `bun run check` | `npm run check` |
| Format + lint with Biome, autofixing | `deno task fmt` | `bun run fmt` | `npm run fmt` |
| Format + lint, CI mode (no writes) | `deno task fmt:check` | `bun run fmt:check` | `npm run fmt:check` |

Bun and npm need a one-time `bun install` / `npm install` first, to pull down `typescript`, `tsx` (npm only — Bun runs the TypeScript source natively), and Biome.

`npm run build` compiles `src/` to plain JS in `dist/` (rewriting `.ts` imports to `.js`, and the shebang to `#!/usr/bin/env node`); `npm pack` runs that automatically (via `prepack`) and produces the tarball attached to each [Release](https://github.com/Andrew-Jayne/ExplicitJS/releases) — `dist/` itself is gitignored, generated only for that.

ExplicitJS lints itself with its own [.explicitrc.json](.explicitrc.json) (including the opt-in `optional_param` check); the `lint` task must exit clean, and the test suite enforces the same via a self check and committed baselines in [nfo/](nfo/). Code style is enforced by [Biome](https://biomejs.dev/) via [biome.json](biome.json); `fmt:check` must exit clean.

The test suite (see [test/README.md](test/README.md)) is fixture-driven: real annotated source files in `test/default_checks/` and `test/extra_checks/` carry trailing `// expect:` markers that the harness verifies against the analyzer, in-process and through the real CLI. Table-driven edge cases live in [test/checks.test.ts](test/checks.test.ts). The suite uses Deno's built-in test runner and `jsr:@std/assert`, so `deno task test` is currently the only way to run it, even if you're developing with Bun or npm.

## Requirements

Any one of:

- [Deno](https://deno.com/) >= 2.8
- [Bun](https://bun.sh/) >= 1.0
- Node.js + npm (any version recent enough to run [tsx](https://tsx.is/))

Building from source needs the same.
