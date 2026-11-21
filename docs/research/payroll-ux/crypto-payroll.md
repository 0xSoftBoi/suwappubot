# Crypto / stablecoin payroll UX research (Nov 2026)

**Takeaway:** winners hide crypto behind fiat payroll steps (approve → fund → pay → reconcile), push chain/asset choice to the *payee*, and treat compliance as the product (Toku, Rise). Request Finance / Coinshift are thin layers over Safe.

## Findings
- **Toku flow:** admin approves payroll calcs, deductions, payslips → chooses funding (bank or USDC/USDT) → validates payee details, asset, network → exports ledgers + tax records. [toku.com/stablecoin-payroll](https://www.toku.com/stablecoin-payroll)
- **Rise:** fund in fiat or stablecoin; payees cash out fiat or crypto regardless of funding. [rise-vs-toku](https://www.riseworks.io/compare/rise-vs-toku)
- **Payee-controlled withdrawal (Rise):** payee picks method each cycle; wallet setup Profile → Payment Methods → address → network → asset; FX shown and locked before confirm. [rise guide](https://www.riseworks.io/blog/rise-contractor-withdrawal-guide)
- **Gas:** Rise payee pays gas (advises L2s) [rise guide]; Deel Wallet sponsors gas, passkey sign-in, no seed phrase [eco.com](https://eco.com/support/en/articles/15419001-deel-wallet-onboarding-for-contractors-kyc-withdrawals-and-earn); Sablier employer pays to create streams, recipient pays to withdraw [sablier](https://blog.sablier.com/how-to-automate-crypto-payroll-in-your-dao-or-startup-without-a-cfo).
- **KYC:** Rise one-time KYC → reusable RiseID [rise guide]; Toku onboarding link collects ID, tax info, KYC [toku.com/aor](https://www.toku.com/aor); Deel reuses existing contractor KYC [eco.com].
- **Batch:** Request Finance CSV drag-drop → form → review → pay [help.request.finance](https://help.request.finance/en/articles/8669896-how-to-bulk-upload-pay-with-direct-payments); Sablier validates CSV, creates all streams in one tx, cancel/pause rights set up front, no edits after [sablier].
- **Compliance:** Toku W-2/1099 + FMV records at grant, vest, payday [toku resources](https://www.toku.com/resources/token-compensation-stablecoin-payroll); Toku syncs ADP, Workday, UKG, Gusto [toku]; Rise integrates QuickBooks, Xero [rise-vs-toku].
- **Complaints:** Rise withdrawals stalled by KYC, slow support (anecdotal) [trustpilot](https://uk.trustpilot.com/review/www.riseworks.io); Rise's fees conflict across its own pages ($10 local withdrawal vs $2.50 stablecoin payout) — don't copy; Bitwage criticised as costly middleman [cryptovantage](https://cryptovantage.com/?p=26157).

## UNVERIFIED
Dashboard nav/widgets for all; roles & audit; Toku withholding mechanics (sell-to-cover vs net); W-8/W-9 flow; Rise self-serve split; Coinshift CSV/roles; Utopia, Superfluid dashboards; Request Finance Safe flow (403; only 2023 blog).
