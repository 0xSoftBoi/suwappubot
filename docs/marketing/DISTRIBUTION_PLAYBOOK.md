---
title: "Distribution playbook — channels, cadence, crosspost mapping"
audience: internal — marketing/growth, anyone posting on Suwappu's behalf
status: draft
---

> Checked first: `docs/distribution/registry-listings.md` covers a different job — verbatim
> listing copy for MCP/agent directories (Coinbase Agent.market, Anthropic MCP Connector
> Directory, Smithery, the official MCP registry). It is not a channel/cadence playbook for
> long-form or social content, so this file is new rather than a duplicate.

## 1. Why this exists

We have real, shipped, verifiable product (execution routing across 21 integrations/45
chains, an application-layer compliance gate, an x402 agent payment surface) and close to
zero outside awareness. The gap isn't content — `docs/marketing/` and `docs/economics/`
already contain solid research — it's turning that research into small, cross-postable units
and actually posting them on a cadence. This playbook is the mapping from "research exists"
to "something goes out this week."

## 2. Channels and what each one is for

| Channel | Format | Best-fit content | Notes |
|---|---|---|---|
| **Blog / Mirror** | Long-form (800–1,500 words) | Full crosspost `.md` §A versions | Canonical version; everything else links back here |
| **X/Twitter** | Numbered thread, each tweet ≤280 chars | Crosspost `.md` §B versions | Highest-frequency channel; can also post single-tweet excerpts between full threads |
| **LinkedIn** | 1 post, professional register, no thread mechanic | Crosspost `.md` §C versions | Best channel for the stablecoin/institutional audience (compliance-screening, execution-layer pieces) |
| **MCP/agent directories** (Coinbase Agent.market, Anthropic MCP Connector Directory, Smithery, official MCP registry) | Structured listing forms | `docs/distribution/registry-listings.md` | Separate workflow — one-time submission + keep-in-sync, not a cadence item |
| **Telegram (own bot/channel)** | Short announcement + link | Any published piece, condensed to 2-3 sentences | Use to drive existing users to read/share, not for cold outreach |
| **Event / in-person** (Stablecon DC and similar) | Pitch scripts + live demo | `docs/marketing/stablecon-dc-2026.md` | Treat as a distribution channel with its own pre/post cadence, not just a one-day event |

## 3. Cadence

Default rhythm outside of event crunch (see `stablecon-dc-2026.md` §6 for the compressed
event-week version):

- **One new long-form piece every 5–7 days.** Publish blog/Mirror first, same day or next day
  as X thread, LinkedIn post 1–2 days after (stagger so the same audience doesn't see three
  versions of the same thing in one day).
- **Between long-form drops, 1–2 standalone tweets** pulling a single fact/number out of an
  already-published piece (e.g., a single stat: "21 routing integrations, 45 chains, one
  execution layer") to keep the account active without needing new research every time.
- **Re-share cadence:** re-post the best-performing piece once, roughly a week after original
  publish, with a fresh framing line — do not silently repost identical copy.
- **No cadence commitment to research that isn't grounded.** If a topic can't be traced to a
  specific file/constant (per the sourcing discipline below), it waits, it doesn't ship on a
  timer.

## 4. Crosspost package → channel mapping (current inventory)

| Package | Blog/Mirror | X thread | LinkedIn | Priority audience |
|---|---|---|---|---|
| `crosspost/execution-layer.md` | §A | §B | §C | General crypto/DeFi, cross-chain builders — good opener, most broadly legible |
| `crosspost/compliance-screening.md` | §A | §B | §C | Stablecoin issuers, institutional/compliance — **lead with this ahead of Stablecon DC** |
| `crosspost/agent-payments-x402.md` | §A | §B | §C | AI agent builders, x402/agentic-commerce ecosystem, MCP directory audiences |
| `crosspost/fee-denominated-points.md` | §A | §B | §C | Tokenomics/mechanism-design audience — publish clearly labeled pre-TGE, not as launch news |

Each package's §D (SEO title/description) should be used verbatim as the blog/Mirror post's
meta title/description — don't rewrite it ad hoc per platform.

## 5. Non-negotiable rules for anyone posting from this playbook

1. **Every number in a post must trace to a file cited in that package's "Sources" section.**
   If you want to add a new number that isn't already sourced, go find the file first — don't
   estimate and post.
2. **Never claim something is "live" from a doc alone.** Cross-check `docs/product-status.md`
   status vocabulary (Production / Hosted / Shadow / Experimental / Plan) before publishing a
   maturity claim. If a package says "shipped, default-off," keep saying that — don't let a
   later edit quietly upgrade it to "live."
3. **Never use forbidden phrasing for Positions/Membership or any tokenized-equity product**:
   no "own a piece of," "shares of," "invest in," "dividends," or implied price appreciation.
   See `docs/marketing/positions-launch.md` §6 for the full list and why.
4. **Never imply the Seasons token is live or investable.** No token exists yet; see
   `crosspost/fee-denominated-points.md` header. Mechanism-design content about it is fine;
   launch-toned language about it is not.
5. **No countdown urgency, no manufactured scarcity, no exclamation marks, no "revolutionary."**
   Voice reference: "The execution layer between intent and markets" (`showcase/src/app/page.tsx`).
6. **Every package ends with a "what we did not claim" section — keep it when reposting.**
   If space forces a cut (e.g., a single tweet pulled from a thread), the omission itself must
   not introduce a claim the full piece didn't make.

## 6. Adding a new crosspost package

1. Read the underlying code/doc directly — not a summary of it — and pull every number from a
   constant, generated file, or explicitly-cited doc.
2. Check `docs/product-status.md` for the feature's actual maturity before writing any tense
   that implies "this is live now."
3. Write the four sections (long-form, X thread, LinkedIn, SEO title/description) plus a
   Sources block and a "what we deliberately did not claim" block, following the existing
   files in `docs/marketing/crosspost/` as the template.
4. Add a row to §4 of this file so the mapping stays current.
