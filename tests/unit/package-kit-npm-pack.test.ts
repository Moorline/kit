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
    dependencies: {
      '@acme/slack-sdk': '^2.0.0'
    },
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

function writeMoorlineHttpAdapterSource(root: string): void {
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, 'resources', 'migrations'), { recursive: true });
  mkdirSync(join(root, 'resources', 'policies'), { recursive: true });
  writeFileSync(join(root, 'resources', 'migrations', '001_sessions.sql'), '-- migration\n');
  writeFileSync(join(root, 'resources', 'policies', 'default-secure.json'), '{}\n');
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    name: '@moorline/http',
    version: '1.0.0',
    description: 'Moorline HTTP API adapter.',
    type: 'module',
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
      },
      './server.js': {
        types: './server.d.ts',
        default: './server.mjs'
      }
    },
    private: false,
    license: 'MIT',
    repository: {
      type: 'git',
      url: 'git+ssh://git@github.com/Moorline/moorline.git',
      directory: 'packages/http'
    }
  }, null, 2));
  writeFileSync(join(root, 'manifest.json'), JSON.stringify({
    id: 'moorline/http',
    name: 'moorline/http',
    version: '1.0.0',
    type: 'api-adapter',
    description: 'Moorline HTTP adapter',
    entrypoint: 'index.mjs',
    configSchema: {
      type: 'object'
    }
  }, null, 2));
  writeFileSync(join(root, 'moorline.dist.json'), JSON.stringify({
    schemaVersion: 1,
    display: {
      name: 'HTTP Adapter',
      description: 'Moorline HTTP adapter',
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

function writeBundleSource(root: string): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    name: '@acme/moorline-defaults',
    version: '1.0.0',
    description: 'Acme default Moorline package bundle.',
    type: 'module',
    private: false,
    license: 'MIT',
    repository: {
      type: 'git',
      url: 'git+https://github.com/acme/moorline-defaults.git'
    }
  }, null, 2));
  writeFileSync(join(root, 'manifest.json'), JSON.stringify({
    id: 'acme/defaults',
    name: 'acme/defaults',
    version: '1.0.0',
    type: 'bundle',
    description: 'Acme default bundle',
    members: [
      {
        kind: 'plugin',
        packageId: 'acme/slack',
        version: '~1.0.0',
        activation: 'enable'
      }
    ]
  }, null, 2));
  writeFileSync(join(root, 'moorline.dist.json'), JSON.stringify({
    schemaVersion: 1,
    display: {
      name: 'Acme Defaults',
      description: 'Acme default bundle',
      version: '1.0.0',
      tags: ['defaults']
    }
  }, null, 2));
}

