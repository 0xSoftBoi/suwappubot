# PR #1151 review-thread triage, second pass

Source: review threads on https://github.com/0xSoftBoi/suwappubot/pull/1151, re-read after fix commit `7362ce5`.
Code verified against: working tree at `919dc48` (journal commit on top of `7362ce5`) on `claude/cool-noether-mh0l2k`.
First pass: `docs/plans/neobank-1151-review.md` (57 rows). Fix log: `docs/plans/neobank-1151-fix-status.md`.
Read-only triage: no source changed, nothing posted to GitHub. Review text was treated as claims to verify.

Thread URLs are abbreviated `r<id>` = `https://github.com/0xSoftBoi/suwappubot/pull/1151#discussion_r<id>`.

## Thread state log (as returned by GitHub)

Page 1 (20 threads, all created 02:22-02:27Z, none new):
- resolved + outdated: r4725045662, r4725045685, r4725045718 (CodeQL), r4725061502, r4725061504, r4725061515, r4725061519, r4725061522, r4725061525, r4725061528
- resolved, not outdated: r4725061521 (row 9, App.tsx:165)
- unresolved + outdated: r4725050363 (row 1), r4725050504 (row 4), r4725050577 (row 5), r4725050635 (row 6), r4725050728 (row 7), r4725050777 (row 8), r4725050823 (row 9)
- unresolved, NOT outdated (live): r4725050407 (row 2, BusinessExtra.tsx:261-266), r4725050465 (row 3, PayInvoice.tsx:134-145)

Page 2 (20 threads, all created 02:27Z, none new):
- resolved + outdated: r4725061532, r4725061538, r4725061544, r4725061548, r4725061549, r4725061551, r4725061554, r4725061558, r4725061563, r4725061569
- resolved, not outdated: r4725061531 (row 13), r4725061555 (row 21), r4725061561 (row 23), r4725061574 (row 27), r4725061576 (row 28)
- unresolved + outdated: r4725061536 (row 15)
- unresolved, NOT outdated (live): r4725061560 (row 22, BankSettings.tsx:11), r4725061566 (row 6, App.tsx:165), r4725061571 (row 26, useBankCore.ts:68), r4725061578 (row 29, docs/plans/neobank-prod-smoke.md:27)

Page 3 (20 threads, all created 02:27Z, none new):
- resolved + outdated: r4725061580, r4725061585, r4725061589, r4725061591, r4725061593 (regex duplicates), r4725061597, r4725061616, r4725061631, r4725061636, r4725061649, r4725061652
- resolved, not outdated: r4725061594 (row 33), r4725061620 (row 39), r4725061633 (row 37)
- unresolved + outdated: r4725061599 (row 35), r4725061603 (row 36), r4725061640 (row 43)
- unresolved, NOT outdated (live): r4725061582 (row 22, BankHome.tsx:81), r4725061607 (row 37, AccountSelect.tsx:10), r4725061627 (row 40, PayInvoice.tsx:85)

Page 4 (12 threads, all created 02:27:48Z, none new; `hasNextPage` false):
- resolved + outdated: r4725061656, r4725061667, r4725061674, r4725061680, r4725061687, r4725061690, r4725061691, r4725061697
- resolved, not outdated: r4725061662 (row 47), r4725061678 (row 51)
- unresolved, NOT outdated (live): r4725061670 (row 49, a11yToast.tsx:93), r4725061693 (row 56, docs/plans/neobank-terminal-port-status.md:5)

Totals: 72 threads on 4 pages. Resolved 50, unresolved 22 (11 outdated, 11 live). Latest first-comment timestamp 2026-11-28T02:27:48Z.

## A. New threads

None. All 72 threads were created between 2026-11-28T02:22:24Z and 02:27:48Z, before the 03:00Z cutoff, and every one is covered by the first triage (67 triaged into 57 rows, 5 regex threads skipped as fixed in `985fadd`). `totalCount` is still 72, the same as the first pass.

What changed since the first pass is thread state only: cubic-dev-ai marked many threads "Addressed in" `10e0ffa`, `737d6ce`, `3ea387c`, `e835070`, `7362ce5` and resolved them (latest update 02:50:14Z, so cubic has processed the fix commit). No devin-ai-integration thread has been resolved or re-commented, and neither reviewer has opened a thread on the fix commit yet. A later re-review could still add threads.

| file:line | claim | verdict | severity | fix side | concrete fix | thread URL |
|---|---|---|---|---|---|---|
| (no new threads) | | | | | | |

## B. Spot-check of first-pass fixes (money rows + security row)

