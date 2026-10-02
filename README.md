# ExplicitJS

A semantic clarity enforcer for production JavaScript & TypeScript.

ExplicitJS flags code where the author's intent is ambiguous — patterns that force the next reader (or LLM) to guess what was meant instead of knowing. It is the JS/TS counterpart of [`explicit`](https://github.com/Andrew-Jayne/explicit) for Python.

**Deno:** run straight from this repo, no build step, no registry
```bash
deno install -g --allow-read --allow-env --import-map https://raw.githubusercontent.com/Andrew-Jayne/ExplicitJS/v1beta5/deno.json -n explicitjs https://raw.githubusercontent.com/Andrew-Jayne/ExplicitJS/v1beta5/src/cli.ts
```

**Bun/NPM:** prebuilt tarball attached to every GitHub Release
```bash
bun add -d https://github.com/Andrew-Jayne/ExplicitJS/releases/download/v1beta5/explicitjs-1beta5.tgz
```

Other routes (shell aliases, tracking `main`, running from a clone) see: [docs/install.md](docs/install.md).

## What it catches

Every check is always on. Like [Black](https://github.com/psf/black), ExplicitJS is deliberately opinionated: there are no options, no opt-ins, and no way to disable or suppress a check.

| Check | What's ambiguous | What to write instead |
|---|---|---|
| **Implicit booleans** in `if` / `while` / `do…while` / `for (…; cond; …)` | `if (items)` — checking length? nullness? | `if (items.length > 0)` or `if (items !== null)` |
| **`assert` truthiness** (`assert(x)`, `console.assert(x)`, `assert.ok(x)`, `assert.strict(x)` — including import aliases like `import { ok } from "node:assert"` — and test runners' `expect(x).toBeTruthy()` / `.toBeFalsy()`) | Relies on coercion | `assert(x !== undefined)`, `expect(x).not.toBeNull()` |
| **Ternary expressions** | `cond ? x : y` — buries control flow | Explicit `if`/`else` block |
| **Nullish coalescing** (`??`, `??=`, and default values) | `env.PORT ?? 3000` — an inline if in disguise; so are `const { PORT = 3000 } = env` and `function listen(port = 3000)`, which fill in only on `undefined` | Explicit `=== null` / `=== undefined` check with `if`/`else`. The one allowed default is a parameter's `= null` |
| **Optional chaining** | `request?.headers?.token` — is a missing field expected or a bug? | Validate the shape once (schema/type), then access directly |
| **Non-null assertions** | `request!.headers!.token` — presence claimed, never checked | Validate the shape, or test `=== null` / `=== undefined` explicitly. `items[0]!` index access is exempt (the `noUncheckedIndexedAccess` idiom). Definite assignment (`token!: string`, `let config!: Config`) is the same claim and is flagged too |
| **Optional members** (`name?: T`) | `label?: string` on a parameter, property or method — or JSDoc's `@param {string} [label]` / `@property {string} [label]` — is an absent value meaningful or an accident? | `label: string \| null`, plus `= null` where a default is legal |
| **Boolean operators** | `a && b`, `a \|\| b`, `a \|\|= b`, `a &&= b` with non-boolean operands | Explicit comparisons for each operand |
| **Negation** outside a condition | `const missing = !items`, `return !value`, `if (!items === true)` — the same coercion as `if (items)`, moved somewhere the condition check can't see it | `items === null`, `value.length === 0`, `ready === false` |
| **Bare attributes** (JSX, Svelte/Vue templates) | `<Widget active />` — `true` only by convention | `<Widget active={true} />` / `:active="true"` |
| **Implicit booleans in arrow / function expressions** | Truthiness hidden in anonymous logic | Named function with explicit comparisons |
| **Truthiness predicates** | `.filter(Boolean)`, `.some(String)`, `.every(Number)`, `.find((user) => user.email)` — truthiness as the predicate of `filter` / `find*` / `some` / `every` | Explicit predicate, e.g. `.filter((value) => value !== undefined)` |
| **Loose equality** (`==`, `!=`) | Coerces operands silently | `===` / `!==` |
| **Single-letter names** | `x`, `n`, `e` — anywhere, for any reason: variables, parameters, destructured and imported names, functions, classes, methods, properties and object keys, types, interfaces, enums and their members, generic parameters (`<T>`), labels, export aliases, and a read-back `_` | Descriptive names (`<Item>`, not `<T>`) |
| **Single-use variables** | `const r = compute(); return r;` — pointless indirection | Inline the expression |
| **Single-use functions** | Helper called exactly once — from anywhere, including a module-level helper whose one call sits inside another function, and a `private` / `#private` method called once within its class | Inline the operations at the call site |

Optional chaining and optional members are two halves of one rule. `response?.data?.messages?.text` is only reasonable because something upstream declared those fields optional, so the optional-member check closes the hole: a type that says `data: Data | null` forces the reader — and the next caller — to handle the absent case explicitly instead of chaining past it.

Optional members are flagged wherever `?` appears on a parameter, property or method: implementations, interfaces, type literals, classes and overload signatures alike. Where a default is legal (a parameter of an implementation, a concrete class field) the advice adds `= null`, so existing callers keep working; where it is not, the type carries the `| null` and every construction site states the field. The same goes for optionality that never writes a `?` on a member: `Partial<T>` and a mapped type with `?:` (`{ [Key in keyof T]?: T[Key] }`, which is how `Partial` is defined) make every field optional at once, so both are flagged too; map to `T[Key] | null` instead. `-?` (as in `Required<T>`) removes optionality and is fine. Optional tuple elements (`[name: string, label?: string]`) are out of scope.

## Usage

```bash
# Analyze a file or a directory
explicitjs app.ts
explicitjs src/

# JSON output (for CI/tooling)
explicitjs . --format json

# Statistics only
explicitjs . --stats-only

# Describe every check
explicitjs list-checks
```

`<path>` is any file or directory. ExplicitJS analyzes `.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.mts`, `.cts`, plus `.svelte` and `.vue` components (their `<script>` blocks as code, and their template markup too: bare attributes, plus every template expression — `v-if="items"` and `{#if items}` get the same implicit-boolean check as `if (items)`, and `{{ a ?? b }}`, `{x ? y : z}`, `v-for="(x, i) in rows"` and friends get every code check), and skips `node_modules`, dotfile directories, build output (`dist`, `build`, …) and `*.d.ts` (add more with `ignore` in [the config file](#configuration)). Files are parsed with the TypeScript compiler, so no `tsconfig` is needed.

### Exit codes

Every outcome maps to exactly one code, so CI pipelines can tell them apart:

| Code | Meaning |
|---|---|
| `0` | No style violations found |
| `1` | The analysis found style violations |
| `20` | CLI args were invalid: bad flag, missing path, no source files to check |

## Configuration

ExplicitJS reads an optional `.explicitrc.json` — discovered by walking up from the analyzed path, or pointed at explicitly with `--config`. It has exactly two keys, because the file holds what the _project_ knows: how it reports, and what it does not scan.

```jsonc
// .explicitrc.json
{
  "format": "text", // text | json | csv
  "ignore": ["generated", "src/vendored"],
}
```

- **`format`** — the default output format. `--format` overrides it.
- **`ignore`** — directories to skip **on top of** the built-in list, which no config can re-enable: `node_modules` and dotfile directories at any depth, and the build-output names `dist`, `dist-test`, `build`, `out`, `coverage` and `vendor` wherever build tools put them — directly under the analyzed root, or beside a `package.json` / `deno.json`. Elsewhere those names are ordinary source directories (`src/features/build/`) and are checked. A bare name skips that directory at any depth; an entry containing a separator is a path relative to the config file, so it means the same directory wherever you invoke the tool from. Directories only — no file patterns, no globs.

Everything else is a command-line flag: `--stats-only` and `--no-color` are choices about one run, not facts about the project, and putting them in the file does nothing.

There is no key for turning a check on or off, and no inline directive either — `// explicit: allow-if` does nothing. A construct ExplicitJS flags cannot be silenced; the tool has one mode.

See [example.explicitrc.json](example.explicitrc.json) for every setting and its default.

## What is exempt

The single-use checks deliberately ignore a few legitimate patterns:

- **Constants** — `UPPER_SNAKE_CASE` names bound to a constant value are never flagged as single-use variables; a named constant documents intent even when used once. A constant value is a literal, or an array, object, template, operator expression, `new Set/Map/RegExp(...)` or member access built only from literals and other constants — `const USER = await fetchUser()` is a runtime value in capitals and gets no exemption.
- **Public methods** — a class's public and `protected` methods can be called from other files, which a single-file analysis cannot see, so only `private` / `#private` methods are checked for single use.
- **Exports** — exported names are never flagged as single-use, since references from outside the file are invisible to a single-file analysis.
- **Entry points** — functions named `main` are never flagged as single-use functions.
- **Function references** — a function whose only use passes it **by name** (`React.memo(Component)`, `items.map(helper)`, `onClick={handler}`, a `<Component />` tag) is never flagged as single-use. A named reference is exactly the explicit style this tool asks for; only a genuine call counts as an inlinable use — and `helper.call(…)`, `helper.apply(…)`, `(helper)(…)`, ``helper`…` `` and `new Helper()` are all genuine calls. Ambient `declare function` signatures are exempt for the same reason.

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
