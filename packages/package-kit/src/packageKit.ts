import { build } from 'esbuild';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve, relative, basename, normalize, parse, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import semver from 'semver';
import * as tar from 'tar';
import {
  packageFamilyForKind as contractPackageFamilyForKind,
  type BundlePackageManifest,
  type MoorlineDistroMetadata,
  type PackageKind as ContractPackageKind,
  type ProviderPackageManifest,
  type ResolvedMoorlineDistroMetadata,
  type SkillPackageManifest,
  type TransportPackageManifest,
  validateMoorlineDistroMetadata,
  validateBundlePackageManifest,
  validateProviderPackageManifest,
  validateSkillPackageManifest,
  validateTransportPackageManifest
} from '@moorline/contracts';

type PackageKind = ContractPackageKind | 'api-adapter';
type PackageFamily = ReturnType<typeof contractPackageFamilyForKind> | 'api-adapters';

interface ApiAdapterPackageManifest {
  id: string;
  name: string;
  version: string;
  type: 'api-adapter';
  description?: string;
  entrypoint?: string;
  dependencies?: Array<{
    packageId: string;
    versionRange?: string;
  }>;
  configSchema?: unknown;
}

interface PluginManifest {
  id: string;
  name: string;
  version: string;
  type: 'plugin';
  description?: string;
  entrypoint?: string;
  priority?: number;
  capabilities: string[];
  hooks?: string[];
  defaultEnabled?: boolean;
  dependencies?: Array<{
    packageId: string;
    versionRange?: string;
  }>;
  configSchema?: unknown;
  displayCategory?: string;
}

type AnyManifest = ApiAdapterPackageManifest | ProviderPackageManifest | TransportPackageManifest | PluginManifest | SkillPackageManifest | BundlePackageManifest;
type InstallableManifest = ApiAdapterPackageManifest | ProviderPackageManifest | TransportPackageManifest | PluginManifest;

export type { PackageKind };

export interface BundlePackageInput {
  sourceDir: string;
  outDir: string;
  archive?: boolean;
  archiveFormat?: 'tar.gz';
  entry?: string;
  surface?: PackageKind;
  archiveFileName?: string;
  archiveOutDir?: string;
  runtimeSmoke?: boolean;
}

export interface BundlePackageResult {
  surface: PackageKind;
  family: PackageFamily;
  manifest: AnyManifest;
  distro: ResolvedMoorlineDistroMetadata;
  bundleDir: string;
  archivePath?: string;
}

export interface ValidatePackagePathResult {
  surface: PackageKind;
  family: PackageFamily;
  manifest: AnyManifest;
  distro: ResolvedMoorlineDistroMetadata;
  mode: 'source' | 'bundle';
}

export interface NpmPackPackageInput {
  sourceDir: string;
  outDir: string;
  npmName: string;
  access?: 'public';
}

export interface NpmPackPackageResult {
  packageId: string;
  kind: PackageKind;
  version: string;
  npmName: string;
  npmPackageDir: string;
  tarballPath?: string;
}

interface SourcePackageMetadata {
  description?: string;
  license?: string;
  repository?: string | Record<string, string>;
  homepage?: string;
  keywords?: string[];
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

function packageFamilyForKind(kind: PackageKind): PackageFamily {
  return kind === 'api-adapter' ? 'api-adapters' : contractPackageFamilyForKind(kind);
}

function exists(path: string): boolean {
  return existsSync(path);
}

function optionalPackageJsonString(value: unknown, context: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${context} must be a non-empty string when provided.`);
  }
  return value;
}

function optionalPackageJsonRepository(value: unknown): SourcePackageMetadata['repository'] {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === 'string') {
    if (!value.trim()) {
      throw new Error('package.json.repository must be a non-empty string when provided.');
    }
    return value;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('package.json.repository must be a string or object when provided.');
  }
  const raw = value as Record<string, unknown>;
  const repository: Record<string, string> = {};
  for (const key of ['type', 'url', 'directory']) {
    const field = raw[key];
    if (field !== undefined) {
      if (typeof field !== 'string' || !field.trim()) {
        throw new Error(`package.json.repository.${key} must be a non-empty string when provided.`);
      }
      repository[key] = field;
    }
  }
  if (Object.keys(repository).length === 0) {
    throw new Error('package.json.repository must include type, url, or directory when provided.');
  }
  return repository;
}

function readSourcePackageMetadata(sourceDir: string): SourcePackageMetadata {
  const packageJsonPath = join(sourceDir, 'package.json');
  if (!exists(packageJsonPath)) {
    return {};
  }
  const raw = readJson(packageJsonPath);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('package.json must be an object.');
  }
  const packageJson = raw as Record<string, unknown>;
  const description = optionalPackageJsonString(packageJson.description, 'package.json.description');
  const license = optionalPackageJsonString(packageJson.license, 'package.json.license');
  const repository = optionalPackageJsonRepository(packageJson.repository);
  const homepage = optionalPackageJsonString(packageJson.homepage, 'package.json.homepage');
  const keywords = validateStringArray(packageJson.keywords, 'package.json.keywords');
  return {
    ...(description ? { description } : {}),
    ...(license ? { license } : {}),
    ...(repository ? { repository } : {}),
    ...(homepage ? { homepage } : {}),
    ...(keywords ? { keywords } : {})
  };
}

function inferSurfaceFromManifest(manifest: Record<string, unknown>): PackageKind {
  if (manifest.type === 'bundle') {
    return 'bundle';
  }
  if (manifest.type === 'provider') {
    return 'provider';
  }
  if (manifest.type === 'api-adapter') {
    return 'api-adapter';
  }
  if (manifest.type === 'transport') {
    return 'transport';
  }
  if (manifest.type === 'skill') {
    return 'skill';
  }
  return 'plugin';
}

function requireString(input: Record<string, unknown>, key: string, context: string): string {
  const value = input[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${context}.${key} must be a non-empty string.`);
  }
  return value;
}

