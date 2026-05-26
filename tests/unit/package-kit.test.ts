import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { create } from 'tar';
import { bundlePackage, inspectPackagePath, validatePackagePath } from '../../packages/package-kit/src/packageKit.js';
import { createTempRoot } from '../helpers/temp.js';

describe('@moorline/package-kit', () => {
  it('bundles and validates api-adapter packages as first-class installables', async () => {
    const sourceDir = createTempRoot('moorline-package-kit-api-adapter-');
    const outDir = join(sourceDir, 'bundle');
    writeFileSync(
      join(sourceDir, 'manifest.json'),
      JSON.stringify(
        {
          id: 'acme/http-adapter',
          name: 'acme/http-adapter',
          version: '0.0.1',
          type: 'api-adapter',
          description: 'Test HTTP adapter.',
          entrypoint: 'index.mjs',
          configSchema: {
            type: 'object',
            properties: {
              host: {
                type: 'string'
              }
            }
          }
        },
        null,
        2
      ),
      'utf8'
    );
    writeFileSync(
      join(sourceDir, 'moorline.dist.json'),
      JSON.stringify(
        {
          schemaVersion: 1,
          display: {
            name: 'Acme HTTP Adapter',
            description: 'Test HTTP adapter.',
            version: '0.0.1',
            tags: ['http']
          }
        },
        null,
        2
      ),
      'utf8'
    );
    writeFileSync(
      join(sourceDir, 'runtimePackage.js'),
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

    const bundled = await bundlePackage({
      sourceDir,
      outDir,
      surface: 'api-adapter'
    });

    expect(bundled.surface).toBe('api-adapter');
    expect(readFileSync(join(outDir, 'manifest.json'), 'utf8')).toContain('acme/http-adapter');
    await expect(validatePackagePath({ path: outDir, surface: 'api-adapter' })).resolves.toMatchObject({
      surface: 'api-adapter',
      mode: 'bundle'
    });
  });

  it('bundles, validates, and inspects installable source packages', async () => {
    const sourceDir = createTempRoot('moorline-package-kit-source-');
    const outDir = join(sourceDir, 'dist-bundle');
    writeFileSync(
      join(sourceDir, 'manifest.json'),
      JSON.stringify(
        {
          id: 'acme/test-provider',
          name: 'acme/test-provider',
          version: '0.0.1',
          type: 'provider',
          description: 'Test provider.',
          entrypoint: 'index.mjs'
        },
        null,
        2
      ),
      'utf8'
    );
    writeFileSync(
      join(sourceDir, 'moorline.dist.json'),
      JSON.stringify(
        {
          schemaVersion: 1,
          name: 'Acme Test Provider',
          description: 'Test provider.',
          version: '0.0.1'
        },
        null,
        2
      ),
      'utf8'
    );
    writeFileSync(
      join(sourceDir, 'runtimePackage.js'),
      [
        "import manifest from './manifest.json' with { type: 'json' };",
        'export default {',
        '  manifest,',
        '  createProviderFactory() {',
        '    return () => ({ ok: true });',
        '  }',
        '};'
      ].join('\n'),
      'utf8'
    );
    writeFileSync(join(sourceDir, 'system-prompt.md'), 'Test prompt.\n', 'utf8');
    writeFileSync(
      join(sourceDir, 'package.json'),
      JSON.stringify(
        {
          name: '@acme/test-provider',
          type: 'module',
          main: './dist/index.js'
        },
        null,
        2
      ),
      'utf8'
    );
    writeFileSync(
      join(sourceDir, 'tsconfig.json'),
      JSON.stringify(
        {
          extends: '../../tsconfig.json'
        },
        null,
        2
      ),
      'utf8'
    );

    const bundled = await bundlePackage({
      sourceDir,
      outDir,
      archive: true
    });

    expect(bundled.surface).toBe('provider');
    expect(readFileSync(join(outDir, 'manifest.json'), 'utf8')).toContain('acme/test-provider');
    expect(readFileSync(join(outDir, 'moorline.dist.json'), 'utf8')).toContain('Acme Test Provider');
    expect(readFileSync(join(outDir, 'system-prompt.md'), 'utf8')).toContain('Test prompt');
    expect(existsSync(join(outDir, 'package.json'))).toBe(false);
    expect(existsSync(join(outDir, 'tsconfig.json'))).toBe(false);
    expect(bundled.archivePath).toMatch(/\.tar\.gz$/);

    const validated = await validatePackagePath({ path: outDir });
    expect(validated.mode).toBe('bundle');
    expect(validated.manifest.id).toBe('acme/test-provider');

    const inspected = await inspectPackagePath({ path: outDir });
    expect(inspected.distro.display.name).toBe('Acme Test Provider');
  });

  it('bundles source packages with an index.mjs wrapper without shipping TypeScript implementation files', async () => {
    const sourceDir = createTempRoot('moorline-package-kit-mixed-source-');
    const outDir = join(sourceDir, 'bundle');
    writeFileSync(
      join(sourceDir, 'manifest.json'),
      JSON.stringify(
        {
          id: 'acme/mixed-plugin',
          name: 'acme/mixed-plugin',
          version: '0.0.1',
          type: 'plugin',
          description: 'Plugin with a source marker and implementation helpers.',
          entrypoint: 'index.mjs',
          capabilities: ['runtime.control']
        },
        null,
        2
      ),
      'utf8'
    );
    writeFileSync(
      join(sourceDir, 'moorline.dist.json'),
      JSON.stringify(
        {
          schemaVersion: 1,
          name: 'Acme Mixed Plugin',
          description: 'Plugin with a source marker and implementation helpers.',
          version: '0.0.1'
        },
        null,
        2
      ),
      'utf8'
    );
    writeFileSync(
      join(sourceDir, 'runtimePackage.ts'),
      [
        "import manifest from './manifest.json' with { type: 'json' };",
        'export default {',
        '  id: manifest.id,',
        '  manifest',
        '};'
      ].join('\n'),
      'utf8'
    );
    writeFileSync(
      join(sourceDir, 'index.mjs'),
      [
        "import manifest from './manifest.json' with { type: 'json' };",
        'export default {',
        '  id: manifest.id,',
        '  manifest',
        '};'
      ].join('\n'),
      'utf8'
    );
    writeFileSync(join(sourceDir, 'server.ts'), 'export const server = true;\n', 'utf8');

    const sourceValidation = await validatePackagePath({ path: sourceDir, surface: 'plugin' });
    expect(sourceValidation.mode).toBe('source');

    await bundlePackage({
      sourceDir,
      outDir,
      surface: 'plugin'
    });

    expect(existsSync(join(outDir, 'server.ts'))).toBe(false);
    const bundleValidation = await validatePackagePath({ path: outDir, surface: 'plugin' });
    expect(bundleValidation.mode).toBe('bundle');
  });

  it('bundles skill add-ons without a JavaScript entrypoint', async () => {
    const sourceDir = createTempRoot('moorline-package-kit-skill-');
    const outDir = join(sourceDir, 'bundle');
    mkdirSync(join(sourceDir, 'skills', 'triage'), { recursive: true });
    writeFileSync(
      join(sourceDir, 'manifest.json'),
      JSON.stringify(
        {
          id: 'acme/triage-skills',
          name: 'acme/triage-skills',
          version: '0.0.1',
          type: 'skill',
          description: 'Triage skill pack.',
          skillsRoot: 'skills'
        },
        null,
        2
      ),
      'utf8'
    );
    writeFileSync(
      join(sourceDir, 'moorline.dist.json'),
      JSON.stringify(
        {
          schemaVersion: 1,
          name: 'Acme Triage Skills',
          description: 'Triage skill pack.',
          version: '0.0.1'
        },
        null,
        2
      ),
      'utf8'
    );
    writeFileSync(join(sourceDir, 'skills', 'triage', 'SKILL.md'), '# Triage\n\nUse this skill.\n', 'utf8');

    const bundled = await bundlePackage({
      sourceDir,
      outDir
    });

    expect(bundled.surface).toBe('skill');
    expect(readFileSync(join(outDir, 'skills', 'triage', 'SKILL.md'), 'utf8')).toContain('Use this skill');
    const validated = await validatePackagePath({ path: outDir, surface: 'skill' });
    expect(validated.surface).toBe('skill');
  });

  it('rejects non-semver package versions and bundle member ranges', async () => {
    const sourceDir = createTempRoot('moorline-package-kit-invalid-semver-');
    const outDir = join(sourceDir, 'bundle');
    writeFileSync(
      join(sourceDir, 'manifest.json'),
      JSON.stringify(
        {
          id: 'acme/defaults',
          name: 'acme/defaults',
          version: 'banana',
          type: 'bundle',
          description: 'Invalid defaults.',
          members: [
            {
              kind: 'plugin',
              packageId: 'acme/plugin',
              version: 'not a range',
              activation: 'install'
            }
          ]
        },
        null,
        2
      ),
      'utf8'
    );
    writeFileSync(
      join(sourceDir, 'moorline.dist.json'),
      JSON.stringify(
        {
          schemaVersion: 1,
          name: 'Invalid Defaults',
          description: 'Invalid defaults.',
          version: '0.0.1'
        },
        null,
        2
      ),
      'utf8'
    );

    await expect(bundlePackage({ sourceDir, outDir })).rejects.toThrow(/invalid semantic version banana/i);

    const manifest = JSON.parse(readFileSync(join(sourceDir, 'manifest.json'), 'utf8')) as Record<string, unknown>;
    manifest.version = '0.0.1';
    writeFileSync(join(sourceDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

    await expect(bundlePackage({ sourceDir, outDir })).rejects.toThrow(/invalid semantic version range not a range/i);
  });

  it('keeps validate and inspect structural by default, with optional runtime smoke', async () => {
    const bundleDir = createTempRoot('moorline-package-kit-bundle-');
    const markerPath = join(bundleDir, 'executed.txt');
    writeFileSync(
      join(bundleDir, 'manifest.json'),
      JSON.stringify(
        {
          id: 'acme/side-effect-plugin',
          name: 'acme/side-effect-plugin',
          version: '0.0.1',
          type: 'plugin',
          description: 'Plugin with side effect.',
          entrypoint: 'index.mjs',
          capabilities: ['memory.read']
        },
        null,
        2
      ),
      'utf8'
    );
    writeFileSync(
      join(bundleDir, 'moorline.dist.json'),
      JSON.stringify(
        {
          schemaVersion: 1,
          name: 'Acme Side Effect Plugin',
          description: 'Plugin with side effect.',
          version: '0.0.1'
        },
        null,
        2
      ),
      'utf8'
    );
    writeFileSync(
      join(bundleDir, 'index.mjs'),
      `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(markerPath)}, 'executed\\n', 'utf8'); export default { id: 'acme/side-effect-plugin', manifest: ${JSON.stringify({
        id: 'acme/side-effect-plugin',
        name: 'acme/side-effect-plugin',
        version: '0.0.1',
        type: 'plugin',
        description: 'Plugin with side effect.',
        entrypoint: 'index.mjs',
        capabilities: ['memory.read']
      })} };`,
      'utf8'
    );

    await validatePackagePath({ path: bundleDir, surface: 'plugin' });
    expect(existsSync(markerPath)).toBe(false);

    await inspectPackagePath({ path: bundleDir, surface: 'plugin' });
    expect(existsSync(markerPath)).toBe(false);

    await validatePackagePath({ path: bundleDir, surface: 'plugin', runtimeSmoke: true });
    expect(existsSync(markerPath)).toBe(true);
  });

  it('rejects archive validation when tar entries attempt path traversal', async () => {
    const root = createTempRoot('moorline-package-kit-traversal-');
    const bundleDir = join(root, 'bundle');
    mkdirSync(bundleDir, { recursive: true });
    writeFileSync(
      join(bundleDir, 'manifest.json'),
      JSON.stringify(
        {
          id: 'acme/traversal-plugin',
          name: 'acme/traversal-plugin',
          version: '0.0.1',
          type: 'plugin',
          entrypoint: 'index.mjs',
          capabilities: ['memory.read']
        },
        null,
        2
      ),
      'utf8'
    );
    writeFileSync(
      join(bundleDir, 'moorline.dist.json'),
      JSON.stringify(
        {
          schemaVersion: 1,
          name: 'Traversal Plugin',
          description: 'Traversal test',
          version: '0.0.1'
        },
        null,
        2
      ),
      'utf8'
    );
    writeFileSync(join(bundleDir, 'index.mjs'), 'export default {};', 'utf8');
    writeFileSync(join(root, 'outside.txt'), 'do not unpack me', 'utf8');
    const archivePath = join(root, 'bundle.tar.gz');
    await create(
      {
        gzip: true,
        cwd: bundleDir,
        file: archivePath
      },
      ['.', '../outside.txt']
    );

    await expect(validatePackagePath({ path: archivePath })).rejects.toThrow(/must not escape the archive root/i);
  });

  it('rejects archive validation when tar entries contain symlinks', async () => {
    const root = createTempRoot('moorline-package-kit-links-');
    const bundleDir = join(root, 'bundle');
    mkdirSync(bundleDir, { recursive: true });
    writeFileSync(
      join(bundleDir, 'manifest.json'),
      JSON.stringify(
        {
          id: 'acme/link-plugin',
          name: 'acme/link-plugin',
          version: '0.0.1',
          type: 'plugin',
          entrypoint: 'index.mjs',
          capabilities: ['memory.read']
        },
        null,
        2
      ),
      'utf8'
    );
    writeFileSync(
      join(bundleDir, 'moorline.dist.json'),
      JSON.stringify(
        {
          schemaVersion: 1,
          name: 'Link Plugin',
          description: 'Link test',
          version: '0.0.1'
        },
        null,
        2
      ),
      'utf8'
    );
    writeFileSync(join(bundleDir, 'index.mjs'), 'export default {};', 'utf8');
    symlinkSync('/tmp', join(bundleDir, 'unsafe-link'));
    const archivePath = join(root, 'bundle.tar.gz');
    await create(
      {
        gzip: true,
        cwd: bundleDir,
        file: archivePath
      },
      ['.']
    );

    await expect(validatePackagePath({ path: archivePath })).rejects.toThrow(/must not contain links/i);
  });

  it('rejects bundle outputs that would recursively clear a directory containing the source', async () => {
    const root = createTempRoot('moorline-package-kit-outdir-');
    const sourceDir = join(root, 'source');
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(
      join(sourceDir, 'manifest.json'),
      JSON.stringify(
        {
          id: 'acme/safe-output-provider',
          name: 'acme/safe-output-provider',
          version: '0.0.1',
          type: 'provider',
          description: 'OutDir safety test.',
          entrypoint: 'index.mjs'
        },
        null,
        2
      ),
      'utf8'
    );
    writeFileSync(
      join(sourceDir, 'moorline.dist.json'),
      JSON.stringify(
        {
          schemaVersion: 1,
          name: 'Safe Output Provider',
          description: 'OutDir safety test.',
          version: '0.0.1'
        },
        null,
        2
      ),
      'utf8'
    );
    writeFileSync(
      join(sourceDir, 'runtimePackage.js'),
      [
        "import manifest from './manifest.json' with { type: 'json' };",
        'export default {',
        '  manifest,',
        '  createProviderFactory() {',
        '    return () => ({ ok: true });',
        '  }',
        '};'
      ].join('\n'),
      'utf8'
    );

    await expect(
      bundlePackage({
        sourceDir,
        outDir: root
      })
    ).rejects.toThrow(/contains sourceDir/i);
  });
});
