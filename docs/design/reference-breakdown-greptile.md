# Greptile.com design breakdown (pattern extraction — not for verbatim copying)

## Core thesis
Premium feel = restraint + evidence density. Not gradients/animation. Copywriting/proof-ordering discipline.

## 1. Page structure (confirmed order)
Nav → Hero (headline + subhead + 2-3 CTAs) → Social proof strip ("9,000+ teams" + ~11-16 named logos) → Single high-authority testimonial card (CTO, named, linked case study) → Process section (3 numbered steps, STEP 01/02/03) → 3 concrete proof examples (real linked artifacts with metadata as credibility) → Personalization/depth features → "Your Stack" integrations (4 methods) → New-feature announcement + early-access CTA → Security/Enterprise block (SOC 2, SSO, self-host, audit logs) → Testimonial grid (4-6 quotes, name+title+company) → FAQ (objection handling: pricing mechanics, discounts, self-host) → Minimal footer (repeat CTA + one-line mission).

Rhetorical logic: claim → immediate social proof → one authority quote → mechanism → proof-not-promise (real artifacts) → depth → trust/compliance → broader proof → objection FAQ → low-friction close. Credibility-before-features.

## 2. Typography (structure confirmed; exact fonts TBD via devtools)
- Headline formula: short noun-phrase category claim ("The AI Code Reviewer") — category label, not adjective-stuffed.
- Sentence case throughout, never Title Case.
- Eyebrow labels: short all-caps section tags ("AGENT", "PERSONALIZATION", "YOUR STACK") + numbered steps.
- Body copy short and literal; numbers substitute for adjectives.

## 3. Color (structural inference; verify via devtools)
Light bg, dark text, ONE accent reserved for CTAs + a single "Recommended" badge. No gradients, no glassmorphism, no multi-hue.

## 4. Layout
Logo wall = horizontal row. Testimonial grid = 4-6 cards (avoids generic 3-card). Pricing = 3-tier table, one badge-differentiated column. Proof section uses real linked content, not illustrated mockups.

## 6. Copy style (strongest signal)
- Every claim paired with a checkable artifact: named logos, testimonials with name+title+company, proof links to real public artifacts (+ star/fork counts as ambient credibility).
- Numbers specific, not rounded-for-effect: "9,000+ teams", "3B lines", "1M PRs", "12 languages", "$30/seat/month", "1 credit = 1 review".
- CTAs task-literal verb+object: "Start now", "View case study", "Get early access". No "Unlock/Supercharge/Revolutionize".
- FAQ pre-answers objections explicitly instead of "Contact us".

## 7. Trust
- Logo wall: real technical-buyer brands.
- Testimonials: name + senior title + company — seniority does the credibility work.
- Metrics repeated as connective tissue across sections, not one isolated stats bar.
- Security/enterprise placed AFTER product depth (last-objection removal, not the hook).

## 8. Nav/footer
Nav: logo left; right: Contact Sales + primary CTA + docs. Three items max, no dropdown sprawl.
Footer: minimal — repeat CTA, one-line mission, support contact. Not a sitemap dump.

## 9. Slop patterns avoided
- No purple gradient hero. No emoji bullets. No generic 3-icon-card feature row (real linked artifacts instead). No unattributed "trusted by innovative teams". No stock photos. Testimonials 4-6 not exactly 3.

## CONFIRMED tokens (extracted from live CSS 2026-08-04)
- Fonts: DM Sans (body), Anybody (display headlines), Space Mono (eyebrow labels/numbers), Nanum Pen Script (handwritten annotation accents — playful margin notes/arrows)
- Base: light gray bg rgb(238,238,238) / #eee family; dark slate text #3d3b4f (purple-tinted gray, NOT pure black); secondary dark #2a2a2a
- ONE accent: blue rgb(88,130,255) #5882ff for text links/borders/CTAs; soft green tints #c8ead0/#c5ffd6 as secondary success/diagram tint
- Borders/shadows: hairline translucent (#3d3b4f26, #0000001a) — tinted with the text hue, very low opacity; no heavy black shadows
- Pattern: light restrained base + single saturated accent + mono technical labels + handwritten human flourish = "technical but human"

## Mapping to Suwappu showcase (keep our brand, borrow the system)
- Geist = their DM Sans/Anybody role; JetBrains Mono = their Space Mono role (eyebrows, numbers, stats)
- Persimmon #E58D2B = their #5882ff role — the ONLY accent, used sparingly
- Adopt: tinted-hairline borders, off-neutral bg, sentence case, mono all-caps eyebrows + numbered steps, evidence-dense sections, real linked proof artifacts, 4-6 attributed testimonials/quotes, objection-handling FAQ, minimal nav (3 items) + minimal footer with repeated CTA
