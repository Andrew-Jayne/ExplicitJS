# Tests

The suite mirrors the Python `explicit` project's fixture-marker architecture.

## Layout

| File | What it exercises |
|---|---|
| `fixtures/test_*` | **Fixtures, not tests** — real source (`.ts`, `.svelte`, `.vue`) annotated with expectation markers (see grammar below). One fixture per check. |
| `fixtureSpec.ts` | Shared helpers: the marker parser (`parseFixture`), fixture discovery, diff formatting. Not a test file. |
| `fixtures.test.ts` | The harness: markers vs. analyzer, plus fixture syntax validation (`ts.transpileModule` diagnostics). |
| `self.test.ts` | The self check: every `src/*.ts` source file must pass its own linter. |
| `cli.test.ts` | End-to-end through the real CLI: JSON output vs. markers, exit codes, `list-checks`. |
| `listings.test.ts` | Every check must have a description in `list-checks`. |
| `config.test.ts` | The two `.explicitrc.json` keys (`format`, `ignore`) driven through the real CLI over a temp project, plus what the file cannot do. |
| `baselines.test.ts` | Live lint runs must match the committed outputs in `nfo/` at the repo root. |
| `checks.test.ts`, `svelte.test.ts`, `vue.test.ts` | The older table-driven/unit suites, kept alongside: inline snippets for check edge cases and the SFC extractors. |
| `markupAttrs.test.ts` | The bare-attribute template scanner (`bool_attr`): directive exemptions and scan hazards (comments, quoted `>`, brace expressions). |

Deno's test runner collects only `*.test.ts` files, so the `test_*` fixtures are
**never executed or type-checked** — executing them would crash on their calls
to undefined helpers, and type-checking would reject the undeclared names. They
are only read as text and parsed (via `analyzeFile`) or transpiled (via
`ts.transpileModule`, which validates syntax without executing). Biome ignores
the fixture directory for the same reason (`biome.json`), and `tsconfig.json`
includes only `src/`.

There is no `.explicitrc.json` anywhere in the repo: every check is mandatory,
so a fixture run has nothing to configure and nothing can leak into it. The
config tests build their own throwaway projects under a temp directory.

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
- A line with **no** marker must produce **zero** checks.
- The harness asserts type + count per line, **not** column (column is an
  implementation detail).
- In `.svelte`/`.vue` fixtures the markers sit inside the script blocks; line
  numbers refer to the original component file (the analyzer newline-pads
  extracted blocks so they match).
- In `.tsx` fixtures a marker on a line inside JSX children is technically a
  JSX **text node**, not a comment (`//` has no comment meaning there). The
  marker parser matches on raw line text so it works either way, and fixtures
  are only ever parsed — never rendered — so the stray text is harmless.

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
