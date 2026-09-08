# Tests

The suite mirrors the Python `explicit` project's fixture-marker architecture.

## Layout

| File | What it exercises |
|---|---|
| `default_checks/test_*` | **Fixtures, not tests** — real source (`.ts`, `.svelte`, `.vue`) annotated with expectation markers (see grammar below). One fixture per always-on check. |
| `extra_checks/test_*` | Fixtures for the opt-in `--include-extra` checks (`arrow`, `optional_param`) and the `// explicit: allow-*` directive. These declare both modes, since the stock variant still applies. |
| `fixtureSpec.ts` | Shared helpers: the marker parser (`parseFixture`), fixture discovery, diff formatting. Not a test file. |
| `fixtures.test.ts` | The harness: markers vs. analyzer, plus fixture syntax validation (`ts.transpileModule` diagnostics). |
| `self.test.ts` | The self check: every `src/*.ts` source file must pass its own linter (with the dogfood `optional_param` extra). |
| `cli.test.ts` | End-to-end through the real CLI: JSON output vs. markers, exit codes, listing commands. |
| `listings.test.ts` | Every check must have a description in `list-checks` / `list-extras`. |
| `baselines.test.ts` | Live lint runs must match the committed outputs in `nfo/` at the repo root. |
| `checks.test.ts`, `svelte.test.ts`, `vue.test.ts` | The older table-driven/unit suites, kept alongside: inline snippets for check edge cases and the SFC extractors. |
| `markupAttrs.test.ts` | The bare-attribute template scanner (`bool_attr`): directive exemptions and scan hazards (comments, quoted `>`, brace expressions). |

Deno's test runner collects only `*.test.ts` files, so the `test_*` fixtures are
**never executed or type-checked** — executing them would crash on their calls
to undefined helpers, and type-checking would reject the undeclared names. They
are only read as text and parsed (via `analyzeFile`) or transpiled (via
`ts.transpileModule`, which validates syntax without executing). Biome ignores
the fixture directories for the same reason (`biome.json`), and `tsconfig.json`
includes only `src/`.

`.explicitrc.json` here is deliberately neutral: config discovery walks up from
the analyzed path, and without it the repo root's dogfood config (which enables
`optional_param`) would leak into fixture runs.

## Marker grammar

Expectations live in the fixture itself, as a trailing comment on the line
where a check is reported (the construct's starting line):

```ts
if (value) {                   // expect: if
assert(first && second);       // expect: assert, assert, bool_op, bool_op
```

- The spec is a comma-separated list of check-type names (see `CheckType`).
- Repeat a name to assert it is reported that many times on the line (a single
  line can legitimately produce several checks, e.g. one per boolean operand).
- A line with **no** marker must produce **zero** checks in every mode.
- The harness asserts type + count per line, **not** column (column is an
  implementation detail).
- In `.svelte`/`.vue` fixtures the markers sit inside the script blocks; line
  numbers refer to the original component file (the analyzer newline-pads
  extracted blocks so they match).
- In `.tsx` fixtures a marker on a line inside JSX children is technically a
  JSX **text node**, not a comment (`//` has no comment meaning there). The
  marker parser matches on raw line text so it works either way, and fixtures
  are only ever parsed — never rendered — so the stray text is harmless.

## Modes

Checks with a stricter opt-in variant (`arrow`, `optional_param`) are
exercised in both configurations. A fixture declares its modes in a header
comment within its first 10 lines:

```ts
// explicit-test: modes=default,extra; extra=arrow
```

`modes` lists the analyzer configurations to run (`default` = no extras,
`extra` = all listed extras enabled). No header means `modes=default` with no
extras. Per-item mode qualifiers restrict an expectation to one mode:

```ts
report(values.map((value) => value + 1)); // expect: arrow@extra
```

An `// explicit: allow-<name>` directive on a marked line must come **before**
the `// expect:` marker, or the directive text would be parsed as part of the
expectation spec.

## Baselines (`nfo/` at the repo root)

**Policy: everything that is not a deliberate, marker-asserted fixture
violation must pass the linter** — including the test harness itself, which is
written in the same house style as `src/`. `baselines.test.ts` enforces this
by comparing live runs against the committed outputs:

- `nfo/explicit.out` — stats over `src/`. **Must always show
  `Total checks found: 0`**; only the file count moves, when sources are
  added or removed.
- `nfo/tests.out` — the stats summary over the tests tree: exactly the fixture
  specimens.
- `nfo/code_count_*.nfo` — cloc line counts per dir (tracked, not CI-checked;
  up on features, down on cleanup).

A mismatch in CI means a regression (a check changed behavior, or non-fixture
code picked up a violation). When the change is deliberate — new fixture
cases, a new source file — regenerate everything and review the diff in the
commit:

```bash
deno task update-nfo
```

## Workflow

```bash
deno task test                                # everything
deno test --allow-read --allow-env test/fixtures.test.ts   # one concern
deno test --allow-read --allow-env test/ --filter test_if  # one fixture
```

When you add or change a check: update the matching fixture's markers in the
same change, add its `CHECK_DESCRIPTIONS` / `EXTRA_DESCRIPTIONS` entry in
`src/constructs.ts`, regenerate `nfo/`, and run `deno task test`.
