# Enterprise-parity checklist (40 items) and the crypto/fintech peer design bar

Research date 2026-09-01. Thread A = what enterprise buyers expect a top-tier AI company site to have. Thread B = where Suwappu's actual peers sit. UNVERIFIED cells were not confirmed by direct fetch this session.

## Thread A — Enterprise parity checklist (40 items)

| # | Item | Why buyers care | Exemplar |
|---|---|---|---|
|1|Dedicated trust portal, separate URL from marketing|Security/procurement teams bookmark and share it in vendor-review tickets|trust.openai.com; security.vercel.com|
|2|SOC 2 Type II report, self-serve or NDA-gated download|Table-stakes for any B2B deal >$10k ACV|trust.openai.com (report covers Jul 2025–Jun 2026)|
|3|ISO 27001 (+27017/27018/27701, ISO 42001 for AI vendors)|EU/regulated buyers require it explicitly|trust.openai.com; Vercel completed ISO 27001:2013|
|4|GDPR page + DPA + subprocessor list|Legal sign-off blocker without it|stripe.com/legal|
|5|Published pen-test summary or bug-bounty badge (HackerOne/Bugcrowd)|Signals ongoing adversarial testing, not just paperwork|Vercel/OpenAI trust pages|
|6|Trust center built on Vanta/Drata/SafeBase/Conveyor, not a static PDF|Buyers expect live, filterable evidence, not stale attachments|cyberbase.ai trust-center guide|
|7|Status-page link/uptime history surfaced from the trust page|Ties security claims to operational reality|linearstatus.com|
|8|`security.txt` / responsible-disclosure policy|Researchers and auditors check this first|—|
|9|Self-serve tiers + explicit "Enterprise" column with "Contact Sales"|Signals there's a sales-assisted path for scale|stripe.com/pricing|
|10|Usage-based unit pricing spelled out per dimension|Procurement models cost before committing|stripe.com/billing/pricing|
|11|Clear threshold for when to talk to sales (volume/contract triggers)|Removes guesswork, speeds qualification|Stripe custom-plan guidance (~$80k/mo trigger)|
|12|Feature comparison matrix across tiers (not price alone)|SSO, audit logs, SLAs live in this row buyers scan first|linear.app/pricing|
|13|Procurement FAQ (PO/invoicing, MSA, security questionnaire turnaround)|Removes friction for finance/legal|—|
|14|SSO/SAML explicitly gated to Enterprise tier|Buyers search for this line item specifically|—|
|15|Full-text or semantic doc search|Devs bounce without instant answers|Mintlify semantic search; docs.stripe.com|
|16|Dark mode toggle in docs, synced to OS|Baseline dev-tool expectation now|vercel.com/docs|
|17|Multi-language code tabs per endpoint (curl/JS/Python/etc.)|Reduces integration time across stacks|docs.stripe.com|
|18|Interactive API playground with live auth|Lets evaluators test before signing|Mintlify-generated OpenAPI playgrounds|
|19|Versioned docs cross-linked to changelog|Prevents "which version is this for" support tickets|—|
|20|Public changelog, dated, screenshots/GIFs, RSS|Shows shipping velocity — a trust signal itself|linear.app/changelog|
|21|Public status page: component breakdown + 90-day uptime|Minimum bar per 2026 status-page guides|linearstatus.com; instatus/statuspage.io templates|
|22|Published incident postmortems|Separates good status pages from average ones|pingping.io status-page guide|
|23|Subscribe-to-updates (email/RSS/webhook) on status page|Ops teams need alerting, not polling|Instatus/Statuspage|
|24|Full legal set: Privacy, ToS, Cookie Policy, DPA, AUP, subprocessor list|Legal review checklist item|stripe.com/legal|
|25|GDPR/CCPA-compliant cookie consent|Avoids compliance flags in review|—|
|26|WCAG 2.2 AA focus indicators (3:1 contrast, ≥2px)|Now a hard requirement, not nice-to-have|webaim.org/deque WCAG 2.2 checklists|
|27|Skip-to-content link, first focusable element|Keyboard/screen-reader users blocked without it|—|
|28|`prefers-reduced-motion` respected on hero/parallax|WCAG 2.2 AA + vestibular-disorder accessibility|—|
|29|Semantic landmarks + accessible names on icon-only buttons|Screen-reader navigability|—|
|30|Core Web Vitals green on marketing pages specifically (LCP<2.5s, INP<200ms, CLS<0.1)|Marketing shell is often un-optimized even when the app is fast|—|
|31|Marketing shell statically/edge-rendered, decoupled from app JS bundle|Prevents app-weight tanking homepage LCP|Vercel's own stack is the reference pattern|
|32|Dark mode across marketing + docs, not just product|Inconsistency reads as unfinished|vercel.com, linear.app|
|33|i18n/locale switcher on marketing pages|Global enterprise buyers expect it|—|
|34|Per-page custom OG/social cards (docs, blog, changelog)|Generic banner on every shared link looks unmaintained|—|
|35|Careers page, ATS-integrated, culture content|Signals a real, growing company to enterprise vetting|—|
|36|Press/media kit: logos, leadership bios, press mentions|PR and analyst diligence checklist|—|
|37|Blog/newsletter with RSS, visible cadence|Shows the company is alive between releases|—|
|38|Named-company case studies with quantified outcome + quote|Generic testimonials convert far worse|Stripe customers page (186+ filterable case studies)|
|39|Homepage logo wall, grayscale/monochrome treatment, recognizable names|Immediate credibility before any copy is read|Stripe/Oracle patterns per 2026 enterprise-design surveys|
|40|`.well-known/security.txt` machine-readable disclosure file|Automated vendor-risk scanners check for it|—|

