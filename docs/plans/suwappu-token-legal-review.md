# $Suwappu Adoption — Legal-Risk Memo

**NOT LEGAL ADVICE — analyst-grade internal review, prepared 2026-08-28 to brief outside counsel.** Companion to `docs/plans/suwappu-token-utility.md` and `docs/marketing/suwappu-token-announcement.md`.

## Executive summary (risk-ranked)

- **Fine as-is (minor polish):** Phase 0/1 perks — fee-discount tiers + XP multiplier. Consumptive, feature-flagged, off by default, fail-safe (`bot/config/settings.py`, `COMMUNITY_TOKEN_*`). The pinned disclaimer is well-drafted (no revenue-share/ownership language, discretionary/revocable framing).
- **Needs redlines before publishing:** the X thread and Telegram post. Several phrases contradicted the doc's own "never say" rails or read as implied endorsement — **redlines applied 2026-08-28** (see §6; announcement doc updated in the same commit as this memo).
- **Blocks on real counsel, not just internal review:**
  1. **Phase 2 fee-funded buyback/burn** — the single conduct most likely to convert "we didn't launch this" into an investment-contract fact pattern.
  2. **Team/company holdings of $Suwappu** — the docs are silent; silence is the worst answer once discovered. Must be answered affirmatively either way before anything is posted.
  3. **UK reachability** — the thread as drafted is likely a non-compliant financial promotion under the FCA cryptoasset promotions regime.

## 1. US securities (Howey)

- SEC staff statement (Feb 27, 2025): meme coins as generally described are not securities — but it explicitly does not extend to conduct that ties value to a promoter's efforts. ([SEC](https://www.sec.gov/newsroom/speeches-statements/staff-statement-meme-coins); [Crenshaw dissent](https://www.sec.gov/newsroom/speeches-statements/crenshaw-response-staff-statement-meme-coins-022725) — enforcement posture, not settled law.)
- SEC v. Ripple (SDNY 2023): programmatic/anonymous sales failed "efforts of others" because buyers couldn't connect profits to Ripple's conduct. **Distinguish:** a publicly marketed, formulaic, company-funded buy-and-burn is the opposite of anonymous — disclosed, repeated, promoter-directed float reduction. Closer to the conduct the 2025 statement carves *out* than to Ripple's protection.
- Suwappu is not the issuer, but Howey doesn't require the issuer and the relied-upon "other" to be the same entity (cf. EthereumMax touting actions — §17(b) theory, not Howey directly). **No case squarely tests "unaffiliated company runs a public buy-and-burn for a meme coin it didn't launch"** — likely first-impression; the core question for counsel.
- **Bottom line:** perks alone = low incremental Howey risk. Buyback materially raises it (§8).

## 2. US manipulation / CFTC

- Meme coins ≈ commodities for CFTC spot fraud/manipulation authority; NYDFS Jan 2025 guidance flags wash trading, pump-and-dump, insider manipulation as the live meme-coin risks.
- **Timing optics:** announcing perks while the token is +1,344%/24h; celebratory copy is what a plaintiff screenshots as promotional intent. (Redlined.)
- **Self-referential loop:** Suwappu earns fees on $Suwappu swaps → discounts those fees to drive that volume → (Phase 2) buys the token with fee revenue. Not wash trading, but a regulator will diagram it. **Fix:** fund any buyback from blended total fee revenue, never token-specific revenue.
- If Phase 2 ships: pre-committed public formula/schedule, never discretionary timing.

## 3. US promotion (§17(b) / FTC)

- §17(b) anti-touting requires disclosing nature/source/amount of compensation for touting a security (Kardashian, Pierce actions). Likely doesn't attach today, but activates retroactively if Phase 2 conduct pushes the token toward investment-contract status.
- **Regardless of securities status:** if any team member or company wallet holds $Suwappu, disclose it prominently in the same post describing perks (FTC Endorsement Guides material-connection logic, 16 CFR 255). **Currently unanswered — the most important gap.**
- Any paid/gifted KOL amplification needs that person's own compensation disclosure.

## 4. UK (FCA)

- Cryptoasset financial-promotions regime (s21 FSMA + Oct 2023 FPO amendments) covers any invitation/inducement reaching UK persons **regardless of promoter location**. A public X thread naming a CA, a buy mechanic, and holder benefits is in scope.
- Unless Suwappu is FCA-authorised / a registered cryptoasset business / using an authorised person's s21 approval, the thread as drafted is likely non-compliant. Public-thread exemptions don't fit.
- Options: route UK-facing copy through an authorised-person approval with the prescribed risk warning, or strip "buy option" framing from UK-reachable copy (imperfect for a public thread — residual risk either way). Counsel question.

## 5. EU (MiCA)

- Suwappu didn't mint/sell the token → not the Title II "offeror"; white-paper obligations for the offering don't attach.
- Residual: (1) MiCA marketing-communication rules (fair/clear/not-misleading, consistent with a white paper) — this token likely has **no white paper**, so publicly marketing it in the EU is arguably an unlawful marketing communication independent of offeror status. Unsettled — EU counsel question. (2) CASP licensing of the swap-bot business generally is a pre-existing, separate exposure — standalone review recommended.

