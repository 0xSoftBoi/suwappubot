# Reference breakdown: Kamino CEO vision letter (2026-09-15)

Source: four-page PDF, "Building the Markets Tokenization Makes Possible", Michael Weisz,
CEO, Kamino. PATTERNS ONLY. Never copy their copy, assets, chart, logo, or wording.

The letter is the gold standard for every prose surface in this repo: docs, research
posts, marketing copy, README, bot strings. The derived rules live in
[`docs/WRITING.md`](../WRITING.md). This file is the evidence behind those rules.

## Why it reads as institutional

The letter is a fintech CEO writing to asset managers, wealth platforms and lenders. It
never sounds like crypto marketing, and it never sounds like a whitepaper. Four things do
that work.

1. **Short declarative sentences, one idea each.** Median sentence is 15 to 20 words. The
   longest sentence on page one is 34 words and it is a list. Many paragraphs are one
   sentence. Pivots are one line: "That is why tokenization matters." "There are important
   limits." "It brings the asset on-chain. The market around it comes next."
2. **Concrete nouns, no adjectives doing the selling.** The letter names who: brokerages,
   wealth managers, RIAs, retirement platforms, payments and banking companies. It names
   what: ownership, eligibility, pricing, collateral, debt and settlement. The reader
   supplies the excitement. The text supplies the objects.
3. **The limits are stated in the body, not a footnote.** The letter says plainly that
   the token does not improve credit quality or create an enforceable claim. A whole
   section is titled by what the product does not do. This is what makes the claims
   before it believable.
4. **One number, sourced, in a chart.** Private markets AUM 2019 to 2024, dollars in
   trillions, "+79% in five years", Preqin via S&P Global, superscript footnote. Nothing
   else in the letter is quantified. One well-sourced figure beats ten unsourced ones.

## Structure (page by page)

| Page | Move | What it does |
|---|---|---|
| 1 hero | Eyebrow ("A vision letter from our CEO") → headline (7 words, two lines) → deck (one sentence) → author card (photo, name, title) | Tells the reader what kind of document this is before the first paragraph |
| 1 body | Personal opening (2 short paragraphs) → credentials in specifics (two decades, named prior employer, what was built there) → the gap ("Across that work, I came to recognize a wider gap") → the gap described in three plain paragraphs → one-line thesis → what shared infrastructure enables → bold closing line ("That is the work I came to do at Kamino.") | Earns the right to make claims, then makes one |
| 1 sidebar | Pull quote card (the one memorable line) above a data card (one chart, one stat, one source) | The two things a skimmer takes away |
| 2 | "The Future We Can Build": a concrete scenario in second-order detail (who onboards, who distributes, what the investor holds) → "Some of this is already possible today" → one named product, described in one sentence, by the steps it removes → the point beyond the steps → full-width pull quote band → one-paragraph bridge to the next section | Vision, grounded in a shipped product, without a feature list |
| 3 | "What Tokenization Changes": today's state (who holds the records) → what the shared record changes → what that enables for credit → "There are important limits." → the limits, plainly → what the technology actually does → two-sentence close | The honest section. Every claim above is repaid here |
| 4 | "The Market Around the Asset": one sentence on the path an asset needs → "Kamino is building that path as one four-module system:" → 01 to 04, each a bold noun-phrase title plus one sentence of definition, separated by hairlines | The product, as four nouns, in under 200 words |

Escalation: who I am → the gap → why the technology matters → what we can build → what
it actually changes and what it does not → the four-part system. Personal → market →
mechanism → limits → product. The product comes last and is therefore not a pitch.

## Rhetorical devices worth stealing

- **The one-line paragraph as pivot.** Used five times in four pages. Never used twice in
  a row. Always sets up the next paragraph rather than summarizing the last.
- **The memorable line is a comparison to something already boring.** "'On-chain finance'
  should sound as redundant as 'online banking' does today." Our analog: the execution
  layer should be as unremarkable as a payment rail. The comparison must be to something
  the reader already stopped noticing.
- **Name the steps a product removes, then say the steps are not the point.** "deposit,
  borrow, swap, redeposit, repeat, into a single action. The point is not simply to remove
  a few steps."
- **Definition by role list.** A module is defined by who it connects and the lifecycle
  it covers. The roles are asset managers, issuers, administrators, transfer agents,
  pricing and data providers, and servicers. The lifecycle runs from onboarding through
  administration, reporting and ongoing operation. No adjectives.
