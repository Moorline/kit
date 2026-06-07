# Package Authoring

This guide is for developers who want to create Moorline packages for other users or teams.

Canonical naming:
- [TERMINOLOGY.md](./TERMINOLOGY.md)

## What You Can Build

Moorline supports two package families:

- installables
  - API adapters
  - providers
  - transports
  - plugins
- add-ons
  - skills
- bundles
  - metadata-only packages that install and activate a declared set of other packages

The practical difference is:

- installables are executable packages and must be shipped as finished bundles
- skill add-ons are content packages and stay simpler
- bundle packages contain package membership metadata and no runtime JavaScript

## The Short Version

If you are building a third-party package today:

1. Create your package source folder.
2. Add `manifest.json`.
3. Add `moorline.dist.json`.
4. Write the runtime code or skill content.
5. Build a finished bundle with `@moorline/package-kit`.
6. Test that bundle locally with `moorline configure package install ...`.
7. Ship either:
   - the finished directory bundle for local development
   - a `.tar.gz` archive for normal user installs

Important:

- you do not need the Moorline repo locally
- third-party authors should use `npx @moorline/package-kit`
- users should install finished bundles, not raw source trees
- packages run inside the operator-controlled Moorline runtime once activated

## Two Required Files

Every third-party package needs both of these files:

- `manifest.json`
- `moorline.dist.json`

They do different jobs.

Some fields overlap by design. In particular, `name`, `description`, and `version` may appear in both files because Moorline keeps runtime loading metadata separate from distribution and catalog metadata.

### `manifest.json`

`manifest.json` is the runtime manifest.

It tells Moorline how to load and run the package:

- package `id`
- package `type`
- runtime `entrypoint` when applicable
- dependencies
- config schema
- activation metadata, including optional uniqueness keys
- runtime/plugin capabilities

### `moorline.dist.json`

`moorline.dist.json` is the distribution metadata file.

It tells Moorline how to describe and distribute the package:

- display `name`
- `description`
- `version`
- npm discovery tags and category
- recommendation metadata
- release and channel metadata

Required distro fields:

- `name`
- `description`
- `version`

Other distro fields are optional.

## What “Finished Bundle” Means

A finished installable bundle is a directory that Moorline can copy into the runtime and import directly.

That directory should contain:

- `manifest.json`
- `index.mjs`
- `moorline.dist.json`
- any runtime assets your package reads at runtime

Typical finished bundle shape:

```text
bundle/
  manifest.json
  index.mjs
  moorline.dist.json
  system-prompt.md
  environment.md
```

Moorline expects the installed package to work from that bundle directory alone.

## What Not To Ship

Do not make users install:

- raw TypeScript source trees
- package source that still expects a build step on the user machine
- package source that still expects `npm install` or `bun install` on the user machine

The normal distribution format is a finished bundle, not source code.

## Package Types

### API Adapter

An API adapter package exposes Moorline's control API over a protocol. The Moorline-shipped adapter is `moorline/http`, and the Moorline CLI currently talks to HTTP endpoints.

API adapter packages occupy the core `api-adapter` activation key. Moorline selects at most one API adapter at a time.

### Provider

A provider package supplies agent-runtime behavior.

Use it when you want to integrate:

- a CLI agent
- an app-server style agent runtime
- a local or remote agent wrapper

Provider packages occupy the core `provider` activation key. Moorline activates at most one package for that key; packages that need multiple upstream providers should expose that multiplexing inside a single provider package.

### Transport

A transport package supplies the external interaction surface.

Use it when you want to integrate:

- Discord
- Slack
- email
- GitHub or issue trackers
- CI systems
- incident tools
- a custom external surface

Transport packages occupy the core `transport` activation key. Moorline activates at most one package for that key; packages that need to bridge multiple external surfaces should expose that multiplexing inside a single transport package.

Transports can emit chat-like messages, native actions, resource lifecycle events, or generic external events. Use `external.event.received` when an outside system reports something that is not naturally a chat message, such as `issues.opened`, `workflow.failed`, `incident.triggered`, or `email.received`.

### Plugin

A plugin package extends runtime behavior.

Use it for:

- tools
- hooks
- slash commands
- routing logic
- renderers
- integrations

