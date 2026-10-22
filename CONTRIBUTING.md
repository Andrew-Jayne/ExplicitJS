# Contributing

Clone the repo and run `pnpm install` (see [docs/install.md](docs/install.md#from-a-clone)). It needs Node.js >= 26, which runs the TypeScript source with no build step.

## Tasks

| Task | Command |
|---|---|
| Run the CLI against any source | `pnpm start <path>` |
| Dogfood: lint ExplicitJS's own source | `pnpm lint` |
| Run the test suite | `pnpm test` |
| Type-check (tsc 7) | `pnpm check` |
| Format + lint with Biome, autofixing | `pnpm fmt` |
| Format + lint, CI mode (no writes) | `pnpm fmt:check` |
| Regenerate the `nfo/` baselines | `pnpm update-nfo` |

Source must stay erasable TypeScript (`erasableSyntaxOnly`): no enums, namespaces or parameter properties, because Node strips types instead of compiling them.

The analyzer parses with the TypeScript 6 compiler API, installed under the alias `typescript6`. TypeScript 7 is the type checker only: its package has no in-process parser API.

## The gate

Nothing ships that fails its own rules. Before a release tag is published, CI runs the type check, the tests, Biome, and the dogfood lint; all four must exit clean.

- ExplicitJS lints itself: `pnpm lint` runs it over `src/`, which must stay at zero findings. Every check is mandatory, so there is no config file to carry. The test suite enforces the same via a self check and committed baselines in [nfo/](nfo/).
- Code style is enforced by [Biome](https://biomejs.dev/) via [biome.json](biome.json).

## Tests

The suite (see [test/README.md](test/README.md)) is fixture-driven: real annotated source files in `test/fixtures/` carry trailing `// expect:` markers that the harness verifies against the analyzer, in-process and through the real CLI. Table-driven edge cases live in [test/checks.test.ts](test/checks.test.ts).

The suite uses Node's built-in `node:test` runner and `node:assert`.

## Releases

`pnpm build` compiles `src/` to plain JS in `dist/` (rewriting `.ts` imports to `.js`). Node does not strip types under `node_modules`, so the tarball must ship JS. `pnpm pack` runs that automatically via `prepack` and produces the tarball attached to each [Release](https://github.com/Andrew-Jayne/ExplicitJS/releases); `dist/` itself is gitignored. Pushing a `v*` tag triggers [release.yml](.github/workflows/release.yml), which runs the gate and attaches the tarball.
