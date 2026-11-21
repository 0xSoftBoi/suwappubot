# Payday — settlement engine, integrations, and worker spectrum

Status: design v2 · Nov 2026 · companion to `payroll-engine.md` (kernel/data model) and `docs/research/payroll-ux/PARITY.md` (UI parity). MONEY-PATH throughout.

The pitch in one line: **bank-grade payroll for every kind of worker, on rails that cost almost nothing per payment and never close.**

---

## 1. Settlement engine: pay 1,000 people for less than one ACH fee

The naive approach (one ERC-20 transfer per person per payday) is what the shallow version did. It wastes gas and leaks salaries onchain. The engine below spends gas only when money actually leaves the system, and makes every payroll provable with one 32-byte commitment.

### 1.1 Layers, cheapest first

| Layer | What happens | Onchain cost | When used |
|---|---|---|---|
| **L0 Internal ledger** | Payee holds a Suwappu balance; payroll is a double-entry posting in `ledger_postings` | **0** | Payees who keep pay in Suwappu (spend card, savings, swap) — the default for most workers |
| **L1 Payroll commitment** | One tx per payroll writes a **Merkle root** of `(payee_commitment, amount, asset, payroll_id, salt)` leaves to a `PayrollRegistry` | **1 tx per payroll**, ~45–60k gas, no matter if 5 or 50,000 people | Every payroll; it's the public receipt |
| **L2 Claim vouchers** | Each leaf is redeemable: payee (or our relayer) presents a Merkle proof to `PayrollVault.claim()` and funds move | Paid only on withdrawal, sponsored, batchable | Payees who want funds in their own wallet |
| **L3 Batched push** | For payees on external wallets who want push delivery: one `Multicall3`/disperse tx per chain per payroll | 21k base once + marginal per recipient | Contractors on self-custody wallets |
| **L4 Cross-chain** | CCTP v2 (burn/mint, fast transfer) or LI.FI/Across, **netted per destination chain** — one bridge per chain per payroll, then L3 on the destination | 1 bridge per destination chain | Payee chose a chain that isn't the treasury chain |
| **L5 Fiat off-ramp** | Partner rails: ACH / RTP / FedNow (US), SEPA Instant, PIX, SPEI, UPI, mobile money, cash pickup | Partner fee | Bank, paycard, cash, remittance |

### 1.2 Why this is cheap (order-of-magnitude, Base L2, to be measured on testnet before any copy uses it)

| Method | Gas | Scales with |
|---|---|---|
| Separate ERC-20 transfer per payee | ~35k (existing holder) / ~52k (new holder) **each**, incl. 21k base | N × full tx |
| Batched push (Multicall3/disperse) | 21k once + ~10–13k (existing) / ~30k (new holder) per payee | N × marginal |
| Merkle commitment + lazy claims | ~50k **once**; claims ~60–80k each but only when someone withdraws, and claims from many payrolls can be redeemed in one proof batch | 1 + withdrawals |
| Internal ledger | 0 | nothing |
On Base, execution gas is cheap and the L1 data fee dominates, so calldata size matters: pack amounts as `uint96`, addresses as 20 bytes, and use the Merkle path to avoid per-payee calldata entirely.

**Solana path:** SPL transfers cost one 5,000-lamport signature fee per transaction, and ~20 transfers fit in one 1,232-byte tx (more with address lookup tables). The real cost is **associated token account rent (~0.002 SOL one-time per new recipient)**, so we pre-create ATAs only for payees who choose Solana, and we pay it once.

**Tempo path:** the repo already has `tempo_tip20.py`, `tempo_fee_sponsor.py`, `tempo_keychain.py` and `tempo_mpp.py`. Tempo gives native fee sponsorship, fees payable in stablecoins, and a **transfer memo field**, so we write the `payroll_id:line_id` into every transfer for exact bank-style reconciliation. Use Tempo as the default payroll settlement chain where corridors support it; Base and Solana as payee-choice chains.

### 1.3 Streaming without streaming transactions