- **The scenario before the product.** Page two opens with "Imagine an asset manager
  onboarding an investment once" and does not name the company for four paragraphs.
- **Credentials as specifics, once.** "two decades", a named employer, one sentence on
  what was built. Never repeated.

## Design system (observed)

- **Type.** One geometric grotesk throughout, Inter-class. Display 500 to 600 weight,
  tight leading, sentence case. Body 400 at about 1.5 leading, 17 to 18px on a 640px
  measure, roughly 70 characters per line.
- **Chrome type.** Running header and footer in a small gray sans. Eyebrows in small
  caps-tracked blue. Section numbers in small blue.
- **Color.** Navy hero with white type. White body with near-black text. One accent blue
  with a tint ramp: eyebrow blue, bar-chart blue, pale blue pull-quote card, pale blue
  chart card, pale blue full-width quote band. One hue, four tints, each with a role. No
  second accent.
- **Layout.** Page one is two columns: 60 percent prose, 40 percent sidebar with the
  pull-quote card above the data card. Pages two to four are single column with a
  wider left margin. Section title, then prose, no decorative elements. Hairline rules
  separate the four numbered modules. The full-width pull-quote band is the only
  full-bleed element after the hero.
- **Chrome.** Every page carries the logo top-left, the current section name top-right in
  gray, the page number bottom-left, the document name bottom-right. The reader always
  knows where they are.
- **Data.** One bar chart. Values on bars, the current year in a darker tint, x-axis
  labels only, no gridlines, no y-axis.
- **Data caption.** Headline stat under the chart in bold. Source line in gray 11px under
  the stat. Superscript footnote marker on the chart title.
- **Whitespace.** Pages two and three are about 45 percent empty. Sections end when the
  argument ends. Nothing is padded to fill the page.

## What we already do that matches

- Evidence labels on research posts (status, as-of date, basis, boundary) are our version
  of "There are important limits." Keep them.
- Serif display over sans body on the showcase is a stronger editorial signal than the
  letter's single grotesk. Keep it; the letter's lesson is discipline, not typeface.
- The research index separates measurement from engineering notes. That is the letter's
  "some of this is already possible today" honesty applied to a catalog.
- The content model's "conclusion first" rule for concept pages.

## Where we drift (fix targets)

1. **Sentence length and stacking.** Research post openings routinely run 35 to 50 word
   sentences with two or three qualifying clauses. The letter's median is 17.
2. **Hedge density.** We hedge inside the sentence: a "yes" followed by three "but"
   clauses about reconciliation and configuration. The letter makes the claim in one
   sentence and states the limit in the next.
3. **Em-dashes and parentheticals as glue.** The letter uses one em-dash pair in four
   pages. Our posts use several per paragraph. Each one is a sentence that should have
   been two.
4. **Headlines that describe the argument instead of naming the thing.** "The fee payer
   as a treasury control surface: sponsored execution on Tempo" is a good title with a
   subtitle glued on by a colon. The letter's titles are four to seven words.
5. **Numbers in prose.** Our excerpts put "1.000298x", "3.65% SOFR", "9.86 days" in
   running text. The letter puts its one number in a chart with a source.
6. **No pull quote, no one-line thesis.** A reader who skims a Suwappu research post
   cannot find the one sentence to remember. The renderer has no slot for it.
7. **Feature lists where a scenario belongs.** The showcase lead lists surfaces, from
   Terminal and Telegram to REST, MCP and the SDKs, instead of describing what a user
   does.

## Adaptation directives (ours only, no borrowed assets)

- D1. Every research post gets a `pullQuote`: one sentence, under 30 words, no numbers,
  rendered as a full-width band after the first section, in the same style as the
  post's evidence label. See `showcase/src/content/research.ts`.
- D2. Every post opening follows the letter's page one: what this is (deck, one sentence)
  → the gap, in two or three short paragraphs → one-line thesis → the argument.
- D3. A "Limits" or "What this does not show" section is mandatory in research posts and
  in any marketing page that makes a capability claim. It is body text, not a footnote.
- D4. Numbers leave prose. A figure goes in a table, a chart with a source line, or on its
  own line. Prose keeps the conclusion the number supports.
- D5. The showcase hero lead describes the action, not the surface list.
- D6. Numbered modules become the house pattern for "what the system is" sections in
  docs, marketing pages, and the README: 01 to 04, bold noun-phrase title, one sentence.
- D7. Sentence and paragraph limits are linted, advisory, in the docs verify lane. See
  `scripts/copy_lint.py`.