## 6. Announcement copy redlines — APPLIED 2026-08-28

| Original | Problem | Replacement (now in doc) |
|---|---|---|
| "Wild way to spend a Thursday. Thank you." | Thanks the buyers = gratitude for the pump | "We're not going to pretend that's not wild. We also can't and won't comment on the chart — here's what we're actually doing." |
| "read it before you ape" | Encourages impulsive buying | "read it before you decide anything" |
| "safety card + buy option" | "Safety" implies Suwappu vetted the token — violates the doc's own rail #4. **Check whether `/check`'s product UI itself says "Safety Card"** — if so, product-wide naming issue | "token info card (contract, liquidity, holder data) + a buy option" |
| "The ONLY canonical CA … Bookmark it." | Declaring canonicity = judgment others rely on financially, on an informal basis | "the contract we've configured perks for, based on our own on-chain and community research as of [date]… We have no authority to declare any token 'official' — verify independently, including this one." |
| Disclaimer silent on team holdings | Silence discovered later is worse than either answer | Added `[FOUNDER: confirm & state holdings either way]` placeholder line — **must be resolved before posting** |
| "in the bot" unscoped | api-ts/webapp don't honor perks yet (Phase 1.5 gap) → false-advertising surface | Scoped to "our Telegram bot" until parity ships |

## 7. Perk mechanics

- **Gambling/sweepstakes:** low risk — consumptive, no chance element. Redo if XP ever gets loot-box randomness.
- **Consumer protection:** "at our discretion, without notice" must live in the **binding bot ToS**, not only marketing copy. Action item.
- **Sanctions/KYC:** perks extend to any holder incl. sanctioned wallets — same baseline exposure as the core swap product, not zero incremental. Note, don't panic.

## 8. Buyback (Phase 2) verdict — HIGH RISK; fence, don't abandon

Counsel will likely kill it as currently described. Aggravators: (a) plan doc calls it "the only mechanism proven to durably support a community coin" — a value-support claim; (b) recurring company-funded, company-directed buy pressure = "efforts of a promoter"; (c) funded by fees from the token's own trading (circularity); (d) publishing tx hashes is transparency about a value-support program, not a defense to it.

Risk-reduced structure if pursued:
1. Formulaic, non-discretionary, pre-committed policy (fixed %, fixed cadence, published in advance).
2. Funded from **blended total** fee revenue.
3. **Burn, don't hold**; anything held for XP redemptions sits in a published multisig and only exits via redemption — never sold into market.
4. **Written outside-counsel sign-off before any code ships.** Not `money-path-reviewer` — a lawyer.

## 9. Questions only real counsel can answer

1. Does Ripple/the 2025 staff statement protect a *non-issuer's* public formulaic buyback-and-burn, or does that conduct create its own investment-contract analysis? (First-impression; crux.)
2. **ANSWERED 2026-08-28 — founder confirms a personal open-market purchase of $Suwappu, made before any public perks announcement.** Remaining for counsel: exposure from the pre-announcement timing specifically (founder bought knowing perks were in development — disclosure is drafted into the pinned post, but counsel should assess whether disclosure alone suffices or a cooling-off/no-sale undertaking should be formalized). Amount/date/wallet still to be filled into the disclosure by the founder.
3. Company domicile / primary regulatory nexus? (Reframes everything above.)
4. Is the swap-execution business itself required to hold MSB/CASP/VASP licensing, and does token marketing or a buyback change scope?
5. Does routing fee revenue into market purchases implicate BSA-AML / proprietary-trading posture?
6. FCA prescribed risk-warning + s21 approval path for UK-reachable posts?
7. MiCA marketing-rule exposure for a non-offeror marketing a white-paper-less token in the EU?

## Ship gates derived from this memo

- [~] Holdings question ANSWERED: founder personally bought on the open market pre-announcement. Disclosure block drafted into the pinned disclaimer (announcement doc) with a 14-day no-sale-around-announcements commitment — founder must fill [DATE]/[AMOUNT]/[X% of supply] (and ideally the wallet address) before posting. **Hard rule from here: never sell into or around an announcement window.**
- [ ] Buyback gate hardened: founder's personal holdings make any company buyback a direct personal-enrichment fact pattern — Phase 2 counsel sign-off is now strictly non-negotiable, and counsel should be told about the holdings in the first conversation.
- [ ] Redlined copy (this commit) is the only version that may be posted.
- [x] "Safety Card" product-UI naming: checked repo-wide 2026-08-28 — the phrase does not appear in product code, only in the (now-redlined) marketing draft. No rename needed.
- [ ] Discretion/revocability sentence mirrored into the bot ToS.
- [ ] UK counsel question resolved (or UK-facing framing stripped) before posting.
- [ ] Phase 2 buyback: no code until written counsel sign-off.
