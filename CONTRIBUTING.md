# Contributing

Clone the repo and pick a runtime — see [docs/install.md](docs/install.md#from-a-clone) for the one-time setup. Bun and npm need `bun install` / `npm install` first to pull down `typescript`, `tsx` (npm only), and Biome.

## Tasks

| Task | Deno | Bun | npm |
|---|---|---|---|
| Run the CLI against any source | `deno task start <path>` | `bun src/cli.ts <path>` | `npm start -- <path>` |
| Dogfood: lint ExplicitJS's own source | `deno task lint` | `bun src/cli.ts src` | `npm run lint` |
| Run the test suite | `deno task test` | — (Deno-only, see below) | — |
| Type-check | `deno task check` | `bun run check` | `npm run check` |
| Format + lint with Biome, autofixing | `deno task fmt` | `bun run fmt` | `npm run fmt` |
| Format + lint, CI mode (no writes) | `deno task fmt:check` | `bun run fmt:check` | `npm run fmt:check` |

## The gate

Nothing ships that fails its own rules. Before a release tag is published, CI runs the type check, the tests, Biome, and the dogfood lint; all four must exit clean.

- ExplicitJS lints itself with its own [.explicitrc.json](.explicitrc.json), including the opt-in `optional_param` check. The test suite enforces the same via a self check and committed baselines in [nfo/](nfo/).
- Code style is enforced by [Biome](https://biomejs.dev/) via [biome.json](biome.json).

## Tests

The suite (see [test/README.md](test/README.md)) is fixture-driven: real annotated source files in `test/default_checks/` and `test/extra_checks/` carry trailing `// expect:` markers that the harness verifies against the analyzer, in-process and through the real CLI. Table-driven edge cases live in [test/checks.test.ts](test/checks.test.ts).

The suite uses Deno's built-in test runner and `jsr:@std/assert`, so `deno task test` is currently the only way to run it, even if you develop with Bun or npm.

## Releases

`npm run build` compiles `src/` to plain JS in `dist/` (rewriting `.ts` imports to `.js`, and the shebang to `#!/usr/bin/env node`). `npm pack` runs that automatically via `prepack` and produces the tarball attached to each [Release](https://github.com/Andrew-Jayne/ExplicitJS/releases); `dist/` itself is gitignored. Pushing a `v*` tag triggers [release.yml](.github/workflows/release.yml), which runs the gate and attaches the tarball.