function optionalString(input: Record<string, unknown>, key: string, context: string): string | undefined {
  const value = input[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${context}.${key} must be a non-empty string when provided.`);
  }
  return value;
}

function validateDependencies(raw: unknown, context: string): ApiAdapterPackageManifest['dependencies'] {
  if (raw === undefined) {
    return undefined;
  }
  if (!Array.isArray(raw)) {
    throw new Error(`${context}.dependencies must be an array when provided.`);
  }
  return raw.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`${context}.dependencies[${index}] must be an object.`);
    }
    const dependency = entry as Record<string, unknown>;
    return {
      packageId: requireString(dependency, 'packageId', `${context}.dependencies[${index}]`),
      ...(optionalString(dependency, 'versionRange', `${context}.dependencies[${index}]`)
        ? { versionRange: optionalString(dependency, 'versionRange', `${context}.dependencies[${index}]`) }
        : {})
    };
  });
}

function validateStringArray(raw: unknown, context: string, required = false): string[] | undefined {
  if (raw === undefined) {
    if (required) {
      throw new Error(`${context} must be an array of strings.`);
    }
    return undefined;
  }
  if (!Array.isArray(raw) || !raw.every((entry) => typeof entry === 'string' && entry.length > 0)) {
    throw new Error(`${context} must be an array of non-empty strings.`);
  }
  return raw;
}

function validateApiAdapterPackageManifest(raw: Record<string, unknown>): ApiAdapterPackageManifest {
  const type = requireString(raw, 'type', 'manifest');
  if (type !== 'api-adapter') {
    throw new Error(`manifest.type must be api-adapter, got ${type}.`);
  }
  return {
    id: requireString(raw, 'id', 'manifest'),
    name: requireString(raw, 'name', 'manifest'),
    version: requireString(raw, 'version', 'manifest'),
    type,
    ...(optionalString(raw, 'description', 'manifest') ? { description: optionalString(raw, 'description', 'manifest') } : {}),
    ...(optionalString(raw, 'entrypoint', 'manifest') ? { entrypoint: optionalString(raw, 'entrypoint', 'manifest') } : {}),
    ...(validateDependencies(raw.dependencies, 'manifest') ? { dependencies: validateDependencies(raw.dependencies, 'manifest') } : {}),
    ...(raw.configSchema !== undefined ? { configSchema: raw.configSchema } : {})
  };
}

function validatePluginManifest(raw: Record<string, unknown>): PluginManifest {
  const type = requireString(raw, 'type', 'manifest');
  if (type !== 'plugin') {
    throw new Error(`manifest.type must be plugin, got ${type}.`);
  }
  const capabilities = validateStringArray(raw.capabilities, 'manifest.capabilities', true) ?? [];
  return {
    id: requireString(raw, 'id', 'manifest'),
    name: requireString(raw, 'name', 'manifest'),
    version: requireString(raw, 'version', 'manifest'),
    type,
    capabilities,
    ...(optionalString(raw, 'description', 'manifest') ? { description: optionalString(raw, 'description', 'manifest') } : {}),
    ...(optionalString(raw, 'entrypoint', 'manifest') ? { entrypoint: optionalString(raw, 'entrypoint', 'manifest') } : {}),
    ...(typeof raw.priority === 'number' ? { priority: raw.priority } : {}),
    ...(typeof raw.defaultEnabled === 'boolean' ? { defaultEnabled: raw.defaultEnabled } : {}),
    ...(validateStringArray(raw.hooks, 'manifest.hooks') ? { hooks: validateStringArray(raw.hooks, 'manifest.hooks') } : {}),
    ...(optionalString(raw, 'displayCategory', 'manifest') ? { displayCategory: optionalString(raw, 'displayCategory', 'manifest') } : {}),
    ...(validateDependencies(raw.dependencies, 'manifest') ? { dependencies: validateDependencies(raw.dependencies, 'manifest') } : {}),
    ...(raw.configSchema !== undefined ? { configSchema: raw.configSchema } : {})
  };
}

function assertValidPackageVersion(input: { packageId: string; version: string | undefined }): void {
  if (!input.version || !semver.valid(input.version)) {
    throw new Error(`Package ${input.packageId} has invalid semantic version ${input.version ?? '<missing>'}.`);
  }
}

function assertValidPackageRange(input: { packageId: string; range: string | undefined }): void {
  if (!input.range) {
    throw new Error(`Package ${input.packageId} has invalid semantic version range <missing>.`);
  }
  if (input.range === 'latest' || input.range === 'stable') {
    return;
  }
  if (!semver.validRange(input.range)) {
    throw new Error(`Package ${input.packageId} has invalid semantic version range ${input.range}.`);
  }
}

function validateManifestVersions(manifest: AnyManifest): void {
  assertValidPackageVersion({ packageId: manifest.id, version: manifest.version });
  for (const dependency of 'dependencies' in manifest ? manifest.dependencies ?? [] : []) {
    if (dependency.versionRange) {
      assertValidPackageRange({ packageId: dependency.packageId, range: dependency.versionRange });
    }
  }
  if ('members' in manifest) {
    for (const member of manifest.members) {
      assertValidPackageRange({ packageId: member.packageId, range: member.version });
    }
  }
}

function loadManifest(surfaceHint: PackageKind | undefined, packageDir: string): { surface: PackageKind; manifest: AnyManifest } {
  const raw = readJson(join(packageDir, 'manifest.json')) as Record<string, unknown>;
  const surface = surfaceHint ?? inferSurfaceFromManifest(raw);
  let manifest: AnyManifest;
  switch (surface) {
    case 'api-adapter':
      manifest = validateApiAdapterPackageManifest(raw);
      break;
    case 'provider':
      manifest = validateProviderPackageManifest(raw as unknown as ProviderPackageManifest);
      break;
    case 'transport':
      manifest = validateTransportPackageManifest(raw as unknown as TransportPackageManifest);
      break;
    case 'skill':
      manifest = validateSkillPackageManifest(raw as unknown as SkillPackageManifest);
      break;
    case 'plugin':
      manifest = validatePluginManifest(raw);
      break;
    case 'bundle':
      manifest = validateBundlePackageManifest(raw as unknown as BundlePackageManifest);
      break;
  }
  validateManifestVersions(manifest);
  return { surface, manifest };
}

function resolveDistro(packageDir: string, manifest: AnyManifest): ResolvedMoorlineDistroMetadata {
  const raw = readJson(join(packageDir, 'moorline.dist.json')) as MoorlineDistroMetadata;
  validateMoorlineDistroMetadata(raw);
  const display = {
    ...(raw.display ?? {}),
    name: raw.display?.name ?? raw.name ?? manifest.name,
    description: raw.display?.description ?? raw.description ?? manifest.description ?? '',
    version: raw.display?.version ?? raw.version ?? manifest.version
  };
  if (!display.name || !display.description || !display.version) {
    throw new Error(`Resolved distro metadata is missing required fields in ${packageDir}`);
  }
  return {
    ...raw,
    display
  };
}

function findSourceEntrypoint(sourceDir: string, manifest: InstallableManifest, explicit?: string): string {
  const candidates = [
    explicit,
    'src/runtimePackage.ts',
    'src/runtimePackage.js',
    'src/index.ts',
    'src/index.js',
    'runtimePackage.ts',
    'runtimePackage.js',
    manifest.entrypoint,
    'index.ts',
    'index.js',
    'index.mjs'
  ].filter((entry): entry is string => Boolean(entry));
  for (const candidate of candidates) {
    const path = resolve(sourceDir, candidate);
    if (exists(path)) {
      return path;
    }
  }
  throw new Error(`Unable to resolve a source entrypoint for ${sourceDir}`);
}

function copyStaticAssets(sourceDir: string, outputDir: string): void {
  const stack = [sourceDir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const sourcePath = join(current, entry.name);
      const rel = relative(sourceDir, sourcePath);
      const targetPath = join(outputDir, rel);
      if (entry.isDirectory()) {
        if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'dist') {
          continue;
        }
        stack.push(sourcePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (entry.name === 'manifest.json' || entry.name === 'moorline.dist.json') {
        continue;
      }
      if (
        entry.name === 'package.json' ||
        entry.name === 'package-lock.json' ||
        entry.name === 'bun.lock' ||
        entry.name === 'tsconfig.json' ||
        /^tsconfig\..+\.json$/u.test(entry.name)
      ) {
        continue;
      }
      if (/\.(?:[cm]?js|tsx?|d\.ts)$/u.test(entry.name)) {
        continue;
      }
      mkdirSync(dirname(targetPath), { recursive: true });
      cpSync(sourcePath, targetPath);
    }
  }
}

function writeOfficialHttpDeclarations(outDir: string): void {
  writeFileSync(
    join(outDir, 'index.d.ts'),
    [
      'export interface RuntimeApiEndpoint {',
      "  protocol: 'http';",
      '  url: string;',
      '  token?: string;',
      '  metadata?: Record<string, unknown>;',
      '}',
      'export interface RuntimeApiAdapter {',
      '  start(): Promise<{ endpoints: RuntimeApiEndpoint[] }>;',
      '  stop(): Promise<void>;',
      '}',
      'export interface RuntimeApiAdapterContext {',
      '  host: string;',
      '  port: number;',
      '  config: Record<string, unknown>;',
      '  configPath?: string;',
      '  entrypoint: string;',
      '}',
      'export interface RuntimeApiAdapterPackage {',
      '  manifest: unknown;',
      '  createAdapter(input: RuntimeApiAdapterContext): RuntimeApiAdapter;',
      '}',
      'export interface HttpAdapterInput {',
      '  host: string;',
      '  port: number;',
      '  config: Record<string, unknown>;',
      '  configPath?: string;',
      '  entrypoint: string;',
      '}',
      'export declare function createAdapter(input: HttpAdapterInput): RuntimeApiAdapter;',
      'export declare function runHttpAdapter(input: HttpAdapterInput & { waitForShutdown?: () => Promise<void> }): Promise<RuntimeApiAdapter>;',
      'export declare class ControlApiServer {',
      '  constructor(options: HttpAdapterInput);',
      '  start(): Promise<void>;',
      '  stop(): Promise<void>;',
      '  getUrl(): string | null;',
      '  getApiToken(): string;',
      '}',
      'declare const runtimePackage: RuntimeApiAdapterPackage;',
      'export default runtimePackage;',
      ''
    ].join('\n'),
    'utf8'
  );
  writeFileSync(
    join(outDir, 'server.d.ts'),
    [
      "export { ControlApiServer } from './index.mjs';",
      ''
    ].join('\n'),
    'utf8'
  );
}

function copyOfficialHttpRuntimeAssets(sourceDir: string, outDir: string, manifest: AnyManifest): void {
  if (manifest.id !== 'official/http') {
    return;
  }
  const resourcesRoot = resolve(sourceDir, '..', 'core', 'resources');
  if (existsSync(resourcesRoot)) {
    cpSync(resourcesRoot, join(outDir, 'resources'), { recursive: true });
  }
  writeFileSync(join(outDir, 'server.mjs'), "export { ControlApiServer } from './index.mjs';\n", 'utf8');
  writeOfficialHttpDeclarations(outDir);
}

function assertNoTypeScriptSources(dir: string): void {
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const child = join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') {
          continue;
        }
        stack.push(child);
        continue;
      }
      if (entry.isFile() && /\.tsx?$/u.test(entry.name) && !/\.d\.ts$/u.test(entry.name)) {
        throw new Error(`Installable bundles must not include raw TypeScript source files: ${child}`);
      }
    }
  }
}

async function validateBuiltBundle(bundleDir: string, surface: PackageKind, runtimeSmoke = true): Promise<void> {
  const { manifest } = loadManifest(surface, bundleDir);
  resolveDistro(bundleDir, manifest);
  if (surface === 'skill') {
    const skillManifest = manifest as SkillPackageManifest;
    const skillsRoot = join(bundleDir, skillManifest.skillsRoot ?? 'skills');
    if (!exists(skillsRoot)) {
      throw new Error(`Skill bundle ${manifest.id} is missing skills root ${skillManifest.skillsRoot ?? 'skills'}`);
    }
    return;
  }
  if (surface === 'bundle') {
    return;
  }
  assertNoTypeScriptSources(bundleDir);
  const installableManifest = manifest as InstallableManifest;
  const entrypoint = join(bundleDir, installableManifest.entrypoint ?? 'index.mjs');
  if (!exists(entrypoint)) {
    throw new Error(`Bundle ${manifest.id} is missing entrypoint ${installableManifest.entrypoint ?? 'index.mjs'}`);
  }
  if (runtimeSmoke) {
    await import(pathToFileURL(entrypoint).href);
  }
}

async function extractArchive(archivePath: string, targetDir: string): Promise<void> {
  if (archivePath.endsWith('.tar.gz') || archivePath.endsWith('.tgz')) {
    const normalizeEntryPath = (entryPath: string): string => {
      const normalized = normalize(entryPath).replaceAll('\\', '/');
      if (!normalized || normalized === '.' || normalized === './') {
        return '';
      }
      if (normalized.startsWith('/') || /^[A-Za-z]:/u.test(normalized)) {
        throw new Error(`Archive entry must not be absolute: ${entryPath}`);
      }
      const segments = normalized.split('/').filter(Boolean);
      if (segments.some((segment) => segment === '..')) {
        throw new Error(`Archive entry must not escape the archive root: ${entryPath}`);
      }
      return segments.join('/');
    };

    let archiveValidationError: Error | null = null;
    await tar.list({
      file: archivePath,
      onReadEntry(entry: tar.ReadEntry) {
        if (archiveValidationError) {
          return;
        }
        try {
          normalizeEntryPath(entry.path);
          if (entry.type === 'SymbolicLink' || entry.type === 'Link') {
            archiveValidationError = new Error(`Archive must not contain links: ${entry.path}`);
          }
        } catch (error) {
          archiveValidationError = error instanceof Error ? error : new Error(String(error));
        }
      }
    });
    if (archiveValidationError) {
      throw archiveValidationError;
    }

    await tar.x({
      file: archivePath,
      cwd: targetDir,
      filter: (entryPath, entry) => {
        normalizeEntryPath(entryPath);
        if ('type' in entry && (entry.type === 'SymbolicLink' || entry.type === 'Link')) {
          throw new Error(`Archive must not contain links: ${entryPath}`);
        }
        return true;
      }
    });
    return;
  }
  throw new Error(`Unsupported archive format: ${archivePath}`);
}

function findBundleRoot(rootDir: string): string {
  const stack = [rootDir];
  const matches: string[] = [];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    const stat = statSync(current, { throwIfNoEntry: false });
    if (!stat?.isDirectory()) {
      continue;
    }
    if (exists(join(current, 'manifest.json'))) {
      matches.push(current);
      continue;
    }
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === '.git' || entry.name === 'node_modules') {
        continue;
      }
      stack.push(join(current, entry.name));
    }
  }
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one Moorline bundle root in ${rootDir}, found ${matches.length}`);
  }
  return matches[0];
}