Plugins are trusted runtime code. Moorline validates plugin manifests, declared capabilities, package layout, and install safety, but it does not sandbox plugin JavaScript after the package is activated. Install third-party plugins only from sources you are willing to let run inside the operator-controlled Moorline process.

Plugins can be activated or deactivated independently. Most plugins do not need an activation key, so many can be activated together.

#### Package State, Jobs, And Work

Plugins that need durable package state should use package state through the runtime context instead of asking the host for a feature-specific table. Declare:

```json
{
  "capabilities": ["package.state.read", "package.state.write"]
}
```

The plugin context exposes:

```js
const current = context.getPackageState('settings');
await context.putPackageState('settings', { enabled: true });
const records = context.listPackageState('items/');
await context.deletePackageState('settings');
```

Keys are scoped to the calling package id, so `acme/foo` and `acme/bar` can both use `settings` without colliding. Use prefixes such as `items/` when you need to list a group of records.

Plugins that need recurring work should use package jobs. Declare:

```json
{
  "capabilities": ["package.job.manage"]
}
```

Then schedule an action from the same package:

```js
await context.schedulePackageJob({
  jobId: 'sync:primary',
  actionId: 'sync.run',
  schedule: 'every hour',
  startTime: '09:00',
  payload: { account: 'primary' }
});
```

The runtime will dispatch the package action with the payload plus `jobId` and `scheduledAt`. The package remains responsible for interpreting its payload, updating package state, and cancelling jobs it no longer needs:

```js
export default {
  manifest,
  actions() {
    return [{ id: 'sync.run', title: 'Run sync', description: 'Internal scheduled sync.' }];
  },
  async onAction(event, context) {
    if (event.actionId !== 'sync.run') return { handled: false };
    await runSync(event.input.account, context);
    return { handled: true };
  }
};

await context.cancelPackageJob('sync:primary');
```

Package jobs are for recurring package-owned behavior. They are timers that dispatch package actions.

Plugins that need durable event-driven work should use package work items instead. Work items are runtime-owned queue records with idempotency keys, attempts, leases, retry/dead-letter states, optional external resources, and optional session bindings. Declare:

```json
{
  "capabilities": ["package.work.manage"]
}
```

Use work items for webhook retries, polling dedupe, CI failure repair, issue processing, inbox triage, or any workflow where work must survive runtime restarts:

```js
await context.enqueueWorkItem({
  queue: 'github-issues',
  idempotencyKey: 'github:acme/repo:issue:123',
  externalResource: {
    provider: 'github',
    kind: 'issue',
    id: 'acme/repo#123',
    url: 'https://github.com/acme/repo/issues/123',
    title: 'Improve setup'
  },
  payload: { action: 'opened' }
});

const item = await context.claimWorkItem({
  queue: 'github-issues',
  leaseSeconds: 300
});

if (item) {
  try {
    const created = await context.createSession({
      requestedName: 'Issue 123',
      runtimeMode: 'full-access',
      objective: 'Investigate and prepare a fix for issue #123.',
      externalResource: item.externalResource,
      workItemId: item.workItemId
    });
    await context.completeWorkItem({ workItemId: item.workItemId, phase: 'session-created' });
    console.log(created.session.sessionId);
  } catch (error) {
    await context.failWorkItem({
      workItemId: item.workItemId,
      error: error instanceof Error ? error.message : String(error),
      retryAfter: new Date(Date.now() + 60_000).toISOString()
    });
  }
}
```

Use package state for package-specific configuration or indexes, package jobs for schedules, and work items for durable queue/retry/recovery. Do not add host concepts for package-specific data unless multiple package families need the same host-owned primitive.

#### External Events

Plugins can declare and implement `onExternalEvent` to receive generic external events from transports:

```json
{
  "hooks": ["onExternalEvent"],
  "capabilities": ["package.work.manage"]
}
```

```js
export default {
  manifest,
  async onExternalEvent(event, context) {
    if (event.source !== 'github' || event.eventName !== 'issues.opened') {
      return { handled: false, continueDispatch: true };
    }
    await context.enqueueWorkItem({
      queue: 'github-issues',
      idempotencyKey: event.idempotencyKey,
      externalResource: event.resource,
      payload: { eventName: event.eventName, payload: event.payload }
    });
    return { handled: true };
  }
};
```

Use `onTransportEvent` for broad transport observation or chat-style message routing. Use `onExternalEvent` when the package handles non-chat events as workflow triggers.

