# SDK Support and Compatibility Policy

This document defines what Suwappu means by a supported SDK/package release. It separates **source state**, **registry publication**, **API compatibility**, and **support lifecycle** so those facts cannot be inferred from one another.

## Current package status

| Surface | Current status | Installation authority |
|---|---|---|
| `@suwappu/sdk` | **Published + source** | npm registry for published releases; repository source may be ahead. |
| `@suwappu/mcp-server` | **Published + source** | npm registry for published releases; hosted MCP remains the runtime tool/catalog authority. |
| Python SDK | **Source-only** | Pin a full reviewed repository commit SHA. No package-registry publication should be claimed until a release exists and is verified. |
| Hosted MCP | **Hosted protocol** | `tools/list`, `resources/list`, protocol negotiation, and the hosted service are runtime authority; not an npm version. |
| Agent REST | **Hosted API** | `/v1` compatibility major + OpenAPI contract. |

These states are also summarized in [Product Status](product-status.md).

## Version meanings

Package semver and API compatibility are different contracts.

- `@suwappu/sdk@X.Y.Z` describes a TypeScript client release.
- Agent REST `/v1` describes the HTTP compatibility major.
- OpenAPI `info.version` describes a contract-document revision.
- MCP protocol revisions are negotiated independently.
- A repository package version describes source state and does not prove that exact version was published.

Do not compare those values numerically as though they are one release train.

## Compatibility declaration

Every published SDK release SHOULD declare which public API major(s) it supports. Until a generated compatibility manifest lands, the package README and release notes are the human-readable source.

Target machine-readable shape:

```json
{
  "package": "@suwappu/sdk",
  "version": "0.6.0",
  "apiMajors": ["v1"],
  "stage": "active",
  "runtime": {
    "node": ">=20"
  }
}
```

The exact runtime range above is illustrative only; CI must derive and validate the real value from package/tooling metadata before such a manifest becomes authoritative.

## Support stages

| Stage | Meaning |
|---|---|
| **Preview** | Public evaluation; interface may change. |
| **Active** | Supported for production integration under the package's documented compatibility range. |
| **Maintenance** | Critical fixes and migration support; new feature development may stop. |
| **End of life** | No ordinary fixes or compatibility promise. Upgrade required. |
| **Source-only** | Repository implementation exists without a current supported registry release. Pin a commit. |

Suwappu SHOULD actively support the latest published major of each GA SDK. Because current SDKs are pre-1.0, minor releases may still contain incompatible changes under SemVer conventions; any such published change should have a clear changelog/migration entry rather than relying on the `0.x` exception as a surprise mechanism.

## Registry versus source

For a published package:

- npm is authoritative for what users can install by version;
- monorepo source is authoritative for the next/unreleased state;
- source may be ahead of npm;
- documentation MUST distinguish source-only methods from methods present in the latest registry release;
- badges, examples, and install commands should point at actual registry releases rather than source package numbers.

For source-only packages:

- use a full commit SHA for production installs;
- do not use `main` as a production pin;
- do not advertise a PyPI/npm package name unless the registry release has been verified;
- migration from source-only to published requires package/release contract tests and registry provenance.

## Release requirements

A supported published SDK release SHOULD have:

1. deterministic build/test passing from a clean checkout;
2. package API/type tests;
3. compatibility tests against the declared REST major or hosted protocol;
4. changelog/release notes;
5. provenance/signing metadata where the registry supports it;
6. no unreviewed secrets or environment-specific generated output;
7. install-and-smoke-test from the packed/published artifact, not only from workspace source;
8. documentation for all exported money-moving methods explaining authority, idempotency, retry, and reconciliation semantics.

`@suwappu/sdk` already has `publishConfig.provenance: true` in source; future release CI should verify that registry provenance actually exists for each published release rather than assuming configuration equals evidence.

## Money-moving SDK methods

Every fund-moving or transaction-preparation method must identify its authority level:

- **Discover / Quote / Simulate** — read-only;
- **Prepare** — returns unsigned self-custody transaction data;
- **Managed execute** — can move funds under managed authority.

Managed execution APIs must document:

- durable idempotency key behavior;
- what a retry means;
- how to reconcile an unknown outcome;
- request/status identifiers;
- policy/authorization requirements;
- whether the SDK retries automatically and, if so, which operations are safe to retry.

SDK convenience must never erase custody boundaries.

## Automatic retries

SDKs may automatically retry idempotent reads and explicitly retry-safe requests with bounded exponential backoff and jitter. They MUST NOT blindly retry a money-moving request whose outcome is unknown.

Rate-limit retry behavior should follow the server contract (`Retry-After` and documented rate-limit headers) rather than use an unrelated hard-coded delay.

## Deprecation and end of life

SDK deprecations follow [API Lifecycle and Deprecation Policy](api-lifecycle.md).

For a supported release line moving to maintenance/EOL, publish:

- affected package and versions;
- date support changes;
- recommended replacement version;
- API-major compatibility differences;
- migration guide;
- security-fix policy during the transition.

Deprecated methods should use language-native annotations where practical and link to migration guidance.

## Hosted MCP bridge special case

`@suwappu/mcp-server` is a transport/client bridge to the hosted MCP service. Its package version does **not** define the hosted tool catalog.

Clients should:

- negotiate protocol support;
- discover tools/resources/prompts at runtime;
- maintain an application-owned allowlist;
- treat tool metadata as descriptive, not authorization;
- prefer the hosted endpoint directly when their client supports the current transport.

## Python SDK publication gate

The Python SDK remains source-only until all of these are true:

- package name and ownership are secured in the chosen registry;
- clean build/install tests pass from the produced wheel/sdist;
- API-major compatibility tests pass;
- version and changelog policy are wired into release automation;
- provenance/signing strategy is documented and implemented where supported;
- docs stop using a source-install path as though it were a registry release.

Until then, documentation must use a pinned commit and label the package source-only.

## CI parity target

The developer-platform parity work should add a machine check that validates:

- registry/package source version relationship where registries are accessible;
- declared API-major compatibility;
- no unsupported registry claims in README/docs/`llms.txt`;
- generated examples compile against the package they claim to target;
- published package APIs do not silently depend on unreleased server behavior;
- deprecated server operations have matching SDK annotations/migration links where applicable.

That check is part of the parity exit criteria, not optional documentation hygiene.