async function createTarGz(sourceDir: string, archivePath: string): Promise<void> {
  const tar = await import('tar');
  mkdirSync(dirname(archivePath), { recursive: true });
  await tar.create(
    {
      gzip: true,
      cwd: dirname(sourceDir),
      file: archivePath
    },
    [basename(sourceDir)]
  );
}

async function createNpmTgz(sourceDir: string, archivePath: string): Promise<void> {
  const tar = await import('tar');
  mkdirSync(dirname(archivePath), { recursive: true });
  await tar.create(
    {
      gzip: true,
      cwd: sourceDir,
      file: archivePath,
      prefix: 'package/'
    },
    ['.']
  );
}

function assertScopedNpmName(npmName: string): void {
  if (!/^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/u.test(npmName)) {
    throw new Error(`Moorline npm packages must use a scoped npm name such as @scope/name: ${npmName}`);
  }
}

function npmKeywordSafe(value: string): string | null {
  const normalized = value.toLowerCase().trim().replace(/[^a-z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '');
  return normalized ? normalized.slice(0, 64) : null;
}

function packageIdKeyword(packageId: string): string {
  return `moorline-id-${packageId.replace('/', '-')}`;
}

function npmTarballName(npmName: string, version: string): string {
  return `${npmName.replace(/^@/u, '').replace('/', '-')}-${version}.tgz`;
}

function npmPackagePath(outDir: string, npmName: string): string {
  const [scope, name] = npmName.split('/');
  return join(outDir, scope!, name!);
}

function generatedPackageJson(input: {
  npmName: string;
  manifest: AnyManifest;
  surface: PackageKind;
  distro: ResolvedMoorlineDistroMetadata;
  sourcePackage?: SourcePackageMetadata;
}): Record<string, unknown> {
  const namespace = input.manifest.id.split('/')[0]!;
  const distroTags = input.distro.display.tags ?? [];
  const sourceKeywords = input.sourcePackage?.keywords ?? [];
  const description = input.sourcePackage?.description ?? input.distro.display.description;
  const license = input.sourcePackage?.license ?? input.distro.display.license ?? 'UNLICENSED';
  const homepage = input.sourcePackage?.homepage ?? input.distro.display.homepageUrl;
  const keywords = [
    'moorline-package',
    `moorline-kind-${input.surface}`,
    `moorline-namespace-${namespace}`,
    packageIdKeyword(input.manifest.id),
    ...sourceKeywords.map((keyword) => npmKeywordSafe(keyword)).filter((keyword): keyword is string => Boolean(keyword)),
    ...distroTags.map((tag) => npmKeywordSafe(tag)).filter((tag): tag is string => Boolean(tag))
  ];
  const runtimeEntrypoint =
    input.manifest.id === 'official/http'
      ? {
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
          }
        }
      : {
          main: './index.mjs',
          exports: {
            '.': './index.mjs'
          }
        };
  return {
    name: input.npmName,
    version: input.manifest.version,
    description,
    license,
    type: 'module',
    ...(['bundle', 'skill'].includes(input.surface) ? {} : runtimeEntrypoint),
    ...(input.sourcePackage?.repository ? { repository: input.sourcePackage.repository } : {}),
    ...(homepage ? { homepage } : {}),
    publishConfig: {
      access: 'public'
    },
    keywords: [...new Set(keywords)],
    moorline: {
      schemaVersion: 1,
      packageId: input.manifest.id,
      kind: input.surface,
      manifestPath: 'manifest.json',
      distroPath: 'moorline.dist.json'
    }
  };
}

