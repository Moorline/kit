# Moorline Kit

This repository owns `@moorline/package-kit`, the package authoring SDK and CLI for Moorline package builders.

The host runtime lives in `Moorline/moorline`. Official installable packages live in `Moorline/packages`.

Moorline packages extend an operator-controlled runtime. Package authors can build external surface adapters, providers, plugins, skills, and bundles that participate in durable event/work orchestration. Chat is one supported transport shape, not the architectural center.

## Development

The public development path consumes the published `@moorline/contracts` package:

```sh
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun run test:fast
bun run build
```

For cross-repo runtime changes, clone the repos side-by-side and build host contracts first:

```text
moorline/
  moorline/
  kit/
  packages/
```

```sh
cd moorline
bun install --frozen-lockfile
bun run --filter '@moorline/contracts' build
cd ../kit
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun run test:fast
bun run build
```

Package authoring documentation lives in `docs/PACKAGE_AUTHORING.md`. Shared wording lives in `docs/TERMINOLOGY.md`.

## Releases

Publishing is manual for now. The initial public npm package is `@moorline/package-kit@0.0.1`.

The release workflow only builds and smoke-tests the npm package tarball; it does not publish npm packages or upload GitHub release assets.
