# Moorline Kit

This repository owns `@moorline/package-kit`, the package authoring SDK and CLI for third-party Moorline package builders.

The host runtime lives in `Moorline/moorline`. Official installable packages live in `Moorline/packages`.

## Development

Until `@moorline/contracts@0.0.1` is published, clone the repos side-by-side:

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

Package authoring documentation lives in `docs/PACKAGE_AUTHORING.md`.

## Releases

Publishing is manual for now. The release workflow only builds and smoke-tests the npm package tarball; it does not publish npm packages or upload GitHub release assets.