Note: items 8, 13, 14, 19, 22–29, 33–37, 40 are best-practice conventions documented in the cited 2026 guides but I could not find a single Suwappu-relevant exemplar URL that demonstrably implements each in isolation — treat those `—` cells as UNVERIFIED-exemplar (the practice itself is well-sourced; the specific live example wasn't confirmed this session).

## Thread B — Crypto/DeFi/fintech design bar

| Company | Typography | Color mode | Motion | Hero technique | Trust signals | Premium vs. cheap tell |
|---|---|---|---|---|---|---|
|Jupiter (jup.ag)|Clean geometric sans, dense data tables|Dark-first|Low-moderate, functional|Direct product embed ("The Home of Onchain Finance") — no separate marketing hero, straight into the trading UI|Dune Analytics-style transparency, in-app; no formal trust center found|Feature-first, function-over-marketing tone reads as confident, not cheap — but has no enterprise trust page at all|
|Hyperliquid|Technical/monospace accents mixed with display sans|Dark, gradient/particle backgrounds|Higher — particle/gradient hero animation|"Infrastructure to House All Finance" — live multi-asset ticker as hero|Names named custodians (Anchorage, BitGo, Fireblocks, Komainu), explicit non-custodial architecture claims|Custodian name-drop is the single biggest "caught up to enterprise" signal in this set|
|Phantom|Rounded, consumer-app sans, large type|Light + dark|Moderate, consumer-app polish|Lifestyle tagline ("take you places") + product screenshots, Apple/Google Pay badges|"20M+ users," self-custody messaging, careers/press/merch in footer|Consumer-fintech polish (Revolut/Cash App tier), not enterprise-B2B — deliberately, and it works|
|Rainbow|Playful rounded sans|Vibrant, multi-hue per brand name|Moderate|Broad positioning ("easiest way to trade any financial market")|Partnership credential (Hyperliquid powers derivatives), premium tier (Rainbow Black)|Reads consumer-premium; no compliance/trust surface visible|
|Polymarket|Data-dense sans, numeric-heavy|Light, high-contrast|Low — live ticking odds is the "motion"|Live market feed as hero, no static marketing splash|News-outlet logos (WSJ, Reuters, Bloomberg) embedded as legitimacy signal, live volume numbers|Media-logo trust-borrowing is a distinctive, effective pattern others in this list don't use|
|Uniswap|UNVERIFIED this session — root domain 302s straight into the app (app.uniswap.org), so there's effectively no marketing homepage left to evaluate|—|—|—|—|Notable finding: Uniswap has apparently collapsed its marketing site into the app shell — worth a follow-up fetch of app.uniswap.org if this matters to a design decision|
|Aave|UNVERIFIED (fetch returned only sitemap, not rendered content) — known from general knowledge as clean, dark, protocol-serious, with a dedicated Security/audits page and GHO stablecoin sub-brand|—|—|—|Security page, audits, brand guidelines page (aave.com/brand) — one of the few DeFi protocols with a formal brand kit|—|
|Coinbase, Robinhood, Revolut|UNVERIFIED this session (not fetched) — general knowledge: all three run full AI-company-tier design systems (custom type, motion design teams, App Store-quality marketing sites, full trust/compliance/legal footprints, regulatory badges) — these are the actual top of this peer set, above every pure-crypto entry|—|—|—|Full regulatory badge sets (FDIC/SIPC-equivalent disclosures, licenses by jurisdiction)|These three are the bar Suwappu is really being compared against once it's "just a fintech app," not "just a crypto bot"|
|Banana Gun|Bold mascot branding, high-contrast sans|Dark, glow/gradient effects|Moderate-high, animated hero elements|Mascot + speed tagline ("Trade Crypto the Banana Way")|Hard lifetime metrics as trust proxy: 26M+ trades, $16B+ volume, 1.5M+ users, Dune integration|The strongest Telegram-bot site in this set — reads as an established product, not a side project, purely via metrics + polish, despite no compliance page|
|Maestro, BonkBot, Trojan|UNVERIFIED this session — Trojan's `.town` domain didn't resolve via WebFetch (DNS failure), Maestro's site wasn't fetchable through search; per third-party comparison writeups Maestro is described as having "no unified session interface," suggesting a more utilitarian, less designed product surface|—|—|—|—|Comparative reporting (breakingac.com, northpennnow.com) frames Trojan/Maestro/BonkBot primarily on fee/feature comparison, not design — secondary signal that these bots compete on speed/fees, not brand, unlike Banana Gun|

**Where the crypto design bar sits vs. AI companies:** The gap has narrowed sharply at the infrastructure layer (Hyperliquid, Jupiter) and closed almost entirely at the consumer-fintech layer (Phantom, Rainbow, and non-crypto Coinbase/Robinhood/Revolut), but the *enterprise-trust* layer that Thread A documents — SOC 2/ISO badges, named trust portals, procurement-grade legal footers — is still nearly absent across every DeFi-native product in this set, including the best-designed ones (Jupiter, Hyperliquid, Banana Gun). Hyperliquid's move to name real custodians (Anchorage, BitGo, Fireblocks) is the single clearest "borrowing enterprise-trust language" move seen this session, and it stands out precisely because none of its peers do it. Telegram trading bots split hard on this axis: Banana Gun has invested in brand/motion polish rivaling consumer fintech, while Maestro/Trojan/BonkBot compete on fee tables and feature checklists with visibly thinner design investment (per third-party comparison sites, not confirmed by direct fetch this session).

---

## Summary (15 lines)

1. Thread A checklist has 40 items across trust/security, pricing, docs, changelog/status, legal, accessibility, performance, i18n, and social-proof.
2. Trust portals (OpenAI trust.openai.com, Anthropic trust.anthropic.com, Vercel security.vercel.com) now list SOC 2 Type II + ISO 27001 as baseline, often built on Vanta/Drata/SafeBase-style platforms, not static PDFs.
3. Pricing pages converge on: self-serve tiers + explicit "Contact Sales" enterprise column, with Stripe now routing complex usage-billing to Metronome (acquired Feb 2026).
4. Docs: Mintlify leads on semantic search + live OpenAPI playgrounds; Docusaurus/Fumadocs are more DIY, less turnkey per 2026 comparisons.
5. Status pages: Linear's is the cited "does not need to be complex to be effective" exemplar; component breakdown + 90-day uptime is the 2026 minimum bar.
6. WCAG 2.2 AA adds concrete, testable requirements: 3:1 focus-indicator contrast at ≥2px, and focus-not-obscured — worth auditing Suwappu's webapp/showcase against directly.
7. I could NOT write the deliverable file — the researcher agent has no Write tool; `docs/research/ai-frontend-parity/` doesn't exist yet.
8. Thread B: Jupiter and Hyperliquid have effectively collapsed marketing site into product UI — worth deciding if Suwappu wants a separate marketing shell or not.
9. Hyperliquid is the standout for borrowing enterprise-trust language (naming Anchorage/BitGo/Fireblocks as custodians) — a cheap, high-leverage move Suwappu could copy for its own audit/custody story.
10. Phantom/Rainbow are the consumer-fintech-polish bar; Coinbase/Robinhood/Revolut (UNVERIFIED this session, from general knowledge) are the real ceiling once judged as "a fintech app," not "a crypto bot."
11. Banana Gun is the best-designed Telegram trading bot site — mascot branding + hard lifetime metrics (26M+ trades, $16B+ volume) substitute for a trust page.
12. Maestro/Trojan/BonkBot appear to compete on fee/feature comparison rather than design polish (third-party sourced, not independently confirmed — Trojan's domain failed DNS resolution this session).
13. Polymarket's distinctive move: embedding WSJ/Reuters/Bloomberg logos directly for legitimacy-borrowing — not seen elsewhere in this set.
14. Almost no DeFi-native product in Thread B has an enterprise-grade trust/compliance page from Thread A — that gap is real and specific to crypto, not fintech generally.
15. Uniswap's root domain now redirects straight into app.uniswap.org — flagged as needing a follow-up fetch if Uniswap's marketing-site design specifically matters to a decision.

HANDOFF
agent: none
task: No build work required from this research. If the conductor wants this content persisted as `docs/research/ai-frontend-parity/04-enterprise-checklist-and-crypto-peers.md`, dispatch to a builder agent (e.g. `showcase-dev` or a doc-writing pass) with this response's tables as the content, since I have no Write/Edit tool access. If Suwappu's showcase/webapp gets a design pass informed by this, route to `showcase-dev` (marketing/trust pages) and `webapp-dev` (Mini App accessibility/dark-mode/motion items from Thread A #26-29, #32) — cite this research as the source spec.
files: none created (read-only session; target directory docs/research/ai-frontend-parity/ confirmed empty via Glob)
risks: none — pure research, no money-path or cross-stack code touched.
