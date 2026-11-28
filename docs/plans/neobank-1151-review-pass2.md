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
