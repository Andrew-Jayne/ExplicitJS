# ExplicitJS

A semantic clarity enforcer for production JavaScript & TypeScript.

ExplicitJS flags code where the author's intent is ambiguous — patterns that force the next reader (or LLM) to guess what was meant instead of knowing. It is the JS/TS counterpart of [`explicit`](https://github.com/Andrew-Jayne/explicit) for Python.

**Deno:** run straight from this repo, no build step, no registry
```bash
deno install -g --allow-read --allow-env -n explicitjs https://raw.githubusercontent.com/Andrew-Jayne/ExplicitJS/v1beta4/src/cli.ts
```

**Bun/NPM:** prebuilt tarball attached to every GitHub Release
```bash
bun add -d https://github.com/Andrew-Jayne/ExplicitJS/releases/download/v1beta4/explicitjs-1beta4.tgz
```

Other routes (shell aliases, tracking `main`, running from a clone) see: [docs/install.md](docs/install.md).

## What it catches

### Default checks

Always on. Like [Black](https://github.com/psf/black), ExplicitJS is deliberately opinionated: these cannot be disabled or suppressed.

| Check | What's ambiguous | What to write instead |
|---|---|---|
| **Implicit booleans** in `if` / `while` / `do…while` | `if (items)` — checking length? nullness? | `if (items.length > 0)` or `if (items !== null)` |
| **`assert` truthiness** (`assert(x)`, `console.assert(x)`, `assert.ok(x)`) | Relies on coercion | `assert(x !== undefined)` |
| **Ternary expressions** | `cond ? x : y` — buries control flow | Explicit `if`/`else` block |
| **Nullish coalescing** (`??`, `??=`) | `env.PORT ?? 3000` — an inline if in disguise | Explicit `=== null` / `=== undefined` check with `if`/`else` |
| **Optional chaining** | `request?.headers?.token` — is a missing field expected or a bug? | Validate the shape once (schema/type), then access directly |
| **Boolean operators** | `a && b`, `a \|\| b`, `a \|\|= b`, `a &&= b` with non-boolean operands | Explicit comparisons for each operand |
| **Bare attributes** (JSX, Svelte/Vue templates) | `<Widget active />` — `true` only by convention | `<Widget active={true} />` / `:active="true"` |
| **Implicit booleans in arrow / function expressions** | Truthiness hidden in anonymous logic | Named function with explicit comparisons |
| **`.filter(Boolean)`** | Implicit truthiness as a filter predicate | Explicit predicate, e.g. `.filter((value) => value !== undefined)` |
| **Loose equality** (`==`, `!=`) | Coerces operands silently | `===` / `!==` |
| **Single-letter names** | `x`, `n`, `e` — no semantic meaning | Descriptive names |
| **Single-use variables** | `const r = compute(); return r;` — pointless indirection | Inline the expression |
| **Single-use functions** | Helper called exactly once | Inline at the call site |

### Extended checks

Off by default; opt in with `--include-extra` or `include-extra` in `.explicitrc.json`.
These ban a construct outright, not just ambiguous uses (see `explicitjs list-extras`).

| Check | Why ban it | What to write instead |
|---|---|---|
| **`arrow`** — all arrow / function expressions | Anonymous logic with no name to describe intent | Named function |
| **`optional_param`** — all `arg?: T` parameters | Is an absent value meaningful or an accident? | `arg: T \| null = null` — names the absent value, documents the default |

`optional_param` applies to function implementations only; interfaces and overload declarations cannot carry defaults and are exempt.

## Usage

```bash
# Analyze a file or a directory
explicitjs app.ts
explicitjs src/

# JSON output (for CI/tooling)
explicitjs . --format json

# Statistics only
explicitjs . --stats-only

# Strict mode: ban all anonymous functions and optional parameters
explicitjs . --include-extra arrow --include-extra optional_param

# Describe every default check / every opt-in extra
explicitjs list-checks
explicitjs list-extras
```

`<path>` is any file or directory. ExplicitJS analyzes `.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.mts`, `.cts`, plus `.svelte` and `.vue` components (their `<script>` blocks as code, their template markup for bare attributes), and skips `node_modules`, `dist`, `build`, dotfile directories, and `*.d.ts`. Files are parsed with the TypeScript compiler, so no `tsconfig` is needed.

### Exit codes

Every outcome maps to exactly one code, so CI pipelines can tell them apart:

| Code | Meaning |
|---|---|
| `0` | No style violations found |
| `1` | The analysis found style violations |
| `20` | CLI args were invalid: bad flag, missing path, no source files to check |

### Suppressing a check inline

The opt-in `--include-extra` checks can be suppressed per line with a trailing `allow-X` directive naming the check:

```ts
items.forEach((item) => render(item)); // explicit: allow-arrow
function greet(name?: string) {}       // explicit: allow-optional_param
```

The rules are deliberately strict:

- **The default checks are always mandatory.** `// explicit: allow-if` does nothing; a construct the default mode flags cannot be silenced.
- The directive lifts only the opt-in ban. An arrow with an implicit-boolean body still gets flagged by the default variant even under `// explicit: allow-arrow`.
- Every item needs the `allow-` prefix; `// explicit: arrow` suppresses nothing. Naming exactly what you are allowing is itself an explicitness requirement.
- Unknown names are ignored; multiple items are comma-separated (`// explicit: allow-arrow, allow-optional_param`).

## Configuration

ExplicitJS reads defaults from a `.explicitrc.json` file — discovered by walking up from the analyzed path, or pointed at explicitly with `--config`. **Command-line flags always override the config file**; `include-extra` is merged with its CLI counterpart.

```jsonc
// .explicitrc.json
{
  "format": "text", // text | json | csv
  "include-extra": ["arrow"], // opt into stricter checks
  "no-color": false,
  "stats-only": false,
}
```

Configuration only ever adds checks, never removes them:

- **`include-extra`** opts into a check that is off by default. `arrow` has a default variant that only flags _ambiguous_ (implicit-boolean) bodies; listing it here flags **every** arrow / function expression. `optional_param` has no default variant — listing it flags every `arg?: T` in a function implementation.

See [explicit.example.json](explicit.example.json) for every setting and its default.

## What is exempt

The single-use checks deliberately ignore a few legitimate patterns:

- **Constants** — `UPPER_SNAKE_CASE` names are never flagged as single-use variables; a named constant documents intent even when used once.
- **Exports** — exported names are never flagged as single-use, since references from outside the file are invisible to a single-file analysis.
- **Entry points** — functions named `main` are never flagged as single-use functions.
- **Function references** — a function whose only use passes it **by name** (`React.memo(Component)`, `items.map(helper)`, `onClick={handler}`, a `<Component />` tag) is never flagged as single-use. A named reference is exactly the explicit style this tool asks for; only a genuine call counts as an inlinable use. Ambient `declare function` signatures are exempt for the same reason.

## Output formats

**Text**: grouped by file, color-coded by check type, with inline context.

**JSON**: one object per check. Suitable for CI integration, editor plugins, or piping into other tools.

**CSV**: headers: `File, Line, Column, Type, Code, Context`.

## Philosophy

The Zen of Python says "explicit is better than implicit." This tool enforces that line in JavaScript and TypeScript.

Most of the patterns flagged here exist for one reason: saving keystrokes. That trade made more sense when you were typing every character yourself. It makes no sense now. Your editor has autocomplete. Your AI agent will write the verbose version just as fast as the clever one. The keystrokes are free. The ambiguity is not.

The goal is not style, it's semantic precision: code should say what it means so that the next person (or LLM) reading it can understand the intent without guessing.

## Requirements

Any one of:

- [Deno](https://deno.com/) >= 2.8
- [Bun](https://bun.sh/) >= 1.0
- Node.js + npm (any version recent enough to run [tsx](https://tsx.is/))

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development tasks, the dogfood lint, and the test suite.
