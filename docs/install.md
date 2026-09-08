# Installing ExplicitJS

ExplicitJS is not published to any package registry. Deno runs it straight from this repository; Bun and npm install a prebuilt tarball from the [Releases page](https://github.com/Andrew-Jayne/ExplicitJS/releases). Pick whichever runtime you already have.

Every route needs `--allow-read` and `--allow-env` under Deno. The second flag exists because the `typescript` package reads `TSC_*` watch-mode variables at init — never used here, but Deno blocks the read without it.

## Deno

**Install as a shim** (pinned, recommended). Deno fetches the import graph from the URL and caches it, so a pinned URL resolves only once per version:

```bash
deno install -g --allow-read --allow-env -n explicitjs https://raw.githubusercontent.com/Andrew-Jayne/ExplicitJS/v1beta4/src/cli.ts
explicitjs <path>
```

**Run without installing, via a shell alias:**

```bash
# Pinned to a release tag — immutable, auditable at a fixed commit:
alias explicitjs="deno run --allow-read --allow-env https://raw.githubusercontent.com/Andrew-Jayne/ExplicitJS/v1beta4/src/cli.ts"

# Or track the latest on main (mutable):
alias explicitjs="deno run --allow-read --allow-env https://raw.githubusercontent.com/Andrew-Jayne/ExplicitJS/main/src/cli.ts"
```

Available tags are on the [Releases page](https://github.com/Andrew-Jayne/ExplicitJS/releases).

## Bun or npm

Each release has an npm-installable tarball attached, named `explicitjs-<version>.tgz` after the `version` in that release's `package.json`.

```bash
# Bun — add as a dev dependency
bun add -d https://github.com/Andrew-Jayne/ExplicitJS/releases/download/v1beta4/explicitjs-1beta4.tgz
bunx explicitjs <path>

# npm — global install
npm install -g https://github.com/Andrew-Jayne/ExplicitJS/releases/download/v1beta4/explicitjs-1beta4.tgz
explicitjs <path>
```

A dev dependency pins the same version for every developer, and slots into a `package.json` script or CI step:

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

## From a clone

Contributing, or want the source tree directly?

```bash
git clone https://github.com/Andrew-Jayne/ExplicitJS.git && cd ExplicitJS

# Deno — no install step:
deno task start <path>

# Bun runs the TypeScript source directly:
bun install
bun src/cli.ts <path>

# npm needs a TS runner (tsx) since plain Node can't execute this source yet;
# package.json wires that up:
npm install
npm start -- <path>
```

Don't mix the two: `bun run start` (as opposed to `bun src/cli.ts`) fails, because the `start` script shells out to `tsx`, which isn't Bun-compatible. Bun doesn't need `tsx` at all, so run the file directly.

See [CONTRIBUTING.md](../CONTRIBUTING.md) for the rest of the development workflow.