function validateGeneratedNpmPackageJson(packageJson: Record<string, unknown>, manifest: AnyManifest, surface: PackageKind): void {
  if (typeof packageJson.name !== 'string') {
    throw new Error('Generated package.json.name must be a string.');
  }
  assertScopedNpmName(packageJson.name);
  if (packageJson.version !== manifest.version) {
    throw new Error('Generated package.json version must match manifest.json version.');
  }
  if ('dependencies' in packageJson) {
    throw new Error('Moorline npm packages must not use npm dependencies for package resolution.');
  }
  const scripts = packageJson.scripts;
  if (scripts && typeof scripts === 'object') {
    const forbidden = ['preinstall', 'install', 'postinstall', 'prepare', 'prepublish', 'prepublishOnly'];
    for (const name of forbidden) {
      if (name in scripts) {
        throw new Error(`Moorline npm packages must not define lifecycle script ${name}.`);
      }
    }
  }
  const moorline = packageJson.moorline as Record<string, unknown> | undefined;
  if (!moorline || moorline.schemaVersion !== 1 || moorline.packageId !== manifest.id || moorline.kind !== surface) {
    throw new Error('Generated package.json.moorline metadata does not match the Moorline manifest.');
  }
  const keywords = packageJson.keywords;
  if (!Array.isArray(keywords) || !keywords.every((entry) => typeof entry === 'string')) {
    throw new Error('Generated package.json.keywords must be a string array.');
  }
  const namespace = manifest.id.split('/')[0]!;
  for (const keyword of ['moorline-package', `moorline-kind-${surface}`, `moorline-namespace-${namespace}`, packageIdKeyword(manifest.id)]) {
    if (!keywords.includes(keyword)) {
      throw new Error(`Generated package.json.keywords is missing ${keyword}.`);
    }
  }
}

