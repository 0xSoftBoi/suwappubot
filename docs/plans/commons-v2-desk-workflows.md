# Commons v2 Clearing House: operator workflows

Status: spec for the `/commons` → Clearing House desk, 2026-11-06. Contract: `CommonsClearingHouse` (Base Sepolia `0x489b93a0…77dd`). Companion to `commons-v2.md` §2.

**Persona.** A treasury or ops operator at a business inside a trade-credit network: suppliers, customers, partners. They are not a DeFi user. They think in terms of counterparties, invoices, limits, exposure, statements and month-end, not addresses and calldata. They may sign through a Safe (ERC-1271) or hand signed intents to a relayer such as our bot.

**Principle.** Every screen answers one question: *"What do I need to do next, and is it safe to do?"* State changes come from on-chain events. Anything off-chain (labels, references, notes) is clearly marked as local.

---

## W1. Onboard a counterparty

1. **Identify.** Paste an address and give it a label ("Acme Supplies"). From then on the label is shown everywhere instead of hex.
2. **Review their standing.** Check their on-chain record before extending credit: repaid volume, cleared volume, defaults, cures, write-offs.
3. **Propose terms.** Set the credit I extend, the fee APR, the grace period (at least 1 day) and the clearable flag. Terms are hash-bound.
4. **Counterparty responds** from their own Inbox, with one of:
   - **Accept** (binds to the terms hash, and they set the credit they extend back),
   - **Reject**,
   - **Counter-propose**, which is a reject plus a new proposal with their terms in one flow.
5. While it's pending, my proposal sits in *Waiting on them*. I can cancel it.

## W2. Daily operations

- **Inbox first.** Anything needing action is listed with a single primary button:
  - an incoming proposal → review, accept or counter
  - a demand against me → settle, with a countdown to default
  - grace elapsed on my demand → mark default, or write off
  - money in escrow → withdraw
  - a line at ≥ 90% utilization → raise the limit or settle
- **Pay on credit** with an optional **reference** (invoice number, PO). References are local metadata keyed by tx hash, because the contract has no memo field.
- **Batch payments.** Paste or upload `counterparty,amount,reference` rows. Each row is validated against live headroom (limit minus what's owed) before anything is sent, then executed as sequential txs or as a batch of signed intents for the relayer.
- **Routed payments** pay someone you have no line with, through intermediaries who opted in, with a live fee quote and a max-fee guard.

## W3. Risk and limits

- Per line: utilization in each direction, plus a lifecycle indicator showing the current state and the next legal step.
- Book level: **concentration**, meaning the share of total receivables held by the largest counterparty. Lines at ≥ 90% utilization get flagged.
- Change the credit I extend at any time. Lowering it only blocks new debt.
- Routing consent is set per counterparty: a route cap of 0 means no one can be routed through me to them.

## W4. Clearing run

1. Run the solver in one of two scopes: *through me*, or *whole network* (permissionless).
2. Review the cycles, the gross debt removed, interest avoided and my net interest effect.
3. Submit one `clear()` batch. Afterwards the activity log shows "Clearing" entries decoded from the tx.

## W5. Settlement and collections

- **Settle (debtor).** Settle the full balance or part of it; the tokens go to escrow.
- **Collect (creditor).** Demand → wait out the grace period → mark default, or write off. Either way, withdraw escrow to any address.
- **Settle all.** One action settles everything I owe across all lines (approve, then settle each line).

## W6. Reporting and month-end

- **Counterparty statement.** For any period: opening balance, every movement (payments, settlements, clears, write-offs), and the closing balance. Interest shows as the reconciling line (closing − opening − movements), because accrual emits no event. CSV export.
- **Book export.** Positions CSV and activity CSV (with references), plus an address-book export/import so the team shares one set of labels.

## W7. Controls

- **Relay mode.** Every action can be signed as an EIP-712 intent, with decoded params shown before signing. Batches produce a list of intents.
- **Safe and smart accounts** work through WalletConnect (txs) and ERC-1271 (intents). No extra contract work is needed.
- **Testnet guard.** Everything is labelled testnet/unaudited until the external audit.

---

## Gap audit of the `accbed30` desk

| Workflow | Status before this pass |
|---|---|
| W1 labels / address book | **missing**: hex everywhere |
| W1 counter-propose | **missing**: reject and re-propose were two separate manual steps |
| W1/W2 Inbox ("needs your action") | **missing**: incoming proposals were just a row marked "Proposed" |
| W2 payment references | **missing** |
| W2 batch payments | **missing** |
| W3 lifecycle indicator / next step | **missing** |
| W3 concentration, utilization alerts | partial: utilization bar only |
| W5 settle-all | **missing** |
| W6 counterparty statement | **missing** |
| W6 address-book export/import | **missing** |
| W4 clearing run, W2 routed pay, W5 demand/default/write-off/withdraw, W7 relay | present |
