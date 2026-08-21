# Financial API Parity Addendum — Sandbox, Idempotency, Webhooks, Debugging

**Verified:** 2026-08-21  
**Purpose:** extend the core infrastructure benchmark with mature financial/messaging API patterns that are especially relevant to Suwappu's money-moving developer surface.

This addendum exists because a crypto execution platform should not benchmark only DEX aggregators or generic cloud APIs. Financial API providers have spent years hardening the developer experience around irreversible/asynchronous state transitions, retries, test environments, webhooks, and support diagnostics.

## Plaid: a sandbox is a controllable failure laboratory

Verified sources:
- https://plaid.com/docs/api/
- https://plaid.com/docs/api/sandbox/
- https://plaid.com/docs/sandbox/
- https://plaid.com/docs/api/versioning/
- https://plaid.com/docs/api/webhooks/webhook-verification/

Observed properties:

- Sandbox and Production are distinct hosts/environments; Sandbox objects cannot be moved into Production.
- Sandbox has **environment-only control endpoints** to force login errors, change verification status, fire webhooks, simulate payment/transfer states, and create/advance virtual test clocks.
- API responses include a `request_id` explicitly intended for troubleshooting/support.
- GA backwards-incompatible changes create a new API version instead of silently breaking existing developers.
- Beta products can break without versioning but are explicitly outside the GA promise and receive notice.
- Webhook verification binds the signature/JWT to the request-body SHA-256 and checks freshness to limit replay.

### Suwappu implication

If `devapi.suwappu.bot` becomes a supported public sandbox, parity should mean more than changing the hostname. A useful execution sandbox should eventually let integrators deterministically test:

- quote expiration;
- provider failure/timeouts;
- simulation failure;
- insufficient balance/allowance;
- policy rejection;
- approval/step-up states;
- managed execution accepted/pending/confirmed/failed;
- webhook delivery/retry/duplicate handling;
- rate limiting / 402 metering behavior;
- chain/provider degradation;
- time-driven orders or subscriptions where applicable.

Those controls must be isolated from production funds and clearly marked as synthetic/test behavior.

## Circle: idempotency is the retry contract

Verified source:
- https://developers.circle.com/api-reference/idempotent-requests

Observed property:

Certain write endpoints require an idempotency key. Repeating the same request with the same key returns the original result rather than executing the operation again. This turns network uncertainty into a defined protocol behavior instead of a caller guess.

### Suwappu implication

Managed swap execution already documents durable idempotency/reconciliation semantics. The parity gap is consistency: every externally retriable money-moving POST should be classified as one of:

1. idempotent by resource identity;
2. idempotent through an explicit key;
3. unsafe to retry automatically, with an explicit reconciliation method.

No public money-moving write should leave retry semantics unstated.

## Fireblocks: idempotency + webhook recovery are first-class

Verified sources:
- https://developers.fireblocks.com/reference/api-idempotency
- https://developers.fireblocks.com/reference/webhooks-best-practices
- https://developers.fireblocks.com/api-reference/webhooks-v2/resend-notification-by-id
- https://developers.fireblocks.com/api-reference/webhooks-v2/resend-notifications-by-query
- https://developers.fireblocks.com/reference/webhooks-gettingstarted-configuringwebhooks

Observed properties:

- POST requests can carry `Idempotency-Key`; repeated requests return the original response for a documented retention period.
- Transaction creation also has an external transaction identifier for transaction-level deduplication.
- Webhook best practices explicitly tell consumers to deduplicate by event ID and not assume event ordering.
- The webhook platform has circuit-breaker behavior for unhealthy receivers.
- Missed notifications can be resent by ID or query/time range.
- SDK configuration has an explicit Sandbox base path.

### Suwappu implication

The webhook parity target should include recovery, not only delivery:

- event IDs;
- explicit ordering semantics;
- retry/circuit-breaker policy;
- delivery history;
- resend/redrive;
- idempotent consumer reference implementation.

The developer platform should make a failed webhook diagnosable and recoverable without asking support to reconstruct it manually.

## Twilio: errors point directly to remediation and evidence

Verified sources:
- https://www.twilio.com/docs/usage/troubleshooting/debugging-your-application
- https://www.twilio.com/docs/api/errors

Observed properties:

- Stable product-specific error codes.
- Error payloads can contain a direct `more_info` documentation link.
- Console Debugger can filter/inspect errors by time, code, source and event type.
- Request Inspector exposes request/response evidence around failed interactions.
- Error logs can be streamed into customer systems.
- Twilio support guidance asks for a request identifier when deeper investigation is needed.

### Suwappu implication

Suwappu already has `X-Request-ID`, agent `error_code`, Sentry/OTel hooks and some `hint` fields. Top-tier parity is to turn those primitives into the external developer workflow:

1. API returns `error_code`, `request_id`, `documentation_url`, safe structured remediation.
2. Developer searches the request ID in a sanitized explorer.
3. Explorer shows endpoint, timing, status, chain/provider context and correlated execution ID.
4. Builder can link from error to exact reference/troubleshooting page.
5. Support can use the same request ID without asking the developer to reproduce the request with secret material.

## Additional parity requirements added by this pass

| Requirement | Why |
|---|---|
| Sandbox-only failure/state simulation | A sandbox that only mirrors happy-path reads does not validate a money-moving integration. |
| Deterministic time controls where useful | DCA/subscription/order workflows need reproducible time-driven tests. |
| Platform-wide write retry classification | Prevent duplicate execution after transport uncertainty. |
| Webhook redrive/replay controls | Recovery is part of delivery reliability. |
| Stable error dictionary with remediation URLs | Error codes become useful to humans and agents instead of opaque identifiers. |
| Request-inspector retention policy | Developers need to know how long evidence remains available. |
| Export/streaming path for enterprise logs | Mature integrations often need their own SIEM/observability history. |

## Mapping to parity issues

- #874 — supported sandbox semantics and isolation.
- #877 — request explorer and contextual error remediation.
- #878 — webhook delivery contract and delivery explorer.
- #872 — parent developer-platform parity effort.

A separate idempotency audit should cover every externally retriable money-moving write; managed swap behavior is not sufficient evidence for the rest of the platform.
