# Writing standard

This is the sentence-level standard for every prose surface Suwappu publishes: docs,
research posts, marketing pages, the README, bot and app strings, changelogs, and
incident reports. The page-level rules (which page type, what sections) live in
[`content-model.md`](content-model.md). The evidence behind this standard is
[`design/reference-breakdown-kamino-letter.md`](design/reference-breakdown-kamino-letter.md).

The register we are aiming for is a fintech operator writing to an institution: plain,
specific, unhurried, and honest about limits in the body of the text. The technology
should disappear into the description of what it does for the reader.

`python3 scripts/copy_lint.py <path>` checks the mechanical rules below. It runs advisory
in `scripts/verify.sh docs`.

## 1. Sentences

1. **One idea per sentence.** Target 15 to 20 words. Hard ceiling 35, and a sentence that
   long should be a list.
2. **Declarative, active, present tense.** "Routing ranks every venue before you see a
   quote." Not "Every venue will be ranked by the routing layer prior to quote display."
3. **No em-dashes, no parentheticals, no semicolons as glue.** Each one marks a sentence
   that should have been two. A parenthetical that matters gets its own sentence. One
   that does not matter gets cut.
4. **Make the claim, then state the limit.** Two sentences, not one sentence with three
   qualifiers. "Sponsorship separates fee liability from asset authority. It does not
   yet reconcile realized cost to the ledger."
5. **Concrete nouns carry the meaning.** Name the roles: custodian, transfer agent,
   lender. Name the objects: route, quote, signature, receipt. Name the steps. Adjectives
   and intensifiers are cut on sight. Section 10 lists them and the lint flags them.
6. **No stacked hedges.** One hedge word per claim, at most. Prefer stating the boundary
   as a fact. Section 10 lists the stacked forms the lint catches.

## 2. Paragraphs

1. **One to four sentences.** A paragraph longer than that is two paragraphs or a list.
2. **The one-line paragraph is a pivot.** Use it to set up what comes next. Never two in a
   row, never as a summary of the paragraph before it.
3. **Open a section with its conclusion.** The first sentence under any heading says what
   the section establishes. Method and evidence follow.
4. **Close a section when the argument closes.** Do not pad to fill a page or to reach a
   word count.

## 3. Structure of a long piece (research post, letter, launch page)

Follow this order. Skip a step only if the piece is under 400 words.

1. **Eyebrow.** What kind of document this is: "Research", "Engineering note", "Launch",
   "A letter from the founder".
2. **Headline.** Four to nine words. A noun phrase or a plain claim. No colon-subtitle.
   Put the subtitle in the deck.
3. **Deck.** One sentence. What the reader will understand after reading.
4. **The gap.** Two or three short paragraphs on the state of the world before this work.
   Who holds what, what is slow, what cannot be done today.
5. **One-line thesis.** The pivot sentence. This is also the pull quote.
6. **The argument.** Sections with noun-phrase titles. Each opens with its conclusion.
7. **Limits.** A section titled by what this does not show or do. Body text, not a
   footnote. Mandatory for research posts and any page that claims a capability.
8. **The system, if there is one.** Numbered modules 01 to 04: bold noun-phrase title
   plus one sentence of definition. No more than five.
9. **Close.** One or two sentences. What comes next, or what this makes possible.

## 4. Headlines and titles

- Sentence case everywhere. All-caps only for mono stat labels.
- Four to nine words. "What tokenization changes." "The market around the asset."
- Name the thing, not the argument about the thing. "Fee sponsorship on Tempo", not
  "The fee payer as a treasury control surface: sponsored execution on Tempo".
- A question is fine if the piece answers it in its first section.

## 5. Numbers and evidence

- **Numbers leave prose.** A figure goes in a table, in a chart with a source line, or on
  its own line. The sentence keeps the conclusion the number supports.
- **One sourced number beats ten unsourced ones.** Every chart carries: a title, the
  unit, the as-of date, and the source in small gray type. Superscript the footnote.
- **Label the evidence state.** Research posts keep the evidence block (status, as-of,
  basis, boundary). Marketing copy that cites a count links the generated source
  (`showcase/src/data/stats.generated.json`).
- **Never substitute demo data for missing live data.** Say it is unavailable.

### A cited number is a promise. Check it.

A number that names its source is the most dangerous sentence in a document.
The citation makes the reader stop checking, so the number outlives the thing it
was copied from.

The Positions launch copy advertised 10,000 cards while citing the contract
constant that reads 4,444. It quoted a Founder wallet cap of 3 against a
configured cap of 1. It promised a 40% Enterprise fee discount that
`fee_service.py` explicitly refuses to grant. Every one of those had a source
reference sitting beside it.

Four rules follow from that:

1. **Re-derive, do not re-read.** Open the file the copy cites and read the
   constant. A second document quoting the same number is not a source.
2. **A promise about money gets a test.** Any customer-facing number that comes
   from a constant belongs in an automated check.
   `scripts/check_positions_numbers.py` is the pattern. It re-derives each
   number from the contract and the mint config, and fails the docs lane when
   copy and source disagree. A check that has never failed is not yet a check,
   so break the copy on purpose once and watch it go red.
3. **Never state a benefit the code declines to give.** A tier excluded in code
   is excluded in copy, in the same table, with the reason beside it.
4. **Date the reconciliation.** Say when the numbers were last checked against
   source, so the next reader knows how much to trust them.

## 6. The pull quote

Every research post, launch page, and letter carries one pull quote.

- One sentence. Under 30 words. No numbers, no product names if avoidable.
- It is the thesis, restated so it survives being read alone.
- The strongest form compares the new thing to something the reader already stopped
  noticing. "Cross-chain execution should be as unremarkable as a card payment."
