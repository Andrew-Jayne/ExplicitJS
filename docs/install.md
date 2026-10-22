# Installing ExplicitJS

ExplicitJS is not published to any package registry. Each [Release](https://github.com/Andrew-Jayne/ExplicitJS/releases) has a tarball attached, named `explicitjs-<version>.tgz` after the `version` in that release's `package.json`. It needs Node.js >= 26.

## pnpm or npm

```bash
# pnpm, as a dev dependency
pnpm add -D https://github.com/Andrew-Jayne/ExplicitJS/releases/download/v1beta6/explicitjs-1beta6.tgz
pnpm exec explicitjs <path>

# npm, global install
npm install -g https://github.com/Andrew-Jayne/ExplicitJS/releases/download/v1beta6/explicitjs-1beta6.tgz
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
pnpm lint:explicit
```

## From a clone

Node 26 runs the TypeScript source directly, so a clone needs no build step:

```bash
git clone https://github.com/Andrew-Jayne/ExplicitJS.git && cd ExplicitJS
pnpm install
pnpm start <path>
```

See [CONTRIBUTING.md](../CONTRIBUTING.md) for the rest of the development workflow.
