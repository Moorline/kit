import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const legacyRepoSlug = [`Ryz${'on3'}`, 'Moorline'].join('/');

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

describe('package-kit repository contract', () => {
  it('contains only the package-kit workspace package', () => {
    expect(readdirSync(join(root, 'packages')).sort()).toEqual(['package-kit']);
  });

  it('keeps the workspace private and points at the kit repo', () => {
    const pkg = readJson(join(root, 'package.json'));
    expect(pkg.private).toBe(true);
    expect(pkg.license).toBe('MIT');
    expect(pkg.repository).toMatchObject({
      url: 'git+ssh://git@github.com/Moorline/kit.git'
    });
  });

  it('keeps the package-kit npm package name and released contracts dependency', () => {
    const pkg = readJson(join(root, 'packages', 'package-kit', 'package.json'));
    expect(pkg.name).toBe('@moorline/package-kit');
    expect(pkg.license).toBe('MIT');
    expect((pkg.dependencies as Record<string, string>)['@moorline/contracts']).toBe('0.0.2');
  });

  it('keeps release automation manual and non-publishing', () => {
    const workflow = readFileSync(join(root, '.github', 'workflows', 'release.yml'), 'utf8');
    expect(workflow).toContain('workflow_dispatch');
    expect(workflow).not.toContain('tags:');
    expect(workflow).not.toContain('npm publish');
    expect(workflow).not.toContain('softprops/action-gh-release');
  });

  it('keeps public docs pointed at the Moorline org', () => {
    const docs = readFileSync(join(root, 'docs', 'PACKAGE_AUTHORING.md'), 'utf8');
    expect(docs).not.toContain(legacyRepoSlug);
  });
});
