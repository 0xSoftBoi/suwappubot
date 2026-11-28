# Neobank final fix status

## Job 1
- a journal order: DONE. Journal had 0034, 0036, 0037, 0035 (idx 35-37). Not a functional problem today: 0035/0036/0037 touch disjoint objects, none depends on another, and drizzle applies in journal order. But the migrator only applies entries whose `when` is newer than the last applied `created_at`, so the out-of-order numbering was a latent trap. Re-sequenced: idx35=0035 (when 1791600000000), idx36=0036 (1791700000000), idx37=0037 (1791800000000). SQL untouched. Safe for prod/dev (none of 0026+ applied; DBs that applied under old whens already have max 1791800000000 so nothing re-runs).
- b proofs: DONE.
  - A (bank_proof_a, `drizzle-kit migrate` from empty): rc=0, 38 migrations recorded, 64 bank_* tables; second migrate rc=0; python init_db after it OK. No SQL errors (only "already exists, skipping" NOTICEs).
  - B (bank_proof_b, python init_db first, drizzle history seeded through 0025, `drizzle-kit migrate`): rc=0, 38 migrations, 64 bank tables; second init_db + second migrate rc=0. No SQL errors.
  - Logs: scratchpad/proof/*.log.
- c Python DDL: DONE. Every database/bank_ddl/*.py ran twice on B (postgres) and twice on SQLite: all OK. review3.py is fine. No fixes needed, no Python changed.
- d schema diff: DONE. A vs B identical except cosmetic default text ('0' vs 0, now() vs CURRENT_TIMESTAMP). Vs Drizzle schema: only mismatch was two partial unique indexes present in SQL/Python but missing from Drizzle (ux_bank_credit_lines_unsecured_active, ux_bank_credit_lines_recv_active); added to api-ts/src/db/schema/bankEarnCredit.ts. Re-run: no mismatches. No 0039 migration needed.
  - Confirm-list present in both A and B: ux_bank_ledger_posted, ux_bank_transfers_idem, bank_transfers.claimed_at/claim_token, ux_bank_invoice_payments_receipt, ux_bank_credit_lines_recv_active (partial, active), ux_bank_credit_lines_unsecured_active (partial), ux_bank_credit_ops_line_key, ux_bank_agent_sales_nonce (chain, auth_nonce), bank_card_shortfalls, bank_org_wallets (ux_bank_org_wallets_org_family), ux_bank_payroll_runs_period (schedule_id, period_key).

## Job 2
- e partner fee atomicity: NOT STARTED (no edit made) (design: optional feeLeg on TransferInput; principal+fee rows inserted in one tx in insertTransferGuarded reserving amount+fee under source row lock; fee advanced after principal; deferred behind g1-g4)
- f/g6 card refund: PARTIAL. DONE: refund checked against principal minus other pending refunds; cardref ops excluded from pendingTotals so they no longer block borrower repays; distinct event `card_refund_pending` (status AWAITING_REFUND_INFLOW, visible via GET /credit/events) that does not reset the 45-day delinquency clock (BankCreditService.ts repayForRefund ~:1121, pendingTotals ~:512). NOT DONE: the confirmed inflow leg. The provider refund lands at the program settlement address (BANK_CARD_SETTLEMENT_ADDRESS_*), which is provider/program-owned, not a custody wallet we can sign from; sweeping it to the pool account (transfer carrying metadata.cardRefundTxn) needs an ops/off-chain action or provider-side key and cannot be faked in code. The existing settlePendingPoolOps already applies the op once such a confirmed transfer exists.
- g receivables financing race: DONE (see g2)
- h DONE: new routes/bank/retry.ts setRetryAfter(c, e) used by bank.ts run(), payments.ts public invoice, agents.ts paywall, webhooks.ts.
- check / check:openapi: `bun run check` clean; `check:openapi` in sync.

## Coordinator addendum (order: g1-g4 unit, g6, g5, g7, g8, then e, h)
- g1 owner columns: DONE/NOT-A-BUG-AS-STATED. bank_invoices DOES have owner_type/owner_id (schema bankPaymentsPayroll.ts:24-25, always = payee; verified in DB A/B), so the check worked. Hardened anyway: finance now reads payee_owner_* first (BankCreditService.ts ~:994).
- g2 (= item g) DONE: finance re-checks status/paid/amount/parties/acceptance under `select ... for update` on the invoice inside the finance tx (BankCreditService.ts ~:1017); voidInvoice now locks the row, re-checks paid + active receivable line, then updates (BankPaymentsService.ts ~:394). creditInvoiceSql is a single UPDATE so it takes the same row lock implicitly and blocks behind finance. Invoice mutators enumerated: publish (draft->open), void, scanCursor, overdue job, creditInvoiceSql; none edits amount after creation, so there is no amount-edit path to invalidate acceptance (no DDL added).
- g3 DONE: advance = 80% of (amount - paid); zero outstanding refused; in-tx recheck refuses if outstanding changed.
- g4 DONE (incl. org-member relatedness via relatedRoots: issuer/payer sets intersect => refused): issuer/payer resolved to root principal (agent->agents.owner_user_id, org->bank_orgs.owner_user_id, user->id) and rejected if equal; advances per payer capped by the issuer score limit; financing refused while any issuer non-collateral line is delinquent. Org members beyond the owner are not resolved.
- g5 DONE: one USD cap (UNSECURED_CAP_UNITS=5000) per ROOT principal across unsecured + receivable lines, all assets/chains, covering the user, their agents and orgs they own; priced via BankBooksService.resolveRate (fails closed); serialised by a cross-process root lock (withRootLock). BankCreditService.ts rootRoomMinor/withRootLock, used in openUnsecuredLine and financeReceivable.
- g6: PARTIAL (see f)
- g7 DONE: derived hold provider 'receivable_collection' (BankCreditService.ts, before settleReceivable): while a receivable line on the payee account has an invoice with paid_minor>0, owed+1 is held in the same transaction that credits the invoice (no stored hold; no DDL). Collection transfer consumes that hold. Retry: retryPaidReceivableCollections runs inside settlePendingPoolOps (already scheduled by the 'earn-credit' job) with 15-min-bucketed refs; failures logged. A separate registerBankJob was not needed.
- g8 DONE: accruedSince rounds seconds and interest UP (BankCreditService.ts ~:273); no DDL/carry column needed.

check after g1-g4: `bun run check` clean.

- f remainder: interest no longer accrues on refunded-but-unapplied portions (refund op created_at -> now; accruedSince `refunds` param, refundReductions; also honoured at apply time). Remaining f items still open (see below).
- f remainder: PARTIAL. DONE: card_refund_pending event message, owner-scoped GET /credit/refunds/pending (id, amount, age, totals), Blockers section in docs/plans/neobank-execution.md. NOT DONE: ops-wide (admin) list (no admin scope exists in bank routes) and the card transaction view text (BankCardService is being edited by others).
- DDL: none was required (all derived from existing tables), so no 0039 migration. A SQL sanity query for the hold ran on bank_proof_a.
- e: NOT STARTED (BankTransferService.ts has other editors).
- Final: bun run check clean; check:openapi in sync.

## Items e-e6
- e partner fee atomicity: DONE (compile-checked). BankTransferService.ts: optional `feeLeg` on TransferInput + exported feeKeyFor; fee row `${key}:pfee` inserted in the SAME tx as the principal in insertTransferGuarded under the source-row lock (available >= amount+fee, daily limit includes fee); replay with a changed fee = CONFLICT via requestHash; advance() gates the fee row on principal status (confirmed -> proceeds, failed -> voided unfunded, else waits; poller completes it, so no fee-without-transfer window). BankFxService.ts: same feeLeg for fx. BankPartnerService.ts: withFeeFirst/chargeFee/refund removed; feeLegFor (bps 0..10000, floor math, legacy `${key}:fee` only suppresses a new fee when live AND not refunded); webhook enqueue failures ignored after money moved. Fee settlement choice: real transfer to partner revenue wallet gated on principal confirmation (separate on-chain send if wallet differs), not a same-ledger-tx credit, to keep revenue balances backed on-chain. Deviation from brief: fee is its own row/ledger phases, not legs inside the principal's ledger tx.
- e2 segments.ts: DONE. setAccountSegment now runs in one transaction with the account row selected FOR UPDATE before the open-position check and update.
- e6: NOT STARTED
- e3: NOT STARTED
- e4: NOT STARTED
- e5: NOT STARTED
