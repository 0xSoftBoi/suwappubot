# Multi-Language Support: Industry Research & Recommendations for Suwappu

## 1. Executive Summary

- **Externalize every string to a stable key, never concatenate fragments.** Airbnb (1M+ phrases, 62 languages), Slack (~20K strings), and Shopify all enforce this as the foundational rule — concatenation breaks in SOV languages and blocks pluralization/gender handling. [Airbnb Eng](https://medium.com/airbnb-engineering/building-airbnbs-internationalization-platform-45cf0104b63c), [Slack Eng](https://slack.engineering/localizing-slack/)
- **ICU MessageFormat is the de facto standard** for plurals/gender/interpolation (react-intl, Vue-i18n, Android, iOS, Shopify Polaris all use it); a successor, MessageFormat 2, is a 2025 Unicode standard but not yet the safe default. [Crowdin ICU guide](https://crowdin.com/blog/icu-guide)
- **Telegram gives language for free but it's unreliable** — `language_code` is optional, sometimes malformed (`it` vs `it-IT`), and never auto-translates messages; every serious bot/messaging platform layers an **explicit stored override** on top of the live-detected signal. [Telegram Bot Features](https://core.telegram.org/bots/features)
- **Never hand-roll number/currency formatting** — use CLDR-backed `Intl.NumberFormat`/equivalents; crypto adds a unique failure mode on top of standard fintech risk (8–18 decimal assets, MAX-button truncation bugs where displayed value diverges from on-chain submitted value). [CLDR patterns](https://cldr.unicode.org/translation/number-currency-formats/number-and-currency-patterns), [DeFiChain #176](https://github.com/BirthdayResearch/defichain-app/issues/176)
- **Continuous localization is now a commodity workflow**: webhook detects new strings → push to TMS or inline AI action → MT/LLM first draft → human review → PR merge → CI. All five major TMS vendors (Crowdin, Lokalise, Phrase, Smartling, Transifex) converge on this loop; a lightweight "AI-in-CI" variant exists for teams that don't want a paid platform yet. [Crowdin GitHub Action](https://github.com/crowdin/github-action), [Localhero.ai](https://localhero.ai/blog/automate-i18n-github-actions)
- **Regulated financial/legal copy is a distinct translation tier** from marketing/UI copy — treat KYC, disclosures, and T&Cs with certified translators, glossary, and TM, since regulatory expectations vary even within "harmonized" regimes like EU MiCA. [Centific](https://www.centific.com/blog/financial-services-localization-compliance)
- **Pseudo-localization in CI catches expansion/RTL bugs before real translation starts** — Netflix, Slack, and Android all build this into their pipelines; translated text can expand up to ~35%, and layout/mirroring bugs are otherwise invisible until a human translator (or real user) hits them. [Netflix TechBlog](https://netflixtechblog.com/pseudo-localization-netflix-12fff76fbcbe), [Android pseudolocales](https://developer.android.com/guide/topics/resources/pseudolocales)

---

## 2. How Top Companies Do It

### 2.1 Enterprise i18n Architecture

- **String externalization at scale**: Airbnb runs three parallel extraction paths (service config, static source analysis, runtime access-pattern logging) feeding a platform serving 1M+ phrases / 100B+ requests/day at sub-ms latency. Slack wraps ~20,000 strings across 2,000 files in `{t}` template blocks, extracted via static analysis and enforced through collaborative "string jam" events. [Airbnb Eng](https://medium.com/airbnb-engineering/building-airbnbs-internationalization-platform-45cf0104b63c), [Slack Eng](https://slack.engineering/localizing-slack/)
- **Plural/gender via ICU MessageFormat**: one translatable string encodes locale-specific plural rules — `{count, plural, one {...} other {...}}` — rather than branching in code. Shopify Polaris and Slack both standardize on ICU; Slack built custom ICU validation because its TMS didn't natively support the syntax. Languages like Russian have plural-form rules translators must explicitly handle. [Polaris i18n](https://polaris-react.shopify.com/foundations/internationalization), [Airbnb Eng](https://medium.com/airbnb-engineering/building-airbnbs-internationalization-platform-45cf0104b63c)
- **Explicit fallback chains**: Airbnb falls back to a parent locale per a predetermined chain on missing keys; Android resolves `pt-rBR → pt → en` via resource qualifiers. Slack hashes the *source English string* as the translation key (with a `fallback_hash`) so minor copy edits don't orphan existing translations. [Android docs](https://developer.android.com/training/basics/supporting-devices/languages), [Slack Eng](https://slack.engineering/localizing-slack/)
- **RTL**: Material Design 3 defines explicit mirroring rules — layout/icons/sliders mirror, numerals and non-directional icons must not — exposed via Android's `autoMirrored` and start/end layout attributes. [Material Design 3](https://m3.material.io/foundations/layout/bidirectionality-rtl) (UNVERIFIED: no primary source found describing Slack/Airbnb/Netflix's own RTL implementation specifics.)
- **Pseudo-localization QA gate**: Netflix runs pseudo-localization server-side in its Global String Repository before strings reach any client. Slack's accented pseudolocale expands strings ~35% while preserving HTML/emoji. Android ships build-time `en-XA` (expanded) and `ar-XB` (RTL) pseudolocales. [Netflix TechBlog](https://netflixtechblog.com/pseudo-localization-netflix-12fff76fbcbe), [Android pseudolocales](https://developer.android.com/guide/topics/resources/pseudolocales)
- **Native `Intl` for dates/numbers/currency**: V8/Chrome built ECMA-402 `Intl` directly into the JS engine for locale-correct formatting without app-level logic; Spotify widened UI layout tolerances across 74 languages because translated text can grow up to 35%. [V8 blog](https://v8.dev/blog/intl), [Spotify Eng](https://engineering.atspotify.com/2022/09/scaling-translations-at-spotify)

### 2.2 Messaging / Chat-Bot Specific Patterns (most relevant to Suwappu's Telegram bot)

- **Auto-detect, then override**: Telegram's `User.language_code` is optional and format-inconsistent; bots must fall back to a stored preference, then to a hard default. WhatsApp Business API doesn't auto-translate at all — templates carry an explicit `language` field the business sets per send. Discord natively supports per-locale command `localizations` maps plus a runtime `interaction.locale`. [Telegram Bot Features](https://core.telegram.org/bots/features), [Meta WhatsApp templates](https://developers.facebook.com/docs/whatsapp/api/messages/message-templates/), [discord-api-docs#2313](https://github.com/discord/discord-api-docs/issues/2313)
- **Standard override pattern**: a per-user language DB column + a `/language`-style command with an inline-keyboard picker, with the stored value always taking priority over auto-detected locale on every subsequent message. CryptoBot exposes this under Settings > Language for 4 languages — directly comparable to Suwappu's bot UX. [medium.com/@avis](https://medium.com/@avis/crypto-bot-telegram-bot-features-1cbd7f17657d)
- **Template systems**: mature Telegram-bot frameworks (aiogram) ship built-in gettext/Fluent middleware (`aiogram.utils.i18n`); simpler bots (Suwappu's current approach) use a flat dict keyed by string-id → lang → template with `.format()` interpolation and English fallback. [aiogram docs](https://docs.aiogram.dev/en/stable/utils/i18n.html)
- **Buttons/keyboards use the same lookup**: `InlineKeyboardButton` labels are resolved from the translation dict at keyboard-build time, not inside callback logic. [core.telegram.org/api/bots/buttons](https://core.telegram.org/api/bots/buttons)
- **RTL is not automatic** in Telegram or Discord clients — developers must manually order button rows/text for Arabic/Hebrew, and Markdown rendering can interact badly with RTL numeral/punctuation ordering. [Hebrew alignment fix](https://medium.com/@python-javascript-php-html-css/fixing-hebrew-text-alignment-in-telegram-bot-api-e951f9039b72)

### 2.3 Translation Management Tooling & Workflows

- **Convergent CI/CD loop across all major TMS vendors**: webhook on push/PR detects new/changed keys → sync to platform → MT/AI first-pass draft → human/community review → platform opens a return PR with translated resources → normal CI/tests → merge. [Crowdin GitHub Action](https://github.com/crowdin/github-action), [Lokalise blog](https://lokalise.com/blog/how-to-continuously-localize-your-front-end-resource-files-using-github-actions/)
- **Vendor positioning**: Crowdin owns "engineering-led" continuous localization (CLI scored 4.6/5 in a 2025 developer survey); Lokalise is the SaaS/product-team default; Phrase/Smartling target enterprise governance and managed linguist services; Transifex sits in between and trails on developer-experience satisfaction (3.8/5 vs Crowdin's lead). [Phrase blog comparison](https://phrase.com/blog/posts/localization-platform-comparison-2026/), [G2 comparison](https://www.g2.com/compare_reports/lokalise-smartling-crowdin-transifex-phrase-tms-formerly-memsource-and-phrase-strings)
- **A no-platform alternative exists**: an AI GitHub Action translates directly inside the PR diff and auto-commits to the branch for staging review — appropriate for small teams not ready to pay for a TMS seat. [Localhero.ai](https://localhero.ai/blog/automate-i18n-github-actions)
- **MT/LLM as first-pass draft, human polish for customer-facing copy** is the universal pattern: Lokalise auto-selects the best MT/LLM engine per language pair with project glossary/TM injected; Crowdin drafts from TM + DeepL/Google + OpenAI/Anthropic/Azure. [Lokalise blog](https://lokalise.com/blog/what-is-the-best-llm-for-translation/), [Crowdin docs](https://support.crowdin.com/machine-translation/)
- **Translation memory + glossary** underpin consistency: TM surfaces fuzzy matches for speed, glossaries lock brand/product terms and can be injected directly into MT output. [Smartling — TM](https://www.smartling.com/blog/what-is-translation-memory)
- **Crypto-specific precedent**: Uniswap's Interface crowdsources translations via Crowdin with a proofreading/QA gate before merge — community draft → professional review → ship, a de facto staged rollout matching the recommendation below. [Uniswap on Crowdin](https://crowdin.com/project/uniswap-interface)

### 2.4 Fintech/Crypto-Specific Considerations

- **CLDR-backed number formatting is non-negotiable**: comma-decimal (EU) vs period-decimal (US) and currency-symbol prefix/suffix placement are standardized in Unicode CLDR — hand-rolled formatting is a recurring bug source. [CLDR patterns](https://cldr.unicode.org/translation/number-currency-formats/number-and-currency-patterns)
- **Crypto-specific decimal risk**: assets carry 8–18 decimal places (BTC=8, ETH=18); display truncation that diverges from the actual on-chain value has caused real "Invalid amount" bugs on MAX-send buttons in production wallets. [DeFiChain #176](https://github.com/BirthdayResearch/defichain-app/issues/176), [Bitcoin Design — Units & Symbols](https://bitcoin.design/guide/designing-products/units-and-symbols/)
- **Regulated copy is a separate tier**: KYC, risk disclosures, and T&Cs need certified financial translators + TM + glossary — a single mistranslated disclosure term can trigger fines or user harm, and disclosure obligations extend to every digital touchpoint (UI strings, push notifications, in-app banners), not just formal documents. [Centific](https://www.centific.com/blog/financial-services-localization-compliance)
- **Regulatory variance persists even under "harmonized" regimes**: EU MiCA is applied unevenly by national competent authorities, so adaptation must be structural, not purely linguistic. [Centific](https://www.centific.com/blog/financial-services-localization-compliance)
- **Canonical glossaries prevent jargon drift**: Binance Academy / Coinbase Help maintain reference glossaries paired with CAT-tool TM so "gas/slippage/staking/bridge" doesn't drift into inconsistent local terms across a product's surfaces. [Coinbase Glossary](https://help.coinbase.com/en/coinbase/getting-started/crypto-education/glossary)
- UNVERIFIED: could not confirm current RTL support status for MetaMask or Uniswap wallet UI specifically; no primary source found for Binance/Coinbase/Revolut/Wise internal new-language rollout mechanics (beta cohort sizing, feature-flag percentages) — closely-held product-ops detail.

### 2.5 Technical Library Patterns Across a Polyglot Stack

| Layer | Standard | Notes |
|---|---|---|
| Python | **gettext/Babel** (`.po`/`.mo`, `pybabel extract`) | Mature, stdlib-adjacent, but plural syntax is C-style `ngettext`, not true ICU |
| Python (alt) | **Project Fluent** (`fluent.runtime`) | Own syntax purpose-built to avoid leaky placeholders, CLDR-plural-compatible, smaller ecosystem |
| Node/TS (flexible) | **i18next** / react-i18next | Most ecosystem-rich (detectors, backends, namespaces); native plural syntax is i18next-specific, not ICU (bridge plugin `i18next-icu` exists) |
| Node/TS (ICU-strict) | **react-intl / FormatJS** | ICU-first, standards-strict, best for shared ICU catalogs across platforms |
| Next.js | **next-intl** | Next-native, ICU-based, lighter than react-intl, separate API/maintainer despite the naming similarity |
| React Native/Expo | **expo-localization** + i18next/react-i18next | Device locale/calendar/RTL signals + same runtime API as web, easing shared-package reuse |

- ICU MessageFormat is the shared syntax underlying react-intl/FormatJS, Vue-i18n, Symfony, Android quantity strings, iOS stringsdict — driven by Unicode CLDR plural rules; MessageFormat 2 (2025 Unicode Final Candidate) is a future successor, not yet the safe default. [SimpleLocalize](https://simplelocalize.io/blog/posts/what-is-icu/), [Fluent vs ICU wiki](https://github.com/projectfluent/fluent/wiki/Fluent-and-ICU-MessageFormat)
- **Monorepo sharing pattern**: a `packages/i18n`-style package holding JSON/ICU catalogs keyed by **stable semantic IDs** (e.g. `wallet.created.title`), not source text — enables reuse across web/mobile/showcase without app recompilation. [Turborepo i18n discussion](https://github.com/i18next/i18next/discussions/1604)
- **Server- vs client-driven**: client-driven (ship locale JSON, translate in-app) is the majority React/Next pattern and CDN-cacheable; server-driven (API returns pre-rendered strings) suits dynamic/transactional content where the caller has no locale files. A mixed strategy — client for UI chrome, server for transactional copy — is common. [Locize — server-side i18n](https://www.locize.com/blog/how-does-server-side-internationalization-look-like/)

---

## 3. Current State of Suwappu (Codebase Audit)

Suwappu has a **partial, genuinely working scaffold**, not a greenfield problem — but it is fragmented across three independently-shaped catalogs with real drift risk.

**What exists:**
- **webapp**: i18next (^26.3.6) + react-i18next, 4 locale JSON files (`webapp/src/locales/{en,es,fr,zh}.json`). Explicit override via `localStorage['suwappu_locale']` checked first, falls back to Telegram `initDataUnsafe.user.language_code`, then `en` (`webapp/src/lib/i18n.ts:9-29`). Live `LanguageSwitcher.tsx` component and `Settings.tsx` using `useTranslation()`.
- **showcase**: next-intl (^4.13.0), 4 locale message files (`showcase/messages/{en,es,fr,zh}.json`). Override via `NEXT_LOCALE` cookie → `Accept-Language` header → `en` default (`showcase/src/i18n/request.ts:10-29`), wrapped in `NextIntlClientProvider` (`showcase/src/app/layout.tsx`).
- **bot (Python)**: hand-rolled dict-based i18n, no external library — `bot/i18n.py:1-179`, ~11 translation keys covering en/es/fr/zh. `get_user_lang()` derives language **live from the Telegram `User.language_code`** on every call — no persistence (`bot/i18n.py:140`). `get_text()` does `.format()`-style interpolation with English fallback. Only `bot/handlers/start.py` and `bot/handlers/wallet.py` currently call into it — the majority of handlers are unlocalized hardcoded English.
- **DB/API layer, dormant**: `bot/models/user.py:39` has a `language_preference` VARCHAR column (default `"en"`) that is **not read or written anywhere in the bot** — no `/language` command exists (confirmed via grep for `/language`/`CommandHandler("lang"`), and `get_user_lang()` never checks this column. On the TypeScript side, `api-ts/src/db/schema/users.ts:29` has a matching `languagePreference` field, and `api-ts/src/services/UserService.ts:161-162`'s `updateUserPreferences()` can persist it — but per the audit, **no webapp form field currently wires a language choice to that backend call**, so even the write path is unused end-to-end.
- **Mobile**: no `mobile/` directory found in the current checkout despite being referenced in `CLAUDE.md` — no i18n posture to assess there.

**Gaps, stated honestly:**
- **Three independently-shaped locale catalogs** with no shared source of truth: i18next JSON shape in webapp, next-intl JSON shape in showcase, inline Python dict in bot. No shared string IDs, no shared translation memory, duplicated en/es/fr/zh across all three with no guarantee they agree.
- **No ICU MessageFormat / plural handling anywhere** in the repo — bot uses plain `.format()`; unclear whether webapp/showcase's i18next/next-intl setups use plural keys today (not confirmed as in-use, only available as library capability).
- **No `Intl.NumberFormat`/CLDR-backed number or currency formatting confirmed** in `webapp/src/lib/i18n.ts` init or nearby balance/amount render paths — flagged as the single highest-risk gap given real funds move through this UI.
- **No persisted per-user language override in the bot** despite the DB column existing — a real, low-effort win sitting half-built across two backends.
- **No RTL languages in the current locale set** (en/es/fr/zh) and no pseudo-localization/RTL testing in any build pipeline.
- **No i18n strategy documented** in `docs/`.
- Bot string coverage is shallow: ~11 keys translated vs. the full handler surface (swap, balance, portfolio, orders, alerts, referrals, XP — per `CLAUDE.md`'s command list — are still hardcoded English).

**Bottom line**: this is not a "build i18n from scratch" problem. It's a **unify-and-finish** problem — close the dormant DB-column loop, converge the three catalog shapes, extend bot coverage past two handlers, and add CLDR-correct number formatting before any new language work touches money-facing UI.

---

## 4. Recommended Approach for Suwappu

### 4.1 Language Detection & Override

Adopt the pattern Suwappu's webapp and showcase already use, and finish it for the bot:

1. **Default**: Telegram's `user.language_code` (bot) / `initDataUnsafe.user.language_code` (webapp) — free, zero-friction, already implemented on two of three surfaces.
2. **Explicit override, always wins**: add a `/language` (or `/lang`) bot command with an inline-keyboard picker that writes to the existing `bot/models/user.py:39` `language_preference` column. Update `bot/i18n.py:get_user_lang()` to check the stored DB value **first**, then live `language_code`, then `"en"` — closing the dormant-column gap identified in the audit.
3. **Wire the webapp UI to the existing write path**: `api-ts`'s `UserService.updateUserPreferences()` (`api-ts/src/services/UserService.ts:161-162`) already accepts `languagePreference` — add the missing form field/call in `webapp/src/pages/Settings.tsx` so a webapp-set language actually persists server-side, not just to `localStorage`.
4. **Mobile (when built)**: `expo-localization`'s `getLocales()` for initial OS-locale signal, explicit in-app setting persisted via `AsyncStorage`/SecureStore taking priority thereafter — same override-before-detect ordering as the two web surfaces, for consistency across the fleet.

### 4.2 Where to Store Locale Strings

Replace the three-independent-catalog situation with **one shared source of truth**:

- Create a **shared locales package** — extend `packages/shared/` (e.g. `packages/shared/locales/`) holding JSON/ICU catalogs keyed by **stable semantic string IDs** (e.g. `wallet.created.title`, `swap.confirm.body`), not raw English text. This is consumed directly by `webapp` (i18next resource loader) and `mobile` (i18next), and mapped to `showcase`'s next-intl format via a small adapter (both are ICU-based, so the catalog content itself is portable even if the loader API differs).
- **Python bot equivalent**: since Python can't `import` a TS package, generate a parallel Python resource (JSON or `.po`/Fluent `.ftl` files) from the *same* canonical string-ID source at build/CI time — a single translation source, two runtime formats. This avoids the current situation where bot/webapp/showcase can silently disagree on a translated string for the same concept.
- Keep transactional/dynamic bot copy (tx status, fee amounts, confirmations) server-rendered as it is today — that's consistent with the "mixed strategy" pattern (client-driven for UI chrome, server-driven for dynamic content) used across the industry.

### 4.3 Library Choices Per Component

| Component | Recommendation | Rationale |
|---|---|---|
| `bot/` (Python) | **Babel/gettext** (`.po`/`.mo`, `pybabel extract`) as the pragmatic default; consider **Fluent** (`fluent.runtime`) only if grammar-heavy target languages (Arabic, Russian plural forms) become priority | gettext is mature and low-friction for a small team; current hand-rolled dict has no plural support and should be retired once volume grows past ~20-30 keys |
| `api-ts/` | No UI strings expected here (API layer) — but validate error/status messages returned to bot/webapp are string-ID based, not hardcoded English, if they're user-facing | Keeps server-driven dynamic copy consistent with the shared catalog |
| `webapp/` | Keep **i18next/react-i18next** (already in place) — add `Intl.NumberFormat`/`Intl.DateTimeFormat` for all balance/fee/date rendering | Don't rip out a working library; close the CLDR-formatting gap instead |
| `showcase/` | Keep **next-intl** (already in place) | Working, Next-native, no reason to change |
| `mobile/` (when built) | **expo-localization + i18next/react-i18next** | Matches webapp's runtime API, maximizes shared-package reuse per the Expo/Phrase-documented pattern |

### 4.4 Lightweight Translation Workflow (small-team appropriate)

- **Start without a paid TMS.** Use the "AI-in-CI" pattern: a GitHub Action detects new/changed string-ID keys in the shared catalog on PR, runs an LLM (e.g. Claude or GPT-4o) translation pass with a maintained glossary (crypto terms: gas, slippage, bridge, staking — pin these to Coinbase/Binance-style canonical glossary translations) injected as context, and commits the draft translations back into the same PR for human review before merge. This mirrors what Crowdin/Lokalise do internally, without the platform cost.
- **Human review is mandatory before merge for anything user-facing**, and **non-negotiable for money-path or compliance copy** (see Section 5) — a native or fluent speaker on the team (or a contracted reviewer) signs off, not just CI green.
- **Maintain a small glossary file** in the shared locales package from day one — even 20-30 locked terms (swap, wallet, fee, slippage, gas, confirm, cancel) prevents drift across bot/webapp/showcase far more cheaply than post-hoc cleanup.
- **Graduate to a TMS (Crowdin or Lokalise, per the developer-experience comparisons above) once**: (a) string count crosses roughly a few hundred and manual PR review becomes a bottleneck, (b) more than 2-3 languages are live simultaneously, or (c) community/crowdsourced translation contribution is wanted (Uniswap's Crowdin-based community-translate model is a good comparable at that stage).

### 4.5 Phased Rollout Plan

1. **Phase 0 (foundation, no new languages)**: unify the three catalogs into the shared `packages/shared/locales/` structure; wire the dormant bot `/language` command and the webapp Settings form field to the existing DB columns; add `Intl.NumberFormat` to all webapp balance/fee displays. No user-visible language change yet — this is de-risking existing infrastructure.
2. **Phase 1 (2-3 languages, soft launch behind a flag)**: pick languages by actual user base data (not assumption) — Suwappu already has es/fr/zh scaffolded across two of three surfaces, suggesting these are the existing bet; verify against real Telegram `language_code` distribution in production logs before committing further translation spend. Ship behind a feature flag to a small cohort first, consistent with the general feature-flag-gated staged-rollout pattern used industry-wide for de-risking any user-facing change. Extend bot coverage from 2 handlers to the high-traffic set: swap, balance, portfolio, wallet, alerts.
3. **Phase 2 (widen coverage, full handler set)**: once Phase 1 languages are stable and reviewed, extend to remaining bot handlers (`orders`, `snipe`, `ref`, `xp`, admin commands stay English-only as internal tooling) and reassess whether a TMS is now justified per the graduation criteria above.
4. **Phase 3 (RTL, if/when Arabic/Hebrew markets are targeted)**: add pseudo-localization (`en-XA`/`ar-XB`-style build flag) to CI *before* real Arabic/Hebrew translation work starts, to catch webapp layout mirroring and text-expansion bugs early — there is currently zero RTL precedent in this codebase, so this needs to be planned as its own workstream, not bolted onto an existing language launch.

---

## 5. Money-Path Risks Specific to Suwappu

**MONEY-PATH — flag any implementation touching these for `money-path-reviewer` per repo convention.**

- **Mistranslated amounts/fees/confirmation messages**: Suwappu's bot renders swap confirmations, fee breakdowns, and balance figures through `bot/i18n.py`'s `.format()`-based templates. A translation error here (wrong placeholder order, mistranslated "fee" vs "amount" in a target language) can cause a user to confirm a swap they misunderstood — this is a direct financial-harm vector, not a cosmetic bug. Any new-language addition touching `bot/i18n.py` confirmation/fee strings, or webapp's transaction-summary copy, needs `money-path-reviewer` sign-off, matching the fintech research finding that regulated/financial copy is a distinct translation tier requiring higher scrutiny than marketing UI. [Centific](https://www.centific.com/blog/financial-services-localization-compliance)
- **Decimal separator locale confusion**: no confirmed `Intl.NumberFormat` usage in `webapp/src/lib/i18n.ts` or nearby balance/amount components today. Locales that use comma-as-decimal (much of the EU, Latin America) risk users misreading `1.234,56` vs `1,234.56` style ambiguity in raw string formatting, and — per the crypto-specific research finding — display truncation diverging from the actual on-chain value has caused real MAX-send "Invalid amount" bugs in production wallets elsewhere. This is the single highest-priority gap: fix number formatting via CLDR-backed `Intl.NumberFormat` **before** shipping additional languages to money-facing screens. [DeFiChain #176](https://github.com/BirthdayResearch/defichain-app/issues/176)
- **Pluralization bugs in critical confirmation flows**: neither the bot's hand-rolled dict nor (unconfirmed) webapp/showcase i18next usage currently demonstrate ICU-correct plural handling. A string like "You will receive {n} token(s)" naively pluralized breaks in languages with more than two plural forms (e.g. Russian, Arabic) — if such a string appears in a swap-confirmation or withdrawal flow, a broken plural could read as a different quantity than intended. Any pluralized string on a confirm/execute button path is money-path-adjacent and should get review.
- **RTL layout issues in webapp for Arabic/Hebrew markets**: not yet applicable (no RTL languages live), but flagged proactively — if Arabic/Hebrew is added, un-mirrored balance/fee layout in the webapp (e.g. amount-then-currency-symbol ordering, transaction direction arrows, swap-from/swap-to positioning) could visually invert a swap direction or amount grouping for an RTL reader. This must be pseudo-localization-tested (Section 4.5, Phase 3) before real Arabic/Hebrew translation ships to any transaction screen.
- **Cross-stack consistency risk**: because bot (`bot/i18n.py`), webapp (`webapp/src/locales/`), and showcase (`showcase/messages/`) are three independently-maintained catalogs today, the same financial concept (e.g. "slippage tolerance") could already be translated inconsistently across surfaces with no automated check catching the drift — this is a correctness/trust risk even before any new-language work begins, and argues for the Phase 0 catalog-unification work happening ahead of, not alongside, new-language rollout.

---

## Sources

- [Airbnb Engineering — Building Airbnb's Internationalization Platform](https://medium.com/airbnb-engineering/building-airbnbs-internationalization-platform-45cf0104b63c)
- [Slack Engineering — Localizing Slack](https://slack.engineering/localizing-slack/)
- [Shopify Polaris — Internationalization](https://polaris-react.shopify.com/foundations/internationalization)
- [Android Developer Docs — Supporting Different Languages](https://developer.android.com/training/basics/supporting-devices/languages)
- [Android Developer Docs — Pseudolocales](https://developer.android.com/guide/topics/resources/pseudolocales)
- [Material Design 3 — Bidirectionality (RTL)](https://m3.material.io/foundations/layout/bidirectionality-rtl)
- [Netflix TechBlog — Pseudo-Localization](https://netflixtechblog.com/pseudo-localization-netflix-12fff76fbcbe)
- [V8 Blog — Intl](https://v8.dev/blog/intl)
- [Spotify Engineering — Scaling Translations at Spotify](https://engineering.atspotify.com/2022/09/scaling-translations-at-spotify)
- [Telegram Bot Features Docs](https://core.telegram.org/bots/features)
- [Telegram Bots API — Buttons](https://core.telegram.org/api/bots/buttons)
- [Meta — WhatsApp Message Templates](https://developers.facebook.com/docs/whatsapp/api/messages/message-templates/)
- [ChatArchitect — Localize WhatsApp Templates](https://www.chatarchitect.com/news/localize-whatsapp-templates-for-international-audiences)
- [discord-api-docs Issue #2313 — Localizations](https://github.com/discord/discord-api-docs/issues/2313)
- [aiogram Docs — i18n](https://docs.aiogram.dev/en/stable/utils/i18n.html)
- [Medium — Fixing Hebrew Text Alignment in Telegram Bot API](https://medium.com/@python-javascript-php-html-css/fixing-hebrew-text-alignment-in-telegram-bot-api-e951f9039b72)
- [Medium — CryptoBot Telegram Bot Features](https://medium.com/@avis/crypto-bot-telegram-bot-features-1cbd7f17657d)
- [Crowdin GitHub Action](https://github.com/crowdin/github-action)
- [Lokalise — Continuous Localization via GitHub Actions](https://lokalise.com/blog/how-to-continuously-localize-your-front-end-resource-files-using-github-actions/)
- [Phrase — Localization Platform Comparison 2026](https://phrase.com/blog/posts/localization-platform-comparison-2026/)
- [G2 — Lokalise vs Smartling vs Crowdin vs Transifex vs Phrase](https://www.g2.com/compare_reports/lokalise-smartling-crowdin-transifex-phrase-tms-formerly-memsource-and-phrase-strings)
- [Localhero.ai — Automate i18n with GitHub Actions](https://localhero.ai/blog/automate-i18n-github-actions)
- [Lokalise — Best LLM for Translation](https://lokalise.com/blog/what-is-the-best-llm-for-translation/)
- [Crowdin Docs — Machine Translation](https://support.crowdin.com/machine-translation/)
- [Smartling — What is Translation Memory](https://www.smartling.com/blog/what-is-translation-memory)
- [Smartling — Glossary Term Insertion](https://help.smartling.com/hc/en-us/articles/15746243557915-Insert-Glossary-Terms-In-Machine-Translations)
- [Uniswap Interface on Crowdin](https://crowdin.com/project/uniswap-interface)
- [Flagsmith — Phased Rollouts with Feature Flags](https://www.flagsmith.com/blog/how-to-enhance-phased-rollouts-with-feature-flags)
- [Unicode CLDR — Number & Currency Patterns](https://cldr.unicode.org/translation/number-currency-formats/number-and-currency-patterns)
- [DeFiChain App Issue #176](https://github.com/BirthdayResearch/defichain-app/issues/176)
- [Bitcoin Design — Units & Symbols](https://bitcoin.design/guide/designing-products/units-and-symbols/)
- [Centific — Financial Services Localization Compliance](https://www.centific.com/blog/financial-services-localization-compliance)
- [Pangea — Financial Translation vs Localization](https://www.pangea.global/blog/financial-translation-vs-localization-how-to-choose-the-right-approach/)
- [Pangea — Crypto Translation](https://www.pangea.global/blog/crypto-translation-a-new-type-of-financial-translation/)
- [Coinbase Help — Crypto Glossary](https://help.coinbase.com/en/coinbase/getting-started/crypto-education/glossary)
- [SimpleLocalize — What is ICU](https://simplelocalize.io/blog/posts/what-is-icu/)
- [Crowdin — ICU Guide](https://crowdin.com/blog/icu-guide)
- [Fluent Wiki — Fluent and ICU MessageFormat](https://github.com/projectfluent/fluent/wiki/Fluent-and-ICU-MessageFormat)
- [Intlayer — react-i18next vs react-intl 2026](https://intlayer.org/blog/react-i18next-vs-react-intl-comparison-2026)
- [dev.to — Best i18n Libraries for Next.js/React/RN 2026](https://dev.to/erayg/best-i18n-libraries-for-nextjs-react-react-native-in-2026-honest-comparison-3m8f)
- [Expo Docs — Localization](https://docs.expo.dev/versions/latest/sdk/localization/)
- [Phrase — React Native i18n with Expo and i18next](https://phrase.com/blog/posts/react-native-i18n-with-expo-and-i18next-part-1/)
- [i18next GitHub Discussion — Monorepo i18n](https://github.com/i18next/i18next/discussions/1604)
- [Locize — Server-Side i18n](https://www.locize.com/blog/how-does-server-side-internationalization-look-like/)
- [SimpleLocalize — Pseudo-Localization Guide](https://simplelocalize.io/blog/posts/pseudo-localization-guide/)

---

## Suggested Next Steps (for the conductor to route)

- `bot-dev`: implement `/language` command + wire `get_user_lang()` to read `bot/models/user.py:39`'s `language_preference` column first (Section 4.1, point 2). Not MONEY-PATH; no schema migration needed (column exists).
- `webapp-dev`: wire the missing Settings form field to `api-ts`'s existing `UserService.updateUserPreferences()` (Section 4.1, point 3); audit and add `Intl.NumberFormat`/`Intl.DateTimeFormat` to all balance/fee/date renders (Section 5) — **this touches money-facing display, route through `money-path-reviewer` before merge**.
- `sdk-dev`: design the shared `packages/shared/locales/` catalog structure keyed by stable string IDs, with adapters for i18next (webapp/mobile) and next-intl (showcase), plus a generation step for the Python bot's parallel resource format (Section 4.2). Cross-stack, not itself MONEY-PATH, but any string-ID that maps to swap/fee/confirmation copy inherits MONEY-PATH review once populated.
- `test-engineer`: once catalogs are unified, add a CI check that flags orphaned/missing keys across bot/webapp/showcase to prevent the three-catalog-drift risk described in Section 5 from recurring.