- Rendered once, full width, after the section that earns it. Attributed in small gray
  type.

## 7. Marketing and product copy

- **Describe the action, not the surface list.** "Send an intent. See the route. Approve
  the execution." Not "Trade through Terminal or Telegram, or integrate through REST,
  MCP, and typed SDKs." Surfaces go in a labeled row below the fold.
- **The scenario before the product.** Open with what a user does. Name the product in
  the second paragraph.
- **Name the steps removed, then say the steps are not the point.** "Quote, simulate,
  sign, submit, poll, in one call. The point is not fewer calls. It is that every step
  is inspectable."
- **The limit sits beside the claim.** A capability with a maturity below production
  says so in the same block, in the same type size.
- **Credentials once, as specifics.** A named prior work and one sentence on it. Not
  repeated per section.

## 8. Bot and app strings

This covers the Telegram bot, the webapp, the terminal, the browser extension,
and every JSX text node on the showcase. Most of what a user actually reads is
here, not in a document: errors, empty states, warnings, button captions.

- One sentence per line. Lead with the verb. "Send tokens to this address to fund your
  wallet."
- Errors say what happened and what to do next, in that order, in two sentences.
- No exclamation marks except in a first-run welcome, and at most one there.
- Emoji only as a leading glyph on a labeled section, never inside a sentence.
- A maturity statement stays exactly as strong as it was. If a string says a
  feature is not yet shipped, it still says that after the rewrite.
- A risk, security or custody claim may be split into shorter sentences. It may
  never be softened.

`python3 scripts/check_app_copy.py` checks these surfaces and runs in the docs
verify lane. `copy_lint.py` cannot: it reads Markdown and JSON, so it never sees
a string inside a Python handler or a JSX text node.

**Two hazards specific to app strings.**

Telegram parse modes differ per call site. Legacy `Markdown` does not require a
period to be escaped. `MarkdownV2` does, along with the rest of its reserved
punctuation, and rejects the message at send time with a 400 that CI cannot see.
Swapping an em-dash for a period is safe in one and breaks the other.
`scripts/check_markdown_escapes.py` guards this.

A rewrite in TypeScript should touch no code. `scripts/check_ts_copy_only.py`
blanks every string literal and JSX text node, then compares the remaining
skeleton against HEAD. A delegated rewrite can be accepted on that proof even
where the workspace cannot be built.

## 9. Docs

**Know which tree ships.** `gitbook/` is the deployed developer documentation.
`showcase/scripts/regen-docs.mjs` reads it into `showcase/src/data/docs.json`,
which renders the live docs site. The `docs/` tree is repository documentation
for contributors and agents, browsable on GitHub but not deployed. Both follow
this standard. Only one of them is read by customers, and it is the one that is
easy to forget.

- Everything in sections 1 and 2 applies. The content model decides the page shape.
- Reference pages prefer tables. Concept pages open with the conclusion. Runbooks are
  numbered steps with the risk note beside the step.
- Institutional-knowledge docs (decisions, incidents, research) may be longer and may
  use first person. The sentence rules still hold.

## 10. Banned list

Cut on sight, in any surface. The lint enforces the words. The intensifier and verb
senses are judgment calls the lint cannot make, so the reviewer makes them.

<!-- copy-lint: off -->
- Adjectives: seamless, seamlessly, powerful, robust, cutting-edge, state-of-the-art,
  revolutionary, game-changing, world-class, best-in-class, next-generation,
  frictionless, effortless, delightful.
- Verbs: unlock, unleash, supercharge, empower, elevate, leverage (as a verb), harness
  (as a verb, outside the `.claude/harness` sense).
- Intensifiers: truly, very, really, simply, just.
- Filler: synergy, dive into, deep dive, in today's fast-paced, at the end of the day,
  it's worth noting, it is important to note.
- Stacked hedges: may potentially, could arguably, might possibly, is likely to possibly.
<!-- copy-lint: on -->

To quote a banned word on purpose, as this section does, wrap the region in
`<!-- copy-lint: off -->` and `<!-- copy-lint: on -->`.

## 11. Review checklist

Before publishing any prose surface:

- [ ] Every sentence under 35 words. Median under 20.
- [ ] No em-dashes. No parentheticals. No semicolons joining clauses.
- [ ] Every paragraph one to four sentences.
- [ ] Every section opens with its conclusion.
- [ ] Numbers are in tables, charts, or on their own line, with a source.
- [ ] A limits section exists and is body text.
- [ ] One pull quote, under 30 words, no numbers.
- [ ] Headline four to nine words, sentence case, no colon-subtitle.
- [ ] Nothing from the banned list.
- [ ] Every cited number re-derived from the file it cites, not from another doc.
- [ ] No claimed benefit that the code excludes.
- [ ] `python3 scripts/copy_lint.py <path>` is clean or every warning is deliberate.
- [ ] `bash scripts/verify.sh docs` passes.

## 12. Rendering

Prose only counts once it renders. Two defects shipped here because nobody
looked at the page.

- **Check the markdown a surface actually supports.** The renderer in
  `showcase/src/app/docs/[section]/[slug]/markdown.ts` is hand-written, not a
  library. It had no italics rule for months, so every `*deck line*` on every
  research post published literal asterisks. Before relying on a markdown
  feature, render a page and look.
- **Say a thing once.** An on-page deck, an evidence card, and an italic
  provenance line saying the same thing are two too many. Pick the slot that
  owns the fact and delete the rest.
- **Look at it at 390px.** Every prose surface gets read on a phone.
