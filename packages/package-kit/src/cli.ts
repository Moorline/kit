#!/usr/bin/env node
import { resolve } from 'node:path';
import { bundlePackage, inspectPackagePath, npmPackPackage, validatePackagePath } from './packageKit.js';
import type { PackageKind } from './packageKit.js';

function readFlag(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
}

function hasFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag);
}

function readSurface(argv: string[]): PackageKind | undefined {
  const index = argv.indexOf('--surface');
  if (index === -1) {
    return undefined;
  }
  const surface = argv[index + 1];
  if (surface === undefined || surface.startsWith('-')) {
    throw new Error('--surface requires one of: api-adapter, provider, transport, plugin, skill, bundle');
  }
  if (
    surface === 'api-adapter' ||
    surface === 'provider' ||
    surface === 'transport' ||
    surface === 'plugin' ||
    surface === 'skill' ||
    surface === 'bundle'
  ) {
    return surface;
  }
  throw new Error(`--surface must be one of: api-adapter, provider, transport, plugin, skill, bundle`);
}

function usage(): string {
  const surfaceChoices = 'api-adapter|provider|transport|plugin|skill|bundle';
  return [
    `moorline-package-kit bundle <source-dir> [--out-dir <path>] [--archive] [--archive-format tar.gz] [--entry <path>] [--surface <${surfaceChoices}>]`,
    'moorline-package-kit npm-pack <source-dir> --npm-name <@scope/name> [--out-dir <path>] [--access public]',
    `moorline-package-kit validate <path> [--surface <${surfaceChoices}>] [--runtime-smoke]`,
    `moorline-package-kit inspect <path> [--surface <${surfaceChoices}>]`
  ].join('\n');
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const command = argv[0];
  if (!command || command === '--help' || command === '-h' || command === 'help') {
    console.log(usage());
    return 0;
  }

  if (command === 'bundle') {
    const sourceDir = argv[1];
    if (!sourceDir) {
      throw new Error('bundle requires a source directory');
    }
    const surface = readSurface(argv);
    const result = await bundlePackage({
      sourceDir,
      outDir: resolve(readFlag(argv, '--out-dir') ?? './dist/moorline-bundle'),
      archive: hasFlag(argv, '--archive'),
      archiveFormat: (readFlag(argv, '--archive-format') as 'tar.gz' | undefined) ?? 'tar.gz',
      ...(readFlag(argv, '--entry') ? { entry: readFlag(argv, '--entry') } : {}),
      ...(surface ? { surface } : {})
    });
    console.log(`Bundled ${result.surface} ${result.manifest.id} -> ${result.bundleDir}`);
    if (result.archivePath) {
      console.log(`Archive: ${result.archivePath}`);
    }
    return 0;
  }

  if (command === 'npm-pack') {
    const sourceDir = argv[1];
    if (!sourceDir) {
      throw new Error('npm-pack requires a source directory');
    }
    const npmName = readFlag(argv, '--npm-name');
    if (!npmName) {
      throw new Error('npm-pack requires --npm-name <@scope/name>');
    }
    const access = readFlag(argv, '--access');
    if (access !== undefined && access !== 'public') {
      throw new Error('npm-pack only supports --access public');
    }
    const result = await npmPackPackage({
      sourceDir,
      outDir: resolve(readFlag(argv, '--out-dir') ?? './dist/moorline-npm'),
      npmName,
      ...(access ? { access: 'public' } : {})
    });
    console.log(`Packed ${result.kind} ${result.packageId} as ${result.npmName} -> ${result.npmPackageDir}`);
    if (result.tarballPath) {
      console.log(`Tarball: ${result.tarballPath}`);
    }
    return 0;
  }

  if (command === 'validate') {
    const path = argv[1];
    if (!path) {
      throw new Error('validate requires a path');
    }
    const surface = readSurface(argv);
    const result = await validatePackagePath({
      path,
      runtimeSmoke: hasFlag(argv, '--runtime-smoke'),
      ...(surface ? { surface } : {})
    });
    console.log(`Valid ${result.mode} ${result.surface} package ${result.manifest.id}`);
    return 0;
  }

  if (command === 'inspect') {
    const path = argv[1];
    if (!path) {
      throw new Error('inspect requires a path');
    }
    const surface = readSurface(argv);
    const result = await inspectPackagePath({
      path,
      ...(surface ? { surface } : {})
    });
    console.log(
      JSON.stringify(
        {
          surface: result.surface,
          family: result.family,
          id: result.manifest.id,
          version: result.manifest.version,
          name: result.distro.display.name,
          description: result.distro.display.description,
          fingerprint: result.fingerprint
        },
        null,
        2
      )
    );
    return 0;
  }

  throw new Error(`Unknown command: ${command}`);
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
