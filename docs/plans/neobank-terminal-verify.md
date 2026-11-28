# Terminal bank scroll + nginx verification (status)

Scripts (verification only, interception lives only there): scratchpad/terminal-verify/scrollcheck.cjs, sheets.cjs, pay.cjs. Playwright runs (chromium, no install). Dev server on 127.0.0.1:5199.

## Scroll table (390x844, 360x640, DSF 1): 30/30 PASS, 0 FAIL
Pages: /bank, /send, /convert, /earn, /credit, /add, /cashout, /cards (card opened, rules editor), /payments, /payroll, /business, /agents, /privacy, /settings, /pay/<slug> signed-out.
Metrics per page: scrollTop changes when scrollHeight>clientHeight; lowest control inside viewport after scroll; documentElement.scrollWidth <= viewport.
Sheets: send confirm sheet PASS (Cancel/Send buttons fully in viewport, both sizes); payroll run detail (long, scrolls) PASS (Approve at 572-616 of 640).
Harness fixes only (first run false FAILs): "last control" was DOM-last, not bottom-most, and counted the horizontally scrolling Business tab strip; corrected in script.
Source files changed by me: none (BankShell scroll container already works).
Screenshots read: /bank, /bank/cards, /bank/business @360x640, payroll sheet, /pay: bottoms reachable, no clipping.

## nginx: runtime-proven (nginx 1.24 installed via apt, temp copy with vars stubbed, upstream stub on 9099)
nginx -t OK. /bank, /bank/send, /bank/claim/abcDEF_token, /pay/x -> index.html; /bank/app/accounts and /public/bank/invoices/x -> upstream. After /bank/claim/SECRET123, /bank/app/remittance/claim/SECRET123 and a request with Referer .../bank/claim/SECRET123: SECRET123 count in access log = 0 (those requests not logged at all); normal /bank/send?normal=1 logged.
