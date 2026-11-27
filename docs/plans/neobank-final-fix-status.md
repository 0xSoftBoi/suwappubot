# Neobank final fix status
- 1a journal order: DONE - re-sequenced 0035/0036/0037 (idx 35-37, when 1791600/700/800000000). No cross-deps existed.
- 1b/1c proof A/B incl second runs: all OK, no SQL errors; Python DDL all modules OK pg+sqlite x2
- 1d: A vs B identical (only cosmetic default text '0' vs 0, now() vs CURRENT_TIMESTAMP). Drizzle schema lacked 2 partial unique indexes on bank_credit_lines -> added to bankEarnCredit.ts. All confirm-list items exist in A and B. No 0039 needed.
- e-h: in progress
