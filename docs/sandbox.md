# Suwappu Contract Sandbox

**Status:** public deterministic simulator  
**Endpoint:** `https://api.suwappu.bot/v1/sandbox`  
**Production value:** impossible by design in this module  
**Persistence:** ephemeral, in-memory, per API process  

> This page describes the **contract sandbox** only. It does **not** assert that
> `devapi.suwappu.bot` is a supported or isolated customer sandbox. The separate
> `devapi` environment remains unverified for customer sandbox semantics until #874
> proves isolation or removes it from the public contract.

## Purpose

Use the contract sandbox to test client behavior that should never require real funds or a live
provider:

- success responses;
- validation failures;
- policy rejection;
- quote expiry;
- HTTP 402 payment-required handling;
- HTTP 429 retry behavior;
- upstream-unavailable handling;
- unknown execution outcomes and reconciliation;
- idempotency-key replay/conflict handling;
- webhook signature verification fixtures;
- time-dependent client logic with a virtual clock.

It is designed for SDK/agent integration tests, not price discovery or transaction execution.

## Hard safety boundary

The sandbox implementation is `api-ts/src/routes/sandbox.ts`.

It is intentionally dependency-free from:

- Suwappu service layers;
- databases;
- chain RPC clients;
- Li.Fi/Jupiter/routing providers;
- Turnkey or other signing systems;
- billing/metering services;
- internal service APIs.

The module performs no `fetch()` calls. CI tests inspect this dependency boundary in addition to
exercising the HTTP behavior.

Every sandbox response identifies the environment. Capability discovery reports:

```json
{
  "environment": "sandbox",
  "real_funds": false,
  "live_quotes": false,
  "provider_calls": false,
  "rpc_calls": false,
  "signing": false,
  "broadcast": false,
  "billing": false,
  "production_database": false,
  "persistence": "ephemeral-in-memory"
}
```

A sandbox result is never a quote, signature, transaction hash, settlement receipt, or proof of
production execution.

## Discover the sandbox

```bash
curl https://api.suwappu.bot/v1/sandbox
```

The response lists the current forced scenarios and sandbox endpoints. Do not hard-code the
scenario list when runtime discovery is convenient.

## Force a scenario

```bash
curl -X POST https://api.suwappu.bot/v1/sandbox/simulate \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: integration-test-001' \
  -d '{
    "scenario": "rate_limited",
    "from_token": "ETH",
    "to_token": "USDC",
    "amount": "0.5",
    "chain": "base"
  }'
```

Supported scenarios on the initial contract:

| Scenario | HTTP behavior | What it tests |
|---|---:|---|
| `success` | 200 | successful client flow with no signing/broadcast |
| `validation_error` | 400 | bad-request handling |
| `payment_required` | 402 | metering/payment challenge handling |
| `policy_rejected` | 403 | fail-closed policy handling |
| `quote_expired` | 409 | stale quote / re-quote flow |
| `rate_limited` | 429 + `Retry-After` | throttling/backoff |
| `upstream_unavailable` | 503 | provider outage behavior without calling a provider |
| `unknown_outcome` | 202 | reconcile-before-retry behavior |

## Idempotency contract

`POST /v1/sandbox/simulate` accepts `Idempotency-Key` or `idempotency_key`.

For the lifetime of the in-memory sandbox operation:

- same key + same normalized economic terms returns the original operation and
  `X-Idempotent-Replayed: true`;
- same key + different terms returns `409 IDEMPOTENCY_CONFLICT`;
- keys are limited to 1–64 characters from `A-Za-z0-9_.:-`;
- state is intentionally ephemeral and must not be used as a durability guarantee for production.

This lets SDKs test their retry identity before production traffic.

## Unknown outcomes and reconciliation

Create one:

```bash
curl -X POST https://api.suwappu.bot/v1/sandbox/simulate \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: unknown-test-001' \
  -d '{"scenario":"unknown_outcome"}'
```

The response contains `reconcile_required: true` and a `status_url`.

Inspect it:

```text
GET /v1/sandbox/operations/:id
```

Then force the simulated external outcome to become known:

```text
POST /v1/sandbox/operations/:id/resolve
{"resolution":"simulated_success"}
```

or:

```json
{"resolution":"simulated_failure"}
```

This is specifically for testing the production rule: **an unknown money-moving outcome is not
permission to issue a new execution blindly**.

## Webhook fixture

`POST /v1/sandbox/webhook-fixture` returns:

- the exact raw JSON body;
- a deterministic sandbox delivery ID;
- `X-Suwappu-Event`;
- `X-Suwappu-Delivery`;
- `X-Suwappu-Timestamp`;
- `X-Suwappu-Signature`;
- the public sandbox-only test secret.

No callback is sent over the network.

The fixture uses HMAC-SHA256 over the raw body with `SHA256(test_secret)` as the HMAC key, matching
the current test-webhook construction closely enough for client verifier development. It is not a
substitute for the full production webhook delivery/retry contract tracked by #878.

## Virtual clock

```text
POST /v1/sandbox/clock/advance
```

Example:

```json
{
  "now": "2026-08-21T00:00:00.000Z",
  "seconds": 3600
}
```

The response returns a calculated virtual time. It never changes server or production clocks.
Advances are limited to 31 days per request.

## What this sandbox does not provide yet

It does **not** currently provide:

- a separate sandbox credential namespace;
- persistent sandbox organizations/wallets;
- fake on-chain balances or provider order books;
- a durable multi-replica sandbox database;
- a full fake managed-wallet/signing lifecycle;
- real webhook delivery/retry/redrive;
- end-to-end recurring billing state tied to the virtual clock;
- proof that `devapi.suwappu.bot` is isolated from production resources.

Those are deliberately not implied. #874 remains the environment-isolation workstream; #878 owns
production webhook recovery semantics.

## Promotion rule

Do not replace a sandbox scenario with a live provider call for realism. If a test requires provider
or chain behavior, either:

1. keep it in the deterministic simulator with a recorded/synthetic fixture, or
2. place it in a separately isolated test environment whose credentials, data stores, keys, RPCs and
   value semantics have been proven unable to cross into production.

The safety property is more important than making a sandbox response look live.