#### Gates And Headless Runs

Plugins that need deterministic checks can run runtime gates:

```js
const gate = await context.runGate({
  gateId: 'lint',
  command: 'bun',
  args: ['run', 'lint'],
  required: true,
  workItemId: item.workItemId,
  sessionId: item.sessionId
});
```

Plugins that need a one-shot provider assessment can use session-backed headless runs. Declare `provider.headless.run`:

```json
{
  "capabilities": ["provider.headless.run"]
}
```

```js
const result = await context.runHeadless({
  requestedName: 'Classify issue',
  runtimeMode: 'read-only',
  prompt: 'Return JSON with { "ready": boolean, "reason": string }.',
  outputSchema: {
    type: 'object',
    required: ['ready', 'reason'],
    properties: {
      ready: { type: 'boolean' },
      reason: { type: 'string' }
    }
  },
  requireStructuredOutput: true
});
```

### Skill

A skill package is a content add-on.

Use it for:

- reusable instructions
- operator-provided workflows
- domain knowledge packs

Skills are not for shipping runtime JavaScript behavior.

Skill packages can be activated or deactivated independently. They usually do not need an activation key.

### Bundle

A bundle package groups other packages for setup or distribution.

Use it for:

- first-run defaults
- team or project package sets
- transport/provider/plugin combinations
- repeatable package selections with version ranges

Bundle members declare:

- package kind
- package id
- semantic version range
- activation behavior: install, select, or enable
- optional source metadata for members that should not be resolved by package id

Bundles are metadata-only. They should not ship runtime JavaScript behavior; put behavior in provider, transport, plugin, or skill packages.

Bundle member resolution is source-backed. Members can be embedded by npm bundle packages, can point at an explicit source descriptor, or can resolve by package id through npm metadata. Do not rely on a host-shipped package catalog.

## Authoring Structure

## API adapters, providers, transports, and plugins

A source tree usually starts like this:

```text
my-package/
  manifest.json
  moorline.dist.json
  src-or-runtime-files
```

Your shipped bundle should end like this:

```text
bundle/
  manifest.json
  index.mjs
  moorline.dist.json
  runtime-assets
```

## Skills

A skill package should look like this:

```text
my-skills/
  manifest.json
  moorline.dist.json
  skills/
    my-skill/
      SKILL.md
```

## `manifest.json`

Every package needs `manifest.json`.

Keep execution and runtime contract details here.

Shared fields:

- `id`
- `name`
- `version`
- `description`
- `dependencies`
- `configSchema`
- `displayCategory`

### Provider manifest

Required:

- `type: "provider"`
- `entrypoint`

Example:

```json
{
  "id": "acme/my-provider",
  "name": "acme/my-provider",
  "version": "0.0.2",
  "type": "provider",
  "description": "Example provider package.",
  "entrypoint": "index.mjs"
}
```

### Transport manifest

Required:

- `type: "transport"`
- `entrypoint`

Example:

```json
{
  "id": "acme/my-transport",
  "name": "acme/my-transport",
  "version": "0.0.2",
  "type": "transport",
  "description": "Example transport package.",
  "entrypoint": "index.mjs"
}
```

### Plugin manifest

Required:

- `type: "plugin"`
- `capabilities`
- `entrypoint`

Optional:

- `hooks`
- `commands`
- `defaultEnabled`

Example:

```json
{
  "id": "acme/my-plugin",
  "name": "acme/my-plugin",
  "version": "0.0.2",
  "type": "plugin",
  "description": "Example runtime plugin.",
  "entrypoint": "index.mjs",
  "capabilities": ["memory.read"]
}
```

External event worker example:

```json
{
  "id": "acme/github-worker",
  "name": "acme/github-worker",
  "version": "0.0.2",
  "type": "plugin",
  "description": "Turns GitHub issue events into durable Moorline work.",
  "entrypoint": "index.mjs",
  "capabilities": [
    "package.work.manage",
    "session.create",
    "session.direct",
    "provider.headless.run"
  ],
  "hooks": ["onExternalEvent"]
}
```

### Skill manifest

Required:

- `type: "skill"`

Optional:

- `skillsRoot`

Example:

```json
{
  "id": "acme/my-skills",
  "name": "acme/my-skills",
  "version": "0.0.2",
  "type": "skill",
  "description": "Example skill add-on.",
  "skillsRoot": "skills"
}
```