function detectValidationMode(path: string, surface: PackageKind): 'source' | 'bundle' {
  if (surface === 'skill') {
    return exists(join(path, 'skills')) ? 'bundle' : 'source';
  }
  if (surface === 'bundle') {
    return 'bundle';
  }
  if (
    exists(join(path, 'src', 'runtimePackage.ts')) ||
    exists(join(path, 'src', 'runtimePackage.js')) ||
    exists(join(path, 'runtimePackage.ts')) ||
    exists(join(path, 'runtimePackage.js')) ||
    exists(join(path, 'index.ts')) ||
    exists(join(path, 'index.js'))
  ) {
    return 'source';
  }
  if (exists(join(path, 'index.mjs'))) {
    return 'bundle';
  }
  return 'source';
}

function pathContains(basePath: string, candidatePath: string): boolean {
  const rel = relative(basePath, candidatePath);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function assertSafeBundleOutputDir(input: { sourceDir: string; outDir: string }): void {
  const root = parse(input.outDir).root;
  if (input.outDir === root) {
    throw new Error(`Refusing to use filesystem root as outDir: ${input.outDir}`);
  }
  if (pathContains(input.outDir, input.sourceDir)) {
    throw new Error(
      `Refusing to clear outDir ${input.outDir} because it contains sourceDir ${input.sourceDir}. Choose a different output directory.`
    );
  }
}

export async function bundlePackage(input: BundlePackageInput): Promise<BundlePackageResult> {
  const sourceDir = resolve(input.sourceDir);
  const outDir = resolve(input.outDir);
  assertSafeBundleOutputDir({ sourceDir, outDir });
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const { surface, manifest } = loadManifest(input.surface, sourceDir);
  const distro = resolveDistro(sourceDir, manifest);

  if (surface === 'skill') {
    const skillManifest = manifest as SkillPackageManifest;
    const skillsRoot = resolve(sourceDir, skillManifest.skillsRoot ?? 'skills');
    if (!exists(skillsRoot)) {
      throw new Error(`Skill package ${manifest.id} is missing skills root ${skillManifest.skillsRoot ?? 'skills'}`);
    }
    cpSync(join(sourceDir, 'manifest.json'), join(outDir, 'manifest.json'));
    cpSync(join(sourceDir, 'moorline.dist.json'), join(outDir, 'moorline.dist.json'));
    cpSync(skillsRoot, join(outDir, skillManifest.skillsRoot ?? 'skills'), { recursive: true });
  } else if (surface === 'bundle') {
    cpSync(join(sourceDir, 'manifest.json'), join(outDir, 'manifest.json'));
    cpSync(join(sourceDir, 'moorline.dist.json'), join(outDir, 'moorline.dist.json'));
  } else {
    const sourceEntry = findSourceEntrypoint(sourceDir, manifest as InstallableManifest, input.entry);
    await build({
      entryPoints: [sourceEntry],
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: ['node22'],
      outfile: join(outDir, 'index.mjs'),
      sourcemap: false,
      packages: 'bundle',
      banner: {
        js: "import { createRequire as __moorlineCreateRequire } from 'node:module'; const require = __moorlineCreateRequire(import.meta.url);"
      }
    });
    cpSync(join(sourceDir, 'manifest.json'), join(outDir, 'manifest.json'));
    cpSync(join(sourceDir, 'moorline.dist.json'), join(outDir, 'moorline.dist.json'));
    copyStaticAssets(sourceDir, outDir);
    copyOfficialHttpRuntimeAssets(sourceDir, outDir, manifest);
  }

  await validateBuiltBundle(outDir, surface, input.runtimeSmoke ?? true);

  let archivePath: string | undefined;
  if (input.archive) {
    if ((input.archiveFormat ?? 'tar.gz') !== 'tar.gz') {
      throw new Error(`Unsupported archive format: ${input.archiveFormat}`);
    }
    const archiveRoot = resolve(input.archiveOutDir ?? dirname(outDir));
    archivePath = resolve(join(archiveRoot, input.archiveFileName ?? `${manifest.id.split('/').join('-')}-${manifest.version}.tar.gz`));
    await createTarGz(outDir, archivePath);
  }

  return {
    surface,
    family: packageFamilyForKind(surface),
    manifest,
    distro,
    bundleDir: outDir,
    ...(archivePath ? { archivePath } : {})
  };
}

export async function npmPackPackage(input: NpmPackPackageInput): Promise<NpmPackPackageResult> {
  assertScopedNpmName(input.npmName);
  if (input.access && input.access !== 'public') {
    throw new Error(`Unsupported npm access mode: ${input.access}`);
  }
  const sourceDir = resolve(input.sourceDir);
  const outDir = resolve(input.outDir);
  const bundleDir = join(outDir, '.moorline-bundle-work', input.npmName.replace(/^@/u, '').replace('/', '-'));
  const sourcePackage = readSourcePackageMetadata(sourceDir);
  const bundled = await bundlePackage({
    sourceDir,
    outDir: bundleDir,
    runtimeSmoke: false
  });
  const npmPackageDir = npmPackagePath(outDir, input.npmName);
  rmSync(npmPackageDir, { recursive: true, force: true });
  mkdirSync(dirname(npmPackageDir), { recursive: true });
  cpSync(bundled.bundleDir, npmPackageDir, { recursive: true });
  const packageJson = generatedPackageJson({
    npmName: input.npmName,
    manifest: bundled.manifest,
    surface: bundled.surface,
    distro: bundled.distro,
    sourcePackage
  });
  validateGeneratedNpmPackageJson(packageJson, bundled.manifest, bundled.surface);
  writeFileSync(join(npmPackageDir, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
  await validatePackagePath({ path: npmPackageDir, surface: bundled.surface });
  const tarballPath = join(outDir, '..', 'npm-tarballs', npmTarballName(input.npmName, bundled.manifest.version));
  await createNpmTgz(npmPackageDir, tarballPath);
  rmSync(join(outDir, '.moorline-bundle-work'), { recursive: true, force: true });
  return {
    packageId: bundled.manifest.id,
    kind: bundled.surface,
    version: bundled.manifest.version,
    npmName: input.npmName,
    npmPackageDir,
    tarballPath
  };
}

export async function validatePackagePath(input: {
  path: string;
  surface?: PackageKind;
  runtimeSmoke?: boolean;
}): Promise<ValidatePackagePathResult> {
  const resolvedPath = resolve(input.path);
  const tempRoot = mkdtempSync(join(tmpdir(), 'moorline-package-kit-'));
  try {
    let packageDir = resolvedPath;
    const stat = statSync(resolvedPath, { throwIfNoEntry: false });
    if (!stat) {
      throw new Error(`Package path does not exist: ${resolvedPath}`);
    }
    if (stat.isFile()) {
      await extractArchive(resolvedPath, tempRoot);
      packageDir = findBundleRoot(tempRoot);
    }
    const { surface, manifest } = loadManifest(input.surface, packageDir);
    const distro = resolveDistro(packageDir, manifest);
    const mode = detectValidationMode(packageDir, surface);
    if (mode === 'bundle') {
      const { manifest: bundleManifest } = loadManifest(surface, packageDir);
      resolveDistro(packageDir, bundleManifest);
      if (surface === 'skill') {
        const skillManifest = bundleManifest as SkillPackageManifest;
        const skillsRoot = join(packageDir, skillManifest.skillsRoot ?? 'skills');
        if (!exists(skillsRoot)) {
          throw new Error(`Skill bundle ${bundleManifest.id} is missing skills root ${skillManifest.skillsRoot ?? 'skills'}`);
        }
      } else if (surface === 'bundle') {
        // Bundle packages are metadata-only; the validated manifest is the runtime contract.
      } else {
        assertNoTypeScriptSources(packageDir);
        const installableManifest = bundleManifest as InstallableManifest;
        const entrypoint = join(packageDir, installableManifest.entrypoint ?? 'index.mjs');
        if (!exists(entrypoint)) {
          throw new Error(`Bundle ${bundleManifest.id} is missing entrypoint ${installableManifest.entrypoint ?? 'index.mjs'}`);
        }
        if (input.runtimeSmoke) {
          await import(pathToFileURL(entrypoint).href);
        }
      }
    } else if (surface === 'skill') {
      const skillManifest = manifest as SkillPackageManifest;
      const skillsRoot = resolve(packageDir, skillManifest.skillsRoot ?? 'skills');
      if (!exists(skillsRoot)) {
        throw new Error(`Skill package ${manifest.id} is missing skills root ${skillManifest.skillsRoot ?? 'skills'}`);
      }
    } else if (surface !== 'bundle') {
      findSourceEntrypoint(packageDir, manifest as InstallableManifest);
    }
    return {
      surface,
      family: packageFamilyForKind(surface),
      manifest,
      distro,
      mode
    };
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

export async function inspectPackagePath(input: {
  path: string;
  surface?: PackageKind;
}): Promise<{
  surface: PackageKind;
  family: PackageFamily;
  manifest: AnyManifest;
  distro: ResolvedMoorlineDistroMetadata;
  fingerprint: string;
}> {
  const validation = await validatePackagePath(input);
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({
      id: validation.manifest.id,
      version: validation.manifest.version,
      surface: validation.surface
    }))
    .digest('hex');
  return {
    ...validation,
    fingerprint
  };
}
