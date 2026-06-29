# Compliance screening (UBS × Nethermind PoC model)

## Background

In June 2026, [UBS and Nethermind announced](https://www.ubs.com/global/en/media/display-page-ndp/en-20260623-nethermind.html)
two proofs of concept showing that a regulated financial institution can
transact on **public Ethereum** while meeting compliance requirements —
without forking or modifying the protocol. They enforced compliance at two
points:

1. **Node-level compliance** — an Ethereum node configured to apply
   customizable rules: restrict transactions to **pre-approved addresses** and
   block disallowed smart-contract interactions.
2. **Compliant transaction routing** — approved transaction bundles routed
   through relays to selected builders to guarantee inclusion (Flashbots-style
   private orderflow), instead of the public mempool.

Tested on Sepolia; no live transactions.

## What Suwappu implements

We adapt **stage 1** (the compliance gate) to Suwappu's **application layer**.
Every swap is screened *before it is signed or broadcast*, at the single choke
point all swap entry paths funnel through: `SwapEngine.execute_swap`.

| PoC concept | Suwappu equivalent |
|---|---|
| Restrict to pre-approved addresses | **Allowlist** policy (`allowlist_only` / `allowlist_and_blocklist`) |
| Block disallowed interactions | **Blocklist** (OFAC seed list + operator-configured addresses) |
| Relay/builder routing | **Flashbots private routing** (`eth_sendPrivateTransaction`) — implemented |
| Node-level enforcement | Application-layer gate before signing (see scope note) — not node/EL-level |

We implement **both** PoC stages at the application layer:

1. **Stage 1 — compliance gate.** Screen every swap's addresses before signing.
2. **Stage 2 — compliant routing.** Send screened same-chain EVM swaps privately
   to block builders via the Flashbots relay, off the public mempool — the EVM
   counterpart of the existing Jito path for Solana.

### Scope and honest limitations

- **Application-layer, not node/EL-level.** The gate covers every transaction
  **Suwappu originates**, which is what matters for a custodial bot flow: a
  non-compliant swap is never signed or sent. It does **not** cover
  transactions we don't originate — that would require running a configured
  execution-layer node (the actual Nethermind PoC), which is a separate
  infrastructure effort.
- **Relay routing is wired into the primary same-chain EVM swap path** (the
  Li.Fi/aggregator execution path) and any future call site that uses the
  `SwapEngine._broadcast_evm_tx` helper. Approval transactions, cross-chain
  bridge legs, and non-EVM paths still use the public RPC path. Routing is
  best-effort with a guaranteed public-RPC fallback on any relay error, so it
  can never break a swap. CoW Protocol remains available for batch-auction
  MEV protection.
- **EVM only.** Only `0x…` addresses are screened. Solana / TRON / Starknet
  addresses pass through untouched.
- **Seed sanctions list.** The bundled OFAC list (`ofac_list.py`) is a curated
  seed subset (Tornado Cash et al.), not exhaustive. Production deployments
  should point `COMPLIANCE_OFAC_LIST_PATH` at a maintained feed or swap in a
  commercial screening API (Chainalysis / TRM) behind the same interface.

## Configuration

All flags live in `bot/config/settings.py` and default to **off**, so existing
behaviour is unchanged until explicitly enabled.

| Setting | Values | Default | Meaning |
|---|---|---|---|
| `COMPLIANCE_MODE` | `disabled` / `monitor` / `enforce` | `disabled` | `monitor` logs violations but allows; `enforce` blocks |
| `COMPLIANCE_POLICY` | `blocklist_only` / `allowlist_only` / `allowlist_and_blocklist` | `blocklist_only` | Which lists apply (blocklist always wins) |
| `COMPLIANCE_BLOCKLIST` | CSV of `0x…` addresses | `""` | Operator blocklist, merged with the OFAC seed |
| `COMPLIANCE_ALLOWLIST` | CSV of `0x…` addresses | `""` | Pre-approved addresses (allowlist policies only) |
| `COMPLIANCE_OFAC_LIST_PATH` | file path | `""` | Newline-delimited sanctions file merged with the seed |

Compliant-routing flags (stage 2):

| Setting | Values | Default | Meaning |
|---|---|---|---|
| `COMPLIANCE_ROUTING_ENABLED` | bool | `false` | Route screened same-chain EVM swaps privately via the Flashbots relay |
| `FLASHBOTS_RELAY_URL` | URL | `https://relay.flashbots.net` | Flashbots-compatible relay endpoint |
| `FLASHBOTS_SIGNER_KEY` | hex key | `""` | Auth-header identity key (never holds funds; ephemeral if empty) |
| `COMPLIANCE_ROUTING_CHAIN_IDS` | CSV of ints | `1` | Chain IDs whose swaps route through the relay |
| `FLASHBOTS_MAX_BLOCK_OFFSET` | int | `25` | Future-block validity window for a routed tx |

### Rollout recommendation

1. Deploy with `COMPLIANCE_MODE=monitor` to shadow-screen production traffic
   and surface any false positives in logs (`Compliance MONITOR (would block…)`)
   without affecting users.
2. Once logs are clean, switch to `COMPLIANCE_MODE=enforce`.
3. For a UBS-style "permissioned" deployment, set
   `COMPLIANCE_POLICY=allowlist_only` and populate `COMPLIANCE_ALLOWLIST`.
4. To route privately, set `COMPLIANCE_ROUTING_ENABLED=true` and (recommended)
   a stable `FLASHBOTS_SIGNER_KEY` so relay reputation persists.

## Implementation

- `bot/services/compliance/compliance_service.py` — `AddressComplianceService`
  (global `compliance_service`), `ComplianceMode`, `ScreeningPolicy`,
  `ComplianceResult`, `ComplianceError`.
- `bot/services/compliance/ofac_list.py` — seed sanctions set + file loader.
- `bot/services/compliance/flashbots_relay.py` — `FlashbotsRelay` (global
  `flashbots_relay`), `eth_sendPrivateTransaction` submission + signed
  `X-Flashbots-Signature` auth, with `RelayResult`.
- `bot/services/swap_engine.py` —
  - the **gate**, in `execute_swap`, after the spending-limit check and before
    balance validation. Screens the swap's `recipient`, `router`, and token
    contracts.
  - the **routing helper** `_broadcast_evm_tx`, used by the primary swap
    broadcast: routes privately when configured, else public RPC, with fallback.
- `tests/test_compliance_screening.py` — gate: mode/policy/list coverage.
- `tests/test_compliance_routing.py` — relay: routing gate, auth header,
  submit success / error / fallback paths.

### Screening + routing flow

```
execute_swap()
  ├─ spending-limit check
  ├─ compliance_service.screen(recipient, router, tokens, chain)   ← stage 1 gate
  │     └─ disabled? → allow
  │        monitor?  → log violations, allow
  │        enforce?  → block if any address sanctioned / not pre-approved
  ├─ validate_balance()
  └─ build → sign → _broadcast_evm_tx(web3, signed, chain)         ← stage 2 routing
        └─ routing enabled & chain supported?
             ├─ yes → eth_sendPrivateTransaction (Flashbots relay)
             │          └─ relay error? → fall back to public send_raw_transaction
             └─ no  → public send_raw_transaction
```

## Future work

- **Wider routing coverage:** extend `_broadcast_evm_tx` to approval txs and
  additional aggregator paths; add MEV-Share bundle support and per-chain
  relays beyond Ethereum mainnet.
- **Node-level enforcement:** run/configure a Nethermind node with custom
  tx-pool rules for true EL-level compliance over all orderflow.
- **Live sanctions feed:** scheduled refresh of the OFAC SDN crypto list, or a
  Chainalysis/TRM screening adapter behind `AddressComplianceService`.