## Config Schema

If your package needs operator configuration, add `configSchema` to `manifest.json`.

If a field is secret, mark it with:

```json
{
  "secret": true
}
```

That tells Moorline to store the field in secret config instead of shareable public config.

Typical secret fields:

- API keys
- auth tokens
- bot tokens

Typical non-secret fields:

- command names
- IDs
- scopes
- display options

### Transport Config Completion

Transport packages may export an optional `completeConfig(input)` hook from their runtime package. Moorline calls this hook during package apply, after the operator has entered config values but before the applied runtime config is written.

Use this when a transport can derive system-managed setup values from operator-owned inputs. For example, a chat transport can accept a token and workspace ID, verify access, and return derived bot/user IDs or default permission settings. The hook should return the full set of completed config values it owns:

```js
export default {
  manifest,
  async completeConfig(input) {
    const verification = await verifyTransportAccess(input.config);
    return {
      config: {
        ...input.config,
        actorId: verification.actorId,
        applicationId: verification.applicationId
      }
    };
  },
  createTransport() {
    return transport;
  }
};
```

The hook should throw a clear error when verification fails. Moorline treats completion as part of apply, so failed completion prevents setup from being marked complete.

## Dependencies

Dependencies are declared in `manifest.json`.

Each dependency includes:

- `surface`
- `packageId`
- `requiredState`
- optional `versionRange`
- optional `reason`

Example: a plugin that only works when a transport is active:

```json
{
  "dependencies": [
    {
      "surface": "transport",
      "packageId": "acme/my-transport",
      "requiredState": "active",
      "reason": "This plugin delivers commands through that transport."
    }
  ]
}
```

Use hard dependencies when your package truly requires another package.

## `moorline.dist.json`

Every package needs `moorline.dist.json`.

Keep discovery and distribution metadata here.

Required fields:

- `name`
- `description`
- `version`

Optional fields include:

- tags
- category
- discovery metadata
- recommendation metadata
- release metadata

Example:

```json
{
  "name": "Acme Transport",
  "description": "Example transport package for Acme Chat.",
  "version": "0.0.2",
  "display": {
    "category": "transport",
    "tags": ["acme", "chat"]
  }
}
```

Keep runtime contract in `manifest.json`.
Keep discovery and presentation metadata in `moorline.dist.json`.

## Build With `@moorline/package-kit`

Third-party authors should build packages with the standalone package tool:

```bash
npx @moorline/package-kit bundle ./my-package
```

Bun users can run the same tool with:

```bash
bunx @moorline/package-kit bundle ./my-package
```

Default output:

```text
./dist/moorline-bundle/
```

Useful options:

```bash
npx @moorline/package-kit bundle ./my-package --out-dir ./bundle
npx @moorline/package-kit bundle ./my-package --out-dir ./bundle --archive
npx @moorline/package-kit bundle ./my-package --out-dir ./bundle --archive --archive-format tar.gz
```

For installables, the tool:

1. reads `manifest.json`
2. reads `moorline.dist.json`
3. resolves the runtime entrypoint
4. bundles runtime code into `index.mjs`
5. copies runtime assets
6. validates the finished bundle

For skill add-ons, the tool:

1. reads `manifest.json`
2. reads `moorline.dist.json`
3. copies the declared `skills/` content
4. validates the finished bundle

## Validate And Inspect

Validate a source directory, finished bundle, or archive:

```bash
npx @moorline/package-kit validate ./my-package
npx @moorline/package-kit validate ./dist/moorline-bundle
npx @moorline/package-kit validate ./dist/moorline-bundle.tar.gz
```

Default validation is structural only.
It does not execute your package code.

If you want a trusted runtime import smoke test too:

```bash
npx @moorline/package-kit validate ./dist/moorline-bundle --runtime-smoke
```

The runtime smoke test is still a trust decision, not a sandbox. Run it only for packages you are prepared to execute in your current environment.

Inspect the resolved package metadata:

```bash
npx @moorline/package-kit inspect ./dist/moorline-bundle
```

## How To Test Locally

Install the directory bundle into a Moorline runtime you control.

Example:

```bash
moorline configure package install --kind plugin --source ./dist/moorline-bundle
```

or:

