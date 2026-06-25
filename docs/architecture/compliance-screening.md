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
| Node-level enforcement | Application-layer gate before signing (see scope note) |
| Relay/builder routing | **Out of scope** for this change — separate infra track |

### Scope and honest limitations

- **Application-layer, not node/EL-level.** This gate covers every transaction
  **Suwappu originates**, which is what matters for a custodial bot flow: a
  non-compliant swap is never signed or sent. It does **not** cover
  transactions we don't originate — that would require running a configured
  execution-layer node (the actual Nethermind PoC), which is a separate
  infrastructure effort.
- **Relay routing not included.** The private-orderflow half of the PoC
  (Flashbots / MEV-Share `eth_sendBundle`) is not implemented here. The bot
  currently uses CoW Protocol for MEV-protected EVM swaps and Jito for Solana.
  A compliant-routing path would be a follow-up, modeled on `jito_api.py`.
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

### Rollout recommendation

1. Deploy with `COMPLIANCE_MODE=monitor` to shadow-screen production traffic
   and surface any false positives in logs (`Compliance MONITOR (would block…)`)
   without affecting users.
2. Once logs are clean, switch to `COMPLIANCE_MODE=enforce`.
3. For a UBS-style "permissioned" deployment, set
   `COMPLIANCE_POLICY=allowlist_only` and populate `COMPLIANCE_ALLOWLIST`.

## Implementation

- `bot/services/compliance/compliance_service.py` — `AddressComplianceService`
  (global `compliance_service`), `ComplianceMode`, `ScreeningPolicy`,
  `ComplianceResult`, `ComplianceError`.
- `bot/services/compliance/ofac_list.py` — seed sanctions set + file loader.
- `bot/services/swap_engine.py` — the gate, in `execute_swap`, after the
  spending-limit check and before balance validation. Screens the swap's
  `recipient`, `router`, and token contracts.
- `tests/test_compliance_screening.py` — mode/policy/list coverage.

### Screening flow

```
execute_swap()
  ├─ spending-limit check
  ├─ compliance_service.screen(recipient, router, tokens, chain)   ← gate
  │     └─ disabled? → allow
  │        monitor?  → log violations, allow
  │        enforce?  → block if any address sanctioned / not pre-approved
  ├─ validate_balance()
  └─ build → sign → broadcast
```

## Future work

- **Compliant routing (stage 2):** add a Flashbots / MEV-Share bundle sender so
  screened transactions are submitted as private bundles to approved builders,
  matching the PoC end-to-end.
- **Node-level enforcement:** run/configure a Nethermind node with custom
  tx-pool rules for true EL-level compliance over all orderflow.
- **Live sanctions feed:** scheduled refresh of the OFAC SDN crypto list, or a
  Chainalysis/TRM screening adapter behind `AddressComplianceService`.
