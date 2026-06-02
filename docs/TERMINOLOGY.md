# Terminology

Use these terms consistently in package authoring docs and package metadata.

## Preferred Terms

- `operator-controlled runtime`
  - The person or team running Moorline controls the runtime boundary: package activation, provider/transport selection, policy, state, audit, and deployment environment.
- `external surface`
  - A system Moorline connects to through a transport or adapter. Examples include Discord, Slack, GitHub, email, CI, incident tools, and custom APIs.
- `transport`
  - An installable package that connects Moorline to an external surface and emits runtime transport events. A transport may be chat-like, but it does not have to be chat.
- `provider`
  - An installable package that executes agent work.
- `plugin`
  - Trusted runtime code that adds behavior, hooks, tools, commands, workflow logic, or integrations.
- `external resource`
  - A normalized reference to the outside object that caused or receives work, such as a GitHub issue, CI run, email thread, incident, or ticket.
- `work item`
  - Runtime-owned durable package work with status, attempts, idempotency, leases, and optional session/resource binding.
- `package job`
  - Package-owned scheduled action dispatch. Use this for recurring timers. Use work items for durable queue/retry/recovery around event-driven work.

## Avoid As Product Identity

- `local-first`
  - Prefer `operator-controlled`, `self-hostable`, or concrete deployment wording. Local execution is supported, but Moorline is not defined by laptop-only operation.
- `chat-centered`
  - Prefer `event/work orchestration`, `external surface`, or the specific transport name.
- `local runtime code`
  - Prefer `trusted runtime code` or `operator-controlled runtime code`.