```bash
moorline configure package install --kind provider --source ./dist/moorline-bundle
```

Then activate it if needed:

```bash
moorline configure package select --surface provider --package acme/my-provider
moorline configure package enable --surface plugin --package acme/my-plugin
moorline configure apply
```

For skills:

```bash
moorline configure package install --kind skill --source ./dist/moorline-bundle
moorline configure package enable --surface skill --package acme/my-skills
moorline configure apply
```

## How To Create A Distributable Archive

Once your directory bundle works, archive it:

```bash
npx @moorline/package-kit bundle ./my-package --out-dir ./dist/moorline-bundle --archive
```

Users can then install it with:

```bash
moorline configure package install --kind plugin --source ./dist/acme-my-package-0.0.1.tar.gz
```

## How To Ship To Users

Today the realistic third-party distribution options are:

### 1. Ship a local archive bundle

Good for:

- direct sharing
- release attachments
- manual downloads

User install:

```bash
moorline configure package install --kind plugin --source ./my-package-0.0.1.tar.gz
```

### 2. Ship a directory bundle

Good for:

- local testing
- advanced users
- dev collaboration

User install:

```bash
moorline configure package install --kind plugin --source ./my-package-bundle
```

### 3. Ship a remote archive URL

Good for:

- release assets
- team-hosted package downloads
- stable public package installs

User install:

```bash
moorline configure package install --kind plugin --source https://example.com/downloads/my-package-0.0.1.tar.gz
```

Important:

- the remote URL should point directly to a finished bundle archive
- do not expect the user machine to compile your package source

## Recommended Developer Workflow

For a third-party installable:

1. Author source files.
2. Run `npx @moorline/package-kit bundle ./my-package --out-dir ./dist/moorline-bundle`.
3. Install from `./dist/moorline-bundle`.
4. Fix issues until it works.
5. Re-run the bundle command with `--archive`.
6. Publish the archive.
7. Tell users to install the finished bundle.

For a third-party skill add-on:

1. Author the skill package directory.
2. Run `npx @moorline/package-kit bundle ./my-skills --out-dir ./dist/moorline-bundle`.
3. Test install from that bundle directory.
4. Archive it if desired.
5. Tell users to install that package.

Runtime behavior note:

- `moorline configure package config set` validates keys and values against the selected package schema before saving.
- `moorline configure apply` only succeeds when selected packages are installed and startable with valid required config.

## Validation Expectations

Moorline will validate installables at install time.

At minimum, make sure:

- `manifest.json` exists
- the configured entrypoint exists
- `moorline.dist.json` exists
- runtime-loaded assets are present
- your shipped installable is not just raw TS source

Install-time validation is structural only.
Moorline does not import your package code during install.

Runtime code is first imported later when the selected package is actually loaded by the runtime.

## Publishing Through npm

Moorline discovers and installs public npm packages that carry Moorline package metadata.
Users still install through Moorline CLI commands or the control API; npm is the package distribution, discovery, and search source.

Pack a package for npm:

```bash
npx @moorline/package-kit npm-pack ./my-package \
  --out-dir ./dist/moorline-npm \
  --npm-name @acme/moorline-slack-transport
```

Then publish the generated npm package directory:

```bash
npm publish ./dist/moorline-npm/@acme/moorline-slack-transport --access public
```

The generated `package.json` includes:

- `keywords` including `moorline-package`, package kind, namespace, and package id markers
- an `moorline` metadata block that maps npm package identity to the Moorline package id
- no npm dependencies for Moorline dependency resolution
- no install-time lifecycle scripts

Package ids remain Moorline-native:

```text
acme/slack-transport
```

npm names are distribution aliases:

```text
@acme/moorline-slack-transport
```

Users install by Moorline id:

```bash
moorline package search slack
moorline package info acme/slack-transport --kind plugin
moorline package install acme/slack-transport --kind plugin
```

Packages discovered through npm are identified by their npm scope and Moorline package metadata; Moorline does not review npm packages by default.

## Current Limitation

The main limitation to know today is:

- Moorline does not yet ship a hosted registry service, publish command, or package scaffolding generator for third-party authors

What it does ship now:

- a standalone bundling and validation CLI: `@moorline/package-kit`
- npm-compatible package packing for public registry discovery
- runtime installation from bundle directories, local archives, and remote archive URLs