function writeProviderSource(root: string): void {
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, 'dist'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    name: '@acme/moorline-provider',
    version: '1.0.0',
    description: 'Acme provider.',
    type: 'module',
    main: './index.mjs',
    files: ['dist', 'index.mjs', 'manifest.json', 'moorline.dist.json'],
    dependencies: {
      '@acme/provider-sdk': '1.2.3'
    },
    private: false,
    license: 'MIT'
  }, null, 2));
  writeFileSync(join(root, 'manifest.json'), JSON.stringify({
    id: 'acme/provider',
    name: 'acme/provider',
    version: '1.0.0',
    type: 'provider',
    description: 'Acme provider',
    entrypoint: 'index.mjs'
  }, null, 2));
  writeFileSync(join(root, 'moorline.dist.json'), JSON.stringify({
    schemaVersion: 1,
    display: {
      name: 'Acme Provider',
      description: 'Acme provider',
      version: '1.0.0'
    }
  }, null, 2));
  writeFileSync(join(root, 'index.mjs'), "export { default } from './dist/runtimePackage.js';\n", 'utf8');
  writeFileSync(join(root, 'dist', 'runtimePackage.js'), "import '@acme/provider-sdk'; export default { manifest: {} };\n", 'utf8');
  writeFileSync(join(root, 'runtimePackage.ts'), "import '@acme/provider-sdk'; export default {};\n", 'utf8');
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
    expect(packageJson.dependencies).toEqual({
      '@acme/slack-sdk': '^2.0.0'
    });
    expect(packageJson).not.toHaveProperty('files');
    expect(packageJson.keywords).toEqual(['moorline-package']);
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

  it('emits short Moorline-owned npm metadata for api-adapter packages', async () => {
    const root = createTempRoot('moorline-npm-pack-api-adapter-');
    const sourceDir = join(root, 'source');
    const outDir = join(root, 'out', 'npm-packages');
    writeMoorlineHttpAdapterSource(sourceDir);

    const result = await npmPackPackage({
      sourceDir,
      outDir,
      npmName: '@moorline/http'
    });

    const packageJson = JSON.parse(readFileSync(join(result.npmPackageDir, 'package.json'), 'utf8')) as Record<string, unknown>;
    expect(packageJson).toMatchObject({
      name: '@moorline/http',
      version: '1.0.0',
      description: 'Moorline HTTP API adapter.',
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
        packageId: 'moorline/http',
        kind: 'api-adapter'
      }
    });
    expect(packageJson.repository).toMatchObject({
      url: 'git+ssh://git@github.com/Moorline/moorline.git',
      directory: 'packages/http'
    });
    expect(packageJson.keywords).toEqual(['moorline-package']);
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

  it('embeds declared member packages into bundle npm packages', async () => {
    const root = createTempRoot('moorline-npm-pack-bundle-');
    const bundleSourceDir = join(root, 'bundle');
    const pluginSourceDir = join(root, 'plugin');
    const outDir = join(root, 'out', 'npm-packages');
    writeBundleSource(bundleSourceDir);
    writePluginSource(pluginSourceDir);

    const result = await npmPackPackage({
      sourceDir: bundleSourceDir,
      outDir,
      npmName: '@acme/moorline-defaults',
      embeddedMemberSourceDirs: [pluginSourceDir]
    });

    expect(existsSync(join(result.npmPackageDir, 'packages', 'plugins', 'acme', 'slack', 'manifest.json'))).toBe(true);
    expect(existsSync(join(result.npmPackageDir, 'packages', 'plugins', 'acme', 'slack', 'index.mjs'))).toBe(true);
    const packageJson = JSON.parse(readFileSync(join(result.npmPackageDir, 'package.json'), 'utf8')) as Record<string, unknown>;
    expect(packageJson).toMatchObject({
      main: './index.mjs',
      exports: {
        '.': './index.mjs'
      }
    });
    expect(packageJson).not.toHaveProperty('dependencies');
    const dryRun = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', result.npmPackageDir], { encoding: 'utf8' })) as Array<{
      files: Array<{ path: string }>;
    }>;
    expect(dryRun[0]?.files.map((file) => file.path)).toEqual(expect.arrayContaining([
      'index.mjs',
      'manifest.json',
      'packages/plugins/acme/slack/manifest.json',
      'packages/plugins/acme/slack/index.mjs'
    ]));
    await expect(validatePackagePath({ path: result.tarballPath!, surface: 'bundle' })).resolves.toMatchObject({
      surface: 'bundle'
    });
  });

  it('preserves dependency-backed provider package files instead of rebundling runtime dependencies', async () => {
    const root = createTempRoot('moorline-npm-pack-provider-');
    const sourceDir = join(root, 'source');
    const outDir = join(root, 'out', 'npm-packages');
    writeProviderSource(sourceDir);

    const result = await npmPackPackage({
      sourceDir,
      outDir,
      npmName: '@acme/moorline-provider'
    });

    const packageJson = JSON.parse(readFileSync(join(result.npmPackageDir, 'package.json'), 'utf8')) as Record<string, unknown>;
    expect(packageJson.dependencies).toEqual({
      '@acme/provider-sdk': '1.2.3'
    });
    expect(readFileSync(join(result.npmPackageDir, 'index.mjs'), 'utf8')).toContain('./dist/runtimePackage.js');
    expect(readFileSync(join(result.npmPackageDir, 'dist', 'runtimePackage.js'), 'utf8')).toContain('@acme/provider-sdk');
    expect(existsSync(join(result.npmPackageDir, 'runtimePackage.ts'))).toBe(false);
    await expect(validatePackagePath({ path: result.tarballPath!, surface: 'provider', runtimeSmoke: false })).resolves.toMatchObject({
      surface: 'provider'
    });
  });
});