Per-second streams (Sablier/Superfluid) cost a create tx per employee per period and a withdraw tx per withdrawal. Instead:
- **Accrual is off-chain math**: `earned(t) = rate × approved_seconds(t)`, shown live in the app.
- **Earned-wage withdrawal** is an L0 ledger move (free, instant) or an L2 claim against an **interim voucher** signed by the employer's payroll key (EIP-712: `payee, payroll_id, cumulative_amount, expiry`). Vouchers are cumulative, so only the latest one matters and nothing is double-spendable.
- **Payday** publishes the real Merkle root; the root supersedes interim vouchers. Net effect: per-second pay with **zero gas per second** and at most one claim per withdrawal.
- Keep Sablier as an export option for DAOs that want streams to be onchain objects.

### 1.4 Other gas and cost tricks
- **Netting:** within a payroll, internal transfers (employee → savings vault, garnishment → state disbursement escrow, tip pool → servers) net out on the ledger and never touch chain.
- **Paymaster + bundling:** ERC-4337 paymaster (`paymaster.py`) sponsors claims; the bundler batches many users' claims into one bundle. EIP-7702 lets EOAs batch claim+swap+bridge in one signature.
- **Permit2** for employer funding approvals (one signature, no approve tx).
- **Treasury chain choice:** keep the float on the chain where most payees settle; rebalance once per payroll, not per payee.
- **Gas-price aware scheduling:** non-urgent L3/L4 legs (e.g. contractors paid "by Friday") wait for cheap blocks within an SLA.
- **ATA / account pre-warming** only for active payees; dormant payees claim lazily.
- **Amount privacy:** leaves contain a salted commitment, not names. Optional **stealth addresses (ERC-5564)** for payees who don't want their salary wallet linkable.

### 1.5 Contracts (minimal surface)
- `PayrollRegistry` — `commit(payrollId, root, totals, assetMask)`; emits event; immutable history (public receipt).
- `PayrollVault` (per employer, ERC-4626-compatible share accounting for the float) — `claim(proofs[])`, `pushBatch(...)` (only by the payroll Safe), `sweepToYield()/recall()`; limits enforced in-contract (`maxPerPayroll`, payee allowlist root, 48 h payee-change timelock).
- Owned by the employer's **Safe** (2-of-3 default) with a **Zodiac Roles** module so the payroll operator key can only call `commit`/`pushBatch` within limits. Turnkey policies (`turnkey_policies.py`) mirror the same limits at the signing enclave: defence in depth.
- Audits before mainnet; Base Sepolia + Tempo testnet dry runs first.

### 1.6 Proof of income from the same root
A payee proves "I was paid ≥ $X/month by employer E for 6 months" by revealing Merkle inclusion proofs for their leaves to a verifier, **or** a ZK proof over them (amount ≥ threshold, employer = E) without revealing exact pay. Issue as an EAS/Arbiter attestation (`docs/arbiter-attestation-v1.md`) that landlords, lenders and benefits programs can check. No edited PDFs.

---

## 2. Integrations: the traditional stack, doubled down

Payroll is only as good as what plugs into it. Category → what it does for us → candidate partners (selection pending commercial review; none are signed).

### 2.1 Core payroll compliance (must-have for W-2)
| Need | Why | Candidates |
|---|---|---|
| Gross-to-net tax engine + filing/remittance | Federal/state/local withholding, 941/940/W-2, state UI | Check, Symmetry (tax engine), Gusto Embedded |
| Business registrations | State withholding + UI accounts for new states | Middesk, partner-provided |
| New-hire reporting | State requirement within ~20 days | Tax partner |
| Garnishments & child support | Court/agency orders, remit to State Disbursement Units | Tax partner + SDU EFT |
| Workers' comp (pay-as-you-go) | Premium per payroll, no annual audit surprises | NEXT, AP Intego, Pie |
| I-9 / E-Verify | Work authorization | Partner API |
| Background checks | Pre-hire | Checkr |
| Unemployment & leave admin | State programs (PFML) | Tax partner |