| row | status | evidence in current code |
|---|---|---|
| 2 (org transfer unscaled amount) | FIX CONFIRMED | Central: `terminal/src/lib/bankApi.ts:296-298` `isKnownDecimals` (integer 0..36) and `:305-306` `parseToMinor` returns null otherwise, so no call site can scale with undefined/NaN/non-integer decimals (24 call sites grepped; no other scaling path: no `padEnd`, `parseFloat`, `10 **` outside bankApi.ts:278,313). Server: `api-ts/src/routes/bank/business.ts:112-113` maps `presentAccount` over org accounts. Client: `terminal/src/routes/bank/BusinessExtra.tsx:263-264` integer-only `aDec`, warning at :274, sheet gated on `aDec !== null` at :281. |
| 3 (wallet QR after partial payment) | FIX CONFIRMED (public page) | Server `api-ts/src/services/bank/BankPaymentsService.ts:473-474,489-490`: `paymentRequest` is null and `walletCheckout: 'unavailable_after_partial'` once `paidMinor > 0`. Client `terminal/src/routes/bank/PayInvoice.tsx:95,133` `walletOk`. Caveat: the authed invoice view (`BankPaymentsService.ts:196-201`) still builds the full-amount request for a partially paid invoice; no terminal screen renders it (grep of `qrPayload`/`paymentRequest` outside PayInvoice.tsx hits only types), but other API consumers would get it. |
| 4 (card caps re-parsed at wrong precision) | FIX CONFIRMED | `terminal/src/routes/bank/Cards.tsx:145-147` detail accepted only when `detail.data.card.id === card.id`, decimals only from `capDecimals`; `:181-182` `Rules` mounts only with `cd && decimals !== null`, key includes decimals; `:41-48` caps rewritten only when the text differs from its initial value. |
| 5 (payroll confirm total 0) | FIX CONFIRMED | `terminal/src/routes/bank/Payroll.tsx:55,62` total = server `pv.totalMinor` (falls back to summing `x.item.amountMinor` only if that is not a minor string); rows read `x.item.*` / `x.payee.name` (:68); retry totals failed items only (:63-64); actions and sheet blocked when decimals unknown (:92-94, :97). Server `BankPayrollService.ts:411` returns `totalMinor: run.totalMinor`. |
| 10 (advance pay-out asset selector) | FIX CONFIRMED | Selector removed; `terminal/src/routes/bank/PayrollExtra.tsx:89-90` uses `avail.data.asset/decimals` (integer-checked), blocked with a message at :108. Server `BankPayrollService.ts:448` `scheduleAvail` returns `asset, symbol, chain, decimals`. |
| 16 (budget save nulls the other cap) | FIX INCOMPLETE (edge) | Main bug fixed: `BusinessExtra.tsx:216-225` untouched caps resend the saved value and `categoryBudgets` is resent; server merge-patch at `BankOrgService.ts:466-471`. Remaining: `keep()` at `BusinessExtra.tsx:220` turns a saved cap of `"0"` into null, and the client always sends both cap fields, so editing one cap clears a stored zero cap on the other (the route schema `minorOrZero`, business.ts:25,67, allows `"0"`). The UI cannot create a zero cap itself, and what a zero cap means to the card authoriser was not traced. Fix: omit an untouched cap from the request instead of resending it. |
| 17 (schedule create without idempotency) | FIX CONFIRMED | Client `PayrollExtra.tsx:48` passes MoneyAction's key (`}, k)`), `bankApi.ts:648` forwards it, `bankApi.ts:221` sets `Idempotency-Key`. Server `routes/bank/payroll.ts:127` reads body or header; `BankPayrollService.ts:613-616,642` hash + replay / CONFLICT. |
| 18 (escrow resolve at 0 decimals) | FIX CONFIRMED | `terminal/src/components/bank/EscrowDetail.tsx:28` returns null when `decs === null`; `:32` `ready` requires `decs !== null`. |
| 19 (idempotency key lost on sheet reopen) | FIX INCOMPLETE | Intent-scoped keys are used by MoneyAction (`MoneyAction.tsx:28`), IssueCard (:47), Send (:53), PayInvoice (:48), Payments (:30,:136). The old per-mount key (`useIdempotencyKey()` with no fingerprint, a `useRef`) is still used by five money actions: `Earn.tsx:23` (deposit/withdraw; the sheet unmounts on close, the exact original bug), `Credit.tsx:55` (draw/repay/withdraw collateral), `Credit.tsx:109` (open line), `Convert.tsx:21` (FX execute), `Ramps.tsx:143` (cash-out). Reopening the sheet or leaving and returning after a timeout mints a new key. Second weakness: MoneyAction's fingerprint is built from the displayed rows and drops any non-string row value, so two intents that display identically share a key until one succeeds (server payload-hash CONFLICT checks limit the damage). Fix: pass a request-derived fingerprint to `useIdempotencyKey` in those five places. |
| 20 (cash-out quote vs executing provider) | FIX CONFIRMED | `terminal/src/routes/bank/Ramps.tsx:148` quote sent with `externalAccountId`; `:155-156` quote shown only if `best.provider === e.provider`, else blocked; `:150` sends `minReceiveMinor`; inputs reset the quote (:162,:164,:168). Server `BankRampService.ts:405` CONFLICT when the fresh quote pays less, before the provider transfer insert at :429. |
| 9 (claim token in path / no recipient binding) | FIX INCOMPLETE | Confirmed: server refuses a non-recipient with FORBIDDEN at `BankRemittanceService.ts:258-264`, before the single-use swap at `:268`; token redacted in api-ts logs and Sentry paths (`app.ts:104,110,137,152,174`); nginx skips logging claim paths (`terminal/nginx.conf:24,42`); address bar swapped (`routes/bank/index.tsx:26-27`). Still open: (a) binding is opt-in and the terminal never opts in: `Send.tsx:45` sends `{ kind: 'claim' }` with no `telegramId`/`username`, so every claim link made in the UI is still an unbound bearer link ("Anyone with the claim link", :65); (b) the token is still in the URL path of the page load and the API call, so logs outside nginx and api-ts (edge/CDN, platform request logs) still see it; the body-token route is recorded as NOT DONE in the fix log. |

