# ADR 0007: Single-authority managed-agent wallets

**Status:** Proposed
**Classification:** Core
**Related:** ADR 0002, ADR 0005

## Context

The agent API historically created a Turnkey wallet in TypeScript, then asked
the Python execution service to provision a wallet without registering that
provider identity. Python created a second wallet instead. The agent advertised
the TypeScript address while managed swaps loaded and signed with the Python
wallet ID. The same endpoint also derived its synthetic user identity with
Python's process-randomized `hash()`, so the mapping could change after restart.

This crossed the custody and execution boundary with no single authoritative
wallet identity. A deposit and the signer selected to spend it could therefore
refer to different keys.

## Decision

The Turnkey wallet created by the TypeScript agent surface is the authoritative
managed-agent wallet. TypeScript durably records its address and sub-organization
before calling Python. Python registers that exact provider identity as a
`Wallet` row and never creates a second wallet for this flow.

Provisioning is idempotent. An exact-value JSONB compare-and-set records a short
provisioning lease before any provider call, so only one concurrent request may
mint. Other callers reload and resume the winner's published identity. A
completed metadata version is written only after Python returns the same address
with valid internal user and wallet IDs.

Managed-wallet metadata is server-owned. Registration and profile update reject
every reserved key, and the service layer preserves those keys whenever it
replaces caller-owned metadata and strips attempted reserved keys during direct
registration calls. Version 1 is treated as legacy because metadata was still
caller-writable when it existed; version 2 follows these protections. Legacy
address/sub-organization records are not trusted directly: the configured
Turnkey parent must uniquely list the claimed child ID for the deterministic
organization name, then the child must report the deterministic organization
and agent username and list the claimed address. Failure is closed with an
operator-repair error; only verified legacy identities replace stale Python IDs.

Python assigns each managed agent a deterministic negative `telegram_id` derived
from SHA-256 of the canonical agent UUID. The negative namespace cannot overlap
real Telegram users. The full UUID is stored alongside it, and any digest
collision fails closed rather than aliasing two agents.

Python serializes first registration with a transaction-scoped advisory lock and
allows only one active Turnkey wallet per deterministic user and chain. Before
execution it locks both internal rows and requires one consistent, active
Turnkey identity: agent UUID, user ID, wallet ID, owner, provider, chain, and
address must agree. Lock acquisition is ordered process-wide async wallet lock
first, then fail-fast `FOR UPDATE NOWAIT` row locks. The row locks remain held
through the swap engine return, so the validated signing identity cannot change
between check and use without synchronously blocking the event loop on a second
same-wallet request.

## Consequences

- The funded/advertised address and the unattended execution signer are the same
  wallet by construction.
- Cross-service timeouts leave a resumable pending identity; they do not cause a
  retry to mint a second wallet.
- Existing split records fail closed at execution and can be repaired by calling
  the wallet-provisioning endpoint again.
- Verified legacy records gain the wallet/account IDs returned by Turnkey when
  available. Unverifiable records require explicit operator repair.
- Turnkey creation and database publication cannot be one transaction. Losing a
  won provisioning lease after provider creation requires operator repair and
  may leave an unreferenced provider wallet; it is never selected for swaps.
- A stale pre-mint lease is never reclaimed automatically, because the server
  cannot prove whether the prior winner already created a provider wallet. It
  fails closed for operator reconciliation instead of risking a second wallet.
- Execution holds a database transaction and row locks during external swap
  execution. This prioritizes identity safety but consumes a connection longer.
- Changes to this ownership or execution-binding contract remain MONEY-PATH and
  require adversarial review.