### 2.2 Benefits (the W-2 end of the spectrum)
| Benefit | Integration | Notes |
|---|---|---|
| Health, dental, vision | Broker/carrier connectivity (Noyo, Ease, Vericred for plan data) | Deductions sync both ways; ACA reporting (1095-C) |
| ICHRA / QSEHRA | ICHRA administrators | Lets a 6-person restaurant offer real health coverage |
| 401(k) / Roth | Recordkeepers with payroll APIs (Guideline, Human Interest, Vestwell) | Contributions, match, true-up, auto-enroll (SECURE 2.0), loans |
| HSA / FSA / DCFSA / commuter | Administrators (Lively, Alegeus, WEX) | Pre-tax deductions, cards |
| Life & disability | Carrier feeds | Imputed income for group-term life over $50k |
| Equity (RSU/ISO/NSO) and token grants | Carta, Pulley; onchain vesting (Sablier lockups, Hedgey) | Supplemental withholding at vest, 83(b) tracking |
| Tuition / student loan match | SECURE 2.0 student-loan 401(k) match | Differentiator for younger workers |
| Pay transparency | Salary bands per state law | Required in job posts in several states |

### 2.3 Time, tips, scheduling (the hourly end)
Toast, Square, Clover (tips + hours); 7shifts, Homebase, Deputy, When I Work (schedules, timesheets); geofenced mobile clock-in. Tip pooling and tip credits handled in the calc engine; **tips can pay out nightly via payout rules** (gas-free on L0).

### 2.4 Money in and out (fiat)
| Rail | Use | Candidates |
|---|---|---|
| Bank verification | Instant account verification, no failed debits | Plaid, MX |
| ACH / same-day ACH / wires | Employer funding, employee deposit | Column, Increase, Modern Treasury |
| **RTP / FedNow** | Instant US bank payouts, 24/7 | Same partners |
| Paycards | Unbanked workers, no bank account needed | Visa/Mastercard program via issuer (Gnosis Pay / Immersve for crypto-backed; Galileo/Marqeta-backed partners for fiat) |
| International | SEPA Instant, PIX, SPEI, UPI, Faster Payments, mobile money (M-Pesa, MTN), cash pickup | Local off-ramp partners, Bridge, Circle payouts, our P2P providers |
| Fiat ↔ USDC | Treasury funding/redemption at par | Circle Mint, Bridge, Coinbase |

### 2.5 Systems of record
HRIS via unified APIs (Merge, Finch) for BambooHR, Workday, Rippling, HiBob, etc.; accounting GL sync (QuickBooks Online, Xero, NetSuite, Sage Intacct) with class/location/department mapping; SSO (SAML/OIDC via WorkOS or Okta) and SCIM; Slack/Teams approvals; Telegram/WhatsApp worker notifications (already built).

### 2.6 Crypto integrations (deep, not decorative)
| Integration | Job | Repo piece |
|---|---|---|
| Tempo TIP-20 + fee sponsor + memo | Default settlement chain, memo = payroll line id | `tempo_tip20.py`, `tempo_fee_sponsor.py` |
| Turnkey | Passkey wallets for every worker, enclave-enforced policies | `turnkey_client.py`, `turnkey_policies.py` |
| Safe + Zodiac Roles | Employer treasury, scoped operator key | `SmartAccountService.ts` |
| CCTP v2 | Native USDC cross-chain with fast transfer | `cctp_*.py` |
| Morpho / Aave vaults | Float yield, worker savings | `treasury_vault_service.py`, `savings_service.py` |
| Swap engine (7+ chains) | Pay in anything, get paid in anything | `swap_engine.py` |
| x402 | AI agents and APIs paying people per task | `x402_service.py` |
| EAS / Arbiter attestations | Proof of income, employment verification | `docs/arbiter-attestation-v1.md` |
| World ID | Unique-human check for gig/payout-rule abuse without collecting IDs | `worldIdNullifiers` schema |
| ENS subnames | `maya.ramenbar.eth` pay addresses that survive wallet changes | (planned per NEOBANK_ROADMAP) |
| Gnosis Pay / Immersve | Spend card on the payroll balance | NEOBANK_ROADMAP |
| P2P off-ramp | Cash-out in corridors without banking partners | `p2p_*.py` |
| Blockscout | Receipt verification links | MCP / API |

