# Fallow as a Knip replacement

Checked against Fallow 3.24.0 on 2026-09-09. The version and the package's
`node >=22` engine requirement come from the
[npm package](https://www.npmjs.com/package/fallow). The comparison below is
based on Fallow's own documentation and should be treated as a vendor-authored
feature comparison, not an independent benchmark.

## Recommended setup for this repository

Install Fallow at the monorepo root and invoke the local binary through Bun:

```bash
bun add --dev fallow
bunx fallow --version
bunx fallow recommend
bunx fallow dead-code
```

`bun add --dev` and `bunx` are the Bun equivalents of installing a development
dependency and running its executable; see the official
[`bun add`](https://bun.sh/docs/pm/cli/add) and
[`bunx`](https://bun.sh/docs/pm/bunx) references. Fallow itself documents npm,
pnpm, Yarn, Cargo, Docker, and standalone binaries in its
[installation guide](https://docs.fallow.tools/installation).

No special Bun workspace configuration should be necessary. This repository
uses the standard root `package.json#workspaces` field, which is both Bun's
[workspace format](https://bun.sh/docs/pm/workspaces) and one of the formats
Fallow [auto-detects](https://docs.fallow.tools/configuration/workspaces).
Fallow analyzes the whole graph even when output is restricted with
`--workspace`, so cross-package use is preserved. Useful checks are:

```bash
bunx fallow dead-code --workspace apps/web
bunx fallow dead-code --workspace @coldbrew/web
bunx fallow dead-code --changed-workspaces origin/master
```

Fallow works without a config. This repository uses `.fallowrc.jsonc` so the
reason for retained tool dependencies can stay next to the configuration.
`fallow recommend` is read-only; `fallow init` writes a starter config. See the
[configuration reference](https://docs.fallow.tools/configuration/overview).

## Migration result for the current `knip.jsonc`

Running the documented preview command against this repository:

```bash
bunx fallow@3.24.0 migrate --dry-run --format json --quiet
```

produced only the schema header and two warnings. The root per-workspace Knip
configuration has no direct Fallow equivalent, and
`apps/web.ignore = ["src/components/ui/**"]` is not migrated because Fallow's
ignore patterns are project-root-relative. The current migration therefore
cannot be accepted blindly.

A hand-written starting point equivalent to the intent of the current Knip
configuration is approximately:

```jsonc
{
  "$schema": "./node_modules/fallow/schema.json",
  "entry": ["scripts/**/*.ts"],
  "ignoreDependencies": ["@tanstack/intent", "concurrently", "oxfmt", "oxlint", "oxlint-tsgolint"],
  "ignoreFindings": ["apps/web/src/components/ui/**"],
}
```

This is only a starting point: `ignoreFindings` keeps matching files in the
graph, but does not hide manifest-owned dependency findings. `ignorePatterns`
removes files from analysis entirely. Fallow has no equivalent for Knip's
`ignoreBinaries`. The official migration guide also warns that the two tools
use different glob engines and that TypeScript Knip configs cannot be parsed;
see [Migrating from Knip](https://docs.fallow.tools/migration/from-knip).

## Results in Coldbrew

The previous Knip configuration reported no issues. After preserving its manual
script entry points, shadcn UI exclusion, and justfile-only dependencies, Fallow
3.24.0 reports three unused class members:

- `ChatServiceError.type`, which is observed indirectly by a Vitest
  `toMatchObject` assertion and is therefore not safe to remove;
- `DonationIntegrationError.type`, which has no repository reference;
- `Store.fromDbUrl`, which has no repository caller.

The combined analysis also reports 9 clone groups covering 271 lines (2.11% of
the analyzed corpus), and 36 functions above at least one default health
threshold. The largest complexity candidates are `ChatPage`, `VideoQueue`, and
`VideoCard`. The health run uses static estimated coverage, so its CRAP scores
are prioritization hints rather than measured test-coverage evidence.

An exploratory `dead-code --type-aware` run additionally reports 25 private
type leaks, mainly exported React components whose signatures use same-file
private `Props` types. This check is useful for published libraries, but noisy
for this application and is not enabled in the normal lint recipe.

## What Fallow can be used for

- `fallow dead-code`: unused files, exports, types, dependencies, enum/class
  members, unresolved or unlisted dependencies, duplicate exports, circular
  dependencies, re-export cycles, and configured architecture-boundary
  violations. The detailed behavior is in the
  [dead-code guide](https://docs.fallow.tools/analysis/dead-code).
- `fallow dupes`: clone families with strict, mild, weak, or semantic matching;
  see [duplication analysis](https://docs.fallow.tools/analysis/duplication).
- `fallow health --score`: cyclomatic and cognitive complexity,
  maintainability, churn/coverage-aware hotspots, and ranked refactoring
  targets; see [health](https://docs.fallow.tools/cli/health).
- `fallow audit`: a changed-file PR gate combining dead code, duplication,
  complexity, and styling findings, with pass/warn/fail verdicts and baselines;
  see [audit](https://docs.fallow.tools/cli/audit).
- `fallow fix --dry-run`: preview removal of supported unused exports and
  dependencies before applying it; see
  [auto-fix](https://docs.fallow.tools/analysis/auto-fix).
- `fallow viz`, `inspect`, `trace`, `list`, and `explain`: investigate the
  dependency graph and understand why a symbol or file is considered used or
  unused. The complete first-party command index is in
  [`llms.txt`](https://docs.fallow.tools/llms.txt).
- CI/editor/agent workflows: JSON and SARIF output, saved baselines,
  `--changed-since`, watch/LSP support, and a bundled MCP server. The npm package
  exposes `fallow`, `fallow-lsp`, and `fallow-mcp`; CI recipes are in the
  [integration guide](https://docs.fallow.tools/integrations/ci).

The default `fallow` command runs dead-code, duplication, and health analyses in
one pass. For machine-readable output, use `--format json --quiet`. Exit code 1
means findings were found; exit code 2 means invalid configuration or a runtime
failure. See the [quick start](https://docs.fallow.tools/quickstart).

## Differences and limits relative to Knip

Fallow's advertised advantage is breadth: in addition to Knip-like dead-code
analysis, it includes duplication, complexity/health, architecture boundaries,
SARIF, baselines, and Git-aware PR scoping. Knip still has broader niche and
legacy plugin coverage, JavaScript custom reporters, JSDoc tag filtering, and
unused TypeScript namespace-member detection. Fallow does not claim to be
universally faster: its own benchmark shows Knip ahead on some large projects.
See Fallow's [comparison](https://docs.fallow.tools/migration/comparison) and
[benchmark source](https://github.com/fallow-rs/fallow/blob/main/BENCHMARKS.md).

The default analysis is syntactic and does not run the TypeScript compiler.
`--type-aware` adds a slower, bounded TypeScript checker pass for exact symbol
identity, aliases/re-exports, class contracts, affected tests, and public type
coupling, but it is not a replacement for `tsc --noEmit` or typed lint rules.
Other documented edge cases include dynamic/runtime-only loading, arbitrary
JavaScript in tool configs, DI-reflected class members, public library types,
some Svelte exports, partial CSS parsing, and most hidden directories. Review
the [known limitations](https://docs.fallow.tools/analysis/limitations) before
deleting anything reported as unused.

## Suggested evaluation sequence

1. Run `recommend`, `list`, and `config` to verify detected workspaces, plugins,
   entries, and the resolved configuration.
2. Compare `dead-code --format json --quiet` with the current Knip output.
3. Repeat with `dead-code --type-aware` for suspicious symbol-level findings.
4. Run `dupes` and `health --score` to evaluate the functionality Knip does not
   provide.
5. Use `fix --dry-run` only after false positives and intentional public APIs
   have been configured.
6. For gradual CI adoption, save a baseline and gate only changed code with
   `audit` rather than requiring the existing backlog to be clean immediately.
