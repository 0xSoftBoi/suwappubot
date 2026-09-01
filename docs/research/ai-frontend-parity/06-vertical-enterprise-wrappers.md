# AI Application-Layer Marketing Sites — Design Research (Vertical/Enterprise/Productivity, 2025-2026)

**Method note:** Live sites were fetched directly (WebFetch converts HTML→markdown, which strips most inline CSS/font-face declarations — so hex/font claims from raw fetch are noted as such and are weaker than agency/teardown sources). Design credits, typefaces, and tech-stack claims are cross-checked against agency case studies, Fonts In Use, and design-teardown sites. Everything not confirmed from a primary/agency source is marked **UNVERIFIED**.

---

## Per-company findings

### Harvey (harvey.ai)
- Typefaces: **TWK Ghost** (Nolan Paparelli / WELTKERN) for wordmark, headlines, display; **ABC Diatype** (Dinamo) for body/UI — documented on Fonts In Use. [Fonts In Use](https://fontsinuse.com/uses/77027/harvey)
- Brand/identity built collaboratively by Portland studio **Geist**, Harvey's founders, and brand consultant Shawn Farsai; website/product-marketing build and micro-animations by **basement.studio** (case study explicitly credits them with the brand system and website as "a fundraising tool," but omits color/motion specifics). [Fonts In Use](https://fontsinuse.com/uses/77027/harvey), [basement.studio](https://basement.studio/post/from-seed-to-unicorn-how-we-supercharged-harvey-ai)
- Nav: deep mega-menu (Platform/Solutions/Resources/Company) typical of enterprise legal-tech sites; hero uses a product-screenshot ("Harvey UI") rather than illustration. Trust: dedicated `/security` with SOC2 Type II, ISO 27001/27701/42001, GDPR, CCPA badges displayed inline in the page flow, not a buried PDF. [harvey.ai](https://harvey.ai)
- Stack: `/_next/` asset paths confirm **Next.js**. Motion: video-based customer testimonials; no confirmed WebGL. UNVERIFIED: canvas/accent hex, exact type scale.

### Hebbia (hebbia.com — redirects from hebbia.ai)
- Website design credited to **Gleb Kuznetsov for Milkinside** on Dribbble (title: "Hebbia AI web site design"), though the shot itself couldn't be re-verified in this session (Dribbble blocked the fetch). [Dribbble search result](https://dribbble.com/tags/hebbia)
- Hebbia maintains its own internal design portal at `design.hebbia.com` and is actively hiring a brand designer to own "logo, color, typography, iconography, motion guidelines" — implying in-house ownership going forward. [BuiltIn NYC job post](https://www.builtinnyc.com/job/video-and-motion-designer/7059808)
- Live site: dual-layer nav (Max/Product/Solutions/Security/Company/Pricing), Vimeo-embedded product video in hero, finance-heavy logo wall (Morgan Stanley, MetLife, Latham & Watkins). No visible security/trust badges on homepage itself (Security is a nav item, not a homepage trust strip) — UNVERIFIED whether a dedicated trust center exists. [hebbia.com](https://www.hebbia.com)
- UNVERIFIED: fonts, hex values, tech stack (no Framer/Webflow signature detected in fetched markup).

### Sierra (sierra.ai)
- Website/brand narrative built by **Bakken & Bæck**: "succinct copy, visual simplicity, strategic colour accents, and animated elements"; motion design by **Nicolas Vittori (NeverSitStill)**; hero films shot by cinematographer **Osma Harvilahti**; logo by **Ben Barry**. [bakkenbaeck.com/case/sierra](https://bakkenbaeck.com/case/sierra)
- Tech stack per the agency case study: **React, Next.js, Tailwind CSS, Framer Motion, React Aria Components, Rive** (interactive graphics), **Sanity** CMS, **Cloudflare**. This is a strong, specific motion-lib confirmation (Framer Motion + Rive combo) — flagged as agency-sourced rather than independently re-verified against current live markup. [bakkenbaeck.com/case/sierra](https://bakkenbaeck.com/case/sierra)
- In-house design system uses a **compass rose** motif as the anchor icon for AI/agent concepts, plus a hand-illustrated "ghost" mascot (Ghostwriter agent) with animated eye/morph states — an unusually playful icon system for an enterprise seller. [Designer Fund / Sierra design team](https://designerfund.substack.com/p/ai-design-sierra)
- Trust: homepage carries SOC2, ISO 27001, ISO 42001, HIPAA, GDPR, EU AI Act, FedRAMP, PCI DSS badges plus a dedicated external **Trust Center** (trust.sierra.ai) and a "Modern Slavery Statement" link in the footer — unusually complete compliance surface for the category. [sierra.ai](https://sierra.ai)
- UNVERIFIED: canvas/accent hex, exact typeface names (article coverage stops at motion/icon system, doesn't name type).

### Decagon (decagon.ai)
- Site is **Webflow**-hosted (`cdn.prod.website-files.com` CDN confirmed in fetched markup). [decagon.ai](https://decagon.ai)
- Brand colors reported by a third-party brand-asset aggregator (Brandfetch): Conifer #b8d344, Ebony #101828, Antique Brass #cc8c79 — **UNVERIFIED**, third-party inference not confirmed against live CSS. [Brandfetch](https://brandfetch.com/decagon.institute)
- Nav is vertical-heavy (7 industry verticals under Product/Industries), 40+ enterprise logos on homepage, dedicated external Trust Center (trust.decagon.ai). [decagon.ai](https://decagon.ai)
- UNVERIFIED: fonts, agency/designer credit, motion library.

### Glean (glean.com)
- Full brand rebrand (2024) by **Kallan & Co.**: primary typeface is **Polysans**; central visual device is "Depth Flow" — a fluid gradient element transitioning between three brand states (delight/intelligence/clarity). [Glean brand refresh blog](https://www.glean.com/blog/glean-brand-refresh-2024)
- Site is **Webflow**-built (confirmed via CDN pattern in fetched markup). [glean.com](https://glean.com)
- Trust: "Glean Protect" is a named, branded security program (not a generic "Trust & Security" page) — a good example of turning compliance into a product-feature name. Certifications shown inline: ISO 42001, HIPAA, TX-RAMP Level 2, SOC 2 Type II, ISO 27001, GDPR. [glean.com](https://glean.com)
- UNVERIFIED: hex values, motion details, agency for the *website build* specifically (Kallan & Co. did brand identity; separate web dev credit e.g. Pixelmatters appears in search but wasn't independently confirmed for the current live site — [Pixelmatters portfolio](https://www.pixelmatters.com/work/glean-website-development), UNVERIFIED for current version).

### Writer (writer.com)
- Live site returned HTTP 403 to automated fetch on every attempt in this session — **could not inspect directly**. No teardown or agency credit surfaced in search. Flagging as an outright gap: **UNVERIFIED across the board** (fonts, colors, agency, motion, tech stack). Recommend a human/browser-based check if Writer is prioritized further.

### Clay (clay.com)
- Confirmed via design-teardown site A1 Gallery: fonts **Roobert, Inter, Space Mono**; palette "green, light blue, white, dark green, yellow" (colourful, not muted-enterprise); layout tagged "big type," 3D + illustration hero, **scroll animation**; built entirely in **Webflow**. [A1 Gallery](https://www.a1.gallery/website/clay-2026)
- Nav is deep and GTM-specific (Product/Use Cases/Solutions/Resources incl. "Clay University," Community, Partners) — notable for leaning into community/education nav items more than most enterprise-vertical peers. [clay.com](https://clay.com)
- Note: Clay.com should not be confused with **Clay Global** (clay.global), an unrelated Bay Area branding/motion agency that surfaces heavily in searches for "Clay design" — verified the A1 Gallery source is specifically about clay.com. [A1 Gallery](https://www.a1.gallery/website/clay-2026)
- No visible trust-center/SOC2 badges on homepage in fetched markup — **UNVERIFIED** whether Clay has enterprise trust signaling given its self-serve/PLG audience skew.

### 11x (11x.ai)
- Brand + website design by **E&W Studio** (Stockholm), confirmed via their own portfolio: "Figma and Webflow" — **built in Webflow**, not Framer. Visual identity uses red desert-landscape photography as a recurring brand texture. [ew.studio/work/11x](https://www.ew.studio/work/11x)
- Live homepage: "AI Growth Company" positioning, G2 rating badge, funding-amount flex ("$70M+ raised from a16z and Benchmark") in the hero — an unusual choice to put fundraising as a trust signal directly in the hero rather than customer logos. [11x.ai](https://11x.ai)
- Footer carries SOC 2 Type 2 and CASA certification badges with a trust-center link. [11x.ai](https://11x.ai)
- UNVERIFIED: specific typeface names, hex values.

### Granola (granola.ai)
- 2025 rebrand by **Ragged Edge** (London): display face **Quadrant** ("slightly mechanical slab serif"), UI face **Melange** ("neutral but subtly characterful"); brand voice "approachable and optimistic, a bit rough around the edges" with a deliberately imperfect hand-drawn logo mark; green retained as brand color but formalized into a system (no hex disclosed). [Granola blog: "A new look for Granola"](https://www.granola.ai/blog/a-new-look-for-granola)
- Landing page independently reviewed on Lapa.ninja and One Page Love as a best-in-class minimal SaaS landing page (large type, product screenshots, logo wall, step-by-step explainer). [Lapa.ninja](https://www.lapa.ninja/post/granola-2/), [One Page Love](https://onepagelove.com/granola)
- Tech: `/_next/image` optimization confirms **Next.js**, custom-built (not Framer/Webflow). [granola.ai](https://www.granola.ai)
- Trust: dedicated `/security` and `/transparency` pages, third-party-licenses page — transparency-as-trust framing rather than badge-wall framing, notable since Granola sells partly PLG/individual but is pushing an Enterprise tier.

### Superhuman (superhuman.com)
- Late-2025 rebrand (unifying Superhuman Mail + Grammarly + Coda/Superhuman Go into one AI-productivity-suite brand) by **Smith & Diction**: custom cut of **Messina** (Luzi Type) with rounded tittles/punctuation as a subtle nod to the new "Hero" cursor-cape mascot logomark. [Design Week](https://www.designweek.co.uk/smith-diction-rebrands-superhuman-fka-grammarly/), [Medium — Smith & Diction](https://medium.com/smith-diction/branding-superhuman-and-grammarly-and-coda-8c57f970bead)
- A third-party design-token extraction tool (design.withfudge.com — **not a primary source, treat as inferred/UNVERIFIED**) names the live fonts "Super Serif" and "Super Sans" (both Luzi Type) and reports canvas `#F5F0E8`, ink `#000000`, dark hero surface `#1A0F0F`, burgundy footer `#3D1E1E`, warm accent `#C4A882` — plausibly the production names for the customized Messina cut, but not confirmed against Superhuman's own markup. [design.withfudge.com](https://design.withfudge.com/share/superhuman.com-design)
- Live nav is unusually broad for the category (Go/Agents/Mail/Calendar/Docs/Databases/Store) reflecting the suite consolidation; trust page exists at `/legal/trust` but no SOC2 badge visible on homepage. [superhuman.com](https://superhuman.com)

### Limitless (limitless.ai)
- Homepage is currently dominated by an acquisition notice ("Limitless has been acquired by Meta," co-founder Dan Siroker) rather than product marketing — **the "beautiful marketing site" era of this URL is effectively over as of this session**; design analysis of the historical site is out of scope for what's live now. [limitless.ai](https://www.limitless.ai)
- No trust center, no fonts/colors extractable from current content. Flag this to the requester: Limitless should probably be dropped from or footnoted in any current 2025-2026 "most beautiful enterprise sites" ranking given this status change.

### Notion AI / Notion Mail (notion.com)
- Typography confirmed via a third-party design-token benchmark (DesignMD, blocked from direct re-fetch this session — UNVERIFIED-primary but a specific, credible claim): primary typeface is Notion's custom **NotionInter**; a secondary serif, **Lyon Text**, used sparingly for editorial pull-quotes. [DesignMD Notion benchmark](https://designmd.cc/benchmarks/notion) (search-result summary only, page itself 403'd)
- Live homepage headline "Where teams and agents Think together," dual CTA, "Trusted by 98% of the Forbes Cloud 100" as the trust stat (percentile framing rather than logo count) — an efficient trust device for a product with an enormous, over-familiar logo wall. [notion.com](https://www.notion.com)
- Next.js image optimization confirmed (`/_next/image`); no Framer/Webflow signature. [notion.com](https://www.notion.com)
- UNVERIFIED: hex values, Notion-Mail-specific (as opposed to Notion-wide) motion/hero technique — Notion Mail appears to inherit the parent site's design system rather than having a bespoke micro-site.

### Gamma (gamma.app)
- No independent design-credit or teardown article surfaced for gamma.app's own marketing site (search results returned only Gamma's *product* theming/branding features for end users, not meta-analysis of gamma.app itself). **Largely UNVERIFIED** — flagging as a genuine research gap rather than guessing. [Gamma help center](https://help.gamma.app/en/articles/11029150-can-i-add-my-own-colors-and-fonts-to-gamma), 403 on direct fetch this session.
- Recommend a follow-up pass with a browser-rendering tool (not markdown-only fetch) if Gamma is a priority — its own product is a presentation/design tool so its marketing site is a meaningful proof-point that was not capturable with this toolset.

### Julius (julius.ai)
- Direct fetch succeeded but returned essentially no styling signal (chat-app-style hero: "What can I do for you today?", Tasks/Files/Data-connectors/Templates panels, "Browser Agent"/"Build Website" feature call-outs). [julius.ai](https://julius.ai)
- No agency credit, no font/color confirmation found in search — **UNVERIFIED across the board**. Julius reads as a product-app-first site (the marketing page *is* the chat UI) rather than a classic illustrated/motion-led marketing site, which is itself a notable positioning choice worth flagging to the requester.

### Rows (rows.com)
- Brand strategy + visual identity + web design by **Focus Lab**: monogram is a lowercase "r" built from spreadsheet rows/columns; brand attributes "dependable, intuitive, vibrant." [Focus Lab case study](https://www.focuslab.agency/work/rows)
- Rows was acquired by/merged into **Superhuman** — live site nav now includes "Continue with Superhuman Docs," suggesting the site is mid-consolidation into the Superhuman family rather than a stable standalone brand right now. [rows.com](https://rows.com)
- UNVERIFIED: fonts, hex, motion library, whether current site still reflects the Focus Lab identity post-acquisition.

### Fin by Intercom (fin.ai)
- Hero uses a glossy orange 3D "knot" illustration (symmetrical tube/flower shape) as the primary visual device rather than product UI. Accent color: bright orange against navy/charcoal text (from fetched markup, not hex-confirmed). [fin.ai](https://fin.ai)
- Company rebrand from Intercom → Fin announced May 2026; prior Intercom-era typeface (2022-2024) was **TT Norms Pro** per Fonts In Use, with agency **Instrument** credited for an earlier Intercom.com redesign — **UNVERIFIED whether TT Norms Pro carried over to the fin.ai rebrand**, and no agency credit surfaced yet specifically for the Fin identity (work attributed generally to Intercom's in-house **Intercom Creative Studio**). [Fonts In Use — Intercom 2022–2024](https://fontsinuse.com/uses/61509/intercom-2022-2024), [Business Post via X](https://x.com/businessposthq/status/2054479278524240360)
- Trust surface is dense and well-organized for an enterprise CX buyer: SOC2, ISO 27001, ISO 42001, **AIUC-1** (an AI-specific assurance standard — notable, this is one of the only sites in the set citing an AI-specific certification by name), ISO 27701, HIPAA, plus a named `/trust-reliability` page. [fin.ai](https://fin.ai)
- Sanity CMS + Next.js image optimization confirmed in markup. [fin.ai](https://fin.ai)

### Sana (sana.ai)
- Brand identity by **Stockholm Design Lab (SDL)**, typography "created in collaboration with Letters from Sweden" (specific typeface name not disclosed in the case study). [Stockholm Design Lab — Sana](https://www.stockholmdesignlab.se/work/sana-labs)
- Website *design system/build* separately credited to **EW.Studio (E&W)**: "organized content using Webflow and their CMS," built a module library and style guides — i.e., **brand identity and website implementation were done by two different named studios**, a useful data point on how enterprise AI companies split brand vs. web-build work. [EW.Studio — Sana Labs](https://www.ew.studio/work/sana-labs)
- Direct fetch of sana.ai returned essentially no content this session (page-title only) — live hero/nav/trust details **UNVERIFIED** from primary markup.

### Legora (legora.com)
- The strongest, most fully-documented case in this set. 2026 full rebrand: brand identity by **Stockholm Design Lab**, website designed in Figma and **built in Framer** by **E&W Studio**, with additional creative input from **ManvsMachine**. [ew.studio/work/legora-2026](https://www.ew.studio/work/legora-2026), [Framer Stories — Legora](https://www.framer.com/stories/legora/)
- Typography: "a refined serif font" driving H1–H6 hierarchy (specific family name not disclosed in the case study — UNVERIFIED beyond "serif"). Visual language: dark overlays + frosted-glass UI panels, warm-toned photography (tan leather, stone, sunlit offices) to signal institutional trust *through photography* rather than badges. [ew.studio/work/legora-2026](https://www.ew.studio/work/legora-2026)
- **Motion**: parallax-layered hero backgrounds, atmospheric depth, "fast, fluid, highly optimized, web-native" scroll transitions — confirmed as built natively in Framer (not a separate JS motion library), which the Framer Stories piece frames as a case study in Framer's own capability at "enterprise scale" (~30 people editing the site monthly, 5M+ visitors, external agencies and in-house editors collaborating in one Framer project with **no developer handoff**). [Framer Stories — Legora](https://www.framer.com/stories/legora/)
- Trust: no explicit compliance badge wall on homepage; trust is instead conveyed via glass-panel UI + security iconography + calm high-end photography + named studio partnerships, with GDPR/SOC/ISO 27001/ISO 42001 badges relegated to the footer "Certified" section and a dedicated trust site (security.legora.com). [legora.com](https://legora.com)
- This is the **only confirmed Framer-built site** in the entire set of 18 — notable given how often "built on Framer" is assumed for slick startup marketing sites.

---

## Summary table

| Company | Fonts | Canvas hex | Accent hex | Hero tech | Motion lib/tool | Built on | Agency |
|---|---|---|---|---|---|---|---|
| Harvey | TWK Ghost (display) + ABC Diatype (body) [FIU](https://fontsinuse.com/uses/77027/harvey) | UNVERIFIED | UNVERIFIED | Product-UI screenshot + testimonial video | UNVERIFIED | Next.js | Geist (brand), basement.studio (site) |
| Hebbia | UNVERIFIED | UNVERIFIED | UNVERIFIED | Vimeo product video | UNVERIFIED | UNVERIFIED | Milkinside / Gleb Kuznetsov (UNVERIFIED-Dribbble) |
| Sierra | UNVERIFIED (named) | UNVERIFIED | UNVERIFIED | Cinematic product films | **Framer Motion + Rive** [BB case study](https://bakkenbaeck.com/case/sierra) | Next.js/React/Tailwind | Bakken & Bæck |
| Decagon | UNVERIFIED | UNVERIFIED | ~#b8d344/#101828 (UNVERIFIED, Brandfetch) | Conversational UI mockups | UNVERIFIED | **Webflow** | UNVERIFIED |
| Glean | Polysans [blog](https://www.glean.com/blog/glean-brand-refresh-2024) | UNVERIFIED | UNVERIFIED | "Depth Flow" gradient device | UNVERIFIED | **Webflow** | Kallan & Co. (brand) |
| Writer | UNVERIFIED (403, unfetchable) | UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED |
| Clay | Roobert, Inter, Space Mono [A1 Gallery](https://www.a1.gallery/website/clay-2026) | UNVERIFIED | UNVERIFIED (green/blue/yellow palette) | 3D + illustration | Scroll animation (tool UNVERIFIED) | **Webflow** | UNVERIFIED |
| 11x | UNVERIFIED | UNVERIFIED | UNVERIFIED | Desert-landscape photography motif | UNVERIFIED | **Webflow** | EW.Studio [ew.studio](https://www.ew.studio/work/11x) |
| Granola | Quadrant (display) + Melange (UI) [blog](https://www.granola.ai/blog/a-new-look-for-granola) | UNVERIFIED (green system) | UNVERIFIED | Product screenshots, hand-drawn logo mark | UNVERIFIED | Next.js (custom) | Ragged Edge |
| Superhuman | "Super Serif/Super Sans" (custom Messina cut) [Medium](https://medium.com/smith-diction/branding-superhuman-and-grammarly-and-coda-8c57f970bead) | #F5F0E8 (UNVERIFIED, 3rd-party) | #C4A882 (UNVERIFIED) | AI-assistant dialogue mock | UNVERIFIED | UNVERIFIED | Smith & Diction |
| Limitless | N/A — site now an acquisition notice | — | — | — | — | — | — |
| Notion/Mail | NotionInter + Lyon Text (accent serif) [DesignMD, search-summary] | UNVERIFIED | UNVERIFIED | Illustrated card stack | UNVERIFIED | Next.js | In-house |
| Gamma | UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED |
| Julius | UNVERIFIED | UNVERIFIED | UNVERIFIED | Chat-UI-as-hero | UNVERIFIED | UNVERIFIED | UNVERIFIED |
| Rows | UNVERIFIED | UNVERIFIED | UNVERIFIED | Spreadsheet monogram/UI | UNVERIFIED | UNVERIFIED | Focus Lab |
| Fin.ai | TT Norms Pro (legacy Intercom era, UNVERIFIED-current) | UNVERIFIED | Orange (UNVERIFIED hex) | 3D orange "knot" illustration | UNVERIFIED | Next.js + Sanity | Instrument (legacy Intercom); Intercom Creative Studio (in-house, current) |
| Sana | Custom w/ Letters from Sweden (name UNVERIFIED) | UNVERIFIED | UNVERIFIED | UNVERIFIED (page unfetchable) | UNVERIFIED | **Webflow** | Stockholm Design Lab (brand), EW.Studio (site) |
| Legora | "Refined serif" (name UNVERIFIED) | UNVERIFIED | UNVERIFIED | Parallax photography + frosted-glass panels | **Native Framer** [Framer Stories](https://www.framer.com/stories/legora/) | **Framer** | Stockholm Design Lab (brand), EW.Studio + ManvsMachine (site) |

---

## How the best of them make enterprise trust look premium (10 bullets)

1. **Name the security program like a product feature, not a compliance page.** Glean calls it "Glean Protect," not "Trust & Security" — it reads as a capability you're buying, not a checkbox you're clearing. [glean.com](https://glean.com)
2. **Cite AI-specific certifications, not just generic ones.** Fin.ai and Sierra both surface **AIUC-1 / EU AI Act** compliance alongside SOC2/ISO — signaling the vendor understands *this generation's* specific risk (model behavior), not just legacy infosec. [fin.ai](https://fin.ai), [sierra.ai](https://sierra.ai)
3. **Convey trust through photography and material texture, not badges.** Legora uses warm-lit stone/leather/office photography and frosted-glass UI panels to say "institutional" before a single certification logo appears. [ew.studio/work/legora-2026](https://www.ew.studio/work/legora-2026)
4. **Use a percentile/social-proof stat instead of (or in addition to) a logo wall.** Notion's "Trusted by 98% of the Forbes Cloud 100" is more credible and less visually noisy than 40 rotating logos. [notion.com](https://www.notion.com)
5. **Push deep compliance detail to a dedicated, separately-branded Trust Center subdomain**, keeping the homepage clean. Sierra (trust.sierra.ai), Decagon (trust.decagon.ai), Legora (security.legora.com) all do this — the homepage gets a light badge strip, the Trust Center gets the SOC2 report requests, subprocessor lists, and uptime history. [sierra.ai](https://sierra.ai), [decagon.ai](https://decagon.ai), [legora.com](https://legora.com)
6. **Put fundraising/investor credibility in the hero as a trust signal**, not just a press-release line — 11x leads with "$70M+ raised from a16z and Benchmark" directly under the headline. [11x.ai](https://11x.ai)
7. **Let the mascot/icon system carry emotional trust while the type system carries seriousness.** Sierra pairs a whimsical hand-animated ghost icon with an otherwise minimal, modular design system — playful without undermining enterprise credibility. [Designer Fund](https://designerfund.substack.com/p/ai-design-sierra)
8. **Split "trust me" (badges) from "understand me" (transparency).** Granola skips a badge wall almost entirely and instead runs a dedicated `/transparency` page — a bet that specificity reads as more trustworthy than logos to its buyer. [granola.ai](https://www.granola.ai)
9. **Pair a high-contrast editorial display serif with a restrained grotesk workhorse** — Harvey (TWK Ghost + ABC Diatype) and Legora (unnamed serif + presumed sans) both use "serif = gravitas, sans = precision" as a two-typeface trust signal, borrowing the visual grammar of legal/institutional print rather than generic SaaS sans-only systems. [Fonts In Use](https://fontsinuse.com/uses/77027/harvey)
10. **Make the certifications visually scannable in one row, inline in page flow — not a wall of 20 logos, not a hidden PDF.** Harvey, Sierra, Fin.ai, and Legora all show a compact 5-8-badge horizontal strip near the fold or in the footer rather than a dedicated "compliance dump" page as the *only* place trust lives. [harvey.ai](https://harvey.ai), [sierra.ai](https://sierra.ai)

---

## Top 3 to study in depth for a DeFi execution product selling to institutions

1. **Sierra** — the single best template for "serious infrastructure sold with warmth." Its compass-rose/ghost icon system proves you can be playful in the *product* iconography while the *brand system* (React/Next.js/Tailwind/Framer Motion/Rive, cinematic hero films, dense but well-organized compliance strip including EU AI Act/FedRAMP) stays rigorously enterprise. For a DeFi execution product, this is the model for how to earn trust from risk-averse institutional buyers without looking cold. [bakkenbaeck.com](https://bakkenbaeck.com/case/sierra), [sierra.ai](https://sierra.ai)
2. **Legora** — the most directly transferable *build* pattern: brand by a top-tier agency (Stockholm Design Lab), site by a specialist studio (EW.Studio) natively in **Framer** with no developer handoff, letting a small brand team ship parallax/glass-panel enterprise pages at speed (5M+ visitors, ~30 editors/month) while still selling into "the world's most demanding institutions." If Suwappu wants premium visual polish without a full custom Next.js build, this is the concrete proof that Framer scales to serious B2B/institutional selling. [framer.com/stories/legora](https://www.framer.com/stories/legora/)
3. **Harvey** — the best reference for *typography as trust* in a regulated, high-stakes vertical (legal, closely analogous to institutional finance/compliance). The TWK Ghost + ABC Diatype pairing gives "editorial legal-journal gravitas" a template DeFi-for-institutions could adapt (serif display for conviction/authority, disciplined grotesk for data/UI), and its compliance-badge treatment (SOC2/ISO/GDPR inline, not buried) is a direct pattern to copy for an execution product that needs to look audited. [fontsinuse.com/uses/77027/harvey](https://fontsinuse.com/uses/77027/harvey), [harvey.ai](https://harvey.ai)

**Honorable mention / cautionary note:** Clay.com and Sana are worth a glance for how playful color (Clay's green/blue/yellow) can coexist with a Webflow build and a real enterprise pitch — but neither is as directly analogous to "institutional finance" positioning as the top 3.

---

## Coverage gaps (be explicit about what wasn't verified)
- **Writer.com and Gamma.app** returned HTTP 403 on every fetch attempt this session and had no usable teardown in search — essentially unresearched beyond metadata. A browser-based (not markdown-fetch) pass is recommended if either is a priority.
- **Julius.ai and Rows.com** yielded working page fetches but almost no design-token detail (no fonts/hex/agency found for Julius at all; Rows' Focus Lab identity may be stale post-Superhuman-acquisition).
- **Limitless.ai** is not currently a "beautiful marketing site" to study — its homepage is an acquisition notice (Meta) as of this session; recommend dropping it from the comparison set or noting the acquisition explicitly.
- Hex color values across the set are mostly **UNVERIFIED** because WebFetch's markdown conversion strips inline CSS/`<style>` blocks; where a hex value is given, it came from a third-party design-token tool (design.withfudge.com, Brandfetch) rather than primary CSS, and is flagged as such.