---

## 3. The worker spectrum: one product, five people

| | **Rosa** — tipped server, unbanked, sends money home | **Kwame** — contractor in Ghana | **Diego** — hourly line cook, paycheck to paycheck | **Lena** — salaried GM, full benefits | **Priya** — engineer, equity + tokens |
|---|---|---|---|---|---|
| Gets paid to | Paycard or Suwappu balance (L0, free) | USDC → mobile money / local bank | Bank (RTP) + Suwappu balance split | Bank direct deposit | Bank + token grant vesting |
| Biggest pain today | Check-cashing fees ($5–$20/check), no account, remittance fees | 5–7 day SWIFT, 2–5% fees, $25 minimums | Payday loans, overdraft fees | Benefits complexity, tax forms | Equity/token tax withholding |
| What Payday does | Nightly tips via payout rule; paycard; **send home** to family in Mexico/Philippines at near-zero via USDC → local cash-out; no minimum balance | Instant USDC, choose local cash-out; W-8BEN handled; invoice auto-generated | **Earned-wage access free** (L0, no fee, no loan); savings bucket; bill-pay on payday | Benefits enrollment, 401(k) match, HSA, pay stubs, W-2, ACA forms | RSU/token vesting with supplemental withholding, sell-to-cover, 83(b) reminders, FMV records |
| Compliance | Minimum wage in USD; paycard rules (fee-free access option under state law) | Contractor classification, W-8BEN, local tax is theirs | FLSA overtime, tip credit | Full W-2, ACA | Supplemental wage withholding at vest |
| Proof of income | Attestation unlocks apartment / credit-builder | Attestation for visas / loans | Attestation for rent | Standard | Standard |

**Fee philosophy:** nothing a low-income worker touches costs money: L0 transfers, EWA, paycard ATM network in-network, remittance at FX mid-rate + network cost. Revenue comes from employers (per-person SaaS), float yield share (disclosed, opt-in), and FX/swap spread on optional conversions.

---

## 4. What employers see that no incumbent shows
- **Cost per payroll, by rail:** "This payroll cost you $0.04 in network fees for 412 payments (vs $2,060 at $5/ACH)."
- **Settlement map:** how many payees on L0 / claims / push / fiat, per chain, with live status.
- **Float earned** this year, by month.
- **Proof-of-payroll root** per payroll for auditors and lenders (payroll-backed credit lines).
- **Payroll-backed working capital:** a verifiable payroll history lets lenders underwrite a short-term payroll advance onchain (e.g. Morpho market against receivables). Phase 3, partner-dependent.

---

## 5. Build order (unchanged kernel, sharper settlement)
1. **P0:** ledger (L0) + Merkle commitment (L1) on Base Sepolia + Tempo testnet; receipts page.
2. **P1:** claims (L2) with paymaster; batched push (L3); CCTP netting (L4); EWA on L0.
3. **P2:** fiat rails (Plaid verification, RTP/ACH partner, paycard); tax engine partner; time/tip integrations (Toast, 7shifts).
4. **P3:** benefits (401(k) recordkeeper, health via ICHRA admin, HSA); GL sync; HRIS sync; SSO/SCIM.
5. **P4:** remittance corridors (MX, PH, IN, NG, GH, KE) via local off-ramps; proof-of-income attestations; equity/token vesting.
Every phase: money-path review + security audit + testnet dry run + a real small-value payout as the exit criterion.

## 6. Hard constraints to respect
- FLSA minimum wage in cash/negotiable instrument; state wage-payment laws on paycards (fee-free access) and on paying wages in non-USD. Crypto is always an employee election above that floor.
- Money transmission: fiat rails and card issuing via licensed partners only.
- Irreversible payments: payee-change timelock, allowlist, small first payment to new addresses.
- Salary privacy: no names or clear amounts onchain, ever.
