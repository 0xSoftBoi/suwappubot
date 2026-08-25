# Display serif decision (design-iterate 4, 2026-08-04)

**Outcome: EB Garamond replaces Instrument Serif** for `--font-serif` (hero h1,
section h2, A2A pull-quote, vendor bigs, chain names). Geist still carries body/UI,
JetBrains Mono still carries numerals and labels. Unchanged.

## Why the swap happened
Instrument Serif is on the taste-skill's banned-as-default list (with Fraunces) as an
LLM-favourite display serif. Rather than argue the justification, iteration 4 tested it:
the four Google-Fonts-available faces from the skill's rotation pool were rendered with
our *real* headline copy, at our real sizes, on our real soil/persimmon palette, then
screenshotted and compared (`serif-A..D.png`, harness `serif-ab.html`, both in the
session scratchpad; regenerate with the same html if needed).

The rest of the rotation pool (PP Editorial New, GT Sectra, Reckless Neue, Tiempos,
Saol, Domaine, Canela, Schnyder, Tobias, Migra, IvyPresto, Recoleta, ITC Galliard) is
commercial-licence only and therefore not installable here. Not evaluated, not pirated.

## The comparison
| | Face | Verdict |
|---|---|---|
| A | Instrument Serif (incumbent) | Condensed, high-contrast, fashion-editorial. Banned default. |
| B | **EB Garamond** | **Chosen.** Warm old-style; temperature matches the soil/persimmon/cream palette; reads trustworthy-publication, which fits the "proof, not promises" voice; holds the pull-quote on one line; ships a real weight axis (400/500) so display type gains presence on dark without faux-bold. Instrument Serif ships 400 only. |
| C | Playfair Display | Wraps the pull-quote to two lines, forcing a layout change. Lifestyle/wedding register, and the most template-common Google display serif. |
| D | Cormorant Garamond | Hairlines too fragile at display size on a dark ground; wrong signal for a "move money safely" trust context. |

## Layout consequences of the swap (do not undo these blindly)
EB Garamond sets wider per character than Instrument Serif. At the old size the hero
headline broke to **three lines**, violating the taste-skill hero rule (max two on
desktop) and pushing the captured-quote card out of the viewport. Fixed by:
- `.hd__h1` clamp `5.75rem` -> `5.6rem` (`hero-d.css`)
- `.hd__hero--split` object column `46%` -> `41%` (`site.css`), giving the copy column
  the width the wider face needs
- display weight 400 -> 500 on `.hd__h1` and `.sw__h2` (uses the real weight axis)

Verified 2 lines at 1440 and 1280; 3 lines at 390 is expected and in-rule (the cap is a
desktop rule). Note `.hd__hero--split .hd__h1 { max-width: 100% }` in `site.css`
overrides the `max-width` declared in `hero-d.css` — that measure is dead code, so tune
the hero wrap via the grid ratio and clamp, not via `hd__h1 { max-width }`.

## If this is revisited
Swapping the display face again means re-checking hero line count at 1440/1280/390 and
the pull-quote line count, because both are width-sensitive. Rerun the A/B harness rather
than judging a face from its specimen page.

---

# Round 2: Newsreader replaces EB Garamond (2026-08-25)

**Outcome: Newsreader (variable, opsz axis) is now `--font-serif`.** Owner asked for a
stronger, less default-feeling display face for the new ocean-hero institutional
direction (BlackRock / Jane Street register).

Per the rule above, the A/B harness was rerun (`serif-ab-2.html` + `serif-ab-2.png` in
the session scratchpad): real headline copy at display size over the actual golden-hour
ocean poster with the production scrim. Candidates were faces NOT tested in round 1,
drawn from the financial-masthead register:

| | Face | Verdict |
|---|---|---|
| A | EB Garamond (incumbent) | Bookish, humanist, lightest presence of the five. Reads university press, not trading floor. |
| B | **Newsreader** | **Chosen.** Sharp high-contrast strokes, vertical stress, modern financial-masthead register (FT/Financier adjacent). Variable weight + true italics + optical-size axis, so display sizes get the display cut automatically (`font-optical-sizing: auto`). |
| C | Besley | Clarendon; sturdy but blunt/slabby, heritage-newspaper-ad register. Hyphen glyph sits oddly high at display size. |
| D | Spectral | Competent but generic screen serif; less character than Newsreader. |
| E | STIX Two Text | Times register; institutional but reads like an unstyled default. |

Layout consequences: with the current home hero (12ch measure, stacked headline) the
line count is unchanged vs Garamond at 1440/1280/390; wrap points shifted slightly and
read better. No clamp changes needed. Interior pages inherit via `--font-serif`.

---

# Round 3: Archivo replaces Geist for body/UI sans (2026-08-25)

Same harness discipline, applied to the sans (`sans-ab.html` / `sans-ab.png`, session
scratchpad): the real lead paragraph, real buttons, the nav row, and a tabular-numerals
strip at production sizes on the soil ground, with the site's global `tnum` applied.

| | Face | Verdict |
|---|---|---|
| A | Geist (incumbent) | Clean and competent, but it is Vercel's font: the last recognizably stack-default face on the page. |
| B | Hanken Grotesk | Warm, humanist, friendly-SaaS register. Softer than the brand wants. |
| C | Schibsted Grotesk | **Disqualified**: its `tnum` implementation monospaces punctuation, and the site sets tabular numerals globally, so commas/periods gap visibly. |
| D | **Archivo** | **Chosen.** News-agency grotesk register, slightly denser set, clean tabular numerals, holds character at button/nav sizes. Institutional without being another company's brand font. Variable weights + italics. |
| E | Public Sans | USWDS-neutral; institutional in the government sense, no gain over Geist. |

`--font-display` still aliases `--font-sans` (globals.css), so display-sans surfaces
moved with it. JetBrains Mono unchanged.

**Caution for future swaps:** any sans candidate must be checked with
`font-variant-numeric: tabular-nums` active — that is what eliminated Schibsted.
