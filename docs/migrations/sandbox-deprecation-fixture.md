# Sandbox Deprecation Fixture Migration

**Record type:** deprecation fixture  
**Affected operation:** `GET /v1/sandbox/deprecated-fixture`  
**API compatibility major:** `v1`  
**Lifecycle state:** Deprecated  
**Deprecated:** 2026-08-21 00:00:00 UTC  
**Sunset:** 2026-12-01 00:00:00 UTC  
**Replacement:** `GET /v1/sandbox`  
**Production funds:** none — this endpoint is sandbox-only and fixture-only  

## Why this record exists

This endpoint exists only to prove Suwappu's deprecation machinery end-to-end. SDKs and
integrations can test standards-based lifecycle handling without Suwappu deprecating a real
production API solely for test coverage.

It emits:

- RFC 9745 `Deprecation`;
- RFC 8594 `Sunset`;
- `Link: <...>; rel="deprecation"`;
- `X-Suwappu-Lifecycle: deprecated`;
- `X-Suwappu-Replacement: /v1/sandbox`.

The same dates and replacement are published in `api-ts/api-lifecycle.json` and
`GET /v1/api-lifecycle`.

## Migration

Clients that call the fixture should stop calling it and use:

```text
GET /v1/sandbox
```

`GET /v1/sandbox` is the capability-discovery entry point for the deterministic no-funds contract
sandbox. It is not deprecated by this record.

## Behavior differences

The deprecated fixture returns one synthetic lifecycle response and lifecycle headers. The
replacement returns sandbox capabilities, scenario names, safety guarantees, and test endpoints.
Neither route signs, broadcasts, charges, calls routing providers, calls chain RPCs, or uses the
production database.

## SDK impact

SDKs should treat this fixture as a test input for deprecation handling. Production SDK methods
must not depend on it. A client may warn on `Deprecation`, surface the linked migration record, and
use `Sunset` to determine the final supported date. It must not assume every deprecated endpoint
has a replacement; the lifecycle registry explicitly carries replacement/no-replacement state.

## Removal behavior

At or after the sunset date, Suwappu may remove the fixture. Removing this fixture does not change
production execution authority or money-path behavior.

## Support

For lifecycle-policy questions or migration problems, use the repository issue tracker or the
support/security contacts published by Suwappu. Security-sensitive reports should follow
`SECURITY.md` rather than a public issue.
