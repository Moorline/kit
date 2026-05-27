import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { npmPackPackage, validatePackagePath } from '../../packages/package-kit/src/packageKit.js';
import { createTempRoot } from '../helpers/temp.js';

function writePluginSource(root: string): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    name: '@acme/slack',
    version: '1.0.0',
    description: 'Acme Slack bridge for Moorline.',
    type: 'module',
    private: false,
    keywords: ['slack', 'team chat'],
    license: 'MIT',
    repository: {
      type: 'git',
      url: 'git+https://github.com/acme/moorline-slack.git'
    }
  }, null, 2));
  writeFileSync(join(root, 'manifest.json'), JSON.stringify({
    id: 'acme/slack',
    name: 'acme/slack',
    version: '1.0.0',
    type: 'plugin',
    description: 'Slack plugin',
    entrypoint: 'index.mjs',
    hooks: ['onAction'],
    capabilities: ['net.connect']
  }, null, 2));
  writeFileSync(join(root, 'moorline.dist.json'), JSON.stringify({
    schemaVersion: 1,
    display: {
      name: 'Slack',
      description: 'Slack plugin',
      version: '1.0.0',
      tags: ['slack', 'chat']
    }
  }, null, 2));
  writeFileSync(join(root, 'index.js'), 'export default { id: "acme/slack", manifest: {} };\n');
  writeFileSync(join(root, 'environment.md'), '# Runtime Environment\n');
}

function writeOfficialHttpAdapterSource(root: string): void {
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, '..', 'core', 'resources', 'migrations'), { recursive: true });
  mkdirSync(join(root, '..', 'core', 'resources', 'policies'), { recursive: true });
  writeFileSync(join(root, '..', 'core', 'resources', 'migrations', '001_sessions.sql'), '-- migration\n');
  writeFileSync(join(root, '..', 'core', 'resources', 'policies', 'default-secure.json'), '{}\n');
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    name: '@moorline/http',
    version: '1.0.0',
    description: 'Official Moorline HTTP API adapter.',
    type: 'module',
    private: false,
    license: 'MIT',
    repository: {
      type: 'git',
      url: 'git+ssh://git@github.com/Moorline/moorline.git',
      directory: 'packages/http'
    }
  }, null, 2));
  writeFileSync(join(root, 'manifest.json'), JSON.stringify({
    id: 'official/http',
    name: 'official/http',
    version: '1.0.0',
    type: 'api-adapter',
    description: 'Official HTTP adapter',
    entrypoint: 'index.mjs',
    configSchema: {
      type: 'object'
    }
  }, null, 2));
  writeFileSync(join(root, 'moorline.dist.json'), JSON.stringify({
    schemaVersion: 1,
    display: {
      name: 'HTTP Adapter',
      description: 'Official HTTP adapter',
      version: '1.0.0',
      tags: ['http', 'api-adapter']
    }
  }, null, 2));
  writeFileSync(
    join(root, 'index.js'),
    [
      "import manifest from './manifest.json' with { type: 'json' };",
      'export default {',
      '  manifest,',
      '  createAdapter() {',
      '    return {',
      '      async start() { return { endpoints: [] }; },',
      '      async stop() {}',
      '    };',
      '  }',
      '};'
    ].join('\n'),
    'utf8'
  );
}

describe('npmPackPackage', () => {
  it('generates scoped npm package metadata and a valid tarball', async () => {
    const root = createTempRoot('moorline-npm-pack-');
    const sourceDir = join(root, 'source');
    const outDir = join(root, 'out', 'npm-packages');
    writePluginSource(sourceDir);

    const result = await npmPackPackage({
      sourceDir,
      outDir,
      npmName: '@acme/moorline-slack'
    });

    const packageJson = JSON.parse(readFileSync(join(result.npmPackageDir, 'package.json'), 'utf8')) as Record<string, unknown>;
    expect(packageJson).toMatchObject({
      name: '@acme/moorline-slack',
      version: '1.0.0',
      description: 'Acme Slack bridge for Moorline.',
      license: 'MIT',
      repository: {
        type: 'git',
        url: 'git+https://github.com/acme/moorline-slack.git'
      },
      publishConfig: {
        access: 'public'
      },
      moorline: {
        schemaVersion: 1,
        packageId: 'acme/slack',
        kind: 'plugin'
      }
    });
    expect(packageJson).not.toHaveProperty('dependencies');
    expect(packageJson).not.toHaveProperty('files');
    expect(packageJson.keywords).toEqual(expect.arrayContaining([
      'moorline-package',
      'moorline-kind-plugin',
      'moorline-namespace-acme',
      'moorline-id-acme-slack',
      'team-chat'
    ]));
    expect(result.tarballPath && existsSync(result.tarballPath)).toBe(true);
    const dryRun = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', result.npmPackageDir], { encoding: 'utf8' })) as Array<{
      files: Array<{ path: string }>;
    }>;
    expect(dryRun[0]?.files.map((file) => file.path)).toEqual(expect.arrayContaining(['environment.md', 'index.mjs']));
    await expect(validatePackagePath({ path: result.tarballPath!, surface: 'plugin' })).resolves.toMatchObject({
      surface: 'plugin'
    });
  });

  it('rejects unscoped npm names', async () => {
    const root = createTempRoot('moorline-npm-pack-unscoped-');
    const sourceDir = join(root, 'source');
    writePluginSource(sourceDir);

    await expect(npmPackPackage({
      sourceDir,
      outDir: join(root, 'out'),
      npmName: 'moorline-slack'
    })).rejects.toThrow(/scoped npm name/i);
  });

  it('emits short official npm metadata for api-adapter packages', async () => {
    const root = createTempRoot('moorline-npm-pack-api-adapter-');
    const sourceDir = join(root, 'source');
    const outDir = join(root, 'out', 'npm-packages');
    writeOfficialHttpAdapterSource(sourceDir);

    const result = await npmPackPackage({
      sourceDir,
      outDir,
      npmName: '@moorline/http'
    });

    const packageJson = JSON.parse(readFileSync(join(result.npmPackageDir, 'package.json'), 'utf8')) as Record<string, unknown>;
    expect(packageJson).toMatchObject({
      name: '@moorline/http',
      version: '1.0.0',
      description: 'Official Moorline HTTP API adapter.',
      license: 'MIT',
      main: './index.mjs',
      types: './index.d.ts',
      exports: {
        '.': {
          types: './index.d.ts',
          default: './index.mjs'
        },
        './server': {
          types: './server.d.ts',
          default: './server.mjs'
        }
      },
      moorline: {
        schemaVersion: 1,
        packageId: 'official/http',
        kind: 'api-adapter'
      }
    });
    expect(packageJson.repository).toMatchObject({
      url: 'git+ssh://git@github.com/Moorline/moorline.git',
      directory: 'packages/http'
    });
    expect(packageJson.keywords).toEqual(expect.arrayContaining([
      'moorline-kind-api-adapter',
      'moorline-namespace-official',
      'moorline-id-official-http'
    ]));
    const dryRun = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', result.npmPackageDir], { encoding: 'utf8' })) as Array<{
      files: Array<{ path: string }>;
    }>;
    expect(dryRun[0]?.files.map((file) => file.path)).toEqual(expect.arrayContaining([
      'index.d.ts',
      'server.d.ts',
      'server.mjs',
      'resources/migrations/001_sessions.sql',
      'resources/policies/default-secure.json'
    ]));
    await expect(validatePackagePath({ path: result.tarballPath!, surface: 'api-adapter' })).resolves.toMatchObject({
      surface: 'api-adapter'
    });
  });
});