Tally: FIX CONFIRMED 8 (rows 2, 3, 4, 5, 10, 17, 18, 20), FIX INCOMPLETE 3 (rows 16, 19, 9), NOT FIXED 0.

Keyless money endpoints seen while checking row 19 (not flagged by reviewers, not a regression): `executeRun`/`retryRun` (`bankApi.ts:645-646`, server uses deterministic per-item keys, `BankPayrollService.ts:284-319`), `streamAction` settle/pause/cancel (:633), `escrowAction`, `scheduleBill`. These act on an existing id and rely on server state checks, which were not re-verified per endpoint.

## C. Still-open old threads (unresolved and not outdated)

| thread | first-triage row | does the current code fix it? |
|---|---|---|
| r4725050407 (BusinessExtra.tsx:261-266) | 2 | Yes. See section B row 2. Thread just has not been resolved by the reviewer. |
| r4725050465 (PayInvoice.tsx:134-145) | 3 | Yes for the public page. See section B row 3 (authed view caveat). |
| r4725061560 (BankSettings.tsx:11) | 22 | Yes. `useBankAccounts`/`useSegments` go through `hooks/bank/useBankQuery.ts`, which stays disabled without a credential. |
| r4725061582 (BankHome.tsx:81) | 22 | Yes. Same gate; the raw `useQuery` for ops alerts (BankHome.tsx:49) is inside a child that BankShell does not mount when signed out (BankShell.tsx:28). Raw `useQuery` calls remain in Developers.tsx:42-44, BusinessExtra.tsx:123,252, PayrollExtra.tsx:82,88; whether each sits below the gate was not traced. |
| r4725061566 (App.tsx:165, fallback claim link) | 6 | Yes. `Send.tsx:58` builds `${origin}/bank/claim/<token>`. |
| r4725061571 (useBankCore.ts:68, summing assets per currency) | 26 | Unchanged, by decision (first pass: NOT-REAL). Still sums only when all decimals match (useBankCore.ts:72-78). |
| r4725061578 (docs/plans/neobank-prod-smoke.md:27) | 29 | No. Line 27 unchanged; no custody/cleanup note. Docs only. |
| r4725061607 (AccountSelect.tsx:10) | 37 | Yes at both callers (BusinessExtra.tsx:273 clears `toAcct`; Convert.tsx clears `to`). `AccountSelect` itself is unchanged, which is why the thread is not outdated. |
| r4725061627 (PayInvoice.tsx:85) | 40 | Partly. `q.refetch()` runs after paying (PayInvoice.tsx:131). Pay is not disabled while a payment is pending (:36); the server blocks a double pay. |
| r4725061670 (a11yToast.tsx:93) | 49 | No. Per-toast live region unchanged (a11yToast.tsx:93-95); recorded as NOT FIXED in the fix log. Cosmetic. |
| r4725061693 (docs/plans/neobank-terminal-port-status.md:5) | 56 | No. Sentence still says "reads ONLY". Docs only. |

Unresolved but outdated (reviewer has not closed them; code moved): r4725050363 (row 1), r4725050504 (4), r4725050577 (5), r4725050635 (6), r4725050728 (7), r4725050777 (8), r4725050823 (9), r4725061536 (15), r4725061599 (35), r4725061603 (36), r4725061640 (43). Rows 4, 5 and 9 are covered in section B; the others were not re-verified in this pass beyond the fix log.

## D. Counts

- Threads read: 72 of 72, 4 pages, last page `hasNextPage: false`.
- Thread state: resolved 50, unresolved 22 (11 outdated, 11 live).
- New threads: 0. New REAL/PARTLY findings: money 0, security 0, broken 0, cosmetic 0.
- Section B: FIX CONFIRMED 8, FIX INCOMPLETE 3 (row 16 edge, row 19, row 9), NOT FIXED 0.
- Section C: 11 live threads: 6 fixed in code, 1 partly (row 40), 1 unchanged by decision (row 26), 3 not fixed (rows 29, 49, 56; two docs, one cosmetic).
