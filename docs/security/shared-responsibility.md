# Security Shared Responsibility Model

Suwappu spans read-only market data, self-custody transaction preparation, managed wallet execution, agents, webhooks, and third-party execution providers. Security responsibilities therefore change with the authority a customer enables.

This document defines those boundaries. It is not an audit report, certification, legal opinion, or guarantee that every optional integration is enabled in every deployment.

## Core principle

**Capability discovery is not authorization.** A client being able to discover an endpoint, MCP tool, SDK method, chain, or provider does not mean it should be permitted to invoke it with money-moving authority.

Integrators should start with Discover / Quote / Simulate and grant Prepare / Managed Execute only when required by the product and protected by explicit policy.

## Responsibility matrix

| Area | Suwappu responsibility | Integrator / customer responsibility | Shared responsibility |
|---|---|---|---|
| **API authentication** | Verify supported credentials server-side, reject invalid/expired credentials, provide rotation mechanisms and scoped controls where implemented. | Store keys outside source/logs, restrict access, rotate on suspicion, separate environments, issue least-privilege credentials. | Monitor anomalous auth use and coordinate revocation during incidents. |
| **Self-custody signing** | Return transaction data according to the documented prepare contract; do not present unsigned preparation as managed execution. | Independently validate transaction intent, destination, chain, value and calldata as appropriate; protect keys; sign and broadcast. | Reconcile transaction status and provider/chain outcomes. |
| **Managed signing** | Enforce server-side ownership/auth/policy gates; isolate signing infrastructure according to the implemented architecture; log auditable events. | Configure only the authority required; protect account/admin access; set spend/destination policies; review managed-wallet permissions. | Respond to suspicious execution, rotate/revoke credentials, and verify policy behavior after material changes. |
| **Agent/tool access** | Publish tool semantics, authority level and protocol metadata; enforce server auth independent of model instructions. | Treat model output and third-party text as untrusted; maintain a tool allowlist; require approval/policy for money-moving calls; defend against prompt injection in the application. | Test end-to-end behavior under adversarial inputs before granting meaningful value. |
| **Transaction simulation** | Provide documented simulation/checking behavior and surface warnings/failures. | Decide what simulation result is acceptable; do not treat simulation as a proof of future execution; validate high-value transactions independently where appropriate. | Investigate divergence between simulation and settlement. |
| **Idempotency / retries** | Honor documented idempotency/reconciliation semantics on supported money-moving endpoints and return stable request/status identifiers. | Persist durable idempotency keys; never blindly retry an unknown money-moving outcome; reconcile first. | Diagnose ambiguous outcomes using request IDs, status endpoints, provider/chain evidence and support escalation. |
| **Rate limits** | Enforce published limits and return documented retry/rate-limit metadata. | Respect limits, use bounded backoff, cache safely, and avoid retry storms. | Coordinate higher commercial limits only when capacity and abuse controls support them. |
| **Webhooks** | Sign events using the documented scheme; implement documented retry behavior; provide event identifiers where the contract says so. | Verify signatures over the exact bytes, enforce replay controls, handle duplicates, use idempotent consumers, protect callback endpoints. | Reconcile missed/out-of-order delivery using status APIs and delivery evidence. |
| **Route/provider selection** | Apply route eligibility and provider policy implemented by Suwappu; do not claim every provider participates on every route. | Set application constraints (allowed chains/assets/providers/slippage/value) appropriate to risk. | Monitor provider degradation and reconcile settlement failures. |
| **Third-party protocols/chains** | Integrate supported providers according to reviewed contracts and surface known upstream failures where possible. | Understand that blockchain/protocol/provider behavior is outside Suwappu's sole control; choose confirmations/finality/risk thresholds. | Handle provider outages, reorgs, bridge delays, token incidents and emergency disablement. |
| **Secrets / encryption** | Protect service-side secrets using implemented key-management/encryption controls; avoid exposing secret values in diagnostics. | Protect local/customer-side secrets and endpoint credentials; use an appropriate secret manager. | Rotate secrets after suspected compromise and verify old material is invalidated. |
| **Logging / observability** | Generate request IDs and service-side audit/telemetry according to the deployed configuration; protect sensitive data from ordinary logs. | Preserve client-side correlation IDs and application decision logs without storing raw secrets. | Correlate incidents across both sides. |
| **Software supply chain** | Maintain CI/security scanning, dependency controls and release provenance mechanisms that are actually implemented. | Pin and verify dependencies; consume supported releases; monitor dependency advisories in the customer's own application. | Respond to vulnerabilities across the integration boundary. |
| **Compliance / legal** | Accurately state Suwappu's current control/certification status and avoid unsupported claims. | Determine the customer's own regulatory, sanctions, tax, licensing, custody and reporting obligations. | Complete diligence appropriate to the intended use and jurisdiction. |

