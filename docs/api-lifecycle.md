# API Lifecycle and Deprecation Policy

This document defines the compatibility and change-management contract for Suwappu's public developer interfaces. It applies prospectively from the date this policy is merged; it does not retroactively claim that historical releases followed it.

## Contract boundaries

Suwappu has several versioned surfaces. Their version numbers have different meanings and MUST NOT be treated as interchangeable.

| Surface | Compatibility identity | Meaning |
|---|---|---|
| Agent REST | `/v1` | Public HTTP compatibility major. Breaking GA REST changes require a new major unless compatibility is preserved through a migration window. |
| OpenAPI | `info.version` | Revision of the published Agent REST contract document. It is not the npm package version. |
| `@suwappu/sdk` | package semver | TypeScript client release. Compatibility with REST majors is declared separately. |
| Python SDK | pinned source revision until published | Source-only client today; a repository commit is the release identity. |
| Hosted MCP | negotiated MCP protocol + runtime tool discovery | Tool/resource/prompt catalog is discovered at runtime. A package version is not a static tool-catalog version. |
| `@suwappu/mcp-server` | package semver | Transport adapter to hosted MCP; source and registry versions may differ. |
| A2A | protocol/version advertised by the Agent Card | Natural-language discovery/quote surface; no fund-moving method today. |

A source package version, OpenAPI version, deployment SHA, API major, and hosted protocol revision can legitimately differ. Documentation and CI must make that relationship explicit rather than forcing false version equality.

## Lifecycle states

Every public API capability that is not ordinary GA behavior SHOULD have one of these states:

| State | Contract |
|---|---|
| **Experimental** | Evaluation only. Shape or behavior may change without a compatibility guarantee. Must be labeled. |
| **Beta** | Publicly usable but not yet covered by the full GA compatibility promise. Breaking changes require changelog notice whenever practical. |
| **GA** | Supported production contract. Breaking changes follow the policy below. |
| **Deprecated** | Still available but replacement/migration is published. Deprecation date is known. |
| **Sunset** | Removal date is committed and communicated. Calls may stop working at/after that date. |

A route is not GA merely because code exists, tests pass, or a service is deployed in a production environment.

## What counts as breaking

For GA Agent REST, the following are normally breaking changes:

- removing or renaming a route, method, required field, enum value, documented response field, or authentication mechanism;
- changing a field's meaning or unit incompatibly;
- making an optional request field required;
- changing a success response to require additional authorization without a migration path;
- changing managed-vs-self-custody authority semantics;
- changing retry, idempotency, signature, webhook, or settlement semantics in a way that can cause duplicate money movement or incorrect reconciliation;
- tightening limits in a way that invalidates an explicitly documented contractual minimum, unless required for emergency security/reliability reasons.

Normally non-breaking:

- adding optional request fields;
- adding response fields when clients are required to tolerate unknown fields;
- adding enum values only where the contract explicitly defines the enum as extensible;
- adding routes;
- documentation clarification that does not change behavior;
- performance improvements that preserve the contract.

When ambiguity exists, prefer treating the change as breaking.

## GA change policy

For an incompatible GA REST change, Suwappu SHOULD do one of the following:

1. preserve `/v1` behavior and introduce a new compatibility major; or
2. keep both behaviors available through a documented migration window when a new major is unnecessary or impractical.

The default target for a planned breaking GA change is **at least 90 days of public notice before sunset**. This is a policy target, not a contractual SLA. A shorter window may be necessary for actively exploited vulnerabilities, legal/regulatory requirements, third-party network/protocol shutdowns, or severe reliability incidents. Emergency changes must be documented after the fact as soon as doing so is safe.

## Deprecation signals

When a GA HTTP resource is deprecated, use as many of these signals as the surface supports:

1. **OpenAPI**: set `deprecated: true` and link to the replacement/migration guide in the operation description or extension metadata.
2. **Changelog**: publish the deprecation date, planned sunset date, affected operations, replacement, and migration guide.
3. **HTTP**: emit the standard `Deprecation` response header defined by RFC 9745 once the resource is deprecated.
4. **HTTP sunset**: when a removal date is committed, emit the `Sunset` response header defined by RFC 8594.
5. **Link**: expose a deprecation/migration resource through the appropriate link relation where supported.
6. **SDK**: annotate deprecated methods/types and link to migration guidance.
7. **Status/docs**: if a deprecation is caused by an upstream shutdown or operational event, cross-link the relevant status/incident record.

References:
- RFC 9745 — Deprecation HTTP Response Header Field: https://www.rfc-editor.org/rfc/rfc9745.html
- RFC 8594 — Sunset HTTP Header Field: https://www.rfc-editor.org/rfc/rfc8594.html

## Required deprecation record

A planned GA deprecation is incomplete until its public record contains:

- affected API major and operation(s);
- lifecycle state;
- deprecation date;
- sunset date, when known;
- replacement operation or explicit statement that there is none;
- migration guide;
- known behavior differences;
- SDK impact;
- support/contact path.

Changing a changelog sentence without updating the machine-readable contract is not sufficient.

## OpenAPI version semantics

`openapi-agent.json` currently has its own document revision. Going forward:

- `info.version` identifies the **Agent REST contract revision**, not `@suwappu/api-ts` package semver.
- the spec MUST declare its compatible REST major (currently `/v1`) in machine-readable metadata;
- the generator/check must own the lifecycle/version metadata instead of scattering hard-coded copies through docs and runtime strings;
- a contract revision can change for additive/non-breaking API changes without creating `/v2`;
- a new REST compatibility major MUST be visible independently of the document revision.

The exact machine-readable extension names will be implemented with the contract-generation parity work; until then, this document is normative for interpretation.

## SDK compatibility

SDK versions are independent release artifacts. Every published SDK release SHOULD state:

- supported REST major(s);
- minimum runtime version;
- support stage;
- whether the registry release or repository source is authoritative for that installation path;
- breaking changes and migration guidance.

See [SDK Support Policy](sdk-support.md).

## Hosted MCP and A2A

Hosted protocols are discovery-driven and should not be frozen into README inventories.

- MCP clients MUST use protocol negotiation and runtime tool/resource/prompt discovery.
- Tool annotations and names are metadata, not authorization.
- A removed or behaviorally incompatible GA money-moving tool requires the same migration discipline as a REST money-path change even when transport-level protocol negotiation succeeds.
- A2A capability changes must be reflected in the Agent Card and product-status contract.

## Changelog rules

The public changelog SHOULD distinguish at least:

- **Breaking**
- **Deprecated**
- **Security**
- **Added**
- **Changed**
- **Fixed**

Each breaking/deprecation item should link the affected contract and migration guide. The changelog should ultimately expose RSS or Atom so integrators can subscribe without polling a webpage.

## Review gate

A PR changing a public developer contract should answer:

- Is this additive, behavior-changing, or breaking?
- Which lifecycle state applies?
- Does OpenAPI/MCP/A2A discovery change?
- Do SDKs/examples need an update?
- Is a deprecation/migration record required?
- Can this affect signing, custody, idempotency, authorization, or settlement? If yes, treat it as MONEY-PATH review.

The parity CI work should automate every check that can be derived mechanically and leave only semantic review to humans.
