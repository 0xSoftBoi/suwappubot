# Gas inventory — every onchain write in suwappubot

Audited 2026-09-25. "Gas efficient everywhere" means: enumerate every
transaction the system can produce, attribute who pays, and either batch it,
skip it, or document why it's inherent. No guessed ABIs, no speculative
optimizations.

## Our gas (operator / owner keys)

### ENSv2 agent setup — 3 txs (was 5)

| Step | Tx | Notes |
|------|----|-------|
| Deploy resolver proxy | 1 | `VerifiableFactory.deployProxy`; owner policy records written inline via `initialize(..., setters)` |
| Register subname + set resolver | 1 | Parent `IStandardRegistry.register` sets resolver atomically |
| Authorize metadata keys | 1 | All `authorizeTextRoles` grants in one `multicall` |

Was 5 (separate tx per key grant). Saves ~42k base gas per agent.
Grants can't fold into `initialize()` setters: those delegatecall with
`msg.sender == VerifiableFactory`, which holds no admin roles.
See `ENSV2_SETUP.md` and `tests/ensGas.test.ts`.

### ENSv2 parent registration — 3 txs (inherent)

`approve` (USDC) + `commit` + `register`. Commit-reveal is protocol-mandated;
the ERC20 payment is per-registration. Nothing to batch across contracts
from an EOA.

### ENSv2 reads — 0 gas

Policy checks are `eth_call` via `UniversalResolverV2` (fresh `0x4a18…`)
with public-proxy fallback. Reads never cost gas.

### Autopilot anchor — 1 tx per decision (~22.7k gas, inherent)

Zero-value self-send carrying the seal memo as calldata. Fires once per
autopilot decision; each commitment is unique (random nonce), so no dedup
applies. The memo (`suwappu-autopilot:v1:<algo>:<commitment>`, 104 bytes)
is a deliberate third-party-verifiability spec — compressing it to the raw
32-byte commitment would save ~1.1k gas (~5%) but break external verifiers.
Not worth a protocol change for 5% on a cheap L2 tx.

### RecurringBilling (Base Spend Permissions) — gated OFF, untested

- `approveWithSignature`: 1 tx per permission. Re-approving an approved
  permission reverts (wasted gas). A pre-check via the manager's `isApproved`
  view would skip it, but the local ABI only carries the two write functions
  and the view signature was not verifiable without an explorer API key —
  so no guessed ABI was added. Revisit with a verified ABI before live use.
- `spend`: 1 tx per charge. Inherent (one pull per period).

## User's gas (we build it, they sign via Turnkey)

### Swap execution — 1 tx + approval only when needed

- Allowance is checked onchain before any approval tx; no redundant approves.
- Default approval mode is `unlimited` (max uint256): the router is approved
  once, not per swap. `exact` mode is available for zero standing allowance.
- `maxPriorityFeePerGas` is `0x0`: minimal fee cost (slower inclusion is the
  tradeoff, acceptable for the current UX).
- Swap calldata is quoter-built (LiFi/1inch/Uniswap); nothing of ours to pack.

### x402 payments — payer-signed

The payer signs; settlement is via the facilitator. Not our gas to optimize.

## Demo / fixtures

`src/demo/live.ts` and the trust-layer demo do zero onchain writes —
all fixtures/mocks. Nothing to optimize.

## Summary

| Path | Txs | Payer | Status |
|------|-----|-------|--------|
| ENSv2 agent setup | 3 (was 5) | owner | ✅ batched |
| ENSv2 parent registration | 3 | owner | inherent |
| ENSv2 policy reads | 0 | — | free |
| Autopilot anchor | 1/decision | operator | inherent (spec) |
| RecurringBilling approve | 1/permission | operator | gated; pre-check TBD |
| RecurringBilling spend | 1/charge | operator | inherent |
| Swap | 1 (+approve if needed) | user | ✅ already optimal |
| x402 | — | payer | n/a |

Rule going forward: every new write path gets a row in this table before it
ships. If it costs our gas, it gets batched or skipped — never retried blind.