## Authority levels and minimum customer controls

### Levels 0–2: Discover, Quote, Simulate

Recommended baseline:

- scoped read-only credential where available;
- no signing keys in model/tool context;
- input validation and request budgets;
- rate-limit/backoff handling;
- application logging with request IDs.

### Level 3: Prepare unsigned transaction

Add:

- explicit chain/asset/value allowlists;
- destination/calldata review appropriate to the transaction type;
- signing in a separately controlled wallet boundary;
- confirmation that the transaction returned still matches the user's authorized intent;
- simulation before signing for unfamiliar or high-value flows.

### Level 4: Managed execute

Add:

- durable idempotency keys and unknown-outcome reconciliation;
- spending/value caps;
- destination/chain/pair restrictions where available;
- step-up/human approval appropriate to value and threat model;
- admin/account MFA and credential separation;
- alerting for abnormal execution;
- tested kill/revocation path.

An AI agent should not receive Level 4 merely because the model can call an execution-looking tool.

## Third-party custody/signing infrastructure

Suwappu integrates external infrastructure such as Turnkey where configured. Claims about hardware isolation, attestation, certification, or the security posture of an upstream provider remain the claims/evidence of that provider unless Suwappu independently verifies and publishes its own evidence.

Suwappu documentation should distinguish:

- **what Suwappu configures/enforces**;
- **what the upstream provider documents**;
- **what has been independently audited or attested**;
- **what remains roadmap work**.

Do not collapse those into a generic “TEE-secure” certification claim.

## Webhook consumer baseline

Until the canonical webhook-delivery contract is completed, integrations should assume they must tolerate duplicate delivery and independently reconcile important state.

A production webhook contract should eventually specify:

- signature algorithm and exact signed bytes;
- timestamp and replay window;
- event ID / deduplication key;
- retry schedule and maximum retry window;
- ordering guarantee (or explicit lack of one);
- retention/redrive behavior;
- secret/signing-key rotation procedure.

That work is tracked as developer-platform parity rather than implied by the existence of a callback URL.

## Incident responsibilities

### Suwappu

- contain service-side compromise or unsafe execution behavior;
- revoke/disable affected server-side credentials or routes when possible;
- preserve relevant logs/evidence;
- communicate material service incidents through the supported status/incident channels;
- publish a post-incident record when appropriate and safe.

### Integrator/customer

- revoke exposed customer credentials;
- disable affected automation/signing authority;
- preserve application and wallet evidence;
- monitor onchain/provider state;
- notify Suwappu with request IDs, transaction hashes, timestamps and affected account identifiers through the supported channel.

### Both

- do not retry unknown money movement until reconciled;
- agree on a safe recovery point before restoring automation;
- test restored policy/credential state rather than assuming rotation alone fixed the path.

## Security evidence and current limitations

The public security posture should remain evidence-driven.

Repository scanners, CodeQL, dependency audits, SBOM generation, CI gates, an integration with a security provider, or use of TEE-backed infrastructure are **not by themselves** equivalent to:

- a completed independent audit of the entire Suwappu money path;
- SOC 2 certification;
- a public trust center;
- a custody/license determination;
- proof that every optional provider/configuration inherits the same control environment.

Where a certification or external audit is not complete, say so. Parity with top infrastructure companies comes from producing the evidence, not changing the label.

## Builder checklist

Before production money moves through an integration:

1. Identify the highest authority level the integration actually needs.
2. Remove every credential/tool above that level.
3. Define chain, asset, value, destination and slippage policy.
4. Configure durable idempotency/reconciliation for managed writes.
5. Verify webhook signatures and duplicate handling.
6. Test credential rotation/revocation and the execution kill path.
7. Confirm current API/SDK support status and deprecations.
8. Subscribe to changelog/status channels when available.
9. Capture request IDs and transaction identifiers for support/debugging.
10. Complete security/compliance diligence appropriate to the value and jurisdiction.

See also: [API Lifecycle](../api-lifecycle.md) · [SDK Support](../sdk-support.md) · [Product Status](../product-status.md) · [Security](../../SECURITY.md).
