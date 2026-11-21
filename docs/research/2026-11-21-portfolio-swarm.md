# Founder Decision Memo: where to put the next 90 days

*Date: 2026-11-21. Inputs: 17 idea scorecards, 10 red-teamed combinations, 3 judges. Read-only analysis. No files were changed.*

## 1. The answer in 3 sentences

No idea and no combination survived red-teaming. Every one dies on the same constraint: you have no distribution and no trust, and you have about $0. The least-bad move is a cheap probe of **@dial/supervisor** (phone approval for coding agents, built on Dial identity). It costs about 4 hours, has a hard day-7 kill gate, and should run while Suwappu feature work is frozen. A paid setup offer comes after it, and only if you can name 15 or more warm buyers. Treat the "human-agent approval network" as a lottery ticket with kill gates, not as conviction. Dial core stays the priority whatever the probe shows.

## 2. Leaderboard (all 17 ideas)

Column notes:
- **Sum** is the unweighted total of size, fit, speed, distribution, defensibility and solo-feasibility, out of 30. It is my own simple roll-up because the actual formula weights were not supplied. See caveats.
- **Kill** is the red team's kill probability.
- Ties are broken by lower Kill.

| # | Idea | Sz | Fit | Spd | Dist | Def | Solo | Sum | Kill | Role | Verdict | Fatal flaw (12 words or fewer) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 15 | Done-for-you agent studio | 3 | 2 | 3 | 1 | 1 | 3 | 13 | 0.65 | cash_engine | combine_only | Services sell on trust/referrals; founder has neither; drains Dial |
| 1 | Agent phone network | 2 | 3 | 2 | 1 | 1 | 3 | 12 | 0.90 | distraction | kill | Invite-gated app, no PSTN; HumanLayer approval SDK already deprecated |
| 3 | Private AI you text | 2 | 3 | 2 | 1 | 1 | 3 | 12 | 0.90 | distraction | kill | OpenClaw is free, local, and already on Signal/WhatsApp |
| 2 | Claude Code on your phone | 2 | 3 | 1 | 1 | 1 | 4 | 12 | 0.92 | distraction | park | Free OSS approvers and Anthropic Remote Control already do this |
| 16 | Solana Seeker distribution | 1 | 2 | 1 | 2 | 1 | 4 | 11 | 0.90 | distraction | kill | Reward farmers, invite-only messenger, no MWA; nobody to message |
| 6 | Leash OSS spend firewall | 2 | 3 | 1 | 1 | 1 | 3 | 11 | 0.92 | distraction | kill | Hash-chained x402 receipts already shipped as MIT OSS |
| 4 | AI that calls businesses | 4 | 1 | 2 | 1 | 1 | 2 | 11 | 0.93 | distraction | kill | Meta/Google own consumer side; Dial has no PSTN/SIP |
| 11 | Security for agents | 4 | 2 | 1 | 1 | 1 | 2 | 11 | 0.95 | distraction | kill | CISOs won't buy unaudited solo; OSS end already crowded |
| 5 | Phone book for agents | 2 | 2 | 1 | 1 | 1 | 3 | 10 | 0.95 | distraction | kill | ANS (Linux Foundation) owns naming; +0 can't reach PSTN |
| 7 | Chat wallet, next billion | 4 | 2 | 1 | 1 | 1 | 1 | 10 | 0.95 | distraction | kill | WhatsApp bans crypto; UPI freezes; Pix FX rules |
| 9 | Execution Index | 1 | 2 | 1 | 1 | 1 | 3 | 9 | 0.93 | distraction | kill | ClearTrace free; 0 swaps means quotes only, conflicted |
| 14 | Quant desk | 3 | 1 | 1 | 1 | 1 | 2 | 9 | 0.93 | distraction | kill | No capital, no track record, no evidence of edge |
| 12 | Post-quantum migration | 2 | 2 | 1 | 1 | 1 | 2 | 9 | 0.95 | distraction | kill | PQ messaging is a free checkbox; Dial lacks forward secrecy |
| 17 | AI materials discovery | 4 | 1 | 1 | 1 | 1 | 1 | 9 | 0.97 | distraction | kill | No asset, lab or credential; enterprise PhD-led sales |
| 10 | AI auditor hunting bounties | 2 | 1 | 1 | 1 | 1 | 2 | 8 | 0.93 | distraction | kill | Platform AI scanners pre-harvest; Code4rena gone; slow payouts |
| 8 | Agent-to-agent marketplace | 2 | 2 | 1 | 1 | 1 | 1 | 8 | 0.95 | distraction | kill | Zero liquidity; Virtuals can't monetize even with subsidies |
| 13 | Sovereign comms for orgs | 3 | 1 | 1 | 1 | 1 | 1 | 8 | 0.95 | distraction | kill | Product doesn't exist; government procurement; Matrix owns it |

Defensibility is 1 for all 17 ideas, and distribution is 1 for 16 of them. The scorecards largely agree with each other. The binding constraint is not idea quality.

## 3. What the combination analysis showed

- **Scale:** 833 combinations were scored. The 10 highest were sent to adversarial red-teaming. **None survived.** Red-team scores ranged from 2 to 4 out of 10.
- **Recurring cores:** #15 (studio/services) appears in 7 of the top 10 and #2 (supervisor) in 5 of 10. Those two cores carry the whole top of the leaderboard. Everything else (#1, #3, #4, #6, #10, #11, #16) appears only as a partner to one of them.
- **Highest red-team score:** [11, 15], at 4. These are MCP-security reviews whose reports recommend supervisor approval gates. It dies on trust, on the 30-90 day disclosure delay before credibility write-ups can be published, and on the attention it would take from Dial.
- **Common verdict:** Every red-team pass, including ones that started from unrelated ideas (x402, phone agents, local AI for law firms, security), ended up recommending the same fallback. That fallback is: publish @dial/supervisor and offer a HumanLayer-migration setup. It is the only convergence in the dataset. Treat that as the signal, though it is weak.
- **Why combos fail:** Pairing two zero-distribution motions does not create distribution ([2, 15]). Pairing a channel with a hook fails when both depend on the same unbuilt piece, the invite-gate bypass ([2, 16]). Adding Suwappu as a backend gives you a reason to keep spending attention on a product with 0 users ([1, 2]).

## 4. Recommended portfolio

| Slot | Choice | Status |
|---|---|---|
| Cash engine | Stripped-down #15: fixed-fee $1.5-3K "human-approval agent setup/migration", built on supervisor | Conditional. Run only if the day-0 warm list has 15 or more names |
| Wedge | #2: @dial/supervisor demand probe, then publish | Primary. Cheapest test that can actually fail |
| Destination | [1, 2] narrowed: generic human-agent approval cards on Dial (BIP-39) identity, with no Suwappu backend, no +0/PSTN claims and no spend approval | Lottery ticket. Unlocked only by retention gates |

**Sequencing**
1. **Day 0:** Freeze Suwappu feature work. Write down the names of people who have paid, or would plausibly pay, for engineering work. Fewer than 15 names means the cash engine is off.
2. **Days 1-2 (about 4 hours):** Record a 60-second demo from the local checkout (`packages/dial-supervisor`). Post it once each to Show HN, r/ClaudeAI and HumanLayer-sunset threads, with a one-field "get an invite" signup.
3. **Day 7, Gate A:** At least 40 real signups. If it misses, stop. You will have built zero infrastructure.
4. **Days 8-14, only if Gate A passes:** Publish to npm (confirm the name first, because publishing is irreversible). Add the PermissionRequest hook, auto-issue +008 numbers on pairing to bypass the invite gate, and verify on a clean machine.
5. **Days 8-30, in parallel, only if the warm list has 15 or more names:** Send 40 personal messages offering the fixed-fee setup. Cap the work at 8 hours a week. Nothing custodial, no mpc-signer, no Suwappu.
6. **Day 30:** Apply the kill gates in section 5. If 3 or more retained users ask for approvals outside coding, design the generic approval card. Otherwise stop.

Timing caveat: this order lands the published package around Dec 5, just after HumanLayer's hosted sunset (around Dec 4, UNVERIFIED in detail). The red team found that window weaker than it first looked, because the HumanLayer approval SDK was deprecated before the acquisition. Don't skip the probe to chase the date.

Zero-cost side asset: publish the SuwappuCoreRouter self-audit case study (bug, PoC, fix). It needs no services thesis.

## 5. 30-day killer tests (top 3)

**A. #2 supervisor probe (Judge 1's pick)**
- **Pass:** at least 40 real signups by day 7 (crawlers excluded). Then by day 30, at least 15 paired supervisors who answered 3 or more asks during days 15-30, and at least 3 of them who sent a human-to-human Dial message.
- **Kill:** missing either gate. If it fails, park this wedge permanently. Don't generalise the failure to "Dial agents" as a whole, because the probe only tested one wedge.
- **Ignore:** npm download counts.

**B. [2, 15] supervisor plus paid setup (Judge 2's pick)**
- **Day-0 gate:** 15 or more named buyers.
- **Track two counters:** (A) paired supervisors from strangers, and (B) signed, paid pilots.
- **Attribution:** count the sales conversations that started from the OSS post.
- **Kill:** A < 20, or B = 0, or zero inbound attributable to the post. If B ≥ 1 but attribution is zero, it is a plain services gig, so judge it as one.

**C. [1, 2] approval network (Judge 3's pick)**
- **Day 4 friction test:** 5 cold strangers go from `npx` to a tapped approval. Kill if the median is over 5 minutes, or if anyone needs a TestFlight grant done by hand.
- **Day 30:** at least 20 paired supervisors who aren't you, at least 5 still active in week 4, and at least 3 who ask, unprompted, for non-coding approvals.
- **On a pass:** only a generic, non-money approval card. Spend approval needs a named design partner who already moves real money through an agent.

## 6. Kill / park list

- **Kill outright:** #3, #4, #5, #6, #7, #8, #9, #10, #12, #13, #14, #16, #17. Also #11 as a company. Keep only an optional methodology post and checklist as Dial lead-gen.
- **Kill as framed:** #1 as a "phone network" (no PSTN). Its useful core is folded into the destination slot.
- **Park:** #2 beyond the probe gates. #15 as a general "agent studio": never run it generically.
- **Freeze:** Suwappu feature work, including the swap engine, x402/Leash extraction and Execution Index. Assets are kept as design reference only.
- **Never:** selling or demoing the unaudited mpc-signer, anything custodial or fund-moving for clients, bounty farming, or regulated buyers (clinics, law firms) before Dial is on mainnet with a published security review.

## 7. Where the judges disagreed

| Judge | Lens | Pick | Core disagreement |
|---|---|---|---|
| 1 | Cheapest falsifiable experiment | #2 probe (3.0) | Services split attention, and the warm list is unverified. Build nothing until there is a demand signal |
| 2 | 90-day revenue | [2, 15] (3.2) | Services are the only cash path. Add [11, 15] security reviews in weeks 3-6 |
| 3 | $1B / VC | [1, 2] (3.0) | Services cap the outcome. A network effect is the only possible moat. Ranked [2, 15] at 1.5 |

- **They agree** that supervisor is the core asset, that Suwappu should be dropped, that mpc-signer and custody are off-limits, and that each line needs a hard kill by day 30.
- **They disagree** on whether to add services (Judge 2 yes, Judge 3 no) and whether to build before validating (Judge 3 builds in days 1-3, Judge 1 probes first).
- **[11, 15] splits them:** Judge 2 ranks it 2nd (3.0), Judge 1 ranks it last (1.5), arguing the 15-day advisory gate is unrealistic.
- **Resolution in this memo:** use Judge 1's order (probe before build), Judge 2's cash arm only behind the 15-name gate, and Judge 3's destination only behind retention gates.

## 8. Caveats

- **Weights are heuristic.** The 1-5 dimension scores, the kill probabilities, the red-team 0-10 scores and the judge scores are subjective. The leaderboard Sum is an unweighted roll-up I made because the scoring formula's weights were not provided. With all defensibility scores at 1, ranking is driven mostly by speed and solo-feasibility.
- **833 combinations:** only the 10 highest-scoring were red-teamed. Lower-ranked combinations were not adversarially checked.
- **Unverified repos:** claims about suwappu-dag, suwappu-lattice-protocol, suwappu-revm, evmsec, the audit-framework repos, quantdesk, GhostCatcher, cargocredit, the matgl/chgnet forks, PhoneBotX, DialPay, Payphone, Dial-Agent-Gateway, mcp-suite and others are UNVERIFIED. They were not cloned, and some could change individual verdicts (especially #12 and #14).
- **Unverified market facts:** the HumanLayer sunset date and refugee pool size; OpenClaw's star count; the Seeker DAU; Upwork MCP rates; whether Vapi/Retell sign BAAs; that a separate "Dial" agent-phone-number product exists; how the TCPA applies; and the real x402 volume range ($1.6M-24M per 30 days, depending on filtering). All are UNVERIFIED or come from single sources.
- **Verified locally by reviewers:** `packages/dial-supervisor` exists as @dial/supervisor 0.1.0 and is unpublished. Dial has no PSTN/SIP, no MWA/Seed Vault and no PQ code. The Arbiter is hardwired to testnet. Suwappu has 0 completed swaps.
- **Warm list:** the 15-name warm buyer list is an assumption that nobody has checked. If it doesn't exist, the cash-engine slot is empty, and the honest plan is the probe plus full focus on Dial.


---

# Judges

```json
[
 {
  "ranking": [
   {
    "ids": [
     2
    ],
    "score": 3,
    "why": "Least bad, because it is the cheapest experiment that can actually fail. Before building anything: record a 60-second demo from the local checkout and post it once each to Show HN, r/ClaudeAI and HumanLayer threads, linking a signup for an invite. Kill on day 7 if there are fewer than 40 real signups. I confirmed dial-sdk/packages/dial-supervisor exists as @dial/supervisor 0.1.0 and is unpublished, so the demo really costs hours. Every red-team pass ends up recommending this same asset, which is the only convergence in the whole set. The risk is still high. Phone approval for coding agents is already a free commodity (claude-remote-approver, ntfy hooks, Anthropic Remote Control push). The HumanLayer approval SDK was deprecated before the Factory acquisition, so the deadline is weak. A pass gate is still unlikely. But a miss costs about 4 hours and leaves Dial's core untouched."
   },
   {
    "ids": [
     1,
     2
    ],
    "score": 2.5,
    "why": "Only the Dial-only funnel test is worth keeping. Watch 5 cold strangers go from npx to their first phone approval, and kill on day 4 if the median is over 5 minutes or anyone needs a TestFlight grant by hand. That is a sharp, honest friction test. It ranks below the pure probe because it needs about 3 build days up front: an invite-gate bypass, an npm publish under an unscoped name (publishing can't be undone) and a hook. It does this before any demand signal exists. Drop the Suwappu backend and spend-approval generalization entirely. Coding agents don't spend money."
   },
   {
    "ids": [
     15
    ],
    "score": 2,
    "why": "Only as the stripped-down version: a $1.5-3K fixed-fee setup offer built on supervisor, 40 personal messages, an 8 hr/week cap, and a kill rule of no paid pilot by day 30. This is the one path that could produce cash. The founder must first pass a day-0 gate of at least 15 named people who might pay for engineering work. That warm list is unverified. Without it this is cold outreach with zero references, and the track record (8 of 8 PRs closed, 0 stars) predicts $0."
   },
   {
    "ids": [
     2,
     15
    ],
    "score": 2,
    "why": "Same assets as the two entries above. Its one real contribution is attribution: kill the lead-magnet thesis if no inbound traces back to the OSS post, even if outreach closes a deal. But running two zero-distribution motions in parallel splits the founder's attention, and the pool of HumanLayer refugees is small and the wrong shape (teams moving to Factory or self-hosting). Run the pieces one after another (#2 probe, then the #15 offer), not as a combination."
   },
   {
    "ids": [
     11,
     15
    ],
    "score": 1.5,
    "why": "The red team scored it highest, but it rests on a gate the founder is unlikely to pass: an advisory accepted by a maintainer of a 500+ star MCP server within 15 days, found by a founder split across three orgs. Disclosure windows also stop credibility write-ups from appearing inside 30 days. Keep only the free fallback, a methodology post plus a checklist, and only as Dial lead-gen after supervisor is live. Neither services nor anything touching mpc-signer belongs in it."
   }
  ],
  "pick": "2"
 },
 {
  "ranking": [
   {
    "ids": [
     2,
     15
    ],
    "score": 3.2,
    "why": "This is the only option that six separate red-team verdicts independently arrived at as the fallback. It reuses an asset that already exists: @dial/supervisor at dial-sdk/packages/dial-supervisor, roughly 3 build days. It has the only dated demand window in the portfolio, the HumanLayer hosted service sunsetting around 2026-12-04 (date UNVERIFIED in detail). Its buyers are developers the founder can actually reach. And it pushes Dial, the one project with momentum, forward instead of draining it. It did not survive red-team scrutiny (score 3). The two distribution channels are each weak, phone approval for coding agents is free elsewhere (claude-remote-approver, Pushary, Anthropic Remote Control), and the pool of HumanLayer users who would switch is small. Run it only under hard gates. Day 0: the founder must name at least 15 people who might pay; with fewer, drop the services arm. Days 1-3: npm publish, a PermissionRequest hook, an invite-gate bypass for pairing, and a 60-second demo. Then post once, send 40 personal messages offering a $1.5-3K fixed-fee migration/setup, cap the work at 8 hrs/week, and stay away from funds and mpc-signer entirely. Kill at day 30 if there is no paid pilot, or if fewer than 20 paired supervisors come from people the founder doesn't know."
   },
   {
    "ids": [
     11,
     15
    ],
    "score": 3,
    "why": "This has the highest red-team score of any combo (4). The cash product is MCP security reviews: $1-1.5K fixed fee, 5-day turnaround, on 500+-star MCP servers that touch money, credentials or a shell. A checklist plus a methodology post costs almost nothing, and every report can recommend @dial/supervisor approval gates, which ties it back to Dial. It ranks second for three reasons. Responsible disclosure holds back the credibility-building write-ups by 30-90 days. The founder has no security reputation. And deep bug hunting competes with Dial for attention. Run it only after the supervisor package is published, cap it at 10 hrs/week, and kill at day 15 if no GHSA/CVE has been accepted, or at day 30 if no review has been paid."
   },
   {
    "ids": [
     15
    ],
    "score": 2.7,
    "why": "A pure services cash engine is the fastest route to any revenue at all within 90 days. Done generically, though, it has nothing to differentiate it: Upwork MCP work runs about $45-95/hr (UNVERIFIED), there are no references, and selling the money-moving angle carries liability. It is only worth running as a productized, Dial-anchored offer, which is option 1. As a standalone 'agent studio' it eats Dial's calendar for a likely $0-2K."
   },
   {
    "ids": [
     2
    ],
    "score": 2.3,
    "why": "The zero-build demand probe: a demo video plus a signup link, with Gate A at 40 real signups by day 7. It is the cheapest way to learn whether the Dial agent wedge has any pull at all, at about 4 founder-hours, and it is the right first step if the founder can't name 15 warm buyers. It produces momentum and signal, not revenue, so for a 90-day revenue goal it is a sub-step of option 1, not the destination."
   },
   {
    "ids": [
     10,
     11,
     15
    ],
    "score": 2,
    "why": "Publish the SuwappuCoreRouter self-audit case study (bug, PoC and fix) as a near-free credibility asset, then do one free hackathon-winner review and sell a single $2.5K pre-launch review. The case study is worth doing whatever else happens. As a business line, though, it sells trust the founder has no record of, it needs deep uninterrupted attention, and bounty farming is dead (Code4rena wound down, and AI scanners run before human reviewers). Treat it as an add-on to option 2, not a bet of its own."
   }
  ],
  "pick": "[2,15]: publish @dial/supervisor to npm in days 1-3 (hook, invite-gate bypass, clean-machine install, 60-second demo), then send a 30-day, 8 hrs/week outreach to HumanLayer users and warm contacts offering a $1.5-3K fixed-fee human-approval migration/setup. Gates: on day 0, 15 or more named buyers, or drop the services arm. Kill at day 30 if there is no paid pilot, or if fewer than 20 pairings come from people the founder doesn't know. Never custodial, never mpc-signer, never Suwappu. If it passes, keep 1-2 design partners and turn their feedback into Dial features. Add the MCP-security-review track (option 2) in weeks 3-6 only once the supervisor is live. If it fails, stop services completely and put every hour back into Dial core."
 },
 {
  "ranking": [
   {
    "ids": [
     1,
     2
    ],
    "score": 3,
    "why": "This is the only option where the defensibility could compound: a network of identities and channels between humans and agents, rooted in Dial's BIP-39 identity. Under a $1B+ lens, network effects are the only moat this founder could plausibly earn. Every other option is a commodity tool, a services business or a regulated wedge. It also sits on the one asset with momentum (Dial, ~20 PRs merged 2026-11-20) and has a dated opening: HumanLayer's hosted service sunsets around Dec 4 (the exact date and the size of the user pool are UNVERIFIED). Run it only in gated form: no Suwappu backend, no +0/PSTN claims. Days 1-3: publish dial-supervisor, add the PermissionRequest hook and a bypass of the invite gate. Day-4 test: if the median stranger needs more than 5 minutes to onboard, kill it. Day 30: at least 20 paired supervisors and at least 5 still active in week 4. Expand to a generic approval card only if 3 or more of them ask for approvals outside coding. Red-team score is only 2.5. The approve-from-phone feature is free in OSS tools and in Anthropic's Remote Control, so this is a lottery ticket. It is still the only ticket here with a $1B-shaped payoff."
   },
   {
    "ids": [
     2
    ],
    "score": 2.5,
    "why": "Same wedge with less scope: a zero-build demand probe first (demo plus signup page, Gate A: 40 real signups by day 7), then infra only if Gate A passes. It is the cheapest way to falsify the Dial-agent distribution thesis while spending almost no founder time. It ranks below 1+2 for a VC because on its own it stops at a free supervisor tool. It never reaches the network-expansion step, which is the only part that could become defensible. It is the right first step on either path."
   },
   {
    "ids": [
     11,
     15
    ],
    "score": 2,
    "why": "Security reviews for MCP servers, with accepted GHSA/CVE advisories as the credibility gate. It got the highest red-team score (4), and agent security is a large market (Lakera, Protect AI and Prompt Security were all acquired), so the outcome ceiling is real. Ranked 3rd because the play is services-led, it has no moat (AEGIS is a fail-open regex port, and the OSS MCP-firewall space is crowded), and the founder has no security track record. A path to $1B would require pivoting into a product later against funded vendors. It is useful mainly when the review reports point clients to @dial/supervisor approval gates."
   },
   {
    "ids": [
     2,
     15
    ],
    "score": 1.5,
    "why": "The supervisor as a lead magnet for a paid setup/migration service at $1.5-3K. A paid pilot would be a real demand signal, and design-partner feedback could shape Dial. For a $1B investor it is mostly negative: services revenue caps the outcome and takes attention from Dial, and the red team found that both distribution motions start from zero, so they don't add up. Keep only the supervisor half."
   },
   {
    "ids": [
     15
    ],
    "score": 1,
    "why": "Listed only as a possible way to fund the work, not as an investment. Size 3, defensibility 1, and the red team said it does not survive: no trust, no references, and a commodity channel at $45-95/hr (UNVERIFIED). Day-0 gate: fewer than 15 names of people who would plausibly pay means skip it. It has no venture-scale path. Fixed-fee services are acceptable only if they fund Dial's runway without slowing its roadmap."
   }
  ],
  "pick": "1+2: Dial supervisor as a gated wedge into a human-agent approval network built on Dial identity (no Suwappu backend). Order: publish to npm, add the hook and invite-gate bypass, run the day-4 onboarding test, then the day-30 retention gates; expand to a generic approval card only on demand. This is the only option whose moat could be a network effect. Honest caveat: no option clears the $1B bar on current evidence, and this pick is a cheap lottery ticket with hard kill gates, not a high-conviction bet."
 }
]
```

# Combo red-team verdicts

```json
[
 {
  "ids": [
   15
  ],
  "thesis": "Control and baseline for the whole set. Run the studio alone as a narrow productized offer: a fixed-price, 2-week 'policy-gated agent that touches money or ops' build. It reuses PolicyService, ApprovalService, the hash-chained audit, seal receipts and the hosted MCP from Suwappu (api-ts/src/services/*). Cash is the binding constraint and services are the only idea with speed=3 and kill <0.7. The adversarial question is whether any buyer pays without warm referrals, given 0 stars, 8 closed PRs and an MPC signer that is unaudited and must not be sold.",
  "sequencing": "Weeks 0-2: publish one fixed-scope offer page and one public case-study repo built from existing Suwappu components, with custody excluded and no fund-moving keys. Weeks 2-6: direct outreach to 50 named crypto/agent teams plus Upwork MCP gigs, which build reviews. Revenue funds Dial runway. Kill if there is no paid engagement by week 6. Freeze new Suwappu feature work.",
  "survives": false,
  "score": 3,
  "synergy_real": "Mostly a story. As the control/baseline, #15 has no internal synergy: it is one member, so \"synergy\" can only mean reusing Suwappu code to build client work. That reuse is thinner than the thesis claims. PolicyService.ts (652 lines) and ApprovalService.ts (633 lines) exist in api-ts/src/services/, but they are wired to Suwappu's own swap/agent domain. They would have to be extracted before a client could use them, and no paying user has ever exercised them. The parts a buyer would pay a premium for (keys that move funds, the MPC signer, audit-grade guarantees) are exactly the parts that must be excluded. What remains, an MCP server plus an approval step plus an append-only log, is commodity work that Claude Code/Cowork or a $45-95/hr Upwork freelancer can reproduce. Those rates are UNVERIFIED, from listings seen 2026-11-21. The one real link is Dial-side, not Suwappu-side. @dial/supervisor exists in dial-sdk/packages/dial-supervisor (v0.1.0, has a bin and MCP mode, not on npm). Its job, a coding agent asking a human on their phone, maps directly onto HumanLayer's displaced users, whose hosted service sunsets around 2026-12-04 per the founder context (not re-verified here). That is product design-partner revenue, and selling it is a different act from running a studio.",
  "fatal_flaw": "Trust and distribution can't be bought in 6 weeks, and the studio has no differentiator left once the risky parts are removed. Three things make up the trust gap. First, there are zero referenceable proof points: 0 completed swaps, 0 stars across 12 example repos, ~8 integration PRs closed unmerged, nothing published. Second, the only angle buyers would pay extra for, policy-gated agents that move money, can't be offered: the MPC signer is unaudited and the liability is uncapped. Third, the channel is cold outreach plus a review-less Upwork account in a commoditizing category. On top of that, client delivery needs someone responsive on the calendar. That attention comes straight out of Dial, the only asset with momentum (~20 PRs merged 2026-11-20). The likely outcome is the worst case: weeks of outreach, a $500-2K gig or nothing, and Dial stalled. The 6-week kill window is too long given the cost to Dial.",
  "killer_test_30d": "Run one test, with the studio offer removed. Days 1-3: publish @dial/supervisor 0.1.x to npm (the package already exists, so this takes hours, not weeks). Ship a 60-second demo: Claude Code calls an ask tool, the phone buzzes in Dial, the human replies, the agent continues. Put up one page: \"HumanLayer replacement + setup, $1.5-3K fixed fee, done in 5 days.\" Days 3-21: send 40 personal messages to people who publicly used or discussed HumanLayer's hosted service (GitHub issues/discussions, Discord/Slack, posts about the sunset), plus every warm contact the founder can name. Cap the effort at 8 hrs/week, log it, and never touch funds or mpc-signer. Pass: by day 21, at least 1 signed and paid pilot of $1.5K or more, or at least 3 qualified calls plus at least 25 npm installs from people other than the founder. Kill: no paid pilot by day 30. Then stop selling services entirely and treat the npm package as a free top-of-funnel for Dial. Before any outreach, do a day-1 gate: if the founder can't write down 15 real people who have paid or would plausibly pay for engineering work, skip the custom-build studio framing even if the migration test runs.",
  "revised_sequencing": "Week 0 (days 1-3): freeze Suwappu feature work as planned. Do not build a Suwappu case-study repo, because it costs build time and has no users to cite. Publish @dial/supervisor to npm with a demo and a one-page migration/setup offer. Days 3-21: run the HumanLayer-displacement outreach (40 messages) plus one productized Upwork listing as a control, hard-capped at 8 hrs/week. Deliver any pilot within 5 days, reusing ApprovalService-style patterns only as design reference, with no custody and no fund-moving keys. Day 21: decide. A paid pilot means you keep 1-2 design partners and turn their feedback into supervisor/Dial product features. No paid pilot means you kill services outright and return all hours to Dial. Never run a general \"agent studio\" offer, and never sell or mention mpc-signer. Revisit a studio only if 2 or more inbound requests arrive unprompted after the supervisor package gains real users.",
  "summary": "I verified that @dial/supervisor exists unpublished at dial-sdk/packages/dial-supervisor (v0.1.0, has a CLI and MCP mode). I also verified that Suwappu's PolicyService and ApprovalService exist (about 1.3K lines). As specified, the done-for-you agent studio does not survive. It needs trust and warm referrals this founder can show no evidence of having. Its only premium angle, money-moving policy-gated agents, can't be sold because the MPC signer is unaudited and the liability is uncapped. What can be sold is commodity MCP work that buyers or cheap freelancers can now do themselves, and running it takes calendar attention from Dial, the one project with momentum. The baseline is useful mainly as a negative control. Weak cash speed doesn't justify a 6-week drain on focus. The salvageable piece is not a studio: it is fixed-fee HumanLayer-replacement pilots on @dial/supervisor during the hosted-sunset window (around Dec 4, per founder context, not re-verified). That is design-partner revenue that feeds Dial. Test it with a 21-30 day kill rule and an 8 hr/week cap. Score 3/10 for the studio as specified; the supervisor-migration variant would score about 5/10, with its upside limited by how many HumanLayer hosted users actually exist and can be reached (UNVERIFIED)."
 },
 {
  "ids": [
   2,
   15
  ],
  "thesis": "Use @dial/supervisor as an open-source lead magnet and demo for studio sales, not as a product. 'Your coding agent asks you on your phone' gives a concrete demo of human-in-the-loop agent builds, and studio clients become the first real Dial installs. This tests whether a free tool can produce inbound when OSS approval hooks (claude-remote-approver, ntfy hooks, Pushary, Remote Control) already set the price at $0.",
  "sequencing": "First: publish @dial/supervisor to npm with a non-invite path, or at least auto-issued testnet invites, so the hook takes one command. That is the cheapest falsification. Then use it as the demo in studio outreach to agent-building teams. Studio cash funds Dial. Supervisor usage counts only as a leading indicator, never a revenue line.",
  "survives": false,
  "score": 3,
  "synergy_real": "Mostly a story. The link only runs one way. The studio can use the supervisor as a demo prop, but the supervisor can't generate studio leads. The lead-magnet idea assumes a free tool brings in inbound, and the one category where that might work has its price set at $0 by free OSS hooks (claude-remote-approver, claude-ntfy-hook, Pushary) and by Anthropic's own Remote Control push. Teams that buy done-for-you agent builds don't find vendors through phone-approval npm packages. They come through referrals and reviews, and this founder has neither. The second claim, that studio clients become the first real Dial installs, inverts the risk. Clients would put an invite-gated, testnet-only (+008, operator-testnet.dial.work by default in packages/dial-supervisor/src/state.ts), TestFlight-only messaging app into their production approval path. A paying client would see that as a liability. The one real overlap is narrow: \"approval on your phone, E2EE, no vendor server\" is a concrete 60-second demo, and it does make an agent-build pitch more tangible. That gives the demo some value. It doesn't make it a lead source. Checked locally: @dial/supervisor 0.1.0 is real and ships host configs for claude-code, codex, cursor, vscode, windsurf and zed. `init` downloads the dial-agent binary and pairs over a Dial contact. It has no PermissionRequest hook, and it isn't on npm. The one-command falsification therefore still needs three things built first: npm publish, a hook, and a path around the invite gate.",
  "fatal_flaw": "The combination stacks the founder's two weakest channels and calls the result a funnel. The supervisor's inbound depends on OSS distribution: the record shows 8 PRs closed unmerged, 12 repos with 0 stars, and nothing on npm. The studio depends on trust and warm referrals, and nobody has verified that a warm list exists. If the free tool can't produce inbound, the studio is plain cold outreach. If the studio is cold outreach, it gets no lift from the supervisor demo. Two zero-distribution motions don't add up to one working one. The focus cost compounds this. Client delivery needs calendar responsiveness, and it would take time from Dial, the only project with momentum (about 20 PRs merged 2026-11-20). The supervisor polish work (hook, invite bypass, clean-machine install, demo video) is real Dial engineering time spent on a feature the market prices at $0. The HumanLayer-refugee angle doesn't rescue it. Those users are teams moving to Factory or self-hosting the Apache-2.0 code, not single developers looking for a texting MCP. The sunset date (around Dec 4) and the pool size are UNVERIFIED in detail.",
  "killer_test_30d": "Run one 30-day test with two independent counters and fix the kill thresholds before starting. Week 1 (3 days maximum): publish dial-supervisor to npm under its current name, which was 404 on npm when checked. Add a thin PermissionRequest hook and auto-issue testnet invites or bypass the gate for supervisor pairing. Verify a 2-command install on a clean machine and record a 60-second demo. Post it once each to Show HN, r/ClaudeAI and HumanLayer-sunset threads. Weeks 1-4 in parallel: send 40 personal messages offering a fixed-fee \"human-approval agent setup/migration\" at $1.5-3K to the warm list plus HumanLayer users, with the demo as the hook. Cap the work at 8 hrs/week and exclude anything that moves funds or touches mpc-signer. Read the results on day 30. Counter A: paired supervisors (nonzero `status paired`) by people the founder doesn't know. Counter B: signed and paid pilots. Attribution check: how many sales conversations started because of the OSS post, rather than because the founder reached out. Kill the combination if A < 20, or B = 0, or zero inbound conversations trace back to the supervisor. In that last case the lead-magnet thesis is falsified even if outreach closed a deal. If B >= 1 but attribution is zero, what you have is a plain services gig with a decorative demo. Judge it as that, not as this combination.",
  "revised_sequencing": "1) Day 0 gate: list the people who have paid, or could plausibly pay, for engineering work. If there are fewer than 15 names, drop the studio arm entirely and treat the supervisor only as a Dial top-of-funnel side-ship. 2) Days 1-3: npm publish, the hook, the invite bypass, the clean-machine install and the demo, timeboxed hard. This is Dial distribution work and should be justified on Dial's merits, not the studio's. 3) Days 3-5: post once and start the 40-message outreach at the same time, so inbound and outbound signals stay separable. 4) Days 5-30: deliver any pilot within 5 days on mainnet-safe terms. If the Dial network is still testnet-only, sell the setup as a reversible pilot and don't put Dial in the client's critical path. 5) Day 30: apply the kill rules above. Whatever happens, don't let studio delivery go past 8 hrs/week or start pulling Dial's roadmap toward client requests. The supervisor stays a leading indicator and is never a revenue line.",
  "summary": "Scored 3/10, does not survive as framed. The lead-magnet logic fails because the free OSS approval hooks and Anthropic Remote Control already cost $0, so @dial/supervisor has no pull. Its onboarding is also the heaviest in the category: a binary download, an invite-gated testnet, and a TestFlight app. Buyers of done-for-you agent builds don't find vendors through npm tools anyway. Pairing a zero-distribution OSS motion with a zero-trust services motion creates no channel. It does open a second front that takes time from Dial, the only project with momentum. The synergy is real only as a sales demo, not as a lead source. The package (packages/dial-supervisor, v0.1.0, testnet operator by default, no permission hook, not on npm) needs about 3 days of polish to work as even that. The case for doing that polish is Dial distribution, and it shouldn't be credited to the studio. Run one 30-day test with separate counters: paired strangers (20 or more), paid pilots (1 or more), and inbound conversations that trace back to the OSS post (1 or more). If attribution comes back zero, the thesis is dead whatever revenue comes in. Fall back to a narrow, capped setup-pilot offer, or park both arms."
 },
 {
  "ids": [
   6,
   15
  ],
  "thesis": "The spend firewall is a commodity as OSS (x402-spend-receipt, tryx402, x402-firewall and others), but integrating it is not. Sell 'x402/MPP spend-control integration' to the few teams that actually move x402 volume (agent API sellers and buyers on Base/Solana), with Leash as the portfolio piece. This tests whether the real x402 volume (~$1.6M-24M/30d) contains even 5 teams willing to pay for integration help.",
  "sequencing": "Don't launch Leash as a product. Extract it as a small OSS reference from PolicyService only to back sales. First list the top x402 sellers by volume (on-chain via Blockscout) and pitch integration or hardening engagements. Non-custodial, advisory enforcement only, to avoid money-path liability. Kill if fewer than 2 paid in 6 weeks.",
  "survives": false,
  "score": 3,
  "synergy_real": "Mostly a story, with one small real piece.\n\nWhat is real: the founder has actually written policy, approval and audit code (PolicyService.ts, ApprovalService.ts, audit.ts), and that is better evidence of competence than a bare consulting pitch. \"Do it for you, with a reference implementation\" is a sound services pattern.\n\nWhy it breaks down:\n\n1. Seller/buyer mismatch. The sequencing pitches the top x402 sellers, but a spend firewall protects buyers. Sellers need payment acceptance: middleware, settlement verification, replay and idempotency, Bazaar listing. That is a different offer, and the portfolio piece does not demonstrate it.\n\n2. The buyer side is concentrated and largely not human-run. Visa's Sheffield reportedly found the top 1% of buyers (about 4,000 wallets) drive about 90% of adjusted volume. TRM Labs (H1 2026) found volume concentrated in a single payment contract, and about half of settled volume drops out once self-payment and bulk flows are filtered. Bitquery says a few contracts carried 83% of agent payments on Arbitrum/Polygon in Aug 2026. Read the source dates as approximate: the figures look real but I could not verify them precisely. If so, the volume is bots, facilitators and self-dealing, not dozens of teams that would pay for help. Tens of teams at most is a reasonable guess, and that is UNVERIFIED.\n\n3. x402 integration work is already a commodity. There are Upwork product listings (\"API monetized with x402 + Bazaar listing\"), dedicated firms (Ledgers in the UAE, Blocsys, Ouro Agents), and Circle and Base publish seller tooling. The official SDK makes seller integration about 10 lines of code.\n\n4. The portfolio piece does not build trust. A new repo from an author whose 12 repos have 0 stars is not credibility, and Leash itself would be roughly the 8th OSS clone of x402-spend-receipt, tryx402 and the rest.\n\n5. Two separate shortfalls get added together. Leash has no distribution and the studio has no trust. Combining them does not create either; a portfolio piece only helps when the buyer already knows you.",
  "fatal_flaw": "The target market is too small and mostly isn't human, and the offer doesn't match the people being pitched.\n\n1. Real x402 volume (about $1.6M-24M per 30 days) is concentrated in a few thousand wallets, a handful of contracts and facilitators (Dexter, Coinbase, PayAI), and a lot of self-dealing. There probably aren't 5 independent teams that both move meaningful volume and feel spend-control pain. Facilitators and Coinbase build caps natively; Agentic Wallets have session and transaction caps.\n\n2. The plan pitches sellers a buyer-side product.\n\n3. \"Non-custodial, advisory enforcement only\" makes the deliverable a recommendation, not a control. A sophisticated buyer can't justify paying for that when MIT-licensed equivalents exist.\n\n4. Focus cost: this is a second Suwappu-side bet (crypto payments) running alongside Dial, which is the only project with momentum and has a time-boxed opening. HumanLayer's hosted service sunsets about Dec 4, which favors a @dial/supervisor play. Six weeks of x402 cold outreach uses up exactly that window.",
  "killer_test_30d": "Build no code and don't extract Leash. Cap the effort at 6 hrs/week.\n\nDays 1-5: use Blockscout plus x402scan/Dune to list the top 40 x402 counterparties by adjusted volume (exclude facilitator settlement wallets and self-payment loops). Then try to put a human team name on each. Pre-registered metric: if fewer than 15 map to an identifiable, independent team, kill on day 5. The market isn't there.\n\nDays 5-20: send 30 personal messages, each with two fixed-fee SKUs split by side:\n- Sellers: \"x402 hardening review: replay/idempotency, settlement verification, facilitator failover, pricing. $2-3K, 5 days.\"\n- Buyers: \"Agent budget gate + phone approval for over-limit spends, on top of your existing stack. $2-3K.\"\n\nEach message asks one question first: \"Have you had an x402 payment incident or overspend?\"\n\nDays 20-30: count deposits paid, not calls held.\n\nSurvive only with at least 2 paid deposits AND at least 1 from the buyer-side SKU. Without a buyer-side sale, Leash is irrelevant even if sellers pay.\n\nRun one control in parallel: the same 30-message effort aimed at displaced HumanLayer users with a $1.5-3K @dial/supervisor migration. Whichever arm converts gets the founder's next quarter. My prior is that the x402 arm gets 0-1 and the supervisor arm does better.",
  "revised_sequencing": "1. Week 0: publish @dial/supervisor to npm. It is the one asset with a dated demand window (HumanLayer sunsets about Dec 4) and it serves Dial, the active project.\n\n2. Weeks 1-2: run the HumanLayer migration pilot offer as the primary services motion, at 8 hrs/week.\n\n3. Weeks 1-2, in parallel and capped at 4-6 hrs/week: do only the desk-research half of the x402 test, mapping the top 40 counterparties to humans. Pitch only if at least 15 independent teams exist. If they do, lead with the seller hardening SKU, since that is where integration work actually happens, and offer phone approval via @dial/supervisor as the buyer-side add-on. Don't build a Leash repo.\n\n4. Extract PolicyService into OSS only after 2 paid x402 engagements specifically ask for it, and consider contributing it as an adapter to tryx402 or x402-spend-receipt rather than launching a new repo.\n\n5. Hard kill at day 30: if fewer than 2 deposits come in across both arms, stop services entirely and go back to Dial product.\n\nThroughout: nothing custodial, nothing that touches mpc-signer, and no swap engine.",
  "summary": "Score 3/10. As framed, the combination doesn't survive.\n\nThe thesis does ask the right question (\"are there even 5 paying teams in real x402 volume?\"), but the plan answers it badly:\n- It pitches a buyer-side spend firewall to sellers.\n- It uses an unstarred OSS clone as a credibility asset.\n- It enters a services niche that is already commoditized: Upwork x402 product listings, Ledgers, Blocsys, and Circle/Base seller tooling.\n\nThe evidence points to buyer volume concentrated in about 4,000 wallets and a few contracts, with about half of settled volume being self-payment or bulk flows (TRM Labs; Visa's Sheffield via The Defiant; Bitquery). Fewer than 5 human teams with both meaningful volume and spend-control pain is plausible, though UNVERIFIED.\n\nThe synergy is mostly a story. Leash adds no trust, the studio adds no distribution, and the combination takes attention away from Dial's time-boxed HumanLayer-sunset opportunity.\n\nWhat to salvage: run the x402 idea as a 30-day, code-free desk-research and outreach probe with a pre-registered kill rule, as a control arm next to the @dial/supervisor migration pilots, which should be the primary bet.\n\nSources (search snippets, 2026-11-21, not independently verified):\n- https://www.trmlabs.com/trm-tech-blog/whos-actually-paying-measuring-ai-agent-payments-onchain\n- https://thedefiant.io/converge/infrastructure/visa-s-sheffield-pegs-adjusted-x402-volume-at-19m\n- https://bitquery.io/investigations/x402-ai-agent-payments-audit\n- https://coinfomania.com/dexter-overtakes-coinbase-as-top-x402-transaction-facilitator/ (Jan 2026)\n- https://www.upwork.com/services/product/development-it-your-api-monetized-with-x402-and-listed-on-coinbase-bazaar-for-ai-agents-2074185220870897906\n- https://ledgers-ae-v2.pages.dev/services/x402-implementation\n- https://blocsys.com/?p=16881\n- https://developers.circle.com/agent-stack/agent-nanopayments/seller-integration-tools"
 },
 {
  "ids": [
   11,
   15
  ],
  "thesis": "Agent-security as a service rather than as a product: fixed-fee 'MCP server and agent hardening reviews' (prompt-injection surface, tool permissions, secret handling, approval gates). AEGIS and the policy engine serve as internal tooling. CISOs won't buy an unaudited firewall, but small agent startups shipping MCP servers need a cheap, fast review before launch, and the founder's audit/security repos (evmsec, audit frameworks; UNVERIFIED) give credibility.",
  "sequencing": "First: publish 3 public write-ups of reviews of popular open-source MCP servers, with responsible disclosure. This doubles as distribution that does not depend on PR merges. Then offer $2-5k fixed reviews to the teams that respond. Cash funds Dial. Never market AEGIS as a product.",
  "survives": false,
  "score": 4,
  "synergy_real": "Partly real, but thin. The combination fixes the worst problem of each idea on its own. Selling reviews instead of a firewall avoids the \"CISOs won't buy an unaudited firewall\" trap that kills #11. Narrowing the generic studio to a security-review niche turns #15's \"generic MCP build\" (Upwork prices it at $45-95/hr) into a defined product. Public review write-ups are also the one distribution channel the founder hasn't tried that doesn't depend on someone merging a PR. That part is not just a story.\n\nTwo parts of the pitch are a story, though.\n\nFirst, \"AEGIS and the policy engine as internal tooling\" adds almost nothing. I checked the local code. api-ts/src/aegis/ (signatures.ts, crypto.yaml, scan.ts) is a regex/YAML signature port that observes but doesn't block. PolicyService is built around swaps. A reviewer gets more from Claude Code plus a checklist and existing free scanners. Free and cheap scanners already exist: Apify's MCP Server Auditor at $0.15 per audit, MCPAudit and audit-mcp on PyPI.\n\nSecond, the founder's own repos hurt credibility rather than help it. The evmsec/audit-framework repos are UNVERIFIED, have 0 stars and no public findings. The founder's own MPC signer is unaudited. Prospects will check.\n\nThe price point is also not differentiated. Indie fixed-price MCP audits already sell at about $1,000 (a dev.to \"48-hour MCP audit\", jackjin1997's Agent/MCP Audit Sprint, 2026). Contra freelancers list at $75/hr. Appsecco and Zealynx sell MCP pentests with brand credibility. Proposing $2-5k with no track record puts the founder above the indie price but without the incumbents' trust.\n\nThe research-as-distribution space is also occupied by funded labs. OX Security disclosed an MCP SDK RCE in April 2026. Tenet published \"agentjacking\" via Sentry MCP on 2026-06-03. Invariant Labs published tool poisoning in 2025. There are arXiv measurement studies (2603.22489, 2603.21642) and Dynatrace research. A generic \"we reviewed popular MCP server X\" post gets lost unless it contains a real CVE-grade finding.\n\nThe only synergy that compounds is this: every review recommends human approval gates as the remediation, and @dial/supervisor (dial-sdk/packages/dial-supervisor exists locally, but is unpublished) is the reference implementation. That links the services cash to Dial, the project with momentum, instead of to Suwappu's dead assets.",
  "fatal_flaw": "Three problems compound: trust, timing and attention.\n\n(1) Trust. Security services are bought on reputation. The founder has none in this domain: no CVEs, no public audits, 0-star audit repos (UNVERIFIED), and an unaudited signer in his own stack. Meanwhile $1k fixed-price competitors and branded pentest shops already exist.\n\n(2) Timing. The distribution wedge contradicts itself. Responsible disclosure means a real vulnerability can't be published for 30-90 days, unless the maintainer patches quickly. So the write-ups that would create credibility can't appear inside a 30-day window. The ones that can appear quickly (best-practice critiques with no exploit) are what dozens of vendor blogs already publish.\n\n(3) Attention. Finding real bugs in popular MCP servers is deep, unpredictable work. Selling and delivering reviews needs responsiveness on the client's calendar. Both pull directly against Dial, whose ~20 PRs merged on 2026-11-20 are the founder's only real momentum.\n\nThe likely outcome is 3-4 weeks spent on write-ups that get little attention, $0 revenue, and a Dial launch that slips past the HumanLayer sunset window (around Dec 4), which is the one time-limited opportunity in the whole portfolio.",
  "killer_test_30d": "Run a 30-day test capped at 10 hours a week, with Dial's supervisor launch protected.\n\nDays 1-10: review 8-10 OSS MCP servers that each have more than 500 stars. Pick ones that touch money, credentials or a shell. Use Claude Code plus a written checklist covering tool permissions, secret handling, injection through tool output, and missing approval gates. Gate 1: at least one finding the maintainer accepts as a GHSA/CVE, or a confirmed and patched security bug, by day 15. If nothing is found, kill the idea. Without a real finding, the credibility thesis is false.\n\nDays 5-20, in parallel: publish one methodology post right away. It needs no disclosure wait. Pair it with a free, open checklist plus a 1-command scan. Publish the patched finding(s) as soon as the maintainer allows. Send 40 personal messages to teams that recently launched MCP servers (registries, Show HN, Product Hunt, the x402/agent-payments crowd), offering a fixed $1,500 review with 5-day turnaround. Every report's remediation section points to @dial/supervisor approval gates, so that package must be on npm first.\n\nKill if any of these is true at day 30:\n- fewer than 1 paid review at $1,000 or more;\n- fewer than 3 qualified calls;\n- fewer than 1 accepted security advisory;\n- Dial supervisor not yet published.\n\nSurvive if all of these hold: at least 1 paid review, at least 1 advisory, and at least 2 teams adopt the supervisor through a review.",
  "revised_sequencing": "Reorder so Dial comes first and the reviews feed Dial, not the other way round.\n\nWeek 1: publish @dial/supervisor to npm (Dial's first package) with a 60-second demo, aimed at HumanLayer users before the hosted sunset around Dec 4. This is required no matter what, because the reviews need a remediation to point to.\n\nWeeks 1-2: run the time-boxed bug hunt on 8-10 high-risk OSS MCP servers and file private disclosures. Publish only a methodology post and an open checklist. Never market AEGIS. Drop it as \"tooling\" entirely; Claude Code plus the checklist is the real tool.\n\nWeeks 2-4: publish write-ups only for findings that are already patched. Offer $1,000-1,500 fixed reviews. Don't price at $2-5k until there are 2 named references and at least 1 advisory. Every report ends with \"add a phone approval gate,\" linking to Dial.\n\nDay 30: apply the kill rule.\n\nIf it survives, raise the price to $3-5k and package it as \"pre-launch MCP hardening + supervisor integration.\" Keep the cap at 8-10 hours a week. Never review or touch anything that moves funds or uses mpc-signer, because of liability.\n\nIf it dies, keep the checklist and scan as free Dial lead-gen content and stop selling services.",
  "summary": "Score: 4/10. As written, this doesn't survive.\n\nCombining agent security with a services studio is better than either idea alone. Fixed-fee MCP hardening reviews avoid the unaudited-firewall trap that kills #11. Public write-ups are a distribution channel that doesn't depend on PR merges.\n\nBut the market already has $1k fixed-price indie MCP audits (dev.to, jackjin1997 Agent/MCP Audit Sprint, 2026), $75/hr Contra freelancers, branded pentest shops (Appsecco, Zealynx), $0.15-per-run automated auditors (Apify), and funded research labs taking the attention: OX Security (April 2026), Tenet \"agentjacking\" (2026-06-03), Invariant Labs, arXiv studies.\n\nThe founder has no security reputation. The audit repos are UNVERIFIED with 0 stars, and his own MPC signer is unaudited. AEGIS adds nothing: in the local code it is a regex/YAML signature port that observes but doesn't block. Responsible-disclosure windows also stop credibility-building write-ups from landing within 30 days. Services work competes directly for attention with Dial, the founder's only project with momentum, during the short HumanLayer-sunset window.\n\nThe idea is salvageable only if Dial comes first: publish @dial/supervisor, make every review recommend phone approval gates, price at $1-1.5k until there are references, cap at 10 hrs/week, and require a real accepted advisory by day 15.\n\nSources (accessed 2026-11-21; vendor claims UNVERIFIED):\n- https://dev.to/milo_antaeus_784320e2f2f9/mcp-server-in-production-a-48-hour-security-audit-you-can-actually-buy-547h\n- https://jackjin1997.github.io/agent-audit-sprint/mcp-security-audit-service.html\n- https://contra.com/s/Am6sAPBQ-aimcp-security-review-and-audit\n- https://appsecco.com/mcp-pentesting\n- https://apify.com/bmiller1009/mcp-server-auditor\n- https://labs.cloudsecurityalliance.org/research/csa-research-note-mcp-security-crisis-20260504/\n- https://labs.cloudsecurityalliance.org/wp-content/uploads/2026/06/CSA_research_note_agentjacking_mcp_sentry_20260615-csa-styled.pdf\n- https://arxiv.org/abs/2603.22489\n- https://arxiv.org/html/2603.21642\n\nLocal evidence: api-ts/src/aegis/signatures.ts, api-ts/src/aegis/data/crypto.yaml, dial-sdk/packages/dial-supervisor/package.json."
 },
 {
  "ids": [
   3,
   15
  ],
  "thesis": "Private local-model agents as a done-for-you deployment for privacy-bound small professional firms (law, medical, accounting) that cannot send data to cloud LLMs. This reuses dial-autonomous-agent (local OpenAI-compatible models) and Dial E2EE as the delivery channel. OpenClaw kills the consumer version, but a paid setup-and-maintain service for a regulated SMB is a different buyer, and OpenClaw being free actually lowers build cost. This tests whether the privacy edge has any willingness to pay once it is a service.",
  "sequencing": "First: use OpenClaw or dial-autonomous-agent as the base. Don't build a messenger moat. Sell 3 pilot installs at a fixed setup fee plus a monthly retainer to firms in one vertical. Offer Dial as the channel only where a client values E2EE without a vendor server. Retainers fund Dial. Kill if procurement or compliance questions block every pilot.",
  "survives": false,
  "score": 2.5,
  "synergy_real": "Mostly a story. The only real overlap is code. dial-autonomous-agent does exist (dial-sdk/crates/dial-autonomous-agent, about 3.7k LOC). Its model.rs speaks the OpenAI chat-completions format with tools, against Ollama, vLLM, LM Studio or llama.cpp. So the founder can stand up a local agent quickly. Every other leg of the synergy fails:\n\n(1) \"OpenClaw being free lowers build cost\" lowers it for every competitor too. The vertical done-for-you OpenClaw market already exists and is commoditized. An Upwork listing sells \"OpenClaw Setup & AI Automation for Law Firms\". nycclaw.com/for/law-firms targets law firms. There are many Fiverr \"setup openclaw for your business\" gigs, and productized offers start at $1,497 one-time plus a monthly fee (allhart.pages.dev; search 2026-11-21; vendor pages, UNVERIFIED). The founder enters as the newest, unreviewed seller in a race to the bottom.\n\n(2) Dial as the delivery channel is a negative for this buyer. A small law, medical or CPA firm will not adopt an invite-gated testnet (+008) messenger with no vendor to sign a BAA or answer a security questionnaire. Regulated firms also often need retention and discovery of client communications, and E2EE without a vendor server makes that harder. The thesis's own sequencing (\"offer Dial only where a client values it\") quietly admits Dial adds nothing. Expected Dial uptake across pilots is 0.\n\n(3) The premise that these firms \"cannot send data to cloud LLMs\" is weaker than claimed. ABA Formal Opinion 512 (July 2024) permits generative AI, cloud included, with reasonable confidentiality measures and informed consent. Clio, Microsoft Copilot and similar tools sell under enterprise data terms, and medical vendors sign BAAs. Local models are also weaker on citation accuracy (openwebui.com and scand.com blogs, UNVERIFIED). So the privacy edge is a preference for a minority of buyers, not a hard constraint.\n\n(4) \"Retainers fund Dial\" is backwards on time. Even $300-500/mo retainers from 3 firms barely covers hosting. Meanwhile the ongoing maintenance, the on-call duty and the liability surface take hours directly from Dial, the one project with momentum.",
  "fatal_flaw": "The combination adds nothing either parent lacks, and it keeps the worst trait of each. From #15 it inherits the trust and distribution problem: 0 references, 0 reviews, closed PRs, nothing published. That problem gets worse here because the buyer is regulated. Regulated buyers buy on references, E&O insurance, BAAs and security questionnaires, and a solo founder with a testnet messenger has none of them. From #3 it inherits OpenClaw's free dominance. Now OpenClaw dominates the service layer too, through an already crowded field of vertical OpenClaw installers, some pitching law firms specifically, at about $1.5K. The supposed edge is \"local model plus E2EE channel\". The first half is what every OpenClaw installer already sells. The buyer does not want the second half. On top of that, a misconfigured agent with access to privileged or PHI data creates real liability, which a solo founder with $0 cannot insure against. Every hour of on-site setup and ongoing maintenance comes straight out of Dial.",
  "killer_test_30d": "Run one 30-day demand test with an 8 hr/week cap and no new code beyond a demo, in one vertical: solo and small estate-planning or immigration law firms. Both handle sensitive client files and are underserved by Harvey-tier tools.\n\nBuild: a 2-minute recorded demo of a hardened local install. That means Ollama plus dial-autonomous-agent or OpenClaw, drafting from a client folder, with no outbound network and a visible audit log. Add a one-page offer: $2,500 fixed setup plus $300/mo maintenance, explicitly positioned against the $1.5K Fiverr installs as \"hardened, network-isolated, audited, documented for your malpractice carrier\".\n\nOutreach: 60 personalized messages to named firm owners (state bar directories, LinkedIn, local bar-association tech listservs), plus one Upwork or Contra productized listing as a control.\n\nMeasure: replies, discovery calls, the security, BAA and insurance questions asked, the number of prospects who ask for an E2EE messenger channel, and paid deposits.\n\nKill if by day 30 there are fewer than 4 discovery calls or 0 paid deposits, or if every call stalls on insurance or compliance paperwork. Separately, treat 0 requests for the Dial channel as proof that the Dial half of the combination has no synergy, even if a setup sale happens. In that case any revenue is commodity freelancing and should be dropped.",
  "revised_sequencing": "Do not run this as a primary bet, and do not run it in parallel with the #15 survivor. If the founder needs services revenue, the @dial/supervisor HumanLayer-migration pilot beats this one on every axis. Its buyer is technical, so there is no procurement or compliance wall. Its window is dated (hosted sunset around Dec 4). It sells something the founder owns. And every sale publishes and advances Dial instead of draining it.\n\nOrder:\n(1) Days 1-4: publish @dial/supervisor to npm and run the HumanLayer outreach.\n(2) Run the private-local-agent-for-firms idea only as the cheap 30-day demand test above, and only if (a) the founder has a warm contact inside a regulated firm or (b) the supervisor test produces 0 pilots and some services cash is still needed.\n(3) Never put Dial in front of a regulated client before Dial is on mainnet with a published security review. Keep the delivery channel to tools the firm already has, or to a local web UI.\n(4) Nothing in this line touches money movement, the mpc-signer or Suwappu.\n(5) Hard stop at day 30 without deposits. Do not let \"one more pilot\" become a services business that eats Dial.",
  "summary": "Verdict: kill, or at most run a single 30-day demand test, ranked below the HumanLayer-migration pilot. Score 2.5/10.\n\nThe pitch is that privacy-bound small firms will pay for done-for-you local-model agents, with Dial as an E2EE channel. Fresh evidence (searches on 2026-11-21) shows the \"OpenClaw lowers build cost\" logic cuts against the founder. Vertical OpenClaw setup services already exist in volume, including one Upwork listing aimed at law firms, nycclaw.com/for/law-firms, many Fiverr gigs, and productized offers from $1,497 (vendor pages, UNVERIFIED). Australian vendor pricing for private LLM deployments runs AUD 25-110K in year one (airgap-llm.pages.dev, UNVERIFIED), which shows real budgets exist at the mid-market end. Those buyers want references, insurance and BAAs, and the founder has none of them.\n\nThe Dial leg is a liability for regulated buyers: invite-gated testnet, no vendor to sign anything, and retention conflicts. The no-cloud premise is softer than claimed. ABA Opinion 512 (2024) permits cloud AI with safeguards, and medical vendors sign BAAs.\n\nThe code reuse is real. dial-sdk/crates/dial-autonomous-agent/src/model.rs already talks OpenAI-format with tools to Ollama, vLLM and llama.cpp. But that saves days in a business that is limited by trust, not by build effort. Splitting focus is serious: maintenance retainers are a recurring call on time, and they take it from Dial, the only project with momentum.\n\nSources: https://www.upwork.com/services/product/development-it-openclaw-setup-ai-automation-for-law-firms-2025852806686495156 ; https://nycclaw.com/for/law-firms ; https://allhart.pages.dev/openclaw-setup ; https://fiverr.com/sumitgautam0101/setup-openclaw-for-your-business ; https://airgap-llm.pages.dev/blog/private-llm-deployment-cost-australia/ ; https://openwebui.com/blog/what-would-it-take-for-a-law-firm-to-run-ai-in-house ; https://scand.com/company/blog/private-ai-for-law-firms/ ; https://www.clio.com/resources/ai-for-lawyers/legal-ai-tool-pricing/ (all accessed 2026-11-21, vendor-authored, UNVERIFIED)."
 },
 {
  "ids": [
   2
  ],
  "thesis": "The cheapest pure falsification test of Dial's distribution. Publish the supervisor MCP on npm, remove friction and watch for organic pull over 14 days with zero spend. It scores 3.13 standalone (highest non-studio) because solo=4. The adversarial question is whether a phone-native, E2EE, no-vendor-server approval channel beats ntfy and first-party Remote Control for anyone. If it doesn't, the Dial agent story should be shelved and Dial focused on messaging.",
  "sequencing": "Days 0-3: npm publish, a one-command install and an auto-invite flow. Days 3-14: one Show HN / r/ClaudeAI post and one demo video. Success gate: 50 installs and 10 weekly-active supervisors. Below the gate, park it permanently. No monetization attempt in this window.",
  "survives": false,
  "score": 2.5,
  "synergy_real": "Mostly a story. #2 is a single member, so the only \"synergy\" is Dial messaging plus coding-agent demand, and the agent side contributes nothing Dial lacks. The user chooses the phone channel by friction, not by E2EE. ntfy, Telegram and the first-party channel all win on friction. The commodity set is bigger than the dossier says. A 2026-11-21 search turned up claude-remote-approver, claude-push, claude-ntfy-hook, CCGram (Telegram), Pushary (hosted), claude-board (PyPI), Tapproval (Product Hunt), Greenlight, and Feishu/Lark bridges. All use the same PermissionRequest hook that returns allow, deny or ask. The traffic runs one way at best. A coding-agent user who installs Dial only to receive approvals is not a messaging-network user. Nothing in the plan turns supervisors into people who text other humans on Dial, so even a \"win\" doesn't validate Dial's network.\n\nThere is a bigger problem the dossiers missed, which I checked locally and via the GitHub REST API. The thesis says \"publish on npm, remove friction.\" It underestimates the work badly:\n1. packages/dial-supervisor/src/binary.ts sets RELEASE_REPOSITORY to https://github.com/Dial-WTF/Dial-SDK and pins DIAL_AGENT_RELEASE = 'dial-agent-v0.1.1'.\n2. The GitHub API reports Dial-SDK as private: true, stars 0.\n3. The tag dial-agent-v0.1.1 returns 404. The releases that exist are 0.4.1-rc.*, dial-alpha-candidate-*, operator-testnet-2026-11-20.1.\n\nSo `npx dial-supervisor init` would fail for every outsider at the binary download, even after an npm publish. The README admits the package isn't published (\"@dial scope is unclaimed\"). Both @dial/supervisor and dial-supervisor return 404 on npm today. Real onboarding is six steps: an npm package, a dial-agent binary from a public host, wallet enrollment, testnet number registration for strangers, an invite-gated TestFlight or unlisted Android app on the phone, then pairing. Each competitor has two steps: a script and the ntfy app.",
  "fatal_flaw": "The test can't falsify what the thesis claims it falsifies, and its \"zero-friction\" premise is false. With a private repo, a missing binary release and an invite-gated testnet app, the funnel is dead on arrival. Low installs would measure Dial's onboarding friction, not demand for an E2EE approval channel. The conclusion \"shelve the Dial agent story\" would be confounded either way. Even a fixed funnel loses on friction to a commodity category priced at $0, including first-party Remote Control push. The pool it targets is HumanLayer refugees, and they are teams going to Factory or self-hosting the Apache-2.0 code, not solo users looking for an agent-texts-you MCP (pool size UNVERIFIED). The founder has about $0, three orgs and a track record of closed PRs and 0-star repos. The real cost isn't the claimed 2-3 days. It's a hidden infra project: a public binary distribution, an invite-gate bypass, open testnet number registration for strangers, and a publicly installable phone app. All of that pulls attention from Dial's core messaging launch.",
  "killer_test_30d": "Before writing code, run a demand probe at zero build cost. Days 1-2: record a 60-second demo using the existing local checkout (node packages/dial-supervisor/dist/cli.js). Post it once in each of three places: Show HN, r/ClaudeAI, and HumanLayer-sunset threads. Link a one-field signup: \"get a Dial supervisor invite.\"\n\nGate A, day 7: at least 40 signups from real accounts, crawlers excluded. If fewer, kill now. Zero infra built.\n\nOnly if Gate A passes, days 8-14: publish under the unscoped `dial-supervisor` name. Host dial-agent binaries on a public repo's releases and repoint RELEASE_REPOSITORY. Auto-provision testnet numbers and bypass the invite gate for supervisor pairing. Ship a public Android APK. Then add the PermissionRequest hook, with fallback to ask.\n\nGate B, day 30: at least 15 paired supervisors who answered at least 3 asks during days 15-30, and at least 3 of them who sent a human-to-human Dial message. The second number is the only one that says anything about Dial's network. Ignore npm download counts, because mirrors and crawlers inflate them. If Gate B misses, shelve the supervisor wedge permanently. Don't extend the conclusion to \"Dial agents\" in general, because this probe only covered one wedge.",
  "revised_sequencing": "0) Today: don't touch Suwappu, and don't build anything for this wedge. 1) Days 1-2: demo video and a signup-link post, about 4 hours of founder time. 2) Day 7, Gate A at 40 real signups: miss and you're done. 3) Days 8-14, only on a pass: public binary hosting, unscoped npm publish, invite bypass, public APK, PermissionRequest hook, verified on a clean machine. 4) Days 15-30: watch only. 5) Day 30, Gate B: 15 retained supervisors and 3 who send human messages. Below that, park permanently. Throughout, spend at most 3 founder-days in total, and Dial messaging core work stays the priority.",
  "summary": "Combination #2 doesn't survive as framed. It scores 2.5 out of 10. It isn't the cheap, pure falsification test the thesis claims. Local checks show @dial/supervisor is real but can't be installed by outsiders. Its init step downloads dial-agent-v0.1.1 from Dial-WTF/Dial-SDK, which is a private repo, and that tag doesn't exist (GitHub REST 404). The npm names are free but unpublished. The supervisor also needs an invite-gated testnet app. The category is a crowded $0 commodity: claude-remote-approver, claude-push, claude-ntfy-hook, CCGram, Pushary, claude-board, Tapproval, Greenlight, plus first-party Remote Control push. E2EE isn't a buying criterion for these users. A failed test would therefore be confounded by friction and couldn't justify shelving the whole Dial agent story. A success wouldn't validate the Dial messaging network either, unless supervisors start messaging other humans. The salvage is a zero-build demand probe: a video plus a signup link, gated at 40 real signups by day 7. Build the funnel only after that gate passes. Judge success at day 30 on retained supervisors and human-to-human messages, not on installs. Key files: dial-sdk/packages/dial-supervisor/src/binary.ts (RELEASE_REPOSITORY, DIAL_AGENT_RELEASE) and dial-sdk/packages/dial-supervisor/README.md (\"Not published yet\"). Sources (searched 2026-11-21): github.com/yuuichieguchi/claude-remote-approver, github.com/coa00/claude-push, adrian-gomez.github.io/claude-ntfy-hook, github.com/jsayubi/ccgram, pypi.org/project/claude-board, producthunt.com/products/tapproval, pushary.com/docs/agents/guides/claude-code.md, getgreenlight.github.io/guide-claude-code.html, code.claude.com/docs/en/hooks-guide.md. The HumanLayer/Factory pool size is UNVERIFIED."
 },
 {
  "ids": [
   1,
   2
  ],
  "thesis": "Dial as the human-in-the-loop channel for agents. The coding-agent supervisor is the wedge, then it generalizes to approval of any agent action (spend, deploy, outbound message), with Suwappu's policy engine and receipts as the backend. This tests the founder's preferred 'merge the orgs' narrative directly: is there a sequence in which the HumanLayer vacuum (mostly empty, per red-team) plus the agent-approval need leads to Dial adoption, or does the PSTN-less +0 number and invite gate kill it at step one?",
  "sequencing": "Step 1 is idea #2 exactly, with its gate. Only if it passes, step 2: add a generic 'approve' MCP tool that routes policy-engine escalations from api-ts ApprovalService to the Dial phone, with sealed receipts. Spend approvals come last and only with a design partner. No funding source, so it must run behind the studio cash engine or stay strictly time-boxed.",
  "survives": false,
  "score": 2.5,
  "synergy_real": "This is mostly a story. The two halves share a slogan (\"human in the loop\") but not users, code or a funnel.\n\n1. Users don't overlap. The step-1 user is a solo developer approving Claude Code tool calls. These people rarely need spend approval, as both dossiers note. The step-3 buyer is an ops or finance owner of an autonomous agent that moves money. That market already has about 28 YC-funded spend-control companies, and Suwappu has 0 completed swaps to show it. Nothing about one user makes them become the other.\n\n2. Code doesn't overlap. I checked this locally. api-ts/src/services/ApprovalService.ts (633 lines) is not a generic approval queue. It is built around EconomicTerms: hashCoreTerms, a 15-minute APPROVAL_TTL_MS, WebAuthn step-up challenges, re-quote-and-match checks at resubmit, and swap- and org-owner resolution. It has no notification-channel abstraction. A \"generic approve\" tool means rewriting it, not wiring it up.\n\n3. Install chains stack instead of sharing. @dial/supervisor is unpublished. Its package.json description says it works \"over the dial-agent binary\". src/binary.ts downloads dial-agent-v0.1.1 from GitHub releases for darwin or linux only, so Windows users must build crates/dial-agent themselves. The human must also have the invite-gated TestFlight or testnet +008 app. Adding Suwappu's backend adds a third trust surface: hosted api-ts, seal receipts, policy config. That makes the funnel longer, not wider.\n\n4. The only real shared asset is a cryptographic receipt for a human decision, from seal.ts. Coding-agent users don't buy on that. Pushary, Velatir, ntfy hooks, claude-remote-approver and Anthropic Remote Control push (UNVERIFIED in detail) cover the job for free.\n\nThe \"merge the orgs\" narrative is a way to justify both orgs. It is not a product sequence.",
  "fatal_flaw": "The sequence can't get past step 1, and the founder would be tempted to start steps 2 and 3 before step 1 has passed. Step 1 asks a stranger to do four things before the agent can ask them anything: npx a package, have it download a native dial-agent binary (no Windows support), install an invite-gated TestFlight app (or sideload Android), and claim a testnet +008 number. Every competitor needs zero new apps.\n\nEven if step 1 passes, its users don't need step 2 or 3. Coding agents don't spend money. So \"generalize to spend and deploy approval\" means starting a second go-to-market in a crowded, funded category, through a Suwappu backend whose approval model is swap-specific.\n\nFor a $0 solo founder split across three orgs, this combination is worse than either half alone. It gives a reason to keep spending attention on Suwappu, which has 0 users, under cover of Dial distribution. Focus suffers whichever way it goes. If step 1 fails, both are dead. If step 1 succeeds, the right move is to double down on Dial and drop Suwappu, which defeats the merge thesis.",
  "killer_test_30d": "One test, Dial only, no Suwappu code touched.\n\nDays 1-3:\n- Publish dial-supervisor under an unscoped npm name. The founder confirms the name first, because publishing can't be undone.\n- Add a thin Claude Code PermissionRequest hook: ask, wait, then allow or deny.\n- Bypass the invite gate for supervisor pairing. This can be an auto-issued testnet number via a deep link from the npx flow.\n- Record a 60-second demo.\n\nDay 4: Watch five strangers onboard, using cold Discord or Reddit recruits, not friends. Time each one from `npx` to an approval tapped on the phone. If the median is over 5 minutes, or anyone needs the founder to grant TestFlight access by hand, kill it on day 4.\n\nDays 5-30: Post once each to Show HN, r/ClaudeAI and r/ClaudeCode. Measure only behavior Dial's relay can see:\n- (a) at least 20 paired supervisors who are not the founder\n- (b) at least 5 of them still sending one or more approvals per week in week 4\n- (c) at least 3 of the 5 say unprompted that they would want the same card for a non-coding agent action (deploy, outbound message, spend)\n\nPass all three, and step 2 is allowed as a generic, non-money approve card. Spend approval still needs a named design partner who signs up before any code. Fail any of them, and freeze dial-supervisor and stop telling the merge narrative. Cost is about 3 founder-days plus passive monitoring.",
  "revised_sequencing": "0. Before anything: drop \"Suwappu as backend\" from the plan. The studio cash engine is the funding source. Cap this whole line at 3 build days and 30 calendar days.\n\n1. Days 1-3: run the Dial-only funnel test above, with the invite-gate bypass. No +0 or PSTN claims, no wallet, no Suwappu.\n\n2. Only if the day-30 gates pass: add a generic `request_approval` card in dial-supervisor itself, with options approve, deny or always. Sign the decision with the user's Dial (BIP-39) key for a local receipt. This reuses Dial's identity instead of Suwappu's seal. Keep it free and open source.\n\n3. Only if 3 or more retained users ask for non-coding approvals: write a simple webhook adapter so any backend can route escalations to Dial. If someone wants it, Suwappu's api-ts can be one consumer of that adapter, after the refactor that separates ApprovalService's swap-specific economic-terms logic from a generic pending, decided, expired queue. That is about 1-2 weeks of work and is only justified by demand.\n\n4. Spend approvals: only with a named, committed design partner who already moves real money through an agent. Never on speculation, and never using Suwappu's 0-user swap path as the demo.\n\n5. On any failed gate: freeze, write a one-paragraph post-mortem in DECISIONS.md, and return attention to the cash engine.",
  "summary": "Verdict: does not survive as a combination. Score 2.5/10.\n\nThe pairing is narrative glue. The users don't overlap: solo coding-agent devs are not ops or finance owners of money-moving agents. The code doesn't compose either. I checked locally that Suwappu's ApprovalService is swap-specific (EconomicTerms hashing, WebAuthn step-up, re-quote matching), not a generic queue. The onboarding chain stacks four steps: unpublished npm package, a native dial-agent binary download for darwin/linux only (src/binary.ts, dial-agent-v0.1.1), an invite-gated TestFlight app, and a testnet +008 number. That fails against free incumbents that need no new app: ntfy hooks, claude-remote-approver, Pushary, and Anthropic Remote Control push (UNVERIFIED in detail). The HumanLayer vacuum is mostly empty: the approval SDK was deprecated before the Factory deal, per earlier red-team sources.\n\nThe merge thesis also defeats itself. If step 1 works, the winner is Dial, and coupling it to Suwappu only adds a trust and maintenance burden.\n\nSalvage: a 3-build-day, Dial-only dial-supervisor publish with a PermissionRequest hook and an invite-gate bypass. Gates:\n- day 4: median stranger onboarding under 5 minutes\n- day 30: at least 20 non-founder pairings, at least 5 retained in week 4, and at least 3 asking unprompted for non-coding approvals\n\nGeneralization happens only after those pass. Spend approval happens only with a committed design partner. It is funded by the studio cash engine, not by attention taken from it.\n\nFiles checked: dial-sdk/packages/dial-supervisor/package.json, dial-sdk/packages/dial-supervisor/src/binary.ts, api-ts/src/services/ApprovalService.ts."
 },
 {
  "ids": [
   10,
   11,
   15
  ],
  "thesis": "Outside the top 40, because the formula scores #10 as bounty farming, and that undervalues it. Reframed as fixed-fee AI-assisted security reviews for small protocols and agent builders (smart contracts plus the agent/MCP layer), the security assets (evmsec, smart-contract-audit-framework and smart-contract-auditor, all UNVERIFIED; plus AEGIS) become a services stack. Payment is upfront, not winner-take-most with a 30-90 day lag. Small protocols priced out of top firms buy $3-10k pre-launch reviews. This tests whether the founder's deepest technical assets can earn cash faster than generic agent builds.",
  "sequencing": "First: one free public review or disclosure to establish credibility, avoiding contest platforms that penalize AI volume. Then offer fixed-fee 'pre-launch contract + agent review' packages to hackathon winners and early protocols in ecosystems the founder already knows (NEAR, Base, Solana). Cash funds Dial. Kill if no 2 paid reviews in 8 weeks.",
  "survives": false,
  "score": 3,
  "synergy_real": "The synergy is partly real, but much smaller than the thesis claims. The real part is one shared skill: LLM-assisted adversarial review of money paths. There is local evidence of it. contracts/AUDIT_COREROUTER_2026-08-31.md is a self-review that found 2 HIGH fund-loss paths in SuwappuCoreRouter (forceRelease/claim missing an in-flight guard) and overturned an earlier ship-to-testnet clearance. The repo also has a Medusa harness and SECURITY.md. That is real work product a client would recognise. #10 (finding bugs), #11 (the agent/MCP layer) and #15 (fixed-fee delivery) do describe one offer: review a contract plus its agent tooling.\n\nThe rest is a story, for three reasons.\n(1) The assets named in the thesis do not exist as an audit stack. evmsec, smart-contract-audit-framework and smart-contract-auditor are not cloned (UNVERIFIED). AEGIS is about 700 lines of regex signatures ported from aegis-shield, fail-open and with no benchmarks. It is not a tool for reviewing someone else's MCP server. PolicyService is swap-shaped.\n(2) The \"agent layer review\" half has no proven buyer. Small protocols buy contract audits. Nothing shows hackathon teams paying extra for an MCP/agent review.\n(3) Price is collapsing from both sides. Published 2026 pricing for a small protocol runs about $15-40K for a focused audit and about $1.5-15K for a simple token (Zealynx, Sherlock 2026 pricing posts, vendor-biased). Zealynx sells 3 days of senior time for $1,500. Austin Griffith launched a $1 x402 AI audit (cryptobriefing, 2026). Sherlock's AI Audit Engine (2026-08-18) and V12 commoditise the \"AI-assisted\" part. The founder's $3-10k band therefore sits between free AI scanners and reputable humans, with no brand to justify it.\n\nThe \"cash funds Dial\" link is the weakest claim. Security services have no product overlap with Dial, apart from a possible @dial/supervisor approval demo.",
  "fatal_flaw": "The founder would be selling trust they have no record of, in the one market where trust is the entire product. An audit is only worth the auditor's name. This founder has no public findings, no contest record, no clients, and repos with 0 stars. The only audit is of their own unlaunched contract, and it did not catch the HIGHs on the first pass. The real cost of a missed bug lands on the client, so serious protocols will not buy a $5k review from an unknown solo founder. Teams that would buy one can get the AI portion for $1 or for free, or a 3-day senior review from a branded shop for $1,500.\n\nIt also opens a fourth front. A credible audit needs deep, uninterrupted attention: days of reading one codebase. That is the founder's scarcest input, and it is taken from Dial, the one project with momentum (about 20 PRs merged on 2026-11-20, @dial/supervisor v0.1.0 ready but unpublished). The 8-week kill window lets the distraction run twice as long as necessary.",
  "killer_test_30d": "One 30-day test, capped at 6 hrs/week. Kill it if no client has paid a deposit by day 30.\n\nWeek 1: Publish the redacted SuwappuCoreRouter F1/F2 write-up as a public case study. Include the bug, the PoC and the fix, and describe the method honestly (\"LLM-assisted plus Medusa\"). Doing this does not depend on the services thesis.\n\nWeek 2: Pick one recent ETHGlobal, NEAR or Base hackathon winner with a mainnet plan. Do a free 1-day review of its contracts and MCP/agent tooling, disclose privately, and publish only with the team's consent.\n\nWeeks 2-4: Post one productized offer: \"pre-launch contract + agent-tooling review, $2,500 fixed, 5 days, deposit upfront.\" Send it as 30 personal messages to teams that are about to launch. Do not use contest platforms.\n\nPass: at least 1 deposit received, plus at least 3 qualified replies asking about scope. Kill: 0 deposits, or the free review finds nothing of substance. A free review that finds nothing proves the method has no edge. Track hours. If they go over 24 in the month, kill regardless of the result.",
  "revised_sequencing": "Do not run this combination as a business line. Change the order as follows.\n\n1. Days 1-3: publish @dial/supervisor to npm. It is Dial's first package and already exists at dial-sdk/packages/dial-supervisor. Ship it with the phone-approval demo for HumanLayer users ahead of the hosted sunset around 2026-12-04. This is the only time-limited opening across the three dossiers.\n\n2. Days 3-5: publish the CoreRouter self-audit case study (a security-credibility asset that costs almost nothing). Add a small optional MCP tool-call approval hook with hash-chained receipts to supervisor. This is the defensible slice of #11, inside Dial and not a separate company.\n\n3. Days 5-30: run the 30-day services test above only if the case study draws inbound interest. Otherwise stop at the case study.\n\n4. Never: bounty farming, an enterprise \"Wiz for agents\", or a generic agent studio. Never touch client systems that move funds, and never sell anything based on the unaudited mpc-signer.\n\nCut the original 8-week, 2-review kill rule to 30 days and 1 deposit.",
  "summary": "Score 3/10; the combination does not survive as a strategy. Recasting bounty hunting as fixed-fee reviews fixes the problems of payment lag and winner-take-most payouts. It does not fix the binding constraint, which is trust plus founder attention.\n\nOne real asset is local and verified: an LLM-assisted review of the founder's own contract that found 2 HIGH fund-loss bugs (contracts/AUDIT_COREROUTER_2026-08-31.md). The thesis's other security assets do not hold up. evmsec and the auditor repos are UNVERIFIED, and AEGIS is regex signatures with no benchmarks. \"Agent-layer review\" has no proven buyer. Pricing is squeezed from both sides: a $1 x402 AI audit and Sherlock's AI Audit Engine on one, branded 3-day senior reviews at $1,500 on the other. Published small-protocol audits run $15-40K, and those firms have brands. As a fourth front it pulls deep attention away from Dial for cash that is speculative and small.\n\nSalvage:\n- Publish the self-audit as a credibility case study.\n- Fold the phone-approval and receipts slice into @dial/supervisor for HumanLayer users before about 2026-12-04.\n- Run at most one 30-day, $2,500 fixed-fee test with a hard 1-deposit kill.\n\nSources: sherlock.xyz/post/smart-contract-audit-pricing-a-market-reference-for-2026; zealynx.io/blogs/audit-pricing-2026; cryptobriefing.com/one-dollar-ai-security-audit-x402-usdc; quillaudits.com/blog/smart-contract/smart-contract-audit-cost-2026; decrypt.co/375876 (Sherlock AI Audit Engine, 2026-08-18, from the dossier); theblock.co/post/401179 (Code4rena wind-down, 2026-05-13, from the dossier)."
 },
 {
  "ids": [
   4,
   15
  ],
  "thesis": "Reframe #4 from a consumer product (killed by Meta Muse and Google) into a studio vertical: build voice and phone agents for SMBs on rented Retell/Vapi/Twilio. Lack of moat doesn't matter for a services margin, and SMB demand for AI receptionists is proven and paid. This tests whether choosing the hottest buyer-funded vertical beats the founder's own crypto assets as a cash engine, even with zero Dial or Suwappu leverage.",
  "sequencing": "First: one template voice agent on Vapi or Retell for one local vertical (clinics, trades), sold at setup plus a monthly fee via direct outreach. No Dial or PSTN build. Cash only funds Dial. Kill if close rates against funded competitors and freelancers are under 1 in 30 contacts after 4 weeks.",
  "survives": false,
  "score": 3,
  "synergy_real": "Mostly a story, though more honest than most. The two members don't strengthen each other. Combining them throws out the one part of each dossier that survived. #4's only surviving idea was a manual hold-and-dispute concierge. #15's only surviving idea was @dial/supervisor pilots for displaced HumanLayer users. What's left is \"run an AI-receptionist agency on Vapi or Retell\", which is a third, separate business. The thesis says outright that it gives up Dial and Suwappu leverage, so the only claimed synergy is that demand is proven and buyer-funded. That part is true. SMBs pay roughly $25-300/mo for AI receptionists, and raw Vapi/Retell cost is about $0.05-0.25/min, so services margin exists. But anyone can see that margin, and the channel is industrialized. Retell, HighLevel ($297-497/mo agency plans), Vendasta, Trillet, Synthflow, Stammer ($197/mo) and VoiceAIWrapper all sell white-label kits made to turn thousands of agencies into resellers. Fiverr gigs offer \"I will build an AI receptionist with Vapi/Retell\". The founder would be one more reseller with no reviews, no local SMB network, no SMB sales record and no vertical integration (CRM, calendar, transfer rules), which the sources name as the only differentiator. The one possible Dial hook is escalating calls to the owner's phone through the Dial app. That doesn't hold up: trades owners won't install an E2EE testnet app, and Dial has no PSTN, SIP or voice anyway (ROADMAP.md:100). Sources are vendor-heavy, and saturation is UNVERIFIED by independent data. Sources (fetched 2026-11-21): retellai.com/blog/white-label-voice-ai-platforms-agencies; vendasta.com/blog/white-label-ai-receptionist; trillet.ai/blogs/best-white-label-ai-receptionist-for-agencies-2026; dev.to/jahanzaibai/how-much-does-a-virtual-receptionist-cost-in-2026-real-pricing-after-40-deployments-3mnl; fiverr.com (Vapi/Retell receptionist gig); sotrosinfotech.com/blog/ai-voice-receptionist-pricing-benchmarks-2026.",
  "fatal_flaw": "It trades the founder's only momentum (Dial, about 20 PRs merged 2026-11-20) for a commodity reseller business with a heavy operational tail, and the founder has none of the trust or distribution that services need. Phone agents for SMBs are live production systems. Missed calls, bad bookings, a 2am outage or a wrong price quote all lose the client's revenue right away, so the founder is on call for every customer. That is the worst possible fit for someone split across three orgs. The sequencing names clinics first. Clinics bring HIPAA BAAs (whether Vapi/Retell sign BAAs at every tier is UNVERIFIED), two-party recording-consent states and the FCC's 2024 AI-voice ruling. Funded competitors and HighLevel agencies hold this market with existing SMB rosters. With 0 users, closed PRs and 0 stars, the founder starts at zero references and is selling to the least technical, most churn-prone buyer there is. \"Cash only funds Dial\" also hides a trap. Every won client adds recurring support load, so success makes the Dial problem worse instead of funding it out of the way. Even the upside is small: 10 clients at $200-300/mo is $2-3K MRR, with churn and support cost the founder carries personally.",
  "killer_test_30d": "Run one vertical, trades (HVAC, plumbing, electrical: \"never miss an after-hours call\"), never clinics. Build one template on Retell or HighLevel white-label in 2 days or less, with 0 custom code. Days 3-25: make 100 personal contacts, by phone, in person or by DM, to owners in one metro. A real ask, not a spray email. Offer a 7-day live trial on their overflow line that converts to $300-500 setup plus $200/mo. Track hours on a timesheet, capped at 8 hrs/week in total. Pass: by day 30, at least 3 businesses have paid both setup and the first month, and the founder has spent no more than 32 hours including support. Kill at 2 or fewer paid, more than 32 hours, or any trial client churning over a call-handling failure. The original rule of under 1 in 30 contacts after 4 weeks is too loose, because a \"close\" can be a free trial. Require cash collected. Run the test only if the founder already has at least 10 warm SMB-owner contacts. Without them, skip the test: the cold base rate against HighLevel agencies makes it predictable.",
  "revised_sequencing": "Rank it below the @dial/supervisor HumanLayer-migration pilot, which has a hard deadline: HumanLayer's hosted service sunsets around Dec 4. That pilot reuses an asset the founder owns, and its buyers are developers the founder can actually reach. Order: (1) Days 1-2: count warm SMB-owner contacts and warm engineering-buyer contacts. (2) Days 2-14: publish @dial/supervisor to npm and sell 40 personal pitches for the $1.5-3K HumanLayer replacement and setup. (3) Only if that gets no traction and the warm SMB list has at least 10 names, run the 30-day trades receptionist test above, white-label only, 8 hrs/week cap, no clinics, no code, no Dial integration, cash required. (4) If the receptionist test passes, cap it at 10 clients and charge enough to hire a part-time VA for support before taking client 11. If it fails, never revisit it. Never run both tests in the same weeks: the founder's attention can't cover two sales motions plus Dial.",
  "summary": "Red-team verdict: does not survive (3/10). The thesis is honest that this is a no-leverage cash play, and SMB AI-receptionist demand is real and paid. But the synergy is a story. Combining the two members drops each one's only surviving angle, and the result is a generic Vapi/Retell reseller agency. White-label kits (Retell, HighLevel, Vendasta, Trillet, Stammer) and Fiverr gigs already mass-produce that business. A founder with $0, 0 users, 0 references, no SMB network and attention split three ways would start behind thousands of HighLevel agencies. The win state is $2-3K MRR that carries a permanent on-call support burden on live business phone lines, which drains Dial, the one project with momentum. Starting with clinics adds HIPAA and consent-law risk. The only fair test is 30 days in trades, 100 personal contacts, an 8 hr/week cap, and a pass at 3 or more paid setups plus first month. Run it only if 10 or more warm SMB contacts exist, and only after the time-boxed @dial/supervisor HumanLayer-migration pilot, which reuses an owned asset and has a deadline. Saturation and pricing evidence is vendor-sourced (UNVERIFIED independently)."
 },
 {
  "ids": [
   2,
   16
  ],
  "thesis": "Tests the claim that Dial can find distribution through a channel other than awesome-lists and framework PRs: the Solana dApp Store, plus F-Droid (already in distribution/), paired with the supervisor as a crypto-native dev hook. It is a cheap, mostly already-built shipping action. The adversarial question is whether ~10k farming-heavy Seeker DAU and no MWA/Seed Vault integration make this worthless, and whether adding MWA is a small enough step to change that.",
  "sequencing": "First: submit the existing Android build to the Solana dApp Store and F-Droid with invites auto-granted, to remove the bad-review trap. In parallel, publish the supervisor on npm. Measure installs and retained conversations over 30 days. Only if retention is above zero, scope MWA sign-in as a follow-up. No spend, and time capped at 3 days of work.",
  "survives": false,
  "score": 2,
  "synergy_real": "The synergy is a story. The two members are separate side-ships that happen to share an Android APK, and their audiences don't overlap. The supervisor's user is a desktop developer running Claude Code, Codex or Cursor who wants approval pings on the phone they already carry, mostly iPhone or Pixel. Seeker's engaged base is about 10k daily active users, mostly farmers of SKR rewards (SolanaFloor/Dune 2026, UNVERIFIED). The share of Seeker owners who also run coding agents is too small to measure. The crypto-native framing doesn't connect them either. The supervisor uses no wallet, no MWA and no on-chain action. I checked dial-android: it has no MWA or Seed Vault code, so Seeker gives the supervisor nothing a Play Store or TestFlight link wouldn't.\n\nLocal repo findings weaken the thesis further:\n(1) The F-Droid half can't be done in 3 days. distribution/fdroid/README.md says publication is \"currently blocked\": Dial-WTF/Dial-SDK is private, F-Droid requires a public FOSS repo, there is no public signed release tag, the APK hasn't been shown to be reproducible, and the testnet registrar key rotates. Fixing that means open-sourcing the repo, which is a strategic decision, not a shipping task.\n(2) The Solana dApp Store half isn't free. distribution/solana-mobile/README.md requires publisher KYC/KYB, a funded publisher wallet and an App NFT mint, and the store has no testnet lane, so the release is public and reviewed. That breaks the \"no spend\" rule, though only slightly.\n(3) The listing (distribution/android/store-listing.json) says \"invite-only preview\", \"+008 is not a public telephone number\", and that calls, payments and groups are \"in development\". It has 1 screenshot and needs 4.\n(4) \"Invites auto-granted\" isn't a toggle. It's a change to the registrar/enrollment policy on a bounded testnet, and nothing in the stubs implements it.\n(5) @dial/supervisor exists at packages/dial-supervisor, version 0.1.0, with a bin. It isn't on npm and has no PermissionRequest hook.\nThe only real link is that both give Dial a free outbound channel. That justifies doing each one in about a day. It doesn't justify a combined thesis or a retention-gated MWA follow-up.",
  "fatal_flaw": "The pairing assumes channel plus hook adds up to distribution. Neither half can deliver it, and each blocks the other's funnel. The supervisor only works if a developer installs the Dial phone app and gets past the invite gate. The Seeker listing only avoids bad reviews if that same gate is lifted. So the critical path for both is the same unbuilt piece: self-serve or auto-granted enrollment on the +008 testnet. Neither member's plan budgets for it, and the 3-day cap doesn't cover it alongside KYC/KYB, screenshot work, npm publishing, a hook and posting. F-Droid is impossible without open-sourcing the repo. The supervisor's differentiator, phone approval for coding agents, is already a commodity: claude-remote-approver, claude-ntfy-hook, Pushary, claude-board, and Anthropic Remote Control push notifications (code.claude.com docs, checked 2026-11-21), all with zero install friction. The Seeker audience can't use the supervisor and has no reason to use an invite-only messenger with no one to message. The likely outcome is that 3 days stretch to 7-10. The founder ends with a public store page, a few dozen installs, and an MWA project justified by retention of 1 or 2 testers. That's the same zero-traction pattern as the 8 closed PRs and 12 zero-star repos, now with a KYC'd wallet and a public listing to maintain. It splits focus moderately rather than fatally, because it's small. But every hour it takes from the decision about which of the three orgs to concentrate on makes it net negative.",
  "killer_test_30d": "Run one test, not two. Ship the supervisor as the hook and treat Seeker as an optional extra listing.\n\nDays 1-2:\n- Publish the supervisor under an unscoped npm name; dial-supervisor returned 404 earlier in this run, so re-check before publishing.\n- Add a thin PermissionRequest hook.\n- Make supervisor pairing bypass the invite gate. A pairing code from the CLI auto-grants a +008 enrollment. If that can't be done in about a day, stop: the test is dead on arrival.\n- Post once to Show HN and r/ClaudeAI with a 60s demo.\n\nOptional day 3: submit the existing Seeker listing, renamed honestly as an invite preview with self-serve enrollment and 4 screenshots, only if KYC is already in hand. Skip F-Droid.\n\nMetric, measured server-side: the number of distinct supervisors that complete pairing and send at least 3 approval round-trips in days 8-30. Attribute each enrollment to its source: npm/HN, Seeker store, or other.\n\nKill thresholds:\n- Fewer than 20 retained supervisors at day 30 kills the supervisor-as-distribution thesis.\n- Fewer than 50 Seeker installs, or fewer than 10 enrollments sourced from Seeker, kills the channel.\n- MWA is scoped only if Seeker-sourced enrollments are at least 25 and at least 5 of them are still messaging in week 4. \"Retention above zero\" is far too weak a gate.\n\nMy prediction: the supervisor lands at 5-30 pairings, and Seeker sends fewer than 10 enrollments.",
  "revised_sequencing": "0. Precondition: decide whether Dial is the org getting focus. If not, do none of this.\n1. Day 1: build invite-gate bypass for supervisor pairing (auto-grant +008 on pairing). It's the shared critical path, so do it first or abandon the plan.\n2. Day 2: npm publish (unscoped name), a minimal PermissionRequest hook, a check on a clean machine, a 60s demo, and one post.\n3. Day 3, optional and only if KYC/KYB and a funded publisher wallet already exist: fix the Seeker listing (4 screenshots, honest \"invite preview\" title, self-serve enrollment) and run scripts/publish-solana-mobile-release.sh. Drop F-Droid from the plan. It needs the repo open-sourced plus reproducible builds, a separate decision outside this budget.\n4. 1 hour: apply for a Solana Mobile builder grant (if still open, UNVERIFIED) pitching MWA-rooted +0 identity. This is the only part that brings in cash rather than spending attention.\n5. Days 4-30: no further building. Measure attributed pairings and enrollments only.\n6. Day 30: apply the kill gates above. MWA needs at least 25 Seeker-sourced enrollments with at least 5 retained, or a funded grant. Don't touch Suwappu.",
  "summary": "The combination fails as a thesis (score 2/10). It can be kept as up to 3 days of independent side-ships with hard kill gates. The synergy is a story: the supervisor serves desktop coding-agent users, Seeker serves about 10k reward-farming daily users (UNVERIFIED), and the supervisor uses no wallet or MWA, so the channel adds nothing to the hook.\n\nLocal evidence contradicts the plan's framing of \"cheap, mostly already-built\":\n- F-Droid is explicitly blocked (distribution/fdroid/README.md): the repo is private, there is no public tag, and builds aren't reproducible. It can't happen without open-sourcing Dial.\n- The Solana dApp Store needs KYC/KYB, a funded wallet and an App NFT mint, and has no testnet lane.\n- The listing has 1 of 4 screenshots and tells users it's invite-only with calls and payments \"in development\".\n- \"Auto-granted invites\" isn't built, and both funnels depend on it.\n- @dial/supervisor (packages/dial-supervisor, v0.1.0) isn't on npm and has no permission hook. Its category is commoditized by free ntfy-based tools and Anthropic Remote Control.\n\nThe fix is to run one 30-day test led by the supervisor, with pairing that bypasses the invite gate. Count retained supervisors with source attribution, use a stronger MWA gate than \"retention above zero\", and drop F-Droid.\n\nKey files: dial-sdk/distribution/fdroid/README.md, dial-sdk/distribution/solana-mobile/README.md, dial-sdk/distribution/android/store-listing.json, dial-sdk/packages/dial-supervisor/package.json."
 }
]
```

# Top 40 combos (formula)

```json
[
 {
  "ids": [
   15
  ],
  "score": 7.56
 },
 {
  "ids": [
   2,
   15
  ],
  "score": 4.5
 },
 {
  "ids": [
   6,
   15
  ],
  "score": 3.89
 },
 {
  "ids": [
   1,
   15
  ],
  "score": 3.61
 },
 {
  "ids": [
   11,
   15
  ],
  "score": 3.6
 },
 {
  "ids": [
   7,
   15
  ],
  "score": 3.54
 },
 {
  "ids": [
   15,
   16
  ],
  "score": 3.49
 },
 {
  "ids": [
   1,
   2,
   15
  ],
  "score": 3.39
 },
 {
  "ids": [
   2,
   6,
   15
  ],
  "score": 3.37
 },
 {
  "ids": [
   2,
   15,
   16
  ],
  "score": 3.37
 },
 {
  "ids": [
   3,
   15
  ],
  "score": 3.31
 },
 {
  "ids": [
   2,
   5,
   15
  ],
  "score": 3.15
 },
 {
  "ids": [
   2
  ],
  "score": 3.13
 },
 {
  "ids": [
   2,
   3,
   15
  ],
  "score": 3.1
 },
 {
  "ids": [
   9,
   15
  ],
  "score": 2.96
 },
 {
  "ids": [
   5,
   15
  ],
  "score": 2.94
 },
 {
  "ids": [
   2,
   11,
   15
  ],
  "score": 2.86
 },
 {
  "ids": [
   2,
   9,
   15
  ],
  "score": 2.59
 },
 {
  "ids": [
   4
  ],
  "score": 2.57
 },
 {
  "ids": [
   8,
   15
  ],
  "score": 2.52
 },
 {
  "ids": [
   1,
   15,
   16
  ],
  "score": 2.5
 },
 {
  "ids": [
   3,
   15,
   16
  ],
  "score": 2.5
 },
 {
  "ids": [
   7
  ],
  "score": 2.47
 },
 {
  "ids": [
   11
  ],
  "score": 2.47
 },
 {
  "ids": [
   2,
   7,
   15
  ],
  "score": 2.46
 },
 {
  "ids": [
   1
  ],
  "score": 2.42
 },
 {
  "ids": [
   3
  ],
  "score": 2.42
 },
 {
  "ids": [
   4,
   15
  ],
  "score": 2.42
 },
 {
  "ids": [
   14,
   15
  ],
  "score": 2.3
 },
 {
  "ids": [
   1,
   2
  ],
  "score": 2.23
 },
 {
  "ids": [
   6,
   15,
   16
  ],
  "score": 2.2
 },
 {
  "ids": [
   2,
   16
  ],
  "score": 2.13
 },
 {
  "ids": [
   15,
   17
  ],
  "score": 2.02
 },
 {
  "ids": [
   9,
   15,
   16
  ],
  "score": 1.99
 },
 {
  "ids": [
   5,
   15,
   16
  ],
  "score": 1.98
 },
 {
  "ids": [
   12,
   15
  ],
  "score": 1.98
 },
 {
  "ids": [
   2,
   3
  ],
  "score": 1.96
 },
 {
  "ids": [
   1,
   3,
   15
  ],
  "score": 1.93
 },
 {
  "ids": [
   1,
   6,
   15
  ],
  "score": 1.92
 },
 {
  "ids": [
   3,
   6,
   15
  ],
  "score": 1.92
 }
]
```

# Idea scorecards

```json
[
 {
  "id": 1,
  "name": "Agent phone network",
  "pitch": "Every agent gets a +0 number, a wallet with rules, and its human on speed dial (Dial x Suwappu).",
  "size": 2,
  "fit": 3,
  "speed": 2,
  "distribution": 1,
  "defensibility": 1,
  "solo_feasibility": 3,
  "kill_probability": 0.9,
  "assets_used": [
   "dial-supervisor",
   "dnn-registry",
   "dial-messaging",
   "policy-engine",
   "receipts"
  ],
  "role": "distraction",
  "top_competitors": [
   "Native mobile approvals in coding agents (Claude Code Remote Control/mobile app, Cursor, Codex) (UNVERIFIED as of 2026-11-21, the strongest incumbent)",
   "AgentPhone (YC P26, seed ~$500K reported, Jun 2026, real PSTN numbers for agents)",
   "Pushary (lock-screen push approvals for agents, positioned against HumanLayer)",
   "Velatir (human approval over Slack, Teams, email and SMS)",
   "Vapi / Retell / Bland (voice agents, $50M+ each)",
   "Spend-control cohort (Agentcard, Locus, Allowance and others)",
   "Free DIY: Telegram bot, ntfy, Slack webhook"
  ],
  "fatal_flaw": "The approver has to install Dial, which is TestFlight and invite-gated, before the agent can reach them. Every competing channel is already on their phone: Slack, Telegram, push, SMS, and the coding agents' own mobile apps. The +0 numbers do not reach the PSTN, so the \"agent phone network\" cannot call or text anyone outside Dial and is not really a phone network. The \"HumanLayer refugee\" wedge is also smaller than the dossier says. HumanLayer's own GitHub README and competitor Pushary both say the approval SDK (require_approval, Slack/email channels) was already deprecated before the Factory acquisition, as HumanLayer pivoted to a coding IDE. So the vacuum is mostly already empty or already served by Pushary and Velatir. Finally, coding agents almost never spend money, so \"approve a spend\" solves a problem the target users do not have. Suwappu, the wallet half, has 0 completed swaps.",
  "best_case": "@dial/supervisor ships to npm as a decent \"ask my human\" MCP and becomes a modest Dial acquisition funnel: dozens of installs, a handful of people who sideload Dial to get E2EE approvals. The E2EE, self-custodial, no-Slack approval angle wins a small niche of privacy-sensitive or crypto-native agent operators. Revenue in the next 12 months is close to zero. The value is distribution for Dial, not a business.",
  "first_14_days": "Drop the Suwappu/wallet/+0-number framing entirely. Days 1-2: publish @dial/supervisor. The founder confirms the scope/name first, since publishing is irreversible. package.json already has bin, files (dist, hosts, README) and tsup, so this is mostly verifying a clean `npx` install. Days 3-5: check the funnel blocker, which is how long a stranger takes to go from zero to receiving an ask on their phone without an invite. If it is over 5 minutes, or needs TestFlight access granted by hand, stop: the idea is dead regardless of features. Days 6-10: only if that passes, add a generic approve/deny `request_approval` card (no money, no Suwappu dependency, at most a seal-style signed receipt). Days 11-14: post to r/ClaudeCode and HN with a 60-second video. Kill gate: fewer than 25 npm installs and fewer than 3 non-founder humans receiving an approval on Dial means kill it.",
  "verdict": "kill",
  "summary": "Kill the idea as framed. It bundles three things: +0 numbers that do not reach the PSTN and are invite-gated, Suwappu, a wallet product with zero users, and approval-on-phone, a slot already filled by Pushary, Velatir, free Telegram/Slack/ntfy setups and, most dangerously, the coding agents' own mobile apps (UNVERIFIED). AgentPhone (YC P26) owns the \"phone number for agents\" story with real PSTN numbers. The dossier's HumanLayer-refugee wedge is weak: per HumanLayer's README and Pushary, the approval SDK was deprecated before the Factory deal. The structural killer is that the human must install an invite-gated TestFlight app before the agent can reach them. Coding-agent users rarely need spend approval. The only salvage is publishing @dial/supervisor to npm as a cheap Dial funnel test (bin, files and tsup are already set up), with no Suwappu coupling, gated on onboarding a stranger in under 5 minutes. Sources: ycombinator.com/companies/agentphone; standout.work (AgentPhone, seed ~$500K); pushary.com/tr/vs/humanlayer; github.com/gptenv/humanlayer; producthunt.com/products/velatir."
 },
 {
  "id": 2,
  "name": "Claude Code on your phone",
  "pitch": "@dial/supervisor + remote control: approve/unblock/steer coding agents from your phone; HumanLayer migration.",
  "size": 2,
  "fit": 3,
  "speed": 1,
  "distribution": 1,
  "defensibility": 1,
  "solo_feasibility": 4,
  "kill_probability": 0.92,
  "assets_used": [
   "dial-supervisor",
   "dial-messaging",
   "dnn-registry"
  ],
  "role": "distraction",
  "top_competitors": [
   "Anthropic Claude Code Remote Control + push notifications (first-party, free)",
   "OpenAI Codex mobile supervision in ChatGPT (free, bundled)",
   "Omnara (YC S25)",
   "claude-remote-approver / claude-ntfy-hook / Pushary / claude-board (free OSS PermissionRequest-hook phone approvals)",
   "Happy Coder (OSS iOS/Android)",
   "Factory (absorbing HumanLayer users) + self-hosted Apache-2.0 HumanLayer"
  ],
  "fatal_flaw": "The dossier's 14-day plan sells the \"permission-hook\" as the differentiator. It isn't one. \"Approve Claude Code's PermissionRequest from your phone\" already exists as several free OSS tools that need nothing beyond ntfy or a messaging app you already have: claude-remote-approver (Approve / Always / Deny buttons), claude-ntfy-hook, Pushary and claude-board. Anthropic's own Remote Control now does opt-in push when Claude needs a decision. Dial's version adds the most friction of any of them: the supervisor has to install an invite-gated TestFlight app on a testnet (+008) number, and nothing is published to npm. E2EE with no vendor server is the only edge, and coding-agent users don't pick tools on that basis. HumanLayer refugees are teams who wanted multiplayer coding-agent coordination. They have Factory or a self-host of the Apache-2.0 code. They are not looking for a one-person \"agent texts you\" MCP tool, so the migration hook targets a pool that is tiny and mismatched (pool size UNVERIFIED). The founder's situation makes it worse: about $0, attention split across three orgs, a track record of zero-traction distribution (8 PRs closed unmerged, 12 repos with 0 stars), and no revenue path. Free OSS and first-party tools set the price at $0.",
  "best_case": "Publish under an unscoped npm name (`dial-supervisor` and `@dial/supervisor` both 404 on npm today, so the name is free). A \"your coding agent texts you over E2EE, no vendor server\" post gets a small HN or r/ClaudeAI bump. That brings a few dozen developers to install the Dial app, which makes it a modest top-of-funnel for Dial's messaging network. Direct revenue is about $0. Its value is only as a Dial demo or distribution hook.",
  "first_14_days": "Cap it at 2-3 days. Do not run the 14-day plan. Day 1: publish under an unscoped name and fix the npx/host snippets. Check it on a clean machine. Day 2: add a thin PermissionRequest hook (ask, then wait, then allow or deny) and record a 60s demo. Day 3: post once (HN Show, r/ClaudeAI, a reply in HumanLayer migration threads) with an E2EE/self-custody angle. Kill gate at day 14: fewer than 20 paired supervisors means freeze it. Before posting, lift or bypass the Dial invite gate for supervisor pairing, or the funnel is dead on arrival. Don't touch Suwappu for this.",
  "verdict": "park",
  "summary": "The red team confirms the dossier's skepticism and goes further. The proposed fix, a phone-approval permission hook, is already a commodity: free OSS tools (claude-remote-approver, claude-ntfy-hook, Pushary, claude-board) do it over ntfy, and Anthropic Remote Control pushes when a decision is needed (code.claude.com/docs/en/remote-control, checked 2026-11-21). Codex mobile and Omnara cover the rest. Verified locally: @dial/supervisor is real and well-tested, but it is unpublished. Both @dial/supervisor and dial-supervisor return 404 on npm, so the name is available. It has no hook today. Using it requires an invite-gated testnet TestFlight app, the worst onboarding in the category. HumanLayer refugees (Factory deal 2026-11-04, hosted floor about Dec 4 per beri.net; UNVERIFIED in detail) are teams heading to Factory or a self-host. Size small, no revenue, zero defensibility. At most it's a 2-3 day Dial distribution side-ship with a hard kill gate. Otherwise park it. Sources: github.com/yuuichieguchi/claude-remote-approver, adrian-gomez.github.io/claude-ntfy-hook, pushary.com, dealroom.co Factory/HumanLayer, beri.net."
 },
 {
  "id": 3,
  "name": "Private AI you text",
  "pitch": "E2EE personal assistant on local models via Dial that can also pay (Signal meets ChatGPT).",
  "size": 2,
  "fit": 3,
  "speed": 2,
  "distribution": 1,
  "defensibility": 1,
  "solo_feasibility": 3,
  "kill_probability": 0.9,
  "assets_used": [
   "dial-messaging",
   "dnn-registry",
   "local-llm",
   "policy-engine",
   "receipts",
   "x402",
   "solana-mobile"
  ],
  "role": "distraction",
  "top_competitors": [
   "OpenClaw (free MIT, local-first personal agent over Signal/WhatsApp/Telegram, Ollama models, ~373k GitHub stars by May 2026 per dev.to, UNVERIFIED; ClawHub already lists many x402/USDC wallet skills, including one with spend caps and approval)",
   "Confer (Moxie Marlinspike, E2EE via TEE, iOS/macOS/Android; one UNVERIFIED report says its architecture goes into Meta AI)",
   "Venice ($1B valuation; ARR estimates of $70-110M disagree, UNVERIFIED)",
   "Proton Lumo (bundled into Proton Unlimited)",
   "Maple / Privatemode (attested enclaves)",
   "Duck.ai (free)"
  ],
  "fatal_flaw": "The dossier missed the incumbent that crushes this idea: OpenClaw. It is free, MIT-licensed and launched January 2026. It runs on your own machine with Ollama or local models, and you reach it through Signal (via signal-cli), WhatsApp and Telegram, apps people already use. ClawHub already has a crowd of x402/USDC payment skills, including llm_wallet with per-transaction and daily caps and an \"ask user before paying\" rule. Reported scale is ~373k stars (dev.to, May 2026, UNVERIFIED). So the dossier's \"open slot\" is filled, and with less friction. Idea #3 asks users to install a new messenger, get an invite-gated +008 testnet number and run a 3B-8B model. In return they get roughly the same \"private local agent you text that can pay\". The privacy lane is held by Confer, Venice and Lumo on quality, and OpenClaw holds the \"text your own agent\" lane on distribution. On top of that, the founder has 0 users, $0, attention split across three orgs, ~8 integration PRs closed unmerged, and nothing on npm. That is the worst position from which to launch a consumer B2C app into a market where the leading product is free.",
  "best_case": "It becomes a demo or reference app that shows off the Dial stack. The pitch would be: a wallet-rooted E2EE identity (+0 number) for agents, plus a fail-closed policy, approval and seal receipt layer that OpenClaw wallet skills lack. That could make it a credible \"secure channel and spend-guard for OpenClaw-style agents\" integration, such as a Dial channel plugin for OpenClaw or a Suwappu policy skill on ClawHub. That would draw 50-500 technical users and some credibility for Dial. It would not become a standalone business; a realistic ceiling is a few hundred dollars a month.",
  "first_14_days": "Do not build the standalone consumer product. If this gets any time, cap it at 3-4 days and point it at the incumbent's distribution:\n- Days 1-2: publish a Dial channel adapter for OpenClaw (OpenClaw users get E2EE plus a +0 identity), or a ClawHub skill that sends payments through Suwappu's PolicyService/ApprovalService and returns a sign_url and a seal receipt. Use a parsed command, not free-form model tool choice.\n- Day 3: post it on ClawHub, r/LocalLLaMA and the OpenClaw Discord with a 60-second recording.\n- Day 4: measure installs. Kill it if fewer than 20 installs and 0 outside completed approval flows by day 14.\n\nNote: the dossier says it could not find the autonomous agent's implementation, but the crate exists at dial-sdk/crates/dial-autonomous-agent/src/brain.rs, with tests in brain_tests.rs, memory_tests.rs and tests/daemon.rs. So the agent side is further along than the dossier said, and the bridge is smaller. Adding a network or pay tool still breaks the spec's own no-network rule (spec line 130), which holds until a policy layer exists. That puts it on the money path and exposes it to prompt injection from anyone who knows the number.",
  "verdict": "kill",
  "summary": "Kill this as a standalone product. The dossier treats \"Signal meets ChatGPT\" as an open slot, but it is taken:\n- **The lane is filled.** OpenClaw (free, MIT, launched Jan 2026, ~373k stars per dev.to, UNVERIFIED) already runs local Ollama models that you text over Signal, WhatsApp and Telegram. ClawHub already lists many x402/USDC payment skills, some with spend caps and approval prompts.\n- **The privacy lane is held too.** Confer, Venice and Lumo all beat a local 3B-8B model on quality.\n- **The ask is heavier for the user.** Idea #3 needs a new messenger, an invite-gated testnet number and a weak local model, and offers nothing new in return.\n- **The founder's position is weak.** 0 users, $0, attention split three ways, closed integration PRs, nothing on npm.\n- **What survives.** The only defensible piece is the plumbing: a wallet-rooted E2EE identity plus fail-closed policy and receipts. That makes sense only as an integration into OpenClaw's distribution, not as a destination.\n- **Correction.** The dial-autonomous-agent crate does exist (brain.rs and tests), which the dossier missed.\n\nSources: dev.to/jahanzaibai OpenClaw article (May 2026), registry.ollama.ai/blog/openclaw, clawhub.ai x402 skill listings, TechCrunch 2026-01-18 on Confer."
 },
 {
  "id": 4,
  "name": "AI that calls businesses",
  "pitch": "Dial calls + autonomous agents: book/cancel/negotiate/wait on hold for consumers, or AI receptionist for SMBs.",
  "size": 4,
  "fit": 1,
  "speed": 2,
  "distribution": 1,
  "defensibility": 1,
  "solo_feasibility": 2,
  "kill_probability": 0.93,
  "assets_used": [
   "dial-autonomous-agent (persona brain only, no speech pipeline)",
   "dial-supervisor (human-on-phone approval concept)",
   "approvals (Suwappu ApprovalService concept only)"
  ],
  "role": "distraction",
  "top_competitors": [
   "Meta Muse (calls companies for paid users, confirmed 2026-11-12)",
   "Google Gemini / Search AI calling businesses for pricing and availability (since Jul 2025) plus hold-for-me tests",
   "Pine AI ($25M Series A, consumer hold, negotiate and cancel)",
   "Retell AI (~$50-60M ARR) / Vapi ($50M Series B) as infra and receptionists",
   "Beside ($32M) / Phonely / Newo / Simple AI (SMB receptionist)",
   "Instinct Concierge"
  ],
  "fatal_flaw": "The consumer gap the dossier calls \"less crowded\" closed in Nov 2026. Meta confirmed on 2026-11-12 that its consumer agent Muse phones US companies for paid users (Under30CEO, Fox News Oct 2026). Google has offered AI calls to local businesses for pricing and availability since Jul 2025 (Invoca study). Platforms with billions of users and free or bundled pricing now own the consumer-side wedge. The SMB side is a commodity fight among funded players (Retell, Vapi, Beside, Phonely). Dial's code gives no leverage either. grep confirms no PSTN or SIP calling: ROADMAP.md:100 says no \"E2EE, SIP, PSTN, or voice\", specs/13-media-provider.md only mentions Twilio as an aspiration, and services/dial-test-contact/README.md:34 says \"no voice, PSTN\". dial-autonomous-agent has no STT/TTS files. So the product would be a rented Twilio + Vapi/Retell wrapper with zero moat, built by a founder with 0 users, $0 and attention split across three orgs. Businesses also resist AI callers: about 1 in 3 stay on the line (SF Standard, 2026-10-29), and 48% gave no pricing to Google's AI (Invoca). Recording-consent laws in two-party states and the FCC's 2024 ruling that AI voices are \"artificial\" under the TCPA add legal drag. How the TCPA applies to consumer-initiated calls to businesses is UNVERIFIED.",
  "best_case": "A narrow manual-assisted concierge for one painful vertical (insurance claims or medical billing disputes, where a hold can run an hour or more and big-tech agents fail) gets 10-30 paying users at $10-25 per task. That validates a lifestyle micro-business of perhaps $2-10K MRR. It still reuses none of Dial or Suwappu, and it stays exposed to Meta, Google and Pine adding the same vertical.",
  "first_14_days": "If done at all, treat it purely as a demand test with no Dial integration and no code. Days 1-2: a landing page for \"we wait on hold and fight your insurance or medical bill for you\", priced $15 per task. Days 3-10: the founder makes the calls by hand (or with Pine or a phone), with posts in r/HealthInsurance and r/personalfinance. Days 11-14: count paid tasks. Kill if fewer than 5 paid tasks, or if users say Meta Muse or Pine already does it. Better choice: skip it entirely and put those 14 days into a bet that reuses Dial (supervisor MCP for ex-HumanLayer users) or the Suwappu policy engine.",
  "verdict": "kill",
  "summary": "Red-team result: kill. I confirmed the dossier's core asset claim locally. Dial has no PSTN, SIP or speech pipeline: ROADMAP.md:100, services/dial-test-contact/README.md:34, and no STT/TTS in dial-autonomous-agent. The idea is therefore a rented Twilio + Vapi/Retell wrapper. Fresh searches found the dossier's one hopeful gap, a less crowded consumer side, is gone. Meta Muse phones US companies for paid users (confirmed 2026-11-12). Google AI has called local businesses for pricing since Jul 2025. Pine has $25M. The SMB receptionist side is crowded with funded players (Retell ~$50-60M ARR, Vapi, Beside, Phonely). Businesses resist AI callers (about a third stay on the line, per SF Standard 2026-10-29). Recording-consent and TCPA exposure add drag, and the TCPA application to consumer-initiated calls is UNVERIFIED. A solo founder with $0, 0 users and split attention cannot win distribution against Meta or Google. A manual vertical concierge is at best a lifestyle demand test, unrelated to existing assets. Sources: under30ceo.com/?p=140069; sfstandard.com/2026/10/29/ai-agents-calling-local-businesses; pymnts.com/?p=3309225; fcc.gov/document/fcc-makes-ai-generated-voices-robocalls-illegal."
 },
 {
  "id": 5,
  "name": "Phone book for agents",
  "pitch": "DNN +0 registry as the naming/discovery/verification layer for agents (ENS/DNS for agents).",
  "size": 2,
  "fit": 2,
  "speed": 1,
  "distribution": 1,
  "defensibility": 1,
  "solo_feasibility": 3,
  "kill_probability": 0.95,
  "assets_used": [
   "dnn-registry",
   "dial-messaging",
   "dial-supervisor",
   "receipts"
  ],
  "role": "distraction",
  "top_competitors": [
   "Agent Name Service (GoDaddy-built, Linux Foundation project, formalized 2026-11-10 at KubeCon NA; IETF draft-narajala-courtney-ansv2)",
   "ERC-8004 + ENS ENSIP-25/26",
   "AgentPhone (YC Spring 2026: real PSTN numbers for agents, ~$3/number/mo per secondary source, UNVERIFIED)",
   "'Dial - Phone Numbers for AI Agents' on G2 (a separate cPaaS product, 4.8 from 12 reviews: real numbers plus SMS/WhatsApp/voice through API and MCP; its relation to the founder's Dial is UNVERIFIED)",
   "AgentCall (Product Hunt: numbers, SMS, OTP, voice, MCP)",
   "Cloudflare Web Bot Auth / Signature Agent Card",
   "AGNTCY directory (already checks ANS identity)"
  ],
  "fatal_flaw": "The idea is squeezed from both sides, and the +0 number is the weakest part. On the naming side, ANS became a Linux Foundation project on 2026-11-10. It is DNS/PKI-anchored and backed by GoDaddy, Cloudflare and Cisco, and AGNTCY's directory already checks ANS identity. ENS and ERC-8004 hold the crypto-native corner. On the phone side, the paying market for agent numbers is real PSTN numbers that can reach humans and receive OTPs (AgentPhone at YC S26, AgentCall, and a G2-listed product literally named 'Dial - Phone Numbers for AI Agents'). A +0 number can't reach the PSTN, can't receive SMS OTPs, and only resolves inside an unpublished, invite-gated testnet (+008) app with zero external users. Code confirms this: the registry's proof types are 'testnet-first-claim' and 'testnet-reserved-claim', and it has no agent kind. So it is not a usable phone number, and as a name it has no standards weight. Founder-specific factor: the brand collides with an existing agent-phone-number product called 'Dial' (identity UNVERIFIED), so 'Dial phone numbers for agents' is unlikely to win search or attention. And this founder's discovery track record is 0 of ~8 integration PRs merged, 12 repos with 0 stars. A registry's value is entirely its network effect, and that is exactly the distribution this founder has repeatedly failed to get.",
  "best_case": "Dial's own clients (dial-agent, @dial/supervisor, dial-autonomous-agent) give each agent a +0 address. Users then message or call their own agents inside Dial with a signed receipt, and ANS or ENSIP-25 is accepted as the external name, with +0 as an internal alias. This is a modest product feature that helps Dial's agent story. Revenue from naming itself would be about $0. Upside caps at being a Dial feature, never a registry business.",
  "first_14_days": "Do not build a registry. Spend at most 2-3 days, and only if Dial's agent product needs it: (1) Add an optional agent manifest field (an A2A Agent Card URL plus an ANS name or ENS name) to existing dnn-registry registrations. Do not invent a new naming scheme. (2) Let @dial/supervisor register its own +0 so a user can message it inside Dial. (3) Find out whether the G2-listed 'Dial - Phone Numbers for AI Agents' product is unrelated. If it is unrelated, treat the brand/SEO conflict as a Dial-level risk. Return the remaining 11 days to whichever idea has a paying user. Kill metric if anything public ships: fewer than 10 external agent registrations in 30 days means it gets removed from the roadmap.",
  "verdict": "kill",
  "summary": "Kill as a product. My checks confirm the dossier and make it worse. ANS is now a formal Linux Foundation project (2026-11-10) with GoDaddy, Cloudflare and Cisco behind it, and AGNTCY is already verifying ANS identities. ENS and ERC-8004 own the crypto angle, and ERC-8004's 1M+ registrations with ~95% zero clients show agent names don't make money. The phone-number angle has paying demand (AgentPhone YC S26, AgentCall, a G2-listed 'Dial - Phone Numbers for AI Agents'), but that demand is for PSTN reach and OTPs, which +0 cannot provide. The dnn-registry code is testnet-only ('testnet-first-claim' proof types) and has no agent concept. A registry is pure network effect, and this founder has a demonstrated zero-distribution record. The best outcome is a 2-3 day internal Dial feature that accepts ANS/ENS names, not a naming layer. Also flag the possible 'Dial' brand collision (UNVERIFIED). Sources: linuxfoundation.org/press/linux-foundation-welcomes-agent-name-service... (2026-11); ycombinator.com/companies/agentphone; g2.com/products/dial-phone-numbers-for-ai-agents."
 },
 {
  "id": 6,
  "name": "Leash OSS spend firewall",
  "pitch": "Open-source proxy enforcing agent budgets, chat approvals, verifiable receipts.",
  "size": 2,
  "fit": 3,
  "speed": 1,
  "distribution": 1,
  "defensibility": 1,
  "solo_feasibility": 3,
  "kill_probability": 0.92,
  "assets_used": [
   "policy-engine",
   "receipts",
   "x402",
   "dial-supervisor",
   "telegram-bot"
  ],
  "role": "distraction",
  "top_competitors": [
   "Coinbase CDP Agentic Wallets (native session/tx caps, launched 2026-02-11)",
   "x402-spend-receipt (OSS, MIT, Jun 2026: policy gate + signed hash-chained allow/deny receipts)",
   "tryx402 (OSS: budget guard, circuit breaker, Ed25519 offline-verifiable receipts)",
   "x402-firewall / bonanza-x402 / payfetch / paygraph / spendwarden (OSS clones: policy, approval queue, audit log)",
   "AgentPay MCP (OSS, budget caps + human approval, x402 + MPP)",
   "PolicyLayer (non-custodial x402 policy, circuit breakers, audit)",
   "Sapiom (~$51M), Mercury/Ramp agent cards",
   "Runlayer, Kontext"
  ],
  "fatal_flaw": "The dossier's only differentiator (\"verifiable receipts + hash-chained audit\") is already shipped as free OSS. Fresh search (2026-11-21) found x402-spend-receipt (MIT, June 2026), which describes itself as \"local policy gate + signed, hash-chained allow/deny receipts for x402 agent payments\". tryx402 advertises Ed25519 offline-verifiable receipts plus circuit breakers. x402-firewall, bonanza-x402, payfetch, paygraph and spendwarden each offer policy + approval queue + audit log. Coinbase Agentic Wallets have native session and transaction caps where x402 volume actually originates. So this would be the ~8th tiny OSS clone in a commodity category, launched by a founder whose 12 repos have 0 stars and whose ~8 integration PRs all closed unmerged. Distribution is the binding constraint, and a new repo does nothing for it. The addressable buy-side is also small: real x402 volume is ~$1.6M-24M/30d, and nobody pays for OSS spend caps on that. Hard enforcement only works on custodial keys, which turns it into a MONEY-PATH custody product the founder can't support. On self-signed EOAs it is advisory, which is not a firewall.",
  "best_case": "The Python-to-TS extraction lands cleanly and the hash-chain plus at-most-once approval reservation turns out more rigorous than the clones. One of two things follows: (a) a few hundred stars on a well-timed HN/X post, giving the founder credibility as a \"safe agent payments\" voice that funnels people to Dial supervisor's phone approvals, or (b) the code ships as an internal module in Suwappu's hosted MCP with nothing separate to maintain. Revenue in the best case is roughly $0 for 12 months. The value is reputation and a component, not a business.",
  "first_14_days": "Don't build a new repo. Days 1-2: DM 10 people who actually run x402/MPP buy-side agents, found via the x402 Discord and the authors of tryx402, x402-spend-receipt and paygraph. Ask one question: \"Have you ever had an agent overspend, and what did you do?\" Kill the idea unless at least 3 describe real pain AND say the existing OSS doesn't cover it. Days 3-5: read x402-spend-receipt and tryx402 to see what they lack. Concurrency-safe approval reservation is probably the only real gap, so check it. Days 6-14, only if validated: don't fork. Contribute a \"phone approval via @dial/supervisor\" adapter as a PR to the most-used existing OSS gate, and publish @dial/supervisor to npm. That uses someone else's distribution instead of competing with them. Spend no time extracting PolicyService.ts (652 LOC, Drizzle/Postgres and swap-intent-coupled) until demand is proven.",
  "verdict": "kill",
  "summary": "Red team result: kill as a standalone product. The dossier's escape hatch, \"no competitor combines hash-chained audit + receipts + approvals\" (marked UNVERIFIED), is false. x402-spend-receipt (June 2026) and tryx402 already ship signed and hash-chained receipts. At least five more OSS gates (x402-firewall, bonanza-x402, payfetch, paygraph, spendwarden) cover policy, approvals and audit. Coinbase Agentic Wallets build caps in natively. Funded players (Sapiom, Mercury, Ramp) own the paying segment. The assets are real but not portable: PolicyService.ts (652 LOC), audit.ts (269 LOC) and seal.ts (128 LOC) are tied to Drizzle/Postgres and swap intents, and seal.ts seals trading theses rather than payments. Python files in the bot mention approvals, but I didn't verify that a Telegram approval flow exists. The founder's real gap is distribution: 0 stars, 0 merged PRs, 0 users. Another OSS clone can't close that. Salvage: publish @dial/supervisor to npm, add a phone-approval adapter to an existing gate, and keep the policy core inside Suwappu.\n\nSources: pypi.org/project/x402-firewall; awesome.ecosyste.ms/projects/github.com%2Fselfradiance%2Fx402-spend-receipt; pypi.org/project/tryx402; github.com/mvanhorn/paygraph; socket.dev/npm/package/@forum-labs/payfetch; coinbase.com/developer-platform/discover/launches/agentic-wallets (2026-02-11); dev.to PolicyLayer post. These are search-result snippets; I didn't check star counts or traction."
 },
 {
  "id": 7,
  "name": "Chat wallet for next billion",
  "pitch": "Save/send/remit over WhatsApp/Telegram/Dial with UPI/Pix rails + Suwappu router (text-my-crypto).",
  "size": 4,
  "fit": 2,
  "speed": 1,
  "distribution": 1,
  "defensibility": 1,
  "solo_feasibility": 1,
  "kill_probability": 0.95,
  "assets_used": [
   "whatsapp",
   "telegram-bot",
   "router",
   "policy-engine",
   "receipts",
   "dial-messaging"
  ],
  "role": "distraction",
  "top_competitors": [
   "Felix Pago (WhatsApp USDC remittance; $200M raised 2026-09-01; Bitso rails)",
   "Bitso",
   "Remitly / Wise / Sendwave-Zepz (wallet in 100+ countries)",
   "MiniPay (Opera, UNVERIFIED 2026 data)",
   "Binance P2P / P2P.me used directly (no middleman)",
   "Kotani Pay (Africa)"
  ],
  "fatal_flaw": "The flagship channel and both target rails are hostile. (1) Meta's WhatsApp Business Messaging Policy lists real, virtual or fake currency, and \"digital or cryptocurrency\", as prohibited (policy updated 2026-09-23 per mirrors). A crypto-send bot on the WhatsApp Business API risks a number ban, which removes the \"next billion on WhatsApp\" premise. Felix gets away with it because it is a licensed money transmitter whose users see USD to MXN, not crypto. (2) India, the UPI leg: the RBI pushed a containment-leaning-to-prohibition stance in July 2026 (Reuters via The Block, 2026-07-08). Indian banks routinely freeze accounts over P2P crypto UPI inflows, with NCRP cybercrime flags (Crypto Times, 2026-06-17). So \"cash out to UPI via P2P.me\" sends real users into account freezes. (3) Brazil, the Pix leg: BCB Resolution 521 treats stablecoin transfers, including cross-border ones, as FX operations that need authorization, with wallet-owner identification for self-hosted transfers (effective 2026-02-02). A non-custodial hand-off still routes users into a regulated FX activity, with no licensed partner in between. (4) The founder has ~0 users and no corridor diaspora, and remittance is won on distribution and trust. That is exactly what he lacks.",
  "best_case": "The realistic ceiling is a working demo, not a business. It would be a Telegram or Dial chat agent (not the WhatsApp Business API) that quotes USDC routes through the 25-provider router, puts policy-gated approval and a seal receipt on each send, and deep-links to P2P.me for BRL, IDR (QRIS) or ARS cash-out, skipping INR. It might get 5 to 20 crypto-native users and serve as a showcase of the policy engine in a \"consumer\" wrapper. Revenue would be near zero: a router fee on a few hundred dollars of volume. It could seed a later partnership pitch, for example to P2P.me as a chat front end, but nothing here competes with Felix.",
  "first_14_days": "Do NOT build. If anything, spend at most 1 day:\n- Write a 1-page memo for P2P.me proposing a \"chat front end via Telegram/Dial\", and ask whether they would pay a referral fee.\n- Check whether p2p_handler.py and p2p_service.py on Telegram already produce a working P2P.me order link end to end. They do exist and are wired: bot/handlers/p2p_handler.py and bot/services/p2p_service.py import p2p_providers.\n- If an order link works, record a 60-second clip as marketing for the existing bot.\n\nKill criterion:\n- Zero inbound interest from P2P.me or from 10 direct asks in Brazil or Indonesia within 14 days means drop it permanently.\n\nNever route this over the WhatsApp Business API and never target INR.",
  "verdict": "kill",
  "summary": "The red team confirms the dossier's \"don't build\" and goes further: kill it. The dossier missed three structural blockers.\n- **WhatsApp:** Meta's Business Messaging Policy prohibits digital/crypto currency facilitation, so the WhatsApp channel can be banned at will.\n- **India/UPI:** India's RBI is moving toward prohibition (July 2026), and banks freeze UPI accounts receiving P2P crypto inflows. The UPI cash-out harms users.\n- **Brazil/Pix:** Brazil's Resolution 521 classifies stablecoin transfers as FX operations that require authorization.\n\nFelix ($200M, licensed, Bitso rails) owns the WhatsApp remittance wedge.\n\nCode reality: whatsapp_router.py (231 lines) is a generic flow dispatcher with no payment intents. whatsapp_conversation.py is a 110-line Redis state helper. The P2P layer is wired only into the Telegram p2p_handler/p2p_service, with 0 live orders evidenced.\n\nWith ~0 users, no corridor community and split attention, this repeats the distribution failure in a licensed, trust-heavy market. It is worth at most a demo clip of the existing Telegram P2P flow. Sources: business.whatsapp.com/policy; theblock.co 2026-07-08; cryptotimes.io 2026-06-17; cointelegraph BCB rules."
 },
 {
  "id": 8,
  "name": "Agent-to-agent marketplace",
  "pitch": "x402 + Dial identity + Arbiter pay-on-delivery: agents hire agents.",
  "size": 2,
  "fit": 2,
  "speed": 1,
  "distribution": 1,
  "defensibility": 1,
  "solo_feasibility": 1,
  "kill_probability": 0.95,
  "assets_used": [
   "x402",
   "tee",
   "dnn-registry",
   "dial-supervisor",
   "policy-engine",
   "receipts"
  ],
  "role": "distraction",
  "top_competitors": [
   "Virtuals ACP (escrow + evaluator, ~2.28M jobs self-reported, Oct 2026)",
   "Coinbase Agentic.Market (x402 discovery catalog, launched 2026-04-20)",
   "ERC-8183 draft standard + AgentLux reference escrow",
   "Olas Pearl",
   "Skyfire",
   "MeshLedger",
   "Nevermined",
   "Fetch.ai"
  ],
  "fatal_flaw": "A two-sided marketplace needs liquidity, and this founder has none: 0 swaps, 2 bot messages a week, and 8 of 8 integration PRs rejected. The market leader shows the economics. Virtuals ACP pays sellers up to $1M/month in token subsidies, yet keeps only about $160K in protocol revenue against roughly 2.28M self-reported jobs (Forkast, Oct 2026). If the incumbent with a token treasury can't turn agent-hires-agent into real revenue, a solo founder with $0 can't seed it. The supposed moat is also hollow. Arbiter is hardwired to outlayer.testnet (lib.rs:35). Its backend is a fixture-replay demo behind HACKATHON_ARBITER that never spends funds. It only judges GitHub PRs and HTTP terms. And it sits on NEAR, while x402 settles on Base/Solana. Dial identity is testnet-only and invite-gated, and I grepped dial-sdk and found no x402 or escrow link. The one real gap is the evaluator problem, and it is an open research problem (an arXiv SoK on bribery, Sybil and collusion attacks; the ERC-8183 thread). A solo founder won't solve it in a sprint.",
  "best_case": "A testnet \"x402-funded GitHub PR bounty, paid on an Arbiter verdict\" demo gets a blog post, maybe a hackathon prize, and a few dozen stars. At best it becomes a feature inside Dial's supervisor flow (\"the agent asks a human, pays on delivery\"). It never becomes a marketplace. Realistic revenue within 12 months is about $0.",
  "first_14_days": "Don't build the marketplace. If the founder insists, run one 2-3 day test instead of a 14-day build. Write a single landing page describing pay-on-delivery PR bounties and post it where people with bounties gather (Algora, Gitcoin, OSS maintainer communities). Count how many named people with real bounty budgets ask to use it. Below 5 qualified responses means kill it. All engineering time goes back to Dial: publish the npm packages and push the supervisor MCP to the HumanLayer users left behind by its hosted sunset (~Dec 4). That window is time-boxed and a much better use of the same attention.",
  "verdict": "kill",
  "summary": "Red-team verdict: kill. I checked the claims against the code and the web. The Arbiter contract is pinned to the testnet resolver at lib.rs:35. arbiter.ts confirms it only replays recorded fixtures and spends nothing. I grepped dial-sdk and found no link to x402 or escrow. Virtuals ACP, the leader with token subsidies, shows ~2.28M jobs but only ~$160K retained revenue (Forkast, Oct 2026). ERC-8183 is still a draft with no mainnet adoption, and evaluator trust remains unsolved (EIP-8183, the Magicians thread, an arXiv SoK). Coinbase owns x402 discovery through Agentic.Market. The founder has zero liquidity, a record of rejected distribution attempts, and divided attention. Assets on three chains (NEAR testnet, Base, Solana) would have to be bridged before anything ships. The one defensible insight is human-reachable approval plus pay-on-delivery, and it belongs inside the Dial supervisor as a feature. Sources: forkast.news/state-of-virtuals-real-fees-elastic-numbers; eips.ethereum.org/EIPS/eip-8183; arxiv.org/pdf/2604.15367; theblock.co 2026-04-20."
 },
 {
  "id": 9,
  "name": "Execution Index",
  "pitch": "Public verifiable best-execution benchmark as a data product for agents/routers.",
  "size": 1,
  "fit": 2,
  "speed": 1,
  "distribution": 1,
  "defensibility": 1,
  "solo_feasibility": 3,
  "kill_probability": 0.93,
  "assets_used": [
   "router",
   "receipts",
   "dial-messaging"
  ],
  "role": "distraction",
  "top_competitors": [
   "ClearTrace (free, open dataset with realized-slippage leaderboard on Ethereum/Base/Arbitrum/Optimism, HF dataset)",
   "Block Scholes x Bitget Wallet (vendor-sponsored execution scoring)",
   "Blockworks Analytics Solana DEX Aggregator Leaderboard",
   "Academic OFA/solver price-improvement frameworks (Bachu/Wan/Moallemi, arXiv 2503.00738, open-source)",
   "Aggregator self-published 'best execution' benchmarks (KyberSwap, 0x, 1inch, Jupiter)",
   "Dune community dashboards (CoW solver info)"
  ],
  "fatal_flaw": "Nobody pays, and the cheapest version is strictly worse than a free incumbent. ClearTrace already publishes a free per-aggregator slippage leaderboard built on realized fills. A 2026-11-21 search found it covers Ethereum, Base, Arbitrum and Optimism, not just Ethereum as the dossier said, which makes it a stronger incumbent than claimed (https://huggingface.co/datasets/andrewmaury/cleartrace-dex-execution-quality). With 0 completed swaps, Suwappu can only measure quotes, and the literature explicitly says a quote is not execution (Block Scholes; arXiv 2503.00738). The founder would be shipping a weaker, gameable dataset as a conflicted party, since Suwappu's own router is a participant. Distribution is also zero: all 8 integration PRs to awesome lists and frameworks were closed unmerged, and 12 example repos have 0 stars. So the report has no audience to land with. The local asset does not help either. execution_benchmark.py is a per-user cohort percentile with a k=5 anonymity floor over pooled user fills. That is the opposite of a public router-vs-router index, and with ~0 users it returns nothing. Sealing quotes with seal.ts is inference, not something shown to exist: seal.ts is built for Autopilot. The research doc also flags that the api-ts quote path may be a thin LI.FI/Jupiter wrapper. If so, the \"25-provider\" index would need the Python engine and work across both stacks.",
  "best_case": "A single dated, quote-based \"Execution Report\", honestly labeled as quotes, gets picked up by one or two researchers or aggregator teams on X. It becomes a credibility citation on the Suwappu landing page and an SEO page for \"best DEX aggregator price\". Revenue is $0, but it works as a marketing artifact for Bet B (provable best-execution swap). Ceiling: a few hundred visits and a handful of inbound conversations. It never becomes a data business, because data vendors (Birdeye ~$39-199/mo, undated snippet) price raw data low and routers ignore benchmarks that don't flatter them.",
  "first_14_days": "The recommended plan is to not build this as a product. If the founder insists, cap the effort at 3-4 days, not 14.\n- Day 1: a standalone script (no new table, no dual-ORM migration, no api-ts endpoint) that pulls quotes from about 5 public aggregator APIs (1inch, 0x, KyberSwap, Odos, LI.FI). Run it for 10 pairs at 3 sizes on Base and Arbitrum, every hour for 48 hours, and write the results to CSV.\n- Day 3: sha256 the CSV and publish it on GitHub together with the reproduction script.\n- Day 4: write one blog/X thread titled \"Quoted vs realized: we compared our quotes to ClearTrace's fills\". It should reference ClearTrace rather than compete with it.\n- Kill criterion: fewer than 3 external shares or inbound replies within 7 days means stop permanently. Any time beyond this should go to getting the first real completed swap on Suwappu, or to Dial, which actually has momentum.",
  "verdict": "kill",
  "summary": "Red-team verdict: kill as a product. At most it is a one-off marketing post. Fresh search (2026-11-21) showed the incumbent is stronger than the dossier said. ClearTrace's free realized-slippage leaderboard already covers four EVM chains. Blockworks runs a Solana aggregator leaderboard. Academic open-source price-improvement frameworks exist. Aggregators like KyberSwap self-publish \"best execution\" comparisons. With 0 completed swaps, Suwappu can only benchmark quotes, which is gameable and weaker than incumbent fill data. It would also be benchmarking as a conflicted participant. The local execution_benchmark.py is a k-anonymous per-user cohort percentile, structurally unrelated to a public index and empty at the current user count. Quote sealing via seal.ts is unbuilt inference. No buyer was found. Routers won't pay for neutral scoring, and agents don't buy benchmarks. The founder's main constraint is attention split across three orgs, with Dial the only active one. This idea spends that attention on a credibility asset nobody will see, given distribution is near zero."
 },
 {
  "id": 10,
  "name": "AI auditor hunting bounties",
  "pitch": "evmsec + audit framework as agents farming Immunefi/Code4rena/Sherlock payouts.",
  "size": 2,
  "fit": 1,
  "speed": 1,
  "distribution": 1,
  "defensibility": 1,
  "solo_feasibility": 2,
  "kill_probability": 0.93,
  "assets_used": [
   "evmsec",
   "audit-framework",
   "medusa-slither-aderyn-wrappers",
   "audit-fleet-prompts"
  ],
  "role": "distraction",
  "top_competitors": [
   "V12 (ex-Zellic, $10M seed, 2026-08-03)",
   "Sherlock Audit Engine (launched 2026-08-18) + Sherlock AI (beta 2025-09)",
   "Zellic V12 tool, runs on all C4-legacy code",
   "Octane ($6.75M seed)",
   "Almanax",
   "Frontier labs' own security models (Anthropic Mythos, OpenAI/Paradigm EVMbench) plus every solo hunter with the same LLMs",
   "Elite human Immunefi whitehats using AI as a co-pilot"
  ],
  "fatal_flaw": "There is nothing defensible to sell and nothing to farm. The agent would be built on frontier LLMs plus Slither, Aderyn and Medusa, which every funded rival and every solo hunter can also use for free. Platforms run AI scanners before humans ever see the code: Zellic V12 on audited codebases, Sherlock's Audit Engine inside its own contests, Bot Races historically. Whatever a commodity pipeline can find is therefore already found before the founder arrives. What remains is deep, protocol-specific logic bugs. Finding those takes sustained expert attention, which is exactly what this founder lacks (three orgs, ~$0, no public audit track record). Platforms also now penalise high-volume AI submissions and rank by researcher reputation, which is the opposite of an agent farm. Code4rena, the contest venue where volume used to pay, wound down on 2026-05-13. Payouts are winner-take-most and lag 30-90+ days, so this does nothing for the near-term cash problem. It also adds a fourth front with zero synergy with Suwappu users (none) or Dial.",
  "best_case": "The founder finds one or two valid medium or high findings on small Immunefi scopes over a few months, worth roughly $5K-50K, lumpy and delayed. A published self-audit of Suwappu's contracts gives a little credibility to the MPC and policy products. Even the upside is a part-time bounty-hunter income, not a company. V12 and Sherlock own the product version.",
  "first_14_days": "Do not build the hunter. At most, spend 1-2 days on the defensive variant: run the existing Slither, Aderyn and Medusa wrappers plus an LLM triage pass over contracts/*.sol, write Foundry PoCs only for real findings, and update contracts/SECURITY.md. Tag any fix MONEY-PATH. If the founder insists on testing bounties, cap it at 5 small Immunefi scopes, a human verifies every report, and kill the experiment at the first zero-valid-finding outcome. Spend the other 12 days on the core product (Dial npm publish or Suwappu users).",
  "verdict": "kill",
  "summary": "The red-team attack confirms and strengthens the dossier's kill. Fresh checks:\n- Code4rena wind-down and Immunefi absorption are confirmed (The Block, 2026-05-13).\n- Sherlock launched an AI Audit Engine on 2026-08-18 (Decrypt), on top of Sherlock AI (beta 2025-09). Platforms now run their own AI first, so commodity findings are pre-harvested.\n- Bugcrowd changed its policy against AI slop, curl ended its bounty in Jan 2026, GitHub went invite-tier, and Cosmos weights researcher reputation. The market is actively hostile to agent-farmed volume.\n- Immunefi banned ChatGPT-generated reports back in 2023. I found no 2026-specific Immunefi or Sherlock AI-agent policy (UNVERIFIED).\n- V12 ($10M seed) and Sherlock own the product angle.\n\nThe founder's evmsec and audit-framework repos are not cloned (UNVERIFIED), and nothing local resembles a hunter. The bottleneck is expert attention, which the founder has least of. Kill it. At most, run a 1-2 day self-audit of Suwappu contracts as credibility collateral.\n\nSources: theblock.co/post/401179; decrypt.co/375876; bugcrowd.com/blog/bugcrowd-policy-changes-to-address-ai-slop-submissions; computing.co.uk/news/2026/security/bug-bounty-platforms-battle-ai-slop; theblock.co/post/240758; sophos.com/en-us/blog/bug-bounties-in-the-mythos-era"
 },
 {
  "id": 11,
  "name": "Security for agents (Wiz for agents)",
  "pitch": "Prompt-injection scanning, policy, MCP firewall, audit trail sold to teams deploying agents.",
  "size": 4,
  "fit": 2,
  "speed": 1,
  "distribution": 1,
  "defensibility": 1,
  "solo_feasibility": 2,
  "kill_probability": 0.95,
  "assets_used": [
   "policy-engine",
   "receipts",
   "dial-supervisor"
  ],
  "role": "distraction",
  "top_competitors": [
   "AIR Security ($50M seed, Sequoia)",
   "Runlayer ($11M seed + $30M A)",
   "Check Point/Lakera, Palo Alto/Protect AI, SentinelOne/Prompt Security",
   "Lasso open-source MCP gateway",
   "IBM ContextForge (OSS MCP gateway)",
   "Bifrost/Maxim (OSS gateway with MCP guardrails)",
   "Trail of Bits MCP security layer (Jul 2025)",
   "MCPGate/Gateward/Agent-Wall and similar indie OSS firewalls",
   "Snyk (Invariant mcp-scan, UNVERIFIED in this search)",
   "Docker MCP Gateway (UNVERIFIED in this search)"
  ],
  "fatal_flaw": "It loses at both ends of the market. Enterprise buyers (CISOs) will not trust an unaudited firewall from a solo founder against $50M-funded vendors and incumbents that bought Lakera, Protect AI and Prompt Security. The free OSS end is already full: Lasso, IBM ContextForge, Bifrost, Trail of Bits, and at least five indie \"MCP firewall\" repos already ship injection-scan plus policy proxies. The asset gap is also bigger than the dossier implies. AEGIS is a regex-YAML signature port of the upstream aegis-shield project, it is fail-open by design, and it has no benchmarks. PolicyService is shaped around swaps (chain and token fields, wired into swap /build). So the \"real components\" are a commodity idea in someone else's signatures, plus a swap-specific policy engine. The founder's record (8 closed PRs, 12 repos with 0 stars, 0 users) shows distribution is the binding constraint, and this idea adds no distribution.",
  "best_case": "An OSS \"mcp-guard\" with phone-based human approval through @dial/supervisor and hash-chained receipts picks up a few hundred stars from coding-agent users displaced by HumanLayer's hosted sunset (around Dec 4). It works as a lead-gen feature for Dial and is never a standalone company. The best revenue case is a small support contract or acqui-hire interest. Even that requires a launch channel the founder has not shown.",
  "first_14_days": "Do not start this as a company. If anything at all, timebox 3-5 days inside Dial rather than Suwappu. Build a minimal MCP stdio proxy whose only hook is \"require approval on phone via @dial/supervisor for tool X\", with a hash-chained local log and a verify command. Publish to npm (Dial's first package). Post it to the threads where HumanLayer's sunset is discussed. Skip AEGIS enforce mode, because false positives from regex signatures will make the first users churn. Kill criterion: fewer than 5 real installs or fewer than 50 stars within 30 days.",
  "verdict": "kill",
  "summary": "Red-team result: kill this as a company. The demand is real, but the funding is extreme (AIR $50M seed, Runlayer $41M), incumbents are buying their way in (over $2B of M&A), and the free tier is already crowded with OSS MCP gateways (Lasso, IBM ContextForge, Bifrost, Trail of Bits, plus many indie \"MCP firewalls\" posted on dev.to and PyPI in 2026). The local code check weakens the dossier. AEGIS (api-ts/src/aegis/signatures.ts) is a YAML regex port of upstream aegis-shield signatures, it is fail-open and observe-only, and it has no benchmarks. PolicyService.ts is built around swap intents (chain/token, swap /build). The only differentiated angle is approval by phone through @dial/supervisor plus tamper-evident receipts. That belongs as a small Dial OSS feature aimed at HumanLayer refugees, not as a \"Wiz for agents\" company. A solo founder with $0, no enterprise credibility and a track record of zero adoption cannot win CISO sales or stand out in the OSS noise. Sources: securityweek.com AIR/Runlayer coverage, forrester.com M&A blog, getmaxim.ai and truefoundry.com MCP security roundups (2026), blog.trailofbits.com (2025-07-28), github.com/mcpgatehq/mcpgate."
 },
 {
  "id": 12,
  "name": "Post-quantum migration",
  "pitch": "PQ messaging (Dial) + PQ settlement (suwappu-dag/lattice): harvest-now-decrypt-later protection.",
  "size": 2,
  "fit": 2,
  "speed": 1,
  "distribution": 1,
  "defensibility": 1,
  "solo_feasibility": 2,
  "kill_probability": 0.95,
  "assets_used": [
   "dial-messaging",
   "dnn-registry",
   "pq-chain"
  ],
  "role": "distraction",
  "top_competitors": [
   "Signal (PQXDH + SPQR triple ratchet, free, https://signal.org/blog/spqr/)",
   "Apple iMessage PQ3 (free, bundled)",
   "Threema + IBM Research (quantum-safe, heise 2026)",
   "BLOQ Talk / Krown (ML-KEM-768+X25519 hybrid plus wallet Trust Passport; launch was set for 2026-10-01, shipped status UNVERIFIED)",
   "Majik Message / Quldra / PQC Chat (solo-built ML-KEM-768 messengers, seed-phrase accounts)",
   "NetSfere, Rocket.Chat (enterprise/government PQ messaging)",
   "PQShield, SandboxAQ, QuSecure (enterprise PQC migration, well funded)"
  ],
  "fatal_flaw": "No one pays for it, and the \"wallet-rooted PQ messenger\" gap the dossier claimed is already filled. Consumer PQ messaging is a free checkbox: Signal has SPQR, Apple has PQ3, and Threema is moving with IBM. Fresh search (2026-11-21) also turned up direct look-alikes. BLOQ Talk pairs an ML-KEM-768+X25519 hybrid with wallet-gated identity (UNVERIFIED whether it shipped). Majik Message offers ML-KEM-768 with seed-phrase accounts, and Quldra and PQC Chat are solo-built ML-KEM messengers. The paying market is enterprise and government PQC migration, which runs on procurement, compliance and audits. An unaudited solo founder with $0 and three orgs cannot sell into it. The assets don't help either. Dial has zero PQ code: the wire suite is only `x25519-hkdf-sha256-aes256gcm-v1` with static-key sealing, not even forward-secret. Suwappu PQ settlement is a doc marked \"experimental / unavailable\" plus a default-off stub, and the dag/lattice repos are unseen. \"PQ\" layered on a protocol without forward secrecy is a marketing claim that a cryptographer will tear apart in public.",
  "best_case": "Dial ships a hybrid X25519+ML-KEM-768 suite behind the versioned `algorithm` field in about a week, with KATs and downgrade protection. That gives a defensible \"HNDL-resistant from testnet day one\" line for the Dial launch narrative and grant applications (NLnet, Ethereum Foundation PQ, Solana Mobile). Upside: credibility and possibly a small grant ($10-50k, UNVERIFIED). It does not produce users or revenue. Suwappu PQ settlement stays default-off forever unless the dag/lattice chains independently find adoption.",
  "first_14_days": "Don't spend the 14 days on this. If it's done at all, cap it at 5 days, Dial only. Day 1: edit the Rust schema source, not the generated TS. Add a `x25519-mlkem768-hkdf-sha256-aes256gcm-v2` suite using a vetted library (RustCrypto ml-kem or liboqs), with a dual-key bundle in the DnnMessageEncryptionKey type. Days 2-3: bind the algorithm into the AEAD/signature transcript (downgrade protection), add KATs, and keep v1 decrypt intact. Day 4: write a one-page threat model that says plainly this is static-key hybrid sealing, not forward-secret, and is a stopgap until libsignal PQXDH. Day 5: apply for one PQ or privacy grant. Do not touch Suwappu settlement (MONEY-PATH, draft EIP-8355, unseen repos).",
  "verdict": "kill",
  "summary": "Kill as a business bet. At most, a 5-day Dial hardening task. The tailwind is real but goes to enterprises: NIST IR 8547 deprecates RSA/ECC after 2030 and disallows them after 2035. Consumers get PQ free from Signal (SPQR), Apple (PQ3) and Threema/IBM. A fresh search found the \"wallet-rooted PQ messenger\" niche already occupied (BLOQ Talk hybrid ML-KEM + wallet passport; Majik and Quldra seed-phrase ML-KEM messengers), so the claimed gap is gone. Dial has zero PQ code and is still classical static-key sealing without forward secrecy, so a PQ claim now invites public cryptographer criticism. Suwappu PQ settlement is a disabled doc plus a stub, and the underlying repos are unverified, and it touches the money path. Enterprise PQC buyers need audits and procurement that a $0 solo founder split three ways can't supply. Expected 14-day revenue is $0 and it brings no users. Its best use is a credibility checkbox for the Dial launch or a grant application."
 },
 {
  "id": 13,
  "name": "Sovereign comms for orgs",
  "pitch": "Self-hosted Dial operators + agents for enterprises/governments (palantir-for-japan hint).",
  "size": 3,
  "fit": 1,
  "speed": 1,
  "distribution": 1,
  "defensibility": 1,
  "solo_feasibility": 1,
  "kill_probability": 0.95,
  "assets_used": [
   "dnn-registry",
   "dial-messaging",
   "calls",
   "local-llm",
   "policy-engine",
   "receipts"
  ],
  "role": "distraction",
  "top_competitors": [
   "Element/Matrix (ESS; claims 25+ governments incl. EC, NATO NI2CE, UN; Germany's Deutschland-Stack/ZaPuK, Sweden federation, France Tchap)",
   "Wire (MLS, EU government wins)",
   "Threema Work (self-hosted)",
   "Mattermost (Oracle sovereign-AI partnership: the agent-native sovereign angle is already taken)",
   "Rocket.Chat / Nextcloud Talk / openDesk integrators"
  ],
  "fatal_flaw": "The thing Dial would sell does not exist. The only deployable operator in the repo is a testnet with one Cloudflare Worker, a single Durable Object, a Rust container and invite admission codes (dial-sdk/deploy/cloudflare-operator/README.md). It runs on a US hyperscaler, which is the opposite of sovereign on-prem. ADR 0001 calls the reference operator \"deliberately disposable\" (line 48). Transport and auth have since moved to ADR 0002, which has not been reviewed. I found no SSO/OIDC, admin console, retention or compliance features; a grep found those words only in incidental spec text. Selling this means government procurement: 6-18 month cycles, security certification, audited crypto and a vendor that can deliver support. A solo founder with $0, attention split across three orgs, an unaudited MPC signer and no npm releases cannot sell there. Matrix/Element already owns the open-standard sovereign seat with 25+ governments (self-reported) and the EU political momentum. Mattermost and Oracle already market \"sovereign AI.\" Buyers pick standards and incumbents with references, and Dial's wallet/+0-number identity adds friction in a government setting.",
  "best_case": "One NGO, journalist collective or crypto-native DAO wants a self-hosted, agent-aware messenger tied to wallet identity and pays a $5-20K pilot or grant. Realistically that takes 6+ months, and the work consumes the Dial core. A sovereign or Japanese government deal (the palantir-for-japan angle) is UNVERIFIED and needs a local partner the founder has not shown he has.",
  "first_14_days": "Build nothing. Spend at most 3 hours on 10 cold outreach messages to crypto-native orgs and NGOs already running Matrix or Signal: \"Would you pay for a self-hosted operator with agents on board?\" Kill the idea at 0 LOIs. Put all other time into Dial distribution (npm publish, growing TestFlight users).",
  "verdict": "kill",
  "summary": "The red team confirms and hardens the dossier's NO-GO. Fresh evidence shows Element/Matrix entrenched in 25+ governments (Element self-report), plus Germany's Deutschland-Stack, Sweden's federation and NATO NI2CE. Mattermost and Oracle already pitch sovereign AI, so \"agent-native\" is not an open gap. Local inspection makes it worse than the dossier said. Dial's only operator deployment is a Cloudflare-hosted, single-Durable-Object testnet with invite tokens, so the product is not self-hostable on-prem at all, and I found no SSO, admin, retention or compliance features. The buyer sits behind 6-18 month procurement and certification that a solo $0 founder with unaudited crypto cannot get through. No buyer has been shown to value wallet-rooted identity. The idea pulls attention from Dial core distribution, which is the one thing with momentum. Kill it as a standalone idea. At most, let inbound sovereign interest show up after Dial ships publicly. Pricing, TAM and the palantir-for-japan repo remain UNVERIFIED. Sources: theregister.com 2026-02-09; element.io/sectors/government; blogs.oracle.com sovereign-ai-oracle-mattermost."
 },
 {
  "id": 14,
  "name": "Quant desk",
  "pitch": "quantdesk + router: trade own capital or sell signals.",
  "size": 3,
  "fit": 1,
  "speed": 1,
  "distribution": 1,
  "defensibility": 1,
  "solo_feasibility": 2,
  "kill_probability": 0.93,
  "assets_used": [
   "quantdesk",
   "router",
   "receipts"
  ],
  "role": "distraction",
  "top_competitors": [
   "Trojan / Banana Gun / Maestro / Axiom / GMGN (execution bots that earn fees on volume)",
   "Cryptohopper signaller marketplace / 3Commas (copy trading and signals)",
   "Hyperliquid vaults (on-chain, verifiable copy trading built into the venue; UNVERIFIED depth)",
   "OKX / Binance / Bybit agentic trading and Robinhood agent accounts (bundled free)",
   "Numerai (crowdsourced signals with staked track records; UNVERIFIED current state)"
  ],
  "fatal_flaw": "Both options need a track record, and the founder has none. Trading own capital needs capital, and the founder has about $0. Selling signals needs verifiable performance, which takes months to build. There is also no evidence of edge. quantdesk is private and uncloned, so every claim about it is UNVERIFIED, and a local grep of suwappubot found no backtest, paper-trading or signal service. The router has 0 completed swaps, so it has never filled a real trade. On distribution: earlier outreach (about 8 integration PRs, all closed, and 12 repos with 0 stars) shows the founder cannot get attention even for free dev tools, and paid signals is a market even lower on trust. Hyperliquid vaults already offer verifiable on-chain records natively (UNVERIFIED depth), which undercuts the one wedge, \"sealed track records\". This would also be a fourth way to split attention, on top of three orgs and a very active Dial. Selling advice or managing funds adds regulatory exposure (UNVERIFIED legal view).",
  "best_case": "quantdesk turns out to hold a real, backtested edge (UNVERIFIED). The founder runs it with a small stake, and seal.ts plus the hash-chained audit produce a tamper-evident public PnL record. After 6-12 months of live results, that record could be sold as a paid feed or as a \"verified agent track record\" service, or used as credibility marketing for Suwappu's policy and audit stack. Realistic ceiling in year one: a few hundred to low thousands of dollars a month, with high variance. The more likely outcome is a marketing demo with no revenue.",
  "first_14_days": "Do not start a business on this. If anything, take one day to clone quantdesk and answer a single question: does it have an out-of-sample backtest with a positive Sharpe ratio after fees and slippage? If not, kill the idea. If it does, spend no more than 3 more days on an unmonetized paper-trade runner that seals each signal (seal.ts plus audit.ts) and marks prices with router quotes, and let it accrue in the background. Revisit after 90 days of live data. Do not market it, do not charge for it, and do not risk capital in this window.",
  "verdict": "kill",
  "summary": "Red-team result: kill. Both paths fail on the founder's actual situation. Trading own capital fails because there is about $0 to trade. Selling signals fails because there is no track record, and a credible one takes months, not 14 days. quantdesk is private and unverified, and the local search found no backtest or signal service. The Rust searcher crate is explicitly isolated research. The router has never completed a swap. The category is crowded with incumbents that either monetize execution, not edge (Trojan, Banana Gun, Axiom), or bundle agent trading for free (OKX, Binance, Robinhood). The founder has no distribution, as shown by the closed PRs and 0-star repos. The only idea worth keeping is the sealed, hash-chained track-record primitive. That is a feature of Suwappu's existing audit stack, not a quant business. At most it is a background paper-trade demo, and only if one day spent inspecting quantdesk shows a real out-of-sample edge."
 },
 {
  "id": 15,
  "name": "Done-for-you agent studio",
  "pitch": "Sell custom bots/agents/MCP builds to companies for cash.",
  "size": 3,
  "fit": 2,
  "speed": 3,
  "distribution": 1,
  "defensibility": 1,
  "solo_feasibility": 3,
  "kill_probability": 0.65,
  "assets_used": [
   "dial-supervisor",
   "policy-engine",
   "receipts",
   "telegram-bot",
   "router"
  ],
  "role": "cash_engine",
  "top_competitors": [
   "Upwork/Fiverr MCP freelancers ($45-95/hr listings, 2-3 hour MCP gigs; Upwork, checked 2026-11-21)",
   "Buyers building it themselves with Claude Code/Cowork (Sandlabs: Cowork plus custom MCP setups sold at $3-5K, Mar 2026)",
   "AI automation agencies (Master of Code, Cleveroad, Space-O, plus a long tail of course-trained shops)",
   "Spend-control and approval SaaS (~28 YC cos: Agentcard, Allowance, Locus...) that hand buyers guardrails without a custom build",
   "Sierra/Decagon forward-deployed engineers (top end, adjacent)"
  ],
  "fatal_flaw": "Services are sold on trust and warm referrals. This founder has neither, and the evidence is in the record: ~8 integration PRs closed unmerged, 12 example repos with 0 stars, 0 completed swaps, nothing on npm. The dossier's 14-day plan assumes 30-50 warm contacts who buy agent builds, and nothing verifies that list exists. Without it the channel is cold outreach plus Upwork. On Upwork, MCP work is priced at $45-95/hr and posted as 2-3 hour jobs (UNVERIFIED as a market average; based on listings seen 2026-11-21). Buyers there pick on reviews, which a new account doesn't have. The one real differentiator, auditable policy-gated agents that touch money, can't be sold: the MPC signer is unaudited, Suwappu has no production users to cite, and any agent that moves funds carries uncapped liability. Strip that out and the offer is a generic MCP server plus an approval step. Claude Code or Cowork lets the buyer, or a $45/hr freelancer, build that in days. Then the time problem: client work demands calendar responsiveness from someone already split across three orgs, so even a won deal mostly takes from Dial, the one project with real momentum (~20 PRs merged 2026-11-20).",
  "best_case": "One or two crypto or fintech contacts pay $3-8K fixed-fee pilots for an MCP server with a human approval step on the phone, built on @dial/supervisor. These pilots become Dial's first paying design partners and first case study. The timing helps: HumanLayer's hosted service sunsets around Dec 4, 2026, and its users want a replacement. Around $10-25K over 6 months buys runway and a published, referenced supervisor package. That is a bridge to product revenue, not a business in its own right.",
  "first_14_days": "Days 1-2: write down every real person who has paid, or could plausibly pay, for engineering work. If that list has fewer than 15 names, kill the studio idea and keep only the HumanLayer-migration angle below. Days 2-4: publish @dial/supervisor to npm with a 60-second demo (coding agent asks for approval, phone buzzes, human approves) and a one-page offer: \"HumanLayer replacement and setup, $1.5-3K fixed fee.\" Selling a migration or setup of something you own beats selling custom builds. Days 4-10: contact HumanLayer users directly (GitHub issues and discussions, their Discord or Slack, people tweeting about the sunset) plus the warm list, aiming for 40 personal messages. Post one productized Upwork listing as a control. Days 10-14: deliver any pilot within 5 days. Kill rule: no signed pilot by day 21 means stop selling services and go back to product. Hard cap of 8 hrs/week. Nothing that moves funds or touches mpc-signer.",
  "verdict": "combine_only",
  "summary": "The red team mostly kills this. A general \"done-for-you agent studio\" fails on this founder's exact weakness, which is trust and distribution: closed PRs, 0 stars, 0 users, nothing published. Generic MCP and agent builds are commoditizing. Upwork shows $45-95/hr MCP listings and 2-3 hour jobs, and Claude Code/Cowork lets buyers self-serve. Commentators describe generic AI-automation agency offers as saturated (UNVERIFIED, vendor-heavy sources). The only defensible angle, auditable agents that touch money, is unsellable because of the unaudited MPC signer and liability risk. Services also take the most attention from the founder's best project, Dial. What survives is a narrow combination: paid setup or migration pilots for @dial/supervisor aimed at displaced HumanLayer users (hosted sunset around Dec 4). That is design-partner revenue that feeds a product, not a studio. Run it with a 21-day kill rule and an 8 hr/week cap."
 },
 {
  "id": 16,
  "name": "Solana Seeker distribution",
  "pitch": "Dial + wallet via Solana Mobile dApp Store / Seeker phone.",
  "size": 1,
  "fit": 2,
  "speed": 1,
  "distribution": 2,
  "defensibility": 1,
  "solo_feasibility": 4,
  "kill_probability": 0.9,
  "assets_used": [
   "dial-messaging",
   "dnn-registry",
   "solana-mobile",
   "router"
  ],
  "role": "distraction",
  "top_competitors": [
   "Dialect (Solana-native messaging/notifications/Blinks)",
   "Telegram (already where Solana traders live; Seeker is plain Android)",
   "Signal",
   "Phantom / Solflare / Backpack / Seed Vault Wallet (default wallet+swap surfaces)",
   "Jupiter Mobile (swap on Seeker; crushes any Suwappu-on-Seeker variant)",
   "XMTP-based wallet chat (Coinbase Wallet/Base App) UNVERIFIED on Seeker"
  ],
  "fatal_flaw": "The listing reaches the wrong audience with the wrong product. Seeker's engaged base is about 10k daily active users, most of them farming SKR season rewards by signing on-chain transactions (SolanaFloor/Dune, 2026, mostly platform-sourced, UNVERIFIED independently). The store holds 1,561+ apps (Solana Compass, 2026-06-25), and Solana Mobile itself calls discovery and retention the bottleneck. Dial Testnet would enter as an invite-only messenger that has no Mobile Wallet Adapter or Seed Vault integration. I checked dial-android and found no MWA, Seed Vault or ed25519 code. So Dial cannot take part in the on-chain activity that drives rewards, rankings and attention. A messenger also has a network-effect cold start: one Seeker owner can only message other invitees. At realistic install counts (tens), there is no one to talk to, and the invite gate turns the installs it does get into bad reviews. The founder has zero users across three orgs, and this channel can't fix that. Its ceiling is a store page, not distribution.",
  "best_case": "Solana Mobile features Dial in a dApp Spotlight or blog post as a \"crypto-native E2EE messenger with wallet-rooted numbers\". That requires real MWA sign-in plus a Solana-key-derived +0 identity. The feature drives 500-2,000 installs, and a few hundred invite redemptions seed a testnet cohort of crypto-native early adopters who give feedback and act as social proof for a grant (Solana Mobile builder grants exist). That is a useful seed cohort, still not a business.",
  "first_14_days": "This is a cap, not a plan. Spend at most 1 day, and only if the founder will do KYC/KYB and the wallet steps anyway. Fix the listing first: it has 1 screenshot and needs at least 4. Rename it honestly as an invite preview and add a public waitlist or self-serve invite so the page doesn't produce bad reviews. Submit with the existing scripts/publish-solana-mobile-release.sh. Run a 30-day kill test: under 50 installs or under 10 invite redemptions means drop the channel. Do NOT build MWA or Seed Vault, Solana key derivation, or a Suwappu Seeker app speculatively, because each is money-path-adjacent work that serves no current user. Separately, if Solana Mobile builder grants are still open, a 1-hour grant application pitching MWA-rooted +0 identity is the only part with positive expected value, since it brings in cash rather than spending attention.",
  "verdict": "kill",
  "summary": "The red team confirms the dossier and goes further: kill this as a strategy. Seeker has about 150k devices but only about 10k daily active users, mostly rewards farmers signing transactions. The store has 1,561+ apps, and Solana Mobile itself says discovery is the bottleneck. I checked the stub (solana-mobile-portal.json): it is \"Dial Testnet\", invite-only, with 1 screenshot (4 required) and calls, payments and groups listed as \"in development\". dial-android has no MWA or Seed Vault code, so Dial gets none of the Seeker-native advantages that drive rankings. A messenger with an invite gate on a tiny base has no network to message, and it will collect bad reviews. Suwappu on Seeker loses to Jupiter Mobile and the built-in wallets. The founder's scarcest resource is attention, and this spends it on a store page. The only defensible pieces are a capped 1-day listing as a free side-channel with a 30-day kill metric, and possibly a Solana Mobile grant application. Neither is a pursuit."
 },
 {
  "id": 17,
  "name": "AI for materials discovery",
  "pitch": "matgl/chgnet/GaN repos: AI-for-science deep tech.",
  "size": 4,
  "fit": 1,
  "speed": 1,
  "distribution": 1,
  "defensibility": 1,
  "solo_feasibility": 1,
  "kill_probability": 0.97,
  "assets_used": [
   "materials-ml"
  ],
  "role": "distraction",
  "top_competitors": [
   "CuspAI ($450M, 2026-07; Foundry consortium with Nvidia/Samsung/Meta)",
   "Periodic Labs ($300M seed, 2025)",
   "Microsoft MatterGen/MatterSim (free)",
   "Google DeepMind GNoME (free)",
   "Orbital Materials / Radical AI / Cambium (UNVERIFIED)",
   "Materials Virtual Lab MatGL and CHGNet upstream (free OSS)",
   "Schrodinger (incumbent enterprise sim software)"
  ],
  "fatal_flaw": "The founder has no materials-science asset to build on. I re-ran the grep across both repos with lock files excluded and word boundaries on GaN. The only hit was a PDF in suwappubot/showcase/public/research/reports, which looks like a binary false positive, and nothing in code. The matgl/chgnet \"assets\" are forks of free open-source models that the upstream lab maintains better, and MatterSim and GNoME are also free from Microsoft and DeepMind. The buyers are chemical, battery and semiconductor R&D enterprises: they buy lab-validated results on multi-year contracts, via a PhD-led sales motion. A $0 solo crypto/messaging founder with no credential, no lab, no GPUs, no data and a proven inability to get community distribution (8 PRs closed, 0 stars) cannot sell to them. Any thin wrapper is commoditized from the start, and the deep version needs $100M+ (CuspAI, Periodic).",
  "best_case": "The founder publishes a free hosted MCP or notebook wrapper around MatGL/CHGNet that gets a few hundred GitHub stars, or a short note from an academic group. It earns $0 and does not help Dial or Suwappu. At most it opens an AI-for-science consulting or co-founder conversation, which needs a domain expert the founder does not have.",
  "first_14_days": "Do not build. If the founder still wants to test the idea, the cap is 1 day: message 5 computational materials scientists and ask whether they would pay for hosted universal-potential inference that they currently run free on their own clusters. Kill it on the expected \"no\". Spend the other 13 days on Dial: publish the npm packages and ship @dial/supervisor to HumanLayer refugees before HumanLayer's hosted service shuts down around Dec 4.",
  "verdict": "kill",
  "summary": "The red-team attack confirms the dossier's KILL. The market is real but is being captured by mega-funded labs: CuspAI raised $450M at a reported $2.6B valuation (2026-07-20) and Periodic Labs raised a $300M seed. Big Tech gives away MatterGen, MatterSim and GNoME, and MatGL/CHGNet are free upstream, so a software-only wrapper has no moat or price. Buyers are enterprise R&D teams who want lab-validated results, which needs credentials, a lab and a long sales cycle. The founder has none of these. My re-grep with lock files excluded and word boundaries found no materials code in either repo, only a PDF false positive. He also has no distribution: closed PRs and 0-star repos. Adding a fourth unrelated domain to a founder already split across three orgs, while Dial has momentum and a time-boxed HumanLayer-sunset opening, is a pure distraction. Competitor details beyond CuspAI and Periodic are UNVERIFIED. No fresh web search was run, because the dossier's sourced evidence plus the asset check is enough to kill."
 }
]
```

# Research dossiers

## #1
**Verdict: do not build "agent phone network" as framed (Dial x Suwappu). It combines two zero-traction assets and lands in the most crowded and best-funded voice-agent market. The narrow slice worth testing is a 14-day "agent asks its human on the phone to approve a spend" demo. It extends the existing @dial/supervisor and doubles as a funnel test for Dial, not Suwappu.**

**(a) Market (dated)**
- Voice AI is large, but the money goes to PSTN voice agents for businesses, not to "+0 numbers for agents". Retell is about $50-60M ARR as of Apr 2026 (Sacra vs Enterprise DNA disagree): https://sacra.com/research/retell-ai-60m-yr-up-650-yoy
- Vapi raised a $50M Series B in May 2026 (total $72M) and reports 1B calls: https://thenextweb.com/news/vapi-50m-series-b
- Bland raised $50M in Jun 2026: https://siliconangle.com/2026/06/16/bland-raises-50m-automate-complex-high-stakes-phone-calls/
- Who pays: enterprises automating inbound and outbound calls, billed per minute. I found no evidence that anyone pays for a decentralized number for an agent. UNVERIFIED: per-minute pricing, which I did not retrieve (my recall is roughly $0.05-0.15/min, treat as a guess).
- Demand for "agent asks human for approval" is real but small, and it sits with coding-agent users. HumanLayer was acquired by Factory on 2026-11-04 and its hosted service sunsets around Dec 4 (from the brief, not re-verified). That leaves a vacuum for a drop-in replacement.

**(b) Competitors**
- Vapi: $72M raised, 1B calls, enterprise. Gap: no wallet, no policy layer.
- Retell: about $50-60M ARR on roughly $5M raised. Same gap.
- Bland: $50M raised in Jun 2026. Same gap.
- AgentMail: $6M raised in Mar 2026, email for agents. It validates "agent gets its own identity primitive" but is not phone: https://techcrunch.com/2026/03/10/agentmail-raises-6m-to-build-an-email-service-for-ai-agents/
- AgentPhone (YC): a phone number for agents. It is the closest direct competitor, funding unknown: https://ycombinator.com/companies/agentphone
- HumanLayer/Factory: the closest to "human in the loop on the phone", now absorbed into a coding-agent vendor.
- Spend-control cohort (~28 YC companies per the brief: Agentcard, Allowance, Locus, OneCLI and others): they own the wallet-with-rules half.
- Telnyx and Twilio: commodity numbers, the supply side. UNVERIFIED: their agent-specific offerings.
- Overall gap: nobody bundles number plus wallet plus policy plus human approval. The reason may be that buyers don't want the bundle, so the gap does not prove demand.

**(c) Asset reality**
- **Dial** is active and substantial.
  - `dial-sdk/packages/dial-supervisor/package.json` is @dial/supervisor 0.1.0, MIT, with a `dial-supervisor` bin, hosts for claude-code/cursor/codex, and tests. It is not published to npm. Its job is notify or ask the human, then read replies.
  - Specs exist for the DNN registry, number payment accounts, and a service line at +813 (`dial-sdk/specs/20-number-payment-accounts.md`, `dial-service-line-813.md`), plus `services/dnn-registry`.
  - The +0 numbers are testnet and invite-gated. They are NOT reachable from the PSTN, so an agent's number cannot call or text normal people. UNVERIFIED: whether any PSTN bridge exists. There is a `providers/dns-bridge`, but it is DNS records, not telephony.
- **Suwappu**
  - `api-ts/src/services/PolicyService.ts` (a `PolicyService` Context.Tag with a Live layer at line 287) is the fail-closed policy engine.
  - ApprovalService.ts, audit.ts and lib/seal.ts exist per the brief. I verified only PolicyService.
  - The reusable piece is policy plus approval plus audit, not the swap router.
  - Dial's own approval flow today lives in the supervisor. A wallet-spend approval over Dial's E2EE chat is not built. UNVERIFIED: any integration between the two repos. My grep of `packages/` for suwappu found only generic "wallet/policy" hits (in contacts-book, protocol types and dns-bridge, not Suwappu code), so there is no Suwappu coupling.
  - mpc-signer is unaudited, so no real-funds custody.

**(d) 14-day solo scope (feasible)**
- Days 1-3: publish @dial/supervisor to npm, with a one-line install and README. This also removes the biggest gap in Dial's distribution.
- Days 4-8: add a `request_approval(amount, payee, reason)` tool to the supervisor MCP. It posts a structured card to the human's Dial app. The human replies approve or deny and the agent receives a signed, seal-style receipt. Reuse the PolicyService and seal receipt logic as a library or HTTP call, with testnet or quote-only funds.
- Days 9-11: a drop-in migration page for HumanLayer refugees before the ~Dec 4 sunset.
- Days 12-14: 5-minute demo video, then post to HN, r/ClaudeCode, and DM 20 HumanLayer users.
- Success gate, no spend: 25 installs or 5 real approvals. If it misses, kill the idea. The earlier integration PR channel (about 8 PRs, all closed) shows that cold distribution into other people's repos fails, so use direct outreach to a time-boxed audience.
- Not feasible in 14 days: real PSTN numbers, a production-money wallet, or competing with Vapi, Retell and AgentPhone.

**Risks:** attention split across three orgs. Any real-funds path is MONEY-PATH and needs a money-path-reviewer pass. The idea is cross-repo with unclear ownership of the policy service.

HANDOFF
agent: sdk-dev
task: In dial-sdk/packages/dial-supervisor, prepare the npm publish (verify the `files`, build and bin entries, README quickstart). Then add an MCP tool `request_approval` that sends a structured card, waits for the human's reply, and returns a signed receipt. Acceptance: `npx @dial/supervisor` works from a clean machine and the approval round-trip passes against the fake dial-agent in test/fake-dial-agent.mjs.
files: dial-sdk/packages/dial-supervisor/package.json:1; api-ts/src/services/PolicyService.ts:108
risks: Cross-repo. Publishing to npm is irreversible, so the founder should confirm the package name and scope. Any real-funds spend path is MONEY-PATH, so keep it testnet or quote-only until the money-path-reviewer has signed off.

## #2
**Verdict: do not build this as a standalone product. Wedge is weak and crowded; Anthropic and OpenAI ship it natively. Only worth a 2-3 day side-ship (publish + HumanLayer-refugee post) as a Dial distribution hook, not a Suwappu pivot.**

**(a) Market (dated)**
- Demand is real but absorbed by first parties. Anthropic launched Claude Code Remote Control 2026-02-24 (Claude app Code tab; also Channels = Telegram/Discord notifications on input needed) [code.claude.com/docs/en/mobile](https://code.claude.com/docs/en/mobile), [VentureBeat](https://venturebeat.com/orchestration/anthropic-just-released-a-mobile-version-of-claude-code-called-remote). OpenAI shipped Codex mobile supervision in ChatGPT 2026-05-14 [YourStory](https://yourstory.com/ai-story/openai-coders-approve-ai-work-from-anywhere).
- Known gaps in Remote Control: session must start on the computer, machine must stay on [Medium](https://medium.com/@orseni/claude-code-on-your-phone-what-anthropics-remote-control-gets-right-and-what-s-still-missing-de33586c8fc8). Cross-agent (Cursor/Codex/Zed) and unattended-agent-asks-human are not covered.
- Pricing/who pays: UNVERIFIED. I found no sizing. Consumer indie apps are free/low-priced; payers would be teams (Factory/HumanLayer enterprise). Realistic TAM for a solo indie tool is small.
- Signal of weakness: MobileCode archived its open-source project after Remote Control shipped [search result, github.com/skelpo/mobilecode].

**(b) Competitors**
- Anthropic Remote Control/Channels, OpenAI Codex mobile: free, bundled, first-party.
- Omnara (YC S25): web and mobile for Claude Code/Codex, approve/steer, voice, cloud fallback; funding ~$500K, sources conflict (pre-seed vs seed) [YC](https://ycombinator.com/companies/omnara), [App Store](https://apps.apple.com/us/app/id6748426727).
- HumanLayer, now Factory (acquired 2026-11-04, undisclosed; core code open-sourced Apache-2.0 2026-10-23; hosted access reportedly 30+ days) [Dealroom](https://dealroom.co/news/169795-factory-buys-humanlayer-to-add-team-coordination-for-coding-agents/), [beri.net](https://www.beri.net/article/factory-humanlayer-acquisition-hosted-platform-30-day-transition-export-self-host-open-source-refunds-coding-agents-customer-continuity). Note: its IDE is team-oriented; the refugee pool is probably small. Pool size UNVERIFIED.
- Happy Coder (open source, iOS/Android, push, voice), Forge Remote (iOS, push approvals), CC Pocket (OSS WebSocket bridge), Nimbalyst Mobile [search summaries]. Funding/traction for these: UNVERIFIED.
- Gap for all of them: none is E2EE-by-default with no vendor server; that is Dial's only differentiator, and few coding-agent users select on it.

**(c) Asset reality (verified locally)**
- Dial: `dial-sdk/packages/dial-supervisor/` is a real, tested package: CLI verbs notify/ask/replies/wait/link/status/mcp (README.md:36-67), src/ (mcp.ts, sync.ts, lock.ts, matching.ts), tests (cli, mcp, durability, cli-process), host configs for Claude Code plugin, Cursor, Codex, VS Code, Zed, Windsurf. Strong design: exactly-once via request-id, crash-journaled inbound, supervisor-only sender filter.
- Blockers: **not published** (`@dial` npm scope unclaimed; every `npx` line and host snippet fails today; README.md:3-9). Testnet only (+008 numbers). Supervisor must also install the Dial app (TestFlight iOS), so onboarding friction is high. The manual e2e run against the testnet operator is not in CI (docs/agents/dial-supervisor.md:212).
- Missing vs competitors: no tool-permission hook (it is an ask-the-human MCP tool the agent chooses to call, not an intercept of Claude Code's permission prompts), no session view, no steering of a running session, no diff review. It is "agent texts you", not "remote control".
- Suwappu: nothing relevant. Policy engine/approvals (api-ts/src/services/ApprovalService.ts) are for money, not coding agents. Cross-reference only; I did not deep-read these files.

**(d) 14-day solo scope**
- Days 1-2: claim npm scope or switch to an unscoped name (e.g. `dial-supervisor`), publish, fix npx snippets, verify on a clean machine.
- Days 3-6: add a Claude Code `PermissionRequest`/`PreToolUse` hook command that calls `ask` and blocks until a reply, which gives real "approve from phone". Cursor/Codex hooks equivalents if available (UNVERIFIED).
- Days 7-9: reply shortcuts (approve/deny/always), request summaries, timeouts mapped to deny.
- Days 10-12: 60-90s demo; HumanLayer-migration post/HN/r/ClaudeAI.
- Days 13-14: measure installs and pairings. Kill criterion: <20 pairings.
- Risk: Dial invite-gating and testnet restrict top-of-funnel; Telegram/ntfy transport would widen reach but dilutes the Dial pitch.

HANDOFF
agent: sdk-dev
task: Optional only if founder wants a Dial hook. In dial-sdk/packages/dial-supervisor, rename/claim the npm package and publish; add a `permission-hook` CLI verb for Claude Code PreToolUse that runs `ask` then `wait` and exits allow/deny; update hosts/claude-code snippets and README. Acceptance: clean-machine `npx` init to phone approval of a Bash command.
files: dial-sdk/packages/dial-supervisor/README.md:3-9,36-67; dial-sdk/packages/dial-supervisor/src/mcp.ts; dial-sdk/docs/agents/dial-supervisor.md:212
risks: Not Suwappu work. Cross-repo (Dial). Publishing under an unclaimed scope is irreversible-ish. Testnet-only dependency. No MONEY-PATH.

## #3
**Verdict: do not lead with Idea #3 as a standalone consumer product. A thin version (a "Dial-reachable local-model agent with approval-gated payments") is shippable in 14 days, but only as a demo of the Dial and Suwappu stacks. As a business it faces crowded, well-funded competitors and a market that already gives private AI away.**

**(a) Market (dated; third-party figures are UNVERIFIED)**
- Private AI is a real, paid category, but price points sit at $9.99-$14.99/month.
  - Venice: Sacra estimates ~$110M ARR in Aug 2026 (up from ~$10M at end of 2025). A separate Zurb article says $70M+ ARR and 3M+ users. The sources disagree; both are third-party estimates. [Sacra](https://sacra.com/c/venice-ai/), [Zurb](https://radar.zurb.com/article/privacy-just-became-a-feature-people-will-pay-for)
  - Venice announced a $65M Series A at a $1B valuation on 2026-07-01. [tech-insider](https://tech-insider.org/private-ai-chatbot-duck-ai-venice-lumo-maple-chatgpt-claude-2026/) (the less independent source).
  - Proton Lumo is bundled free into Proton Unlimited ($14.99/month, or $9.99/month billed annually). Lumo 2.0 shipped 2026-06-30. [Sacra](https://sacra.com/chat/h/42a119b1-c5a1-4af2-9582-9fe61a8d6929/), [Proton](https://proton.me/id/blog/lumo-2)
  - Maple's entry plan is $9.99/month (Maple's own guide, so a biased source).
- Demand signal: Confer (Moxie Marlinspike, launched Dec 2025) drew heavy press. Its free tier is 20 messages/day. [TechCrunch 2026-01-18](https://techcrunch.com/2026/01/18/moxie-marlinspike-has-a-privacy-conscious-alternative-to-chatgpt)
- I found no hard user or revenue figures for Confer, Lumo, Duck.ai or Maple.
- UNVERIFIED: demand for a private AI you reach by text message. No search result covered a Telegram/WhatsApp private-AI assistant.
- UNVERIFIED: demand for an assistant that pays. x402 volume is tiny (~$1.6M-24M/30d), and the leading agent-payment startups (the YC cohort) are already crowded.
- Who pays: privacy-conscious prosumers and crypto-native users, at about $10/month. This segment is small, and a solo founder cannot reach it cheaply.

**(b) Competitors**
1. Confer (Marlinspike): E2EE via a TEE. Funding is not found in the sources I checked (UNVERIFIED). Apps for iOS, macOS and Android. Gap: no messaging identity, no payments, no local models.
2. Venice: $1B valuation; revenue per Sacra. Gap: the model labels itself Anonymized, Private or E2EE depending on model, so it is not uniformly E2EE.
3. Proton Lumo: distribution through the Proton base. Gap: not agentic, no payments.
4. Maple AI and Privatemode: attested enclaves; funding not found. Gap: same as Confer.
5. DuckDuckGo Duck.ai: free, bundled. Gap: not E2EE.
6. Local stacks (Ollama, LM Studio, Jan): free. Gap: no remote phone access and no E2EE transport.
7. Signal: there is no Signal AI product I could find, so "Signal meets ChatGPT" is an open slot. The slot is open mainly because Confer is already staking it out.
- Strategic read: the enclave players win on frontier-model quality. A local 3B-8B model loses on quality. Your angle is a different trade-off (data never leaves your hardware, and the assistant is reachable over E2EE from a phone), not a better assistant.

**(c) Asset reality (verified in code)**
- Dial side, a real foundation:
  - `dial-sdk/crates/dial-agent/src/{main,lib,env}.rs` is a Rust daemon with tests. Per the spec, it is a text and call-signaling daemon only; the daemon carries no media.
  - `dial-sdk/specs/dial-autonomous-agent.md` specifies a daemon that gives any local OpenAI-compatible model (Ollama, llama.cpp) a `+008` address.
  - Tools: `send_message`, `remember`, `set_reminder`, `sleep`, `update_call`. Memory is persistent, and retry dedupe is built in (spec lines 120-200).
  - Spec line 130: "No shell, no filesystem, no network tool in v1."
  - The spec's acceptance checklist (lines 277-343) is ticked, including a smoke test against Ollama `llama3.2:3b` (a text gets a reply, the exchange lands in memory). It is a spec checkbox, not an independent run. I did not find the implementation of the autonomous-agent daemon itself (the glob returned only the spec and a doc); I only confirmed the dial-agent crate.
  - The spec calls out model weakness explicitly: llama3.1 8B never called `schedule_wake`, and a 3B model messaged itself.
  - Distribution is not done. The spec lists "container image and publish workflow" as out of scope, and the daemon runs from a checkout or `cargo install`.
  - `dial-sdk/packages/dial-supervisor/package.json` is version 0.1.0; nothing is on npm.
  - dial-agent talks to the `+008` testnet, which is invite-gated.
- Suwappu side:
  - `api-ts/src/services/ApprovalService.ts` (25 hits for approve/sign_url/export terms) and PolicyService and the seal receipts in the repo give the pieces for "ask human before paying".
  - The hosted MCP quote endpoint is keyless.
- Missing: any bridge between the two.
  - Spec line 130 gives the agent no network tool, so it cannot call Suwappu.
  - The spec's own reasoning ("before there is a policy layer") is exactly what PolicyService and ApprovalService could supply, but I did not find an integration.
- Maturity note: Suwappu's real-user count is ~0, and the MPC signer is unaudited. Keep payments to approval-gated quotes or sign_url links (human signs) rather than custody.

**(d) 14-day solo ship**
- Days 1-3: add a `pay` or `quote` tool to the autonomous agent that calls the hosted Suwappu MCP (keyless quotes) over HTTP. Return a `sign_url`, so the human signs on their own device.
- Days 4-6: bridge to the Suwappu approval flow. Show an "approve this spend" message in the Dial thread and have the human approve in-thread, with the hash-chained audit and seal receipt returned as the reply.
- Days 7-9: package it. A container image or a `cargo install` script, with an Ollama model pre-pulled. Publish `@dial/supervisor` (and any other package a user needs) to npm. Make a 90-second screen recording.
- Days 10-14: invite 10-20 people from the Dial TestFlight and the privacy-leaning crypto community. Measure the number of paying-flow completions. Do not build billing, a web UI or multi-user hosting.
- Honest limits: a 3B-8B model's tool-calling reliability is the main risk, and the Dial authors observed it failing. The demo should script the payment tool to be deterministic (a parsed command, not free-form model choice) for the first release. Do not claim "ChatGPT-level".
- Decision rule: if after 14 days fewer than ~5 outside people complete a real flow, treat this as a Dial-stack demo asset and move on rather than building further.

HANDOFF
agent: none
task: Optional, only if founder picks Idea #3: have bot-dev or api-ts-dev (cross-repo, so the founder may need to pick the repo) add a `quote`/`pay` tool to the dial-autonomous-agent that calls the Suwappu hosted MCP for keyless quotes, plus an approval round-trip in the Dial thread using ApprovalService. Acceptance: a text to a +008 address on a local Ollama model yields a quote and a sign_url, and an approved request produces a sealed audit receipt.
files: dial-sdk/specs/dial-autonomous-agent.md:120-132 (tool table, no-network constraint), dial-sdk/crates/dial-agent/src/lib.rs, api-ts/src/services/ApprovalService.ts, api-ts/src/services/PolicyService.ts (not read in detail)
risks: MONEY-PATH if the agent can ever initiate transfers (keep to sign_url / human-signed only); cross-repo, cross-stack (Rust plus TS). Prompt-injection from anyone who knows the number is a real threat, since the agent receives text from arbitrary senders. AEGIS is observe-mode only. Treat all competitor funding and revenue numbers above as UNVERIFIED third-party estimates.

## #4
**Verdict on Idea #4: NO-GO as framed, because Dial has no PSTN and the market is crowded and well funded on both sides. Cheapest valid test is a Suwappu-agnostic, non-voice 14-day wedge, or skip.**

**(a) Market (dated)**
- Money is flowing to voice AI. Funding reportedly rose about 8x year on year ([PYMNTS](https://www.pymnts.com/?p=2713736), date UNVERIFIED).
- Business-side AI receptionist is proven. Retell AI is reported at roughly $50-60M ARR, up 650% YoY ([Sacra](https://sacra.com/research/retell-ai-60m-yr-up-650-yoy)). The figure is third-party or company-reported, and a second source says $50M.
- Consumer-side demand is real but small. Pine AI reports $3M+ saved for consumers on bills from AT&T, Verizon and T-Mobile (self-reported) ([fintech.global, 2025-12-03](https://fintech.global/2025/12/03/pine-launches-ai-agent-as-it-secures-25m-series-a/)).
- Who pays:
  - SMBs pay for receptionist subscriptions.
  - Consumers pay about $30/mo for Pine (same source), or a share of savings.
- UNVERIFIED: a total market size figure. I did not find a credible one.

**(b) Competitors**
- Pine AI, consumer side: $25M Series A (Fortwest, Dec 2025). Does on-hold waiting and negotiation. Subscriptions from $30/mo, plus a free tier ([SiliconANGLE, 2026-05-06](https://siliconangle.com/2026/05/06/pine-ai-aims-consumer-ai-agent-complex-customer-service-interactions/)). This is the direct rival, and it holds the consumer-side lead.
- Beside: $32M raise (Nov 2025). AI receptionist for SMBs, claims millions of calls a month ([Fortune](https://fortune.com/2025/11/11/beside-ai-voice-startup-raises-32-million-ai-receptionist-for-small-business/)).
- Retell AI: about $60M ARR, developer platform plus receptionists.
- Vapi: $50M Series B (May 2026) ([SiliconANGLE](https://siliconangle.com/2026/05/12/vapi-nabs-50m-make-voice-ai-human/)).
- Newo: $25M. Phonely: $16M Series A ([ContentGrip](https://www.contentgrip.com/phonely-series-a/)). Simple AI: $14M seed (Feb 2026) ([BusinessWire](https://www.businesswire.com/news/home/20260210526354/en)).
- Smith.ai (human plus AI hybrid), Goodcall (cheap, single-location), Rosie (flat-rate for solo operators), Bland (outbound developer tool), Synthflow (custom agents). None of these has a verified ARR or funding figure.
- Gaps:
  - The SMB receptionist space has many funded players and is commoditizing at the infrastructure layer (Vapi, Retell).
  - The consumer side has fewer players. The remaining gaps are trust, privacy and per-task pricing.
  - UNVERIFIED: whether Google Duplex-style or big-tech features are closing the consumer gap. I did not research it.

**(c) Asset reality (local code)**
- Dial has no PSTN, SIP or carrier integration. `dial-sdk/ROADMAP.md:64,91,100` explicitly says "not a public carrier service" and lists "E2EE, SIP, PSTN, or voice" among things not delivered. A grep of the repo found zero Twilio or Telnyx references.
- `dial-sdk/docs/adr/2026-08-23-dial-name-root-and-dns-bridges.md:116` only says gateways crossing PSTN must use authorized public identities. That is a design note, not code.
- Dial calls are P2P between Dial endpoints (`crates/dial-core/src/calling.rs`, `crates/dial-provider-http`). A business's phone number is not a Dial endpoint, so the core premise (calling an arbitrary business) is not implemented.
- `dial-sdk/crates/dial-autonomous-agent` is a persona chat "brain" with 30+ personas, memory and a daemon (`src/brain.rs`, `memory.rs`, `daemon.rs`). Grep found no STT/TTS or telephony matches there, and the `voice|audio` hits are mostly persona prose. I did not read the code in depth, so the claim that no speech pipeline exists is UNVERIFIED.
- Suwappu contributes nothing to this idea. Its assets are the swap router, the policy engine and approvals. One reusable concept is human-approval gating (`api-ts/src/services/ApprovalService.ts`), which is conceptually relevant to "agent asks before committing." I did not verify it against this use case.

**(d) 14-day solo ship**
- Realistic only by renting the stack: Twilio or Telnyx SIP, plus Vapi or Retell for STT/LLM/TTS. That is a thin wrapper on infrastructure that Retell and Vapi already sell, with no Dial or Suwappu moat.
- Narrow wedge: a consumer "cancel / dispute / wait on hold" concierge. A hold-and-callback bridge is cheap: the AI waits on hold and rings the user's phone when a human answers. Pricing would be per task, about $5-10. Ship a landing page, a manual-assisted concierge (a human does the call at first), and 10 paid pilots.
- Do not build the SMB receptionist. It is the most crowded segment and needs sales and onboarding bandwidth a solo founder lacks.
- Legal risk, UNVERIFIED: FCC and state rules on AI voice, call-recording consent, and impersonation. Check the TCPA position on AI-voiced calls before launch.
- Kill criteria: fewer than 5 paid tasks in 14 days means drop it.

**Recommendation:** Do not make this the main bet. It is a distinct, crowded business that reuses almost none of the existing code. If pursued at all, do the manual-assisted wedge as a demand test only, with no Dial integration.

HANDOFF
agent: none
task: Founder decision needed. If the demand test is wanted, spec it as a landing page plus a manual concierge on Twilio and Vapi/Retell, 14 days, with kill criteria of fewer than 5 paid tasks.
files: dial-sdk/ROADMAP.md:64,91,100; dial-sdk/docs/adr/2026-08-23-dial-name-root-and-dns-bridges.md:116; dial-sdk/crates/dial-autonomous-agent/src/brain.rs; dial-sdk/crates/dial-core/src/calling.rs
risks: Legal exposure on AI-voiced calls and call recording (UNVERIFIED). Not MONEY-PATH, no migration, no cross-stack change.

## #5
**Verdict: do not build this as a standalone product.** Agent naming/identity is crowded and standards-driven, and the +0 registry is a testnet, invite-gated, human-phone-number system with no demand signal. It is only worth a small, cheap bolt-on to Dial (agent +0 numbers with a signed receipt) and not a Suwappu pivot.

**(a) Market and demand**
- ERC-8004 agent registrations are large but hollow.
  - One tracker reports 1.33M agents across 24 chains as of 2026-10-23, and trackers disagree on counting and include testnets (stablecoininsider.org/erc-8004, via agenteconomy.to).
  - An arXiv study found only 67 of 10,000 sampled agents expose service records (arxiv.org/abs/2606.26028).
  - ethresear.ch found about 95% of agents have zero clients (ethresear.ch/t/does-erc-8004-form-an-agent-to-agent-trust-network/25322).
- Registration is cheap or free, so there is no pricing signal. I found no evidence that anyone pays for agent names or phone numbers. UNVERIFIED: any per-name pricing for ANS, ENS-for-agents or ERC-8004.
- The payers that exist are enterprises buying agent KYA and verification, not developers buying names.
  - Vouched raised a $17M Series A in 2025-09 for its KYA suite (businesswire.com/news/home/20250904708838/en).
  - Helix raised $6.2M pre-seed on 2026-11-11 for voice verification of humans, not agents (techcrunch.com/2026/11/11/siri-co-founder-backs-helix-for-its-voice-id-tech/).
  - Neither is a naming registry.
- I found nothing on demand for phone numbers issued to agents (the search returned no results on that angle).

**(b) Competitors, with gaps**
1. **GoDaddy ANS.** DNS and PKI-anchored names, a verified badge, dual certificates and a transparency log. It is heading to the Linux Foundation, with Cloudflare, Cisco, Salesforce and Infoblox backing, plus an IETF ANS v2 draft from 2026-04 (diginomica.com, godaddy.com/ans). Gap: no phone and voice reach, and enterprise-first. This is the biggest threat because it owns the incumbent distribution (domains).
2. **ERC-8004 (Ethereum standard, draft).** Mainnet since early 2026. Gaps: per-chain, spam-heavy, almost no liveness (see (a)).
3. **ENS (ENSIP-25/26).** Bidirectional verification of an ENS name against an ERC-8004 entry (ens.domains/blog/post/ensip-25). It is the closest analogue to "ENS for agents" and is already positioned there. Gap: crypto-only audience.
4. **Cloudflare Web Bot Auth and Signature Agent Card.** Verifies agent traffic at the CDN layer, partnered with GoDaddy in 2026-04 (itbrief.com.au). It is a distribution moat. Gap: it verifies, it does not name or route.
5. **Vouched KYA.** $17M, enterprise identity verification.
6. **Unruggable (ERC-8217, ERC-8122) and the dinamic.eth multi-tenant registry.** Small, grant-funded ENS-ecosystem builders (discuss.ens.domains). Their funding amounts are UNVERIFIED.
7. **A2A Agent Cards (the protocol spec).** Not a competitor, and I did not research it. UNVERIFIED: how it relates to Skyfire and KYAPay, which my search did not cover.

No competitor offers a +0 number that works across messaging and calls, but I found no evidence that anyone wants one. That makes it a differentiator and not yet a market.

**(c) Asset reality**
- **DNN registry exists and is real but narrow.** It is a Cloudflare Worker with Durable Objects at dial-sdk/services/dnn-registry/src/http/worker.ts:47-124. Its routes are /v1/registrar, /v1/protocol-capabilities, POST /v1/registrations, reservations (POST, GET, DELETE), GET /v1/registrations/:n, PUT and GET /v1/routes/:addr, and GET /v1/manifests/:n.
- It issues Ed25519-signed registration receipts, with mutation-auth, durable registration, release and reservation tests under services/dnn-registry/tests/. Its network is testnet (+008) and invite-gated, per your context.
- **No agent concept in the registry.** Registrations map a number to a wallet-rooted identity and a route/manifest. I saw no agent type, capability schema or A2A Agent Card linkage. A manifests endpoint could be extended, but that is a design inference.
- The generic registry spec (specs/09-registry.md) describes SDK profile, room and ENS search, not DNN. It is not evidence for this idea.
- **Suwappu side.** Verification primitives exist: the policy engine, approvals and hash-chained audit (api-ts/src/services/PolicyService.ts, ApprovalService.ts), and seal receipts (api-ts/src/lib/seal.ts). I did not inspect them for this task. They are building blocks, not a registry.
- None of it has been published to npm and none has external users (your stated facts). The Suwappu distribution record (about 8 PRs closed unmerged, 12 repos with 0 stars) suggests discovery and integration attempts do not convert.

**(d) 14-day solo ship (small and honest)**
- Days 1-4: a `kind=agent` registration in dnn-registry. A manifest carries an A2A-style Agent Card URL, MCP endpoint and capabilities, signed by the wallet key.
- Days 5-8: a public GET /v1/agents/:number resolver, plus an ENSIP-25-style bidirectional proof (an agent card lists the +0 number, and the registry signs back).
- Days 9-11: publish a tiny @dial/agent-id verify package, and let dial-agent and @dial/supervisor register themselves. This is dogfood, not market validation.
- Days 12-14: a landing page and one real integration, for example Suwappu's hosted MCP with a +0 identity.
- Success metric: external registrations. If there are fewer than 10 in 30 days, stop.
- Cost and risk: low code risk, but it spends scarce attention against GoDaddy and ENS standards momentum. It is not a MONEY-PATH. Keep it testnet-only.

HANDOFF
agent: none
task: Decision for the founder. Skip as a standalone Suwappu or Dial product. If proceeding anyway, a `kind=agent` registration and /v1/agents resolver in dial-sdk/services/dnn-registry, with a hard 30-day kill metric of 10 external registrations.
files: dial-sdk/services/dnn-registry/src/http/worker.ts:47-124; dial-sdk/services/dnn-registry/src/providers/cloudflare/durable-number-object.ts; api-ts/src/lib/seal.ts (not inspected)
risks: Not MONEY-PATH. Cross-repo (dial-sdk only). UNVERIFIED claims: pricing, Skyfire/KYAPay, A2A card integration rates, competitor funding amounts other than Vouched and Helix.

## #6
VERDICT: Weak fit as a standalone product. Build only as a 14-day thin wedge (not a company), and only if it reuses Suwappu's existing code and attaches to Dial's supervisor. Market is crowded and funded; "open-source spend firewall" already has several tiny OSS clones. Distribution, not code, is the founder's bottleneck (0 stars on 12 repos, ~8 PRs closed), and a new OSS repo does not fix that.

(a) MARKET (dated)
- Dealroom: 112 startups let agents hold money / spend within limits; $115M raised in 2026, more than all of 2025 (https://dealroom.co/charts/startup-stack-ai-spending; no exact date seen).
- Sapiom: $15.75M seed Feb 2026 (Accel), $35M Series A Aug 2026 (Dragonfly per TNW), both for per-agent budgets and tool-cost routing (https://siliconangle.com/2026/02/06/sapiom-reels-15-75m-equip-ai-agents-payment-features/, https://thenextweb.com/news/sapiom-35m-series-a-ai-agent-cost-routing).
- Runlayer $30M (Fortune, 2026-06-24); Kindo $30M; Kontext Security $4M (agent runtime controls); Mintive $7M seed (Nov 2026); Natural $30M Series A (Jul 2026). Mintive/Natural/Kindo come via search snippets only, so UNVERIFIED in detail.
- Incumbents: Mercury agent virtual cards (Aug 2026, https://fintech.global/2026/08/12/mercury-puts-ai-agents-on-the-company-spending-line/); Ramp agent spend controls (https://ramp.com/blog/ai-agent-spending-controls); Portal26 token caps (Apr 2026).
- Demand: money is VC-funded supply; real paid demand is thin (x402 ~$1.6M-24M/30d per your context). Pricing/who pays: UNVERIFIED. Likely enterprise/fintech teams via cards/platforms, not individual devs paying for OSS.

(b) COMPETITORS (top 5-8)
1. Sapiom (~$51M total): hosted budgets and routing; gap is closed/hosted, not self-host OSS.
2. Mercury / Ramp agent cards: bank-grade, fiat card rails; gap is no crypto/x402 and no verifiable receipts.
3. Runlayer ($30M): MCP governance; gap is not payment-focused.
4. Kontext ($4M), Portal26: runtime and token controls; gap is LLM-cost focus, not on-chain spend.
5. AgentPay MCP (OSS): budget caps plus human approval, x402 and Stripe MPP. Adoption not verified; one listing showed ~109 weekly downloads.
6. tryx402 (MIT, PyPI): budget guard, ledger, CLI, MCP. Self-described "first OSS governance layer".
7. SpendVeto: proxy holding custody and signing after policy and approval checks.
8. @deepfirstsearch/agent-pay (Base on-chain budgets), ferrumdeck-policy (x402 in Rust).
Sources for 5-8: web search snippets, no star counts or funding seen (UNVERIFIED traction). Your context also names ~28 YC firms (Agentcard, Locus, Allowance, OneCLI, etc.) and HumanLayer, now acquired by Factory. Funding for Agentcard, Locus, Skyfire, Payman: not found in my searches, UNVERIFIED.
Gaps that remain: OSS options are tiny solo projects. None found combining hash-chained audit, commit-reveal receipts, and chat approvals in one tool (UNVERIFIED that none exist; I did not read their code).

(c) ASSET REALITY (read, not run)
- api-ts/src/services/PolicyService.ts: real. evaluate() returns allow/block/require_approval and writes append-only policy_decisions rows. It enforces daily, session, and velocity caps, with kill switches at several scopes. reserveApprovalAllowance (lines ~76-105) is atomic: one DB transaction with a per-org advisory lock, plus a partial unique index for at-most-once, with a release/compensation path. This is mature money-path design. The file itself says enforcement is hard only for custodial/Suwappu-issued keys and advisory for self-signed EOAs. Tied to Drizzle/Postgres and swap-intent shapes (chain, token, valueUsd), so not a generic proxy as written.
- api-ts/src/services/ApprovalService.ts and audit.ts exist. audit.ts has ~26 hash/chain hits. __tests__/auditVerifyChain.test.ts exists, so chain verification is tested. I did not read their bodies.
- api-ts/src/lib/seal.ts: commit-reveal receipts with sha256-canonical-v1, RFC8785-style canonicalisation and cross-language encoding notes. It seals trading theses, not payment receipts, so it needs adapting.
- ApprovalService.ts has no Telegram references. The chat-approval channel lives elsewhere, likely in the Python bot. Not verified; check bot/ before promising it.
- NOT found: any HTTP-proxy or x402-interception layer. Grepped only the files above, so the claim covers those files only; check the x402/MPP code in api-ts separately.
- dial-sdk/packages/dial-supervisor/package.json (@dial/supervisor) exists. I did not read the code. It is a natural phone-approval channel, but nothing is published to npm.
- Other GitHub repos: UNVERIFIED.

(d) 14-DAY SOLO SHIP (feasible, scoped)
- Days 1-4: extract the policy core (caps, velocity, kill switch, approval reservation) from Drizzle/swap intents into a storage-agnostic TS package with SQLite and Postgres adapters. This is the riskiest step because the concurrency guarantees must survive the port.
- Days 5-8: a minimal HTTP forward proxy for x402 / MPP / generic spend endpoints (402 challenge, policy check, pay or hold). Receipts reuse the hash-chained audit and seal.ts canonicalisation. Ship a `verify-chain` CLI.
- Days 9-11: approval channels, with Telegram reuse and a @dial/supervisor adapter.
- Days 12-14: docs, a 60-second demo, and a Docker image. Publish to npm (Dial has published nothing).
- Do not claim "firewall" for self-signed wallets (advisory only). Skip MPC. Do not claim PQ or TEE.
- Risks: MONEY-PATH if it ever holds keys. Ship non-custodial and quote-only first. Cross-stack: policy logic lives in api-ts, approvals may live in the Python bot.

RECOMMENDED POSITIONING IF PURSUED: "verifiable receipts + hash-chained audit" is the only differentiator against AgentPay, tryx402 and SpendVeto. Validate with 5 conversations with agent builders before writing code, since the shipping and distribution history so far shows 0 traction.

HANDOFF
agent: none
task: Decide go/no-go. If go, dispatch api-ts-dev to extract PolicyService/audit/seal into a storage-agnostic package (days 1-4) after founder validates demand with 5 builder calls.
files: api-ts/src/services/PolicyService.ts:71-106, api-ts/src/lib/seal.ts, api-ts/src/services/audit.ts, api-ts/src/services/ApprovalService.ts, api-ts/src/__tests__/auditVerifyChain.test.ts, dial-sdk/packages/dial-supervisor/package.json
risks: MONEY-PATH if custody added; cross-stack (Python bot for Telegram approvals not verified); competitor traction and pricing UNVERIFIED; "no direct competitor combines audit+receipts" UNVERIFIED

## #7
**Verdict: do not build "text-my-crypto" as a consumer remittance product. The category is validated but it is a licensed-money-transmission, fiat-corridor, distribution-heavy business. A solo, ~$0 founder with ~0 users has no edge in it. The only defensible 14-day slice is a narrow demo: a WhatsApp/Telegram agent that quotes and routes USDC and shows a UPI/Pix cash-out hand-off via P2P.me. Treat it as a feature of an existing asset, not a company.**

**(a) Market (dated)**
- Global remittances are about $905B in 2024 (World Bank, as reported). Average cost is 6.36% (World Bank RPW, Q3 2025). Stablecoin-funded cost is a ~1% median (Borderless.xyz, Q3 2026). These mix years and median vs average, so "84% cheaper" is apples-to-oranges. All of this is from secondary aggregators.
- Pix completed 97.8% of stablecoin-funded payouts and Mexico's SPEI 98.6% (Borderless). I found NO UPI stablecoin remittance data. UNVERIFIED: any India demand claim.
- Who pays: the sender pays a fee or FX spread. Félix reportedly charges about $2.99 per transfer, and its USD to MXN settlement runs on USDC via Bitso.
- Sources: [BIS WP 1385](https://www.bis.org/publications/working-paper-1385-competing-rails-crossborder-payments-banks-fintechs-and-stablecoins.pdf), [crypto.news](https://crypto.news/stablecoin-remittances-cost-gap-borderless-report/), [Solana Foundation, 2026-09-08](https://solana.com/el/news/report-stablecoins-are-reshaping-remittances).

**(b) Competitors**
- **Félix Pago** (WhatsApp, US to LatAm): $200M raised 2026-09-01. Unchained reports $87M a16z-led equity plus a $113M credit facility. Sources label it Series B or C, and one reports a $1.4B valuation. It claims >$8B processed since 2022 (aggregator, UNVERIFIED). It is expanding to Colombia, Ecuador and Peru. Gap: it is US-to-LatAm only, with no India, no self-custody and no agents. Sources: [Unchained](https://unchainedcrypto.com/felix-raises-200-million-in-a16z-led-round-to-take-stablecoin-rails-beyond-remittances/), [Bloomberg Línea](https://www.bloomberglinea.com/latinoamerica/mexico/felix-pago-recauda-us200-millones-para-ampliar-sus-servicios-financieros/).
- **Bitso**: the Félix on/off-ramp partner and also a rival. It is licensed and large in LatAm. Source: [Finextra](https://finextra.com/newsarticle/41461/bitso-and-flix-pago-team-on-crypto-powered-remittances-via-whatsapp).
- **Kotani Pay** (Africa): $2M pre-seed, which is old. Source: [TechCrunch](https://techcrunch.com/?p=2593722).
- **Sendwave/Zepz, Remitly, Wise**: incumbents. Zepz launched a Sendwave wallet in 100+ countries (BIS).
- **Not found by search**: Kash, Noah, MiniPay (UNVERIFIED), and Yellow Card and Blockradar as 2026 data points (UNVERIFIED).
- **P2P.me**: an on-chain USDC P2P ramp with UPI, Pix, QRIS and others, which Suwappu already integrates (see (c)). It is a possible supplier, not a rival.
- **Common gap among competitors**: they own licenses, FX liquidity and corridor operations. None is crowded on "agent-native chat wallet", but nobody has shown demand for it either.

**(c) Asset reality**
- **Real**: WhatsApp stack in `bot/services/whatsapp_{service,router,conversation,templates,voice,queue,meta_flows}.py`. The router has 24 hits for send/transfer/swap/balance. I did not read the bodies, so I cannot rate maturity, and the production WhatsApp webhook is `POST /webhook` per CLAUDE.md.
- **Real**: P2P ramp layer in `bot/services/p2p_providers.py`. NoOnes and P2P.me clients are gated on config.
  - Line 368: P2PME_CURRENCIES.
  - Lines 370-377: rails mapping INR to UPI, BRL to Pix, plus QRIS, MercadoPago and PagoMovil.
  - P2P.me settles USDC on Base non-custodially, and the webapp completes the order via `@p2pdotme/sdk`.
  - There is also `api-ts/src/services/P2PService.ts` and `webapp/src/config/p2pme.ts`.
  - Maturity is UNVERIFIED. I found no evidence of live orders, and the project has 0 completed swaps.
- **Real, from the brief (not re-read)**: the 25-provider swap router (`bot/services/swap_engine.py`), the policy/approval/audit stack for spend limits, and keyless hosted MCP quotes.
- **Missing**: I found no custody or KYC, no licensed fiat-payout partner, and no direct UPI/Pix payout. Pix and UPI exist only as P2P.me order rails the user completes themselves. A grep of dial-sdk found no WhatsApp or remittance code, only one ADR mention, so any Dial integration would be new work.
- **Unverified**: the other GitHub repos, including text-my-crypto, DialPay and Payphone (not cloned). The p2p_providers file docstring says "verified Jun 2026".

**(d) 14-day solo scope (what is shippable)**
- Days 1-4: chat commands on WhatsApp and Telegram for "send $X USDC to <address or handle>" and "cash out to UPI/Pix". Reuse the existing swap router and policy/approval engine, so the user approves in chat with a daily cap.
- Days 5-8: a P2P.me hand-off link for the INR/BRL cash-out, with a transparent quote (swap fee plus P2P spread vs the ~6% incumbent average).
- Days 9-12: a landing page and a 60-second demo video. Recruit 10 real users from Dial or friends in India and Brazil, with a $5 cap each.
- Days 13-14: measure completed transfers. The kill criterion is under 5 completed cash-outs.
- Not shippable in 14 days: custody, KYC, own fiat payout, licensing, and anything touching the unaudited MPC signer.

**Risks**
- Money transmission and KYC liability if Suwappu ever holds funds. Keep it non-custodial and hand-off only.
- Distribution is the real blocker: ~0 users, 8 closed PRs and 0 stars all point to a go-to-market gap, not a missing feature.
- Félix has $200M and a 3-year head start.

HANDOFF
agent: none
task: Conductor decision. If pursued, dispatch bot-dev to add chat intents in bot/services/whatsapp_router.py and whatsapp_conversation.py that call the existing swap and p2p_providers paths. Acceptance: a WhatsApp user gets a quote and a policy-gated approval link, and a P2P.me INR/BRL cash-out link. No custody. First, scout should verify which WhatsApp and P2P paths are live (read the router and conversation bodies, not just grep counts).
files: bot/services/p2p_providers.py:366-377, bot/services/whatsapp_router.py, bot/services/whatsapp_conversation.py, api-ts/src/services/P2PService.ts, webapp/src/config/p2pme.ts
risks: MONEY-PATH (swap and approval flow); regulatory (money transmission) if custody is ever added; cross-stack (Python bot and api-ts P2P services); market and distribution risk is high.

## #8
**Verdict on Idea #8 (agent-to-agent marketplace): do not build a marketplace. Two-sided marketplaces need liquidity you cannot seed with ~0 users and ~$0. If you test it at all, ship a 14-day "pay-on-delivery for one narrow job" demo and measure whether anyone outside the founder uses it. Skip it if the aim is revenue.**

**(a) Market (the numbers conflict and are mostly self-reported)**
- x402 volume figures vary widely by source. One dev.to post claims 165M+ transactions and $50M+ volume as of May 2026. Your earlier $1.6M-24M/30d figure is the better-filtered one. The claim is UNVERIFIED because the post is not an audited source. https://dev.to/kirothebot/the-x402-revolution-165m-transactions-later-agent-to-agent-payments-are-real-1o0k
- Virtuals ACP is the closest real agent-hires-agent market. It self-reports about $470M "agent GDP" and 1.77M jobs (Feb 2026). Fundstrat's Q2 2026 update gives protocol revenue of only about $452K, with volumes moderating. GDP is therefore far larger than revenue. Virtuals also subsidises supply with up to $1M/month through its Revenue Network. https://fundstrat.com/wp-content/uploads/2026/06/20260624-Digital-Asset-Strategy-Virtuals-Protocol-–-Growing-Agentic-GDP-Q2-Update.pdf and https://techintelpro.com/news/ai/agentic-ai/virtuals-protocol-launches-revenue-network-for-ai-agent-commerce
- Agent-payment startups raised about $115M across 14 rounds in 2026, per Dealroom (single tracker). https://dealroom.co/charts/startup-stack-ai-spending
- No credible data found on who pays for agent-to-agent hiring outside crypto-token-subsidised flows. Real demand evidence is thin. UNVERIFIED: pricing norms. Observed jobs are cents to a few dollars.

**(b) Competitors**
- Coinbase Agentic.Market launched 2026-04-20. It is a discovery catalog for x402 services, with no escrow. https://www.theblock.co/news/business/2026-04-20-coinbase-incubated-x402-protocol-unveils-app-store-for-ai-bots-398123
- Virtuals ACP: discovery, escrow and evaluator in one protocol, on Base and now BNB. Real volume claims, but token-subsidised, and the "evaluator problem" is its known weak point. https://forkast.news/the-machine-as-buyer-virtuals-acp-and-the-evaluator-problem/
- ERC-8183 (draft standard): task escrow with client, provider and evaluator roles. It standardises exactly what Arbiter does, and the standard has no traction data.
- MeshLedger: Base escrow with a 3-tier dispute layer. Traction UNVERIFIED. https://dev.to/meshledger/agent-payment-protocols-compared-x402-vs-acp-vs-escrow-based-settlement-56l4
- Olas: $13.8M raised (Feb 2025), Pearl agent app store.
- Skyfire: $9.5M total (Coinbase Ventures, a16z CSX). The date and any 2026 traction were not found.
- Catena Labs: $18M seed reported by a tracker, UNVERIFIED.
- Fetch.ai: token-based, and I found no funding round. Nevermined: only a Dealroom mention, with no round size found.
- Gap across all of them: nobody has a trusted evaluator for non-code deliverables, and there is no human-reachable identity or approval layer. That gap exists, but the market for it is unproven.

**(c) Asset reality (local code)**
- Arbiter contract exists: near/arbiter-contract-v3/src/lib.rs has `create_escrow`, `resolve`, `on_arbiter_result`, `on_payout`, `cancel_expired` and `reset_stuck`. It is hardwired to the testnet resolver `outlayer.testnet` (line 35). It is a hackathon artifact, not mainnet-ready, and I did not find an audit.
- Arbiter backend: api-ts/src/routes/arbiter.ts is explicitly a demo, mounted at /hackathon/arbiter only when HACKATHON_ARBITER=true. It serves recorded fixtures and "never fabricates a verdict". It cannot spend funds. Its verdicts are replays for GitHub PRs (`arbiter-github`, `arbiter-http`, `arbiter-wasm`), so only code and HTTP-terms verification exists, not general work.
- x402 payments: api-ts/src/middleware/x402Payment.ts and lib/x402Verify.ts, with multi-network config in config/x402Networks.ts. Test files exist, so it is more than a stub. Actual paid traffic is ~0 (founder-verified).
- A2A: api-ts/src/routes/a2a.ts handles `message/send` (line 592) and has an AEGIS observe-only scan. This is the A2A protocol surface, not a job market.
- Dial identity: dial-sdk has the DNN "+0" registry, but it is testnet and invite-gated, and DNS or identity ADRs sit in dial-sdk/docs/adr/. Agent docs are in dial-sdk/docs/agents/ (dial-agent, dial-webhook, dial-autonomous-agent, dial-supervisor). The README mentions a +0 number or DID model in about 30 places, but I did not verify any x402 or escrow integration. UNVERIFIED: any code linking Dial identity to Suwappu payments (grep found none in what I read).
- Missing for a real marketplace: a listing and discovery index, a job lifecycle API, mainnet escrow (NEAR, or an EVM contract for where x402 runs on Base and Solana), a general evaluator, reputation (only simulation scripts in near/arbiter-reputation/), and any supply or demand side.
- Cross-chain gap: x402 settles on Base and Solana, but Arbiter escrow is on NEAR testnet. Bridging them is a real integration cost.

**(d) 14-day solo scope, and what not to do**
- Realistic: a "pay-on-delivery for GitHub PR bounties via x402" demo. Days 1-5: take an x402 payment and call `create_escrow` on testnet. Days 6-10: run the existing arbiter-github path end to end with a real PR. Days 11-14: record a demo, publish the post and write up the flow.
- Not realistic in 14 days: mainnet escrow (needs audit), a general evaluator, a two-sided marketplace and Dial identity integration (testnet-only, invite-gated).
- Cost to the founder: attention drawn from Dial, which is the actively shipping asset, while Suwappu has had zero distribution success (~8 PRs closed).
- Better framing: treat Arbiter as a differentiator inside Dial or the supervisor flow ("agent asks human, pays on delivery") instead of a standalone marketplace.

HANDOFF
agent: none
task: None recommended. If the founder insists on a test, spec for api-ts-dev: wire the x402 payment verifier to the Arbiter `create_escrow` testnet call for one GitHub-PR-bounty flow, behind the HACKATHON_ARBITER flag. Acceptance: one live testnet end-to-end run with a recorded verdict and no mainnet funds.
files: near/arbiter-contract-v3/src/lib.rs:35,158,245; api-ts/src/routes/arbiter.ts:1-40; api-ts/src/middleware/x402Payment.ts; api-ts/src/routes/a2a.ts:592; dial-sdk/docs/adr/
risks: MONEY-PATH (escrow and payout); cross-stack (NEAR contract, api-ts and Base/Solana x402); unaudited contract; strategic risk of diverting attention from Dial. No migration is needed.

## #9
**Idea #9 (Execution Index): verdict is a weak standalone business and a decent credibility asset. Do not build it as a product. At most ship a 14-day static "Execution Report" as top-of-funnel for Suwappu.**

**(a) Market (thin demand evidence; no TAM figure found)**
- Demand shows up as free research and vendor marketing, not paid products.
  - Block Scholes x Bitget Wallet scores aggregators on price, slippage and fill reliability. This is vendor-sponsored. https://www.blockscholes.com/research/from-aggregation-to-execution-the-next-layer-of-onchain-trading-infrastructure-featuring-data-from-bitget-wallets-dex-aggregator
  - ClearTrace ships a free open Ethereum aggregator execution-quality dataset on HF/Kaggle. https://huggingface.co/datasets/andrewmaury/cleartrace-dex-execution-quality
  - Academic work already covers the topic: an arXiv "Quantifying Sub-Optimality in Routing for AMMs" paper (about 2 bps average loss), "Execution Welfare Across Solver-based DEXes" (arXiv 2503.00738), and a 2025 CEU thesis finding no single best aggregator.
- Pricing comparables are low. Birdeye analytics start around $39 a month and WebSocket access is $199 (search snippet, undated). 0x lists trade analytics as a feature (https://0x.org/pricing).
- Who pays is unproven: no evidence that any agent or router pays for a benchmark. Routers are the subject being benchmarked, so they have a conflict of interest. They typically promote the benchmark when it flatters them and ignore it otherwise.
- The agent-spend market is crowded and tiny, per the founder context (x402 volume about $1.6M-24M a month).
- UNVERIFIED: Kaiko and Dune pricing, and any TAM figure. My searches did not surface them.

**(b) Competitors and substitutes**
- ClearTrace: free and open, covers Ethereum only. Funding and traction are not visible.
- Block Scholes: a research and derivatives-data firm. Their report is paid and promotional. Funding UNVERIFIED.
- Dune community dashboards: free, and ClearTrace is built on Dune labels.
- Aggregators' own claims (Kyber, 0x, 1inch, Jupiter): marketing, not neutral.
- Academic papers: free and credible.
- CoW Protocol: has its own solver competition data. Details UNVERIFIED.
- Bitquery, Birdeye, CoinGecko/GeckoTerminal and DexScreener APIs: raw data vendors, not execution scoring.
- Gaps they leave: no continuous public benchmark across chains that is verifiable and tamper-evident, and nothing agent-native. The gap is real, but no one has shown willingness to pay for filling it.
- Funding and traction figures for these vendors were not found in my searches. UNVERIFIED.

**(c) Local asset reality (partial, and weaker than "benchmark" implies)**
- bot/services/execution_benchmark.py exists. It is a per-user percentile within a cohort for the same trade shape, with a k-anonymity floor (MIN_COHORT_USERS=5, lines 34 and 62+). It relies on pooled user fills, which are about zero here (0 completed swaps).
  - Its cohort-percentile design is the opposite of a public router-vs-router index. At the current user count the k=5 floor would suppress nearly everything.
- The same area has execution_receipt.py, execution_scorer.py and an API route at api/webapp.py:5202 (get_execution_benchmark). Tests exist in tests/test_execution_benchmark.py and tests/test_execution_receipt.py. I did not run them. I did not read the scorer or receipt files.
- Hash-chained audit and seal exist: api-ts/src/lib/seal.ts and api-ts/src/services/audit.ts. They are built for Autopilot decisions.
  - The Suwappu research doc (docs/research/2026-11-20-product-competitor-gaps.md:223) says sealing quotes is "inference", not shown to exist. The same doc flags a conflict about whether the 25-provider router backs the api-ts quote path or whether that path is a thin LI.FI/Jupiter wrapper.
- The 25-provider engine is in bot/services/swap_engine.py. I did not inspect it in depth.
  - Quote-only polling of 25 providers is feasible without real fills. That would measure quoted price, not realized execution.
- Dial: I did not inspect dial-sdk for this idea, and I see no relevance there.

**(d) What a solo founder could ship in 14 days**
- Days 1-4: a cron job that polls quotes from the router's providers for about 20 fixed pairs across 3 trade sizes on 3-4 chains. Store them with timestamps.
- Days 5-8: chain each snapshot batch into the existing audit and seal code, and anchor it publicly. This is tamper-evident quotes only, not a measure of realized execution.
- Days 9-12: a static public page plus a JSON/CSV endpoint showing quoted best-price win rate, spread and gas, labeled "quote-based". Add a methodology page and a reproducibility script.
- Days 13-14: publish one dated report and post it where aggregator teams and researchers already read.
- Real fills would need real money and users, which means they are out of scope for 14 days. Without them the index measures quotes, which is weaker than ClearTrace's on-chain data. Say so explicitly in the report.
- The privacy-threshold work already built does not help here and is a distraction for a public index.

**Risks**
- Routers can game quote benchmarks.
- A neutral index is awkward when Suwappu's own router is a participant.
- Likely revenue in 90 days is roughly zero.
- Opportunity cost is high given the founder's attention is split across three orgs.

**Suggested next steps**
- If pursued, do the minimal quote-poller report only.
- Otherwise fold the idea into Bet B in the competitor-gaps doc as a marketing artifact, not a standalone product.

HANDOFF
agent: api-ts-dev
task: Optional and low priority. Build a read-only quote-poller cron that snapshots quotes from the router for 20 pairs x 3 sizes. Write the results to a new table, hash-chain each batch with api-ts/src/lib/seal.ts, and expose a public GET /v1/execution-index JSON endpoint. Labeled quote-based. Acceptance criteria: a dated batch is verifiable with a published script. Do not start until the founder confirms the idea is worth the attention.
files: bot/services/execution_benchmark.py:34,62; api/webapp.py:5202; api-ts/src/lib/seal.ts; api-ts/src/services/audit.ts; bot/services/swap_engine.py; docs/research/2026-11-20-product-competitor-gaps.md:102-106,223
risks: Cross-stack (Python router vs api-ts). The new table needs a dual-ORM migration (db-migrate). Not on the money path if read-only quote polling is kept, but any change to swap_engine would be MONEY-PATH. Quote-vs-fill methodology is a credibility risk. Third-party provider API rate limits and ToS.

## #10
**Verdict on IDEA #10: do not pursue as a revenue play.** It is a crowded, consolidating market. The leading AI auditors have well-funded, security-native teams, and bounty platforms are explicitly penalising unverified AI submissions. The asset here is not an auditor. It is a defensive security toolchain for Suwappu's own contracts. Weak-fit exception: a narrow, human-supervised "PoC-first" pipeline on small Immunefi scopes, as a side experiment only.

**(a) Market (some sources secondary; recheck before relying on them)**
- Code4rena announced a wind-down on 2026-05-13, with Immunefi absorbing its customers and researchers. Platform consolidation is happening ([The Block](https://www.theblock.co/news/regulation/2026-05-13-immufefi-absorb-code4rena-bug-bounty-customers-shutdown-decision-401179)).
- Code4rena's Bot Races make bots the first phase, and it runs Zellic's V12 on all competition code. Automated findings are therefore largely "pre-harvested" before humans get paid ([Code4rena](https://code4rena.com/blog/new-to-code4rena-bot-races)).
- Immunefi's rules prohibit AI or scanner reports that lack impact detail ([Immunefi rules](https://immunefi.com/rules/)). Bugcrowd penalises automated pipelines with a 30-day suspension for "sloptimism" ([Bugcrowd](https://www.bugcrowd.com/?p=19941)).
- Demand signal: an AI agent reportedly won a $2.5M bounty, and its maker V12 raised a $10M seed on 2026-08-03. Founders are ex-Zellic and the bounty claim is company-sourced ([Dealroom](https://dealroom.co/news/142671-v12-lands-10m-seed-after-its-ai-agent-won-a-2-5m-bug-bounty/)).
- Benchmarks: EVMbench (OpenAI/Paradigm, Feb 2026) claimed high exploit rates, but BlockSec disputed them, saying "replacing humans is not close" ([The Block](https://theblock.co/post/394553/ai-auditing-humans-blocksec-research-openai-paradigm-evmbench-findings)).
- UNVERIFIED: dev.to and blog claims of a $250K HackenProof AI payout (April 2026) and a $400K Solana bounty (March 2026).
- UNVERIFIED: total market size, per-payout pricing, and Sherlock's AI policy. I found no primary data on any of them.
- Who pays: protocols fund bounty pools, not the AI. Payouts are winner-take-most and go to first valid, PoC-backed reports.

**(b) Competitors**
- V12 (new startup, founders ex-Zellic): $10M seed, a $2.5M bounty claim, $200 free credits, self-serve, Slack/GitHub/CLI integrations (Dealroom, above).
- Zellic V12 (the in-house tool, a separate product): autonomous Solidity auditor ([Zellic](https://www.zellic.io/blog/introducing-v12)). Dealroom attributes the $10M seed to a startup; I could not confirm how it relates to the Zellic tool. UNVERIFIED.
- Octane: $6.75M seed from Archetype and Winklevoss Capital ([SecurityWeek](https://www.securityweek.com/octane-raises-6-75m-for-smart-contract-security-tech/amp/)).
- Almanax: about $1M raised, Jan 2025 ([AI Insider](https://theaiinsider.tech/2025/01/27/almanax-secures-1m-to-advance-ai-driven-web3-security-solutions/)).
- Code4rena, Sherlock and Immunefi are platforms rather than rivals. Immunefi is now the dominant one.
- Gaps across rivals: false-positive triage, PoC generation, and non-EVM coverage. All are expensive to close with a solo founder's budget.
- Not found: traction numbers (revenue or payout totals) for any rival. UNVERIFIED.

**(c) Asset reality**
- evmsec and smart-contract-audit-framework are not cloned. Claims about them are UNVERIFIED. A repo-wide search of the session home for evmsec, Immunefi, Code4rena, Sherlock, slither or echidna found only OpenZeppelin vendored files and one Medusa script, no auditor agent code.
- What exists locally is defensive tooling for Suwappu's own contracts:
  - contracts/SECURITY.md records Slither 0.11.4, Aderyn 0.6.8 and Medusa 1.5.1 runs. The Medusa run passed 51K+ calls on `property_solvency`.
  - scripts/run_medusa.sh is the clean-room fuzz wrapper.
  - contracts/test/ has Foundry audit and invariant tests (AuditInvariantsTest.t.sol, StakingInvariant.t.sol, SuwappuCoreRouterMultiUserAudit.t.sol).
  - .claude/commands/audit-fleet.md and .claude/agents/security-auditor.md hold prompts for a parallel audit fleet. These are prompt scaffolds, not an automated hunter.
- Missing: any PoC-generation harness, target ingestion from bounty platforms, fork-test exploit validation, or submission tooling. Maturity is low. It is a human-in-the-loop prompt workflow.

**(d) Solo 14-day ship**
- Realistic: a small CLI or agent that clones an in-scope repo, runs Slither and Aderyn, has an LLM triage the output, and writes a Foundry fork-test PoC per finding. Output is a private, human-reviewed report.
- Days 1-4: ingestion and static-analysis wrapper. Days 5-9: PoC generation and validation loop. Days 10-14: run it on 5-10 small Immunefi scopes, with a human verifying every report before submission.
- Realistic payout: low odds and 30-90+ day lag. Rivals have funded teams and pre-run Bot Races. The expected value is much lower than the cost of the founder's time, which is the scarcest resource here.
- Better use of the same two weeks: run the same pipeline on Suwappu's own contracts and publish the report as marketing and credibility for the MPC and policy products. This reuses the existing SECURITY.md work and does not compete with funded teams.

**Kill criteria:** if no valid, PoC-backed finding appears after the first 5 targets, stop.

HANDOFF
agent: none
task: No build recommended. If the founder wants the self-audit variant, run an AI-triage pass over contracts/*.sol (not lib/), producing Foundry fork PoCs and an updated contracts/SECURITY.md.
files: contracts/SECURITY.md, scripts/run_medusa.sh, contracts/test/AuditInvariantsTest.t.sol, .claude/commands/audit-fleet.md
risks: MONEY-PATH if any contract fix results from findings. No migration or cross-stack impact. Claims about evmsec and audit-framework repos are UNVERIFIED because those repos are not cloned.

## #11
**Verdict on IDEA #11 (Wiz for agents): do NOT pursue as a company. Possible only as a free, open-source wedge/lead-gen feature.** The category is hot but extremely over-funded (a $50M seed exists), buyers are enterprise CISOs, and Suwappu has no distribution, no enterprise credibility, and an observe-only scanner.

**(a) Market (secondary sources, not independently verified)**
- Demand is real, but the money is going to well-funded vendors. Forrester: ~8 big vendors spent >$2.0B acquiring AI-security startups in ~18 months. https://www.forrester.com/blogs/securing-ais-ma-feeding-frenzy-is-on
- Exits: Palo Alto/Protect AI ~$650M, SentinelOne/Prompt Security ~$250M (both per Forrester above), Check Point/Lakera ~$300M (Sept 2025) https://www.ynetnews.com/business/article/bksoa0dogl
- Market-size figure (TAM) and pricing: UNVERIFIED. My search found no credible number. Pricing is typically enterprise/per-seat/sales-led, and I did not confirm any numbers.
- Who pays: CISOs and platform teams at mid-to-large enterprises. Not solo devs and not crypto-agent builders (those are Suwappu's current audience, which is about zero users).

**(b) Competitors (funding per press, 2025-26)**
- AIR Security: $50M seed (Sequoia, Greenoaks), emerged 2026-09-01; inline agent firewall plus agent supply-chain discovery. https://www.securityweek.com/ai-agent-firewall-startup-air-security-emerges-from-stealth-with-50-million/
- Runlayer: $11M seed (Nov 2025), later $30M Series A (date unverified); MCP security control layer. https://www.securityweek.com/runlayer-raises-30-million-in-series-a-funding/
- Rein Security: $25M Series A, ~$35M total. https://thepaypers.com/fraud-and-fincrime/news/rein-security-raises-usd-25-million-in-series-a-to-secure-ai-agents
- Ultra Security: $10M (2026-10-22). https://fintech.global/2026/10/22/ultra-security-raises-10m-as-ai-agents-outrun-defences/
- Helmet Security: $9M. Capsule Security: $7M (2026-04). Manifold: $8M. Asymptote Labs: $5.5M. CodeIntegrity: ~$5M.
- Incumbents: Check Point (Lakera), Palo Alto (Protect AI), SentinelOne (Prompt Security).
- Gaps: I did not assess each competitor's product gaps; UNVERIFIED. The structural gap is that all of them sell to enterprises via sales teams and security-review credibility. There is likely a thin open-source and indie-developer niche, but I did not verify that it is underserved or willing to pay.
- Traction (customers, ARR) is mostly undisclosed except Runlayer's "8 unicorns" launch claim. Not verified.

**(c) Asset reality (local code)**
- AEGIS scanner exists but is observe-only. api-ts/src/middleware/aegisScan.ts:1-5,49-57 states it "never blocks, never alters the response". Sources are in api-ts/src/aegis/ (scan.ts, signatures.ts, semantic.ts, patternMatcher.ts, types.ts) plus a test, api-ts/src/__tests__/aegis.test.ts. It is a pattern/signature scanner with an optional semantic layer; there are no detection-quality benchmarks (not verified; I did not read the signature contents in depth).
- Policy engine, approvals, hash-chained audit and seal receipts exist: api-ts/src/services/PolicyService.ts, ApprovalService.ts, audit.ts, lib/seal.ts, with test api-ts/src/__tests__/auditVerifyChain.test.ts. These are the genuinely differentiated pieces (fail-closed policy, tamper-evident audit), but they are built around swap and payment actions, not generic MCP tool calls. I did not verify how coupled they are to the swap domain.
- Not found: a generic MCP proxy/firewall that sits in front of arbitrary third-party MCP servers, a multi-tenant dashboard, SSO/RBAC, SOC2, or any customers. Suwappu's own hosted MCP is not a firewall product.
- Honest maturity: components are real, but they are an internal safety layer for one product. They have no external users and no enterprise packaging.

**(d) What a solo founder could ship in 14 days**
- Feasible: a standalone open-source "mcp-guard" stdio/HTTP proxy that wraps any MCP server, with:
  - AEGIS injection scanning in enforce mode, in addition to observe mode
  - a YAML allow/deny policy per tool
  - a hash-chained local audit log with `verify` and receipts
  - a human-approval hook. This could be wired to Dial's @dial/supervisor (ask the human on their phone), which would be a rare, honest differentiator.
- Plus: a README with a benchmark against public injection datasets, and an npm publish.
- Not feasible in 14 days: SaaS multi-tenancy, a dashboard, compliance, or sales.
- Risk: Suwappu's history is 8 integration PRs closed unmerged and 12 repos with 0 stars. A free OSS tool also gets no distribution without a launch plan, so a 14-day build likely ends with the same zero adoption unless paired with a concrete distribution channel. Also, Dial has nothing on npm and is more active, so attention is already split.
- Monetization: UNVERIFIED that any solo-dev tier would convert; enterprise buyers will not trust an unaudited, solo-maintained firewall.

**Recommendation:** Do not make this the next company. If anything, spend at most one week as a Dial-attached OSS feature (approval-by-phone plus audit receipts for coding agents, since HumanLayer's hosted sunset around Dec 4 frees up users). Kill it if there is no traction signal (e.g. 50 stars or 5 real installs) in 30 days.

HANDOFF
agent: none
task: No build recommended. Optional, if the founder overrides: api-ts-dev or sdk-dev extracts api-ts/src/aegis/ plus audit.ts and seal.ts into a standalone npm package "mcp-guard" (proxy, YAML policy, enforce-mode flag, `verify` CLI); acceptance is wrapping a real MCP server and blocking a known injection payload end to end.
files: api-ts/src/middleware/aegisScan.ts:1-57; api-ts/src/aegis/; api-ts/src/services/PolicyService.ts; api-ts/src/services/ApprovalService.ts; api-ts/src/services/audit.ts; api-ts/src/lib/seal.ts
risks: Not a MONEY-PATH, but enforce mode on an injection scanner risks false positives that block legitimate calls. Cross-stack: api-ts only. The competitive and market claims above are from secondary press and not independently verified.

## #12
**Verdict on idea #12 (PQ migration): do NOT make it the 14-day bet. Real, dated tailwind, but both asset halves are thin and crypto-migration sales are enterprise/slow. At most, a cheap Dial-only "PQ hybrid sealing" spike (~5-7 days) as a credibility feature, not a business.**

**(a) Market**
- Sizing is wildly inconsistent. MarketsandMarkets puts 2026 at ~$0.60B growing to $3.8B by 2031 (44.5% CAGR). Persistence says ~$1.54B and Grand View ~$2.2B. Root Analysis says ~$0.61B. Treat all as vendor-report noise. [webull/MnM](https://www.webull.com/news/15820564799696896), [Persistence](https://www.persistencemarketresearch.com/market-research/post-quantum-cryptography-market.asp)
- Demand driver is regulatory. NIST IR 8547 deprecates RSA/ECC after 2030 and disallows them after 2035 (Help Net Security, 2026-10-28). [source](https://www.helpnetsecurity.com/2026/10/28/nist-post-quantum-cryptography-migration-roadmap/)
- A claimed June 2026 executive order (EO 14412) requiring federal PQC by 2030 is UNVERIFIED (single source).
- Harvest-now-decrypt-later (HNDL) is framed as a present threat, but the CRQC estimate is still 2030-2035. [CSA note, 2026-05](https://labs.cloudsecurityalliance.org/research/csa-research-note-pqc-harvest-now-decrypt-later-enterprise-2/)
- Who pays: enterprises, governments and telcos buy PQC inventory/migration (crypto-agility, CBOM) through procurement. Consumers do not pay for it. I found no evidence of consumer willingness to pay for PQ messaging, and Signal and Apple give it away free.
- Pricing: UNVERIFIED. I found no public per-seat data.

**(b) Competitors**
- Signal: PQXDH (2023), then SPQR "triple ratchet" (Oct 2025), with plans to force it on all chats. Free. [signal.org](https://signal.org/blog/spqr/)
- Apple iMessage PQ3 (2024), which Apple rates "Level 3". Free, bundled. [Apple](https://security.apple.com/blog/imessage-pq3/)
- PQShield: $37M Series B (2024), ~$70M total per an aggregator. IP and silicon licensing. [TechCrunch](https://techcrunch.com/2024/06/20/pqshield-secures-37m-more-for-quantum-resistant-cryptography)
- SandboxAQ: >$300M raised (Dec 2024). Migration tooling. (Search snippet only.)
- QuSecure: ~$28M total (CB Insights lists only $2.17M, so sources conflict). [SecurityWeek](https://www.securityweek.com/qusecure-banks-28m-series-a-for-post-quantum-cryptography-tech/)
- QIZ Security: $17M seed. Cryptographic posture management, not messaging. [QCR](https://quantumcomputingreport.com/qiz-security-raises-17m-seed-round-to-scale-enterprise-cryptographic-posture-platforms/?noamp=mobile)
- pQCee: $3.9M seed. Crypto-agility, partnering on corporate messaging. [QCR](https://quantumcomputingreport.com/singapores-pqcee-raises-3-9m-seed-round-to-accelerate-global-crypto-agility-deployment/amp/)
- Netsfere: quantum-resilient enterprise/government messaging. Funding UNVERIFIED. [SecurityWeek](https://www.securityweek.com/netsfere-launches-quantum-resilient-messaging-platform-for-enterprise-and-government-use/amp/)
- Gap: nobody serves a wallet-rooted, agent-native PQ identity. But PQ is a checkbox the incumbents already give away, so it is not a wedge on its own.

**(c) Asset reality**
- Dial messaging is classical only. The wire type is `algorithm: "x25519-hkdf-sha256-aes256gcm-v1"` with a static recipient key (`dial-sdk/packages/protocol/src/generated/EncryptedDialMessage.ts:3`). No ML-KEM, Kyber or Dilithium code exists in dial-sdk.
- The only PQ mention is a design proposal: libsignal PQXDH + Double Ratchet is "today static-key sealing" (`dial-sdk/docs/architecture/proposals/2026-09-23-launchable-dial-reference-design.md:92`). It is a plan, not code.
- The `algorithm` field is versioned, which makes a hybrid suite (X25519 + ML-KEM-768, e.g. `x25519-mlkem768-...-v2`) an additive change. This is the one genuinely helpful seam.
- Suwappu PQ settlement is docs and a stub only.
  - `docs/pq-settlement-profile.md:3` says "experimental / unavailable for routing or execution". It delegates ML-DSA-65 and ML-KEM-768 to an external bridge, and says Lattice must not be added to `EXECUTABLE_PROVIDERS`.
  - `bot/services/bridge/lattice_api.py` is a default-off client that "never reimplements ML-DSA/ML-KEM".
- Suwappu-dag, lattice-protocol, revm and the ETP/op-stack-reth repos are not cloned. Their maturity is UNVERIFIED. The profile doc also relies on draft EIP-8355, which is unsettled.
- Grep hits for "kyber" in suwappubot are KyberSwap (a DEX), not post-quantum crypto. Zero real PQ code exists.

**(d) 14-day solo ship**
- Realistic, about 5-7 days: a Dial hybrid KEM suite (X25519 + ML-KEM-768 via a vetted lib such as noble-post-quantum or liboqs) behind the versioned `algorithm` field. Add downgrade-resistant negotiation, KATs/test vectors, and a short threat-model doc. Pitch it as "HNDL-safe from day one" for the testnet.
- Caveats: unaudited crypto, large keys in the DNN registry, and it duplicates the planned libsignal/PQXDH path, so it should be a stopgap.
- Not realistic in 14 days: PQ settlement. It needs the unseen dag/lattice repos, an audited on-chain ML-DSA verifier, and the EIP is still draft. It would touch the money path.
- Needs no new users, but creates no revenue. Expected revenue in 14 days is about $0.

HANDOFF
agent: none
task: Optional (only if the conductor picks #12): a spike spec for sdk-dev or the Dial TS owner. Add a hybrid `x25519-mlkem768-hkdf-sha256-aes256gcm-v2` algorithm to the Dial protocol package, with a dual-KEM key bundle in the DNN registry key type and a downgrade-protection test. Acceptance: round-trip tests pass and old v1 messages still decrypt. Do not touch Suwappu settlement.
files: dial-sdk/packages/protocol/src/generated/EncryptedDialMessage.ts:3; dial-sdk/packages/protocol/src/generated/DnnMessageEncryptionKey.ts; dial-sdk/docs/architecture/proposals/2026-09-23-launchable-dial-reference-design.md:92; docs/pq-settlement-profile.md:3; bot/services/bridge/lattice_api.py
risks: Dial changes are cross-stack (the protocol is generated, probably from a Rust/schema source, so edit the source and not the generated TS). Unaudited crypto and downgrade attacks. Suwappu lattice would be MONEY-PATH, so keep it default-off.

## #13
**Verdict on Idea #13 (sovereign comms for orgs): NO-GO as a 14-day revenue play. Park it, or run it only as a "design-partner conversations" experiment.** The market is real but sold through multi-quarter government procurement, a solo founder with unaudited crypto and no published packages is a poor fit for that, and Matrix/Element, Wire and Threema already hold the position.

**(a) Market and demand (cited, partly vendor-sourced)**
- European governments are moving to sovereign, open-source messaging. France's Tchap runs on Matrix with about 350K daily users, Belgium's BEAM was planned for about 750K, and Germany's openDesk and TI-Messenger use Matrix/Element ([The Register, Feb 2026](https://www.theregister.com/on-prem/2026/02/09/matrix-messaging-gaining-ground-in-government-it/4663932), [Computer Weekly](https://www.computerweekly.com/news/366633894/European-governments-opt-for-open-source-alternatives-to-Big-Tech-encrypted-communications)).
- France's DINUM became the first government member of the Matrix.org Foundation in Oct 2025 ([matrix.org](https://matrix.org/blog/2025/10/dinum/)).
- Money flows to large integrators and incumbents. Computer Weekly reports government funding often went to systems integrators rather than to Matrix itself.
- Pricing: UNVERIFIED. I found no public per-seat or contract values. Element's own blog says it has "a small revenue stream" from government contracts.
- Total market size: UNVERIFIED. I found no credible TAM figure.

**(b) Competitors**
- **Element/Matrix:** Series A 2019 and Series B 2020, about $48M total per CB Insights. Revenue is about $12.5M per GetLatka, a third-party estimate that conflicts with Element's own funding history. Deployments are France, Germany, Belgium and defence. Gap: operational complexity, plus a funding squeeze at the Foundation.
- **Wire:** €24M Series C (Cipio, Iconical), date UNVERIFIED. It is built on MLS and has won European government business ([TechCrunch](https://techcrunch.com/?p=2182359)).
- **Threema Work:** self-hostable with anonymous user management, per the same search results. Funding and traction: UNVERIFIED.
- **Signal, Mattermost, Rocket.Chat, Palantir-style platforms:** UNVERIFIED. My searches returned nothing on them.
- **Gaps Dial could claim:** wallet-rooted identity, agent-native operators, and P2P calls. No evidence yet that any buyer values these. None of the incumbents is agent-first.

**(c) Asset reality**
- The dial-sdk checkout is shallow (`.git/shallow`). It has no `crates/` or `packages/` directories and `services/` holds only a README, so I could not inspect the Rust operator source. Maturity claims about it are UNVERIFIED.
- The ADR says the reference operator is "deliberately disposable" and a production operator "should replace it with authenticated, rate-limited components" (`dial-sdk/docs/architecture/decisions/0001-operator-neutral-networked-messaging.md:48`).
- The same ADR is marked superseded by ADR 0002 for transport and auth, so it overstates today's gaps. The status line is at line 3 and the ADR 0002 file was not read.
- The only self-host and deploy material I found is a testnet operator runbook (`dial-sdk/docs/operations/deploying-the-testnet-operator.md:1-60`). It describes one Cloudflare-hosted testnet operator deployed through GitHub Actions on a self-hosted Proxmox runner.
- I found no evidence of SSO/SAML/OIDC, admin console, retention or compliance controls, or an on-prem package for enterprises. Greps for these terms in the docs and specs returned only a handful of incidental hits, and the two spec/doc files I checked for them had none. The checkout is sparse, so absence is UNVERIFIED.
- From the founder context: nothing is published to npm, and the testnet is invite-gated. That means no self-serve install path for an org.
- Suwappu is the stronger transferable asset: the fail-closed policy engine, approvals, hash-chained audit and seal receipts (`api-ts/src/services/PolicyService.ts`, `ApprovalService.ts`, `lib/seal.ts`). I did not re-inspect these files, so their quality is not re-verified. These are exactly the controls governments and enterprises ask for around agents.
- Everything else is UNVERIFIED: `magic-cabinet/palantir-for-japan`, Dial-Agent-Gateway and the other uncloned repos.
- The MPC signer is unaudited, which is disqualifying in any sovereign pitch.

**(d) What a solo founder could ship in 14 days**
- **Feasible (about 10 days):** a single-command Docker Compose bundle of the Dial operator plus dial-agent, with a one-page "sovereign deployment" doc. It would be a landing page and a reproducible demo, not a product. Add Suwappu's audit/approval ideas as an agent action log.
- **Not feasible in 14 days:** government procurement, security certifications, SSO, a compliance posture, and an independent audit. Public-sector sales cycles typically run 6-18 months (general knowledge, UNVERIFIED).
- **Pragmatic test:** book 10 calls with EU or Japan public-sector IT leads, or defence and NGO groups already on Matrix, and ask who would pay for an agent-native self-hosted operator. Set a kill criterion of 0 paid pilots or LOIs after 10 calls.
- **Verdict:** this idea competes for the same attention as the Dial core. Prefer shipping Dial's own distribution first (npm publish, TestFlight users) and letting enterprise or sovereign demand come in as inbound.

**Suggested next steps**
- Founder-led validation calls first, with no build.
- If any LOI appears, have `deploy-ops` or a Dial builder package the compose bundle.

HANDOFF
agent: none
task: No build now. Optional follow-up: researcher pass on ADR 0002 and the full operator crates (needs a non-shallow dial-sdk checkout) to verify operator production-readiness before any pilot.
files: dial-sdk/docs/architecture/decisions/0001-operator-neutral-networked-messaging.md:3,48; dial-sdk/docs/operations/deploying-the-testnet-operator.md:1-60; api-ts/src/services/PolicyService.ts (not re-inspected)
risks: Evidence gaps (sparse dial-sdk checkout; no pricing or TAM data; competitor figures are vendor-sourced or third-party). No MONEY-PATH or migration impact because nothing is being built. Unaudited MPC signer must stay out of any sovereign pitch.

## #14
**Verdict: do not pursue Idea #14 as a 14-day bet. Selling signals is a crowded, low-trust market with no verifiable track record for us. Trading own capital needs capital, a real edge, and a track record, and we have none of the three. The only defensible slice is a small "verified track record" feature, which is Suwappu's seal/audit tech applied to someone else's signals.**

**(a) Market (thin evidence)**
- I found no credible signal-subscription market size. Vendor reports give trading-bot market figures of $4.3-4.6B (2025/26) growing to roughly $35B by 2032-34, but the two reports disagree on base year and CAGR. Platform market sizes range from $38B to $59B across sources. All of these are commercial research publishers, so treat them as soft. [MarketResearch](https://www.marketresearch.com/LP-Information-Inc-v4134/Global-Crypto-Trading-Bot-Growth-44928771/), [BusinessResearchCo](https://www.thebusinessresearchcompany.com/report/crypto-trading-platform-global-market-report)
- Agent-trading demand is early. Robinhood reports 150k+ agent accounts in about 4 months, but also a 38% drop in crypto revenue and no incremental revenue reported from agents. [Fortune 2026-10-12](https://fortune.com/2026/10/12/crypto-founders-ai-agentic-trading/), [Weiss](https://weissratings.com/en/weiss-crypto-daily/ai-is-trading-your-money-here-s-who-gets-paid)
- The only proven monetization in this area is fee capture on execution. Trojan and Banana Gun have lifetime volumes of about $24B and $16B (undated Datawallet figures). Banana Gun shares 40% of revenue with token holders. Trojan's 30-day DEX volume was $96M on DefiLlama (snapshot date not shown). [Datawallet](https://www.datawallet.com/crypto/best-crypto-telegram-bots), [DefiLlama](https://defillama.com/protocol/trojan), [DL News](https://www.dlnews.com/articles/defi/telegram-bots-gain-in-popularity-with-more-memecoin-trading/)
- Who pays: retail pays for execution speed and for copy trading. Signal subscriptions are the weakest category. SourceForge and listicle results are mostly Telegram channels with no audited performance.
- UNVERIFIED: signal pricing. I did not find primary sources. Retail signal groups commonly charge $20-100/month, which is background knowledge, not cited.

**(b) Competitors (funding and traction are mostly UNVERIFIED, since the searches returned no primary sources)**
- Execution bots: Maestro, Trojan, Banana Gun, BullX, GMGN, Photon, Axiom. They are the category leaders and take fees on execution volume. Their gap is that they sell speed, not edge.
- Copy trading and signals: Cryptohopper's signaller marketplace and 3Commas. Their gap is unverifiable performance claims.
- Exchange agents: OKX, Binance and Bybit have launched agentic trading, and Robinhood has agent accounts. They bundle this for free and have distribution we cannot match.
- Not researched: Hyperliquid vaults, Numerai and Cod3x funding. The search returned nothing on them.
- A wedge no competitor was found to cover (UNVERIFIED as a gap, since my search was shallow) is cryptographically sealed, hash-chained performance records for signals or agents.

**(c) Asset reality (checked locally)**
- `quantdesk` is a private repo and is not cloned. UNVERIFIED: all claims about its maturity.
- A repo-wide search of suwappubot for quantdesk, backtest, paper trading and track record found no signal-provider or backtest service. Matches were scattered mentions in docs and schema files, not a product.
- `execution/searcher/README.md` is a Rust research crate for markout, LVR and builder-bid replay. It says it is "intentionally isolated from deployed services until benchmark and adversarial gates are satisfied". It is not a live strategy.
- Related pieces that do exist:
  - copy-trade schema in `api-ts/src/db/schema/copyTrades.ts`
  - limit-order service in `bot/services/orders.py`
  - the 25-provider router in `bot/services/swap_engine.py` (per your brief; I did not re-inspect it)
  - sealed audit in `api-ts/src/lib/seal.ts` (per your brief; I did not re-inspect it)
- Evidence of edge: none found. With 0 completed swaps and no live PnL, there is no track record.

**(d) What a solo founder could ship in 14 days**
- Not feasible: a profitable strategy with proof. A credible audited record needs months of live results, and trading own capital at $0 means nothing meaningful to trade.
- Feasible (about 5-7 days): a "sealed signal feed" demo.
  - A paper-trade runner emits timestamped signals, each sealed and hash-chained.
  - A public page shows the live PnL, with an unforgeable record of the signal timestamps.
  - It uses the router for fill-price quotes.
  - Verdict: this is a marketing asset for the existing audit stack, not a revenue business. The 14-day plan produces a track record that only starts accruing then.
- Dial overlap: none worth building.

**Suggested next step if pursued anyway:** the sealed paper-trade feed, assigned to `api-ts-dev`.

HANDOFF
agent: none
task: Recommend deprioritizing Idea #14. If the founder insists, spec a sealed paper-trade signal feed (api-ts route, using seal.ts and audit.ts for hash-chained signals, plus router quotes for marks, plus a public page). Acceptance criteria: signals are immutable, verifiable and timestamped, and the PnL is computed from router quotes.
files: execution/searcher/README.md:1-30; api-ts/src/db/schema/copyTrades.ts; bot/services/orders.py
risks: Cross-stack: Python orders vs api-ts. Handling user funds or giving advice has regulatory risk (UNVERIFIED legal view). Sealed signals are not MONEY-PATH unless real capital is added.

## #15
**IDEA #15 (Done-for-you agent studio): verdict is a conditional YES as a cash bridge, not a venture path. It has the fastest path to first dollars of any idea here, but it turns a solo founder into a services business, and that works against the Suwappu and Dial product bets. Do it only as a narrow productized offer with a hard cap on hours.**

**(a) Market**
- Pricing is wide and the sources are mostly vendor marketing. One practitioner, citing 109 builds, puts builds at $25K-$400K+ (mid-market $40-120K) plus $2-20K/month to run ([DEV](https://dev.to/jahanzaibai/ai-agent-development-services-what-109-production-builds-taught-me-about-pricing-process-and-the-4o8k)). Tekrevol says workflow agents cost $25-80K ([Tekrevol](https://www.tekrevol.com/blogs/ai-agent-development-cost/)). A survey of 15 agencies found a median advertised starting price of about $3.6K ([Aumiqx](https://aumiqx.com/services/ai-agent-development/)).
- A custom MCP server is quoted at roughly 120-200 hours, and low-cost sellers charge about $9/hr, so rates are being driven down ([Tripleminds](https://tripleminds.co/blogs/costing/mcp-development-cost/), vendor claim). Sandlabs puts a Claude Cowork setup with custom MCP connectors at $3-5K (March 2026) ([Sandlabs](https://sandlabs.com.au/blog/ai-agent-development-cost)).
- Gartner forecasts that over 40% of agentic AI projects will be canceled by end of 2027, because of cost, unclear value and weak risk controls ([Gartner, Jun 2025](https://www.gartner.com/en/newsroom/press-releases/2025-06-25-gartner-predicts-over-40-percent-of-agentic-ai-projects-will-be-canceled-by-end-of-2027)). That signals demand for builds, and also that buyers get burned.
- Venture money in the category is large: $13.6B in the first nine months of 2026 ([NewMarketPitch](https://newmarketpitch.com/blogs/news/agentic-ai-decagon-vs-sierra), secondary source).
- UNVERIFIED: a market size for custom-agent services specifically. I found none.
- Who pays: SMBs and mid-market firms with a concrete workflow and no engineers. Crypto and fintech teams are the best fit for Suwappu's assets, but they are a small and cash-poor segment.

**(b) Competitors**
- **Sierra:** $950M raise at a $15.8B valuation in May 2026, with roughly $200M revenue (Sacra estimate). Its delivery is forward-deployed engineers ([Sacra](https://sacra.com/research/decagon-vs-sierra/), [SiliconANGLE](https://siliconangle.com/2026/05/04/ai-agent-startup-sierra-valued-15b-new-950m-funding-round)).
- **Decagon:** $250M at a $4.5B valuation in January 2026, with roughly $100M ARR ([SiliconANGLE](https://siliconangle.com/2026/01/28/decagon-ai-raises-250m-4-5b-valuation-scale-ai-concierge)). Both Sierra and Decagon sell customer-support agents, so they are adjacent rather than direct competition.
- **Marketplace freelancers:** Fiverr and Upwork gigs for "custom AI agents and MCP servers" already exist ([Fiverr](https://fiverr.com/bluebearai/build-an-ai-agent-an-mcp-server-or-build-mcp-integrations), [Upwork](https://www.upwork.com/services/product/development-it-a-custom-ai-agent-agentic-workflow-with-langgraph-mcp-tool-use-2061131002454532507)). They set the price floor, and I saw no per-project prices.
- **Mid-size agencies:** Master of Code, Cleveroad, Space-O and similar. I did not get funding or traction figures for them.
- **Platforms (Lindy, Relevance AI, Vellum, Superblocks):** I could not get their funding or traction from search. UNVERIFIED.
- **Gap for a solo studio:** it can't compete on breadth or trust with the agencies. The one differentiator would be policy-gated, auditable agents that touch money. Only the Suwappu stack supports that claim, and only as a pitch, since there are no users.

**(c) Asset reality (local, verified by file existence only; I did not read function bodies)**
- **Suwappu:** `bot/services/swap_engine.py`, `api-ts/src/services/PolicyService.ts`, `ApprovalService.ts` and `api-ts/src/lib/seal.ts` all exist. PolicyService has only 7 top-level definitions, so it is a modest module. The "fail-closed", "hash-chained" and "25-provider" claims are UNVERIFIED by me.
- I found no `examples/`, `templates/` or `mcp/` package directories in Suwappu. The 12 example repos live elsewhere and are not in this checkout.
- **Dial:** `dial-sdk/packages/` contains `@dial/cli`, `@dial/supervisor`, `@dial/sdk`, `@dial/react`, `@dial/protocol`, `@dial/events` and `@dial/ports`. `dial-sdk/packages/dial-supervisor/src/` has a real MCP server (`mcp.ts`) with ask, notify, wait, status and replies verbs. This is the most reusable asset: "agent asks a human on their phone for approval" is a concrete deliverable.
- **Maturity gap:** nothing is published to npm, and Suwappu has zero users. So the portfolio has no social proof. The ~8 closed integration PRs show that selling by distribution has failed. Services sell on trust and referrals, which you currently lack.

**(d) What one person could ship in 14 days**
1. **Days 1-3:** One productized offer, "Agent with human-approval guardrails": a fixed-scope MCP server plus an approval flow (Dial supervisor or Telegram) plus an audit log, priced at $3-5K. Ship a one-page site and a public demo that runs on your own stack.
2. **Days 4-7:** Direct outreach to 30-50 warm contacts. Candidates are the founders around the repos you already work in (crypto, fintech, ops-heavy small businesses). Cold outreach to strangers is the weak channel here, given the closed-PR history. Also post two Fiverr or Upwork listings as a cheap test.
3. **Days 8-14:** Close and deliver 1-2 paid pilots. Keep each build to a 1-week fixed fee, a template-based MCP server, and a maintenance retainer upsell (15-20% per year is typical).
- **Realistic outcome:** $3-10K cash in the best case, and most likely $0 if no warm leads convert. Estimated 14-day revenue is a guess, not sourced.

**Risks**
- This is a time-for-money trap that costs the Dial and Suwappu product focus. Cap it at roughly 20% of attention.
- Without a case study, trust is the bottleneck.
- Liability is high if an agent mishandles funds: the MPC signer is unaudited, so sell nothing that moves money in v1.

HANDOFF
agent: none
task: Founder decision only. If go: showcase-dev builds a one-page "approval-gated agent" offer page plus a demo, and api-ts-dev packages the Dial supervisor MCP as a reusable template.
files: dial-sdk/packages/dial-supervisor/src/mcp.ts, api-ts/src/services/PolicyService.ts, api-ts/src/services/ApprovalService.ts, api-ts/src/lib/seal.ts
risks: Not a money-path change in itself, but do not sell anything that touches the unaudited mpc-signer. Cross-stack: Dial and Suwappu stay separate repos. The main risk is attention dilution.

## #16
**Verdict: do not make Seeker a strategy; do a ~1-day listing as a free side-channel only. A messaging app with no Solana wallet integration and no user-facing value on a ~150k-device base will not produce traction. A Suwappu swap/wallet app on Seeker is a different, weakly supported bet.**

**(a) Market**
- Seeker shipped 2025-08-04 after 140k+ presales at $500 across 57 countries ([The Block](https://www.theblock.co/post/317154/solana-seeker-saga-crypto-mobile-phone-successor-140000-presales)). Cumulative figures: ~150k (Breakpoint 2025 per [Solana Compass](https://solanacompass.com/learn/breakpoint-25/update-from-solana-mobile-the-seeker-economy)), 175k+ (an MWC exhibitor listing), 200k+ (MEXC, possibly Saga+Seeker). No audited 2026 sales figure; the sources conflict on shipped vs. sold. Saga sold ~20k.
- The dApp Store reached 1,561 apps by 2026-06-25, up from ~700 in March, with 0% platform fees ([Solana Compass](https://solanacompass.com/news/solana-mobile-dapp-store-surpasses-1561-apps-as-catalog-more-than-doubles-in-three-months)). Supply is growing fast, so discovery is the bottleneck, which is why Solana Mobile launched curated "dApp Spotlight".
- Solana Mobile Stack opened to all Android OEMs at MWC 2026, which widens the reachable base beyond Seeker ([blog](https://blog.solanamobile.com/post/sms-goes-global-and-season-2-wrapup)).
- Who pays: users pay nothing for messaging. Demand evidence for paid messaging on Seeker: UNVERIFIED, none found. The audience is crypto-native traders and airdrop hunters (the "Seeker Season" quests), not a privacy-comms buyer segment.
- Cost to list: publisher KYC/KYB, a funded Solana wallet, and an App NFT mint ([docs](https://docs.solanamobile.com/dapp-store/submit-new-app)). Required assets: 512px icon, 4+ screenshots at 1080px or larger, privacy policy and EULA. APK or PWA accepted.

**(b) Competitors on Seeker**
- Dialect (Solana messaging/notifications) is the only messenger my search surfaced in the dApp Store. Its funding and traction: UNVERIFIED, not searched.
- Telegram, Signal and Phantom/Backpack/Solflare wallets are the default alternatives. Their store presence on Seeker: UNVERIFIED.
- XMTP: UNVERIFIED, nothing found for Seeker.
- Gaps: I did not complete a funded top-5-to-8 table. Treat that as an open item.

**(c) Asset reality**
- Dial Android has a portal-ready stub only: `dial-sdk/distribution/android/solana-mobile-portal.json` has status "portal-stub", app ID `work.dial.mobile.android`, and the name "Dial Testnet".
- The doc `dial-sdk/docs/mobile/android-store-distribution.md:17` says "Stub ready, not submitted". The owner-held steps (KYC/KYB, wallet, NFT, API key) are listed at lines 106-118.
- Publish script: `dial-sdk/scripts/publish-solana-mobile-release.sh`, which pins `@solana-mobile/dapp-store-cli` 1.0.0 and requires `--confirm-public-submit`. The README is `dial-sdk/distribution/solana-mobile/README.md`.
- The listing is only an invite-gated, bounded +008 testnet. The description says calls, payments and groups are "still in development". The screenshot set has one image (`sourceAssets.phoneScreenshots`), so the 4-screenshot minimum is not met.
- No Seed Vault or Mobile Wallet Adapter integration in dial-android. The only Solana mentions in the Android app are the three README lines about the stub (`dial-sdk/apps/dial-android/README.md:156-163`). So a Dial wallet cannot sign on Seeker. UNVERIFIED: whether Dial's BIP-39 key derives a Solana ed25519 key.
- Distribution is a public reviewed listing with no testnet lane. An invite-gated app would likely get poor reviews.
- Suwappu: `bot/services/swap_engine.py` references Jupiter 56 times, so Solana swap routing exists in code. It has 0 completed swaps and no Android client; `mobile/` is an iOS Expo app. A PWA wrap of the webapp or hosted MCP is possible. Mini App behavior inside Seeker's wallet context: UNVERIFIED.
- The Solana Mobile listing is the cheapest hosted-listing channel Dial has, since it reuses a signed APK already produced by CI.

**(d) What a solo founder can ship in 14 days**
- Days 1-2: do the owner-held steps (KYC/KYB, funded wallet of a few dollars, App NFT, API key). KYC turnaround: UNVERIFIED.
- Days 3-5: capture 4+ real screenshots at 1080px, confirm the privacy policy and EULA URLs, and add an honest "testnet / invite" line. Submit with the existing script.
- Optional days 6-14: add Mobile Wallet Adapter sign-in so the Solana key from the BIP-39 identity can be used, which differentiates Dial from plain chat. Do this only if the derivation question above resolves yes. Any money-path work would need review.
- Do not build anything else for Seeker. Success metric: installs and invite-code redemptions from the listing within 30 days. If under about 50, drop it.

**Suggested next steps**
- Owner decision: whether to complete KYC and the wallet steps.
- Researcher follow-up: a funded competitor table for Seeker messengers and Dialect traction.

HANDOFF
agent: none
task: Founder decides whether to do the owner-held Solana Mobile publisher steps (KYC/KYB, funded wallet, App NFT, API key). If yes, the builder (Dial repo, likely showcase-dev equivalent) adds 3+ 1080px screenshots to store-listing.json and runs scripts/publish-solana-mobile-release.sh with --confirm-public-submit. Acceptance: listing live at solanadappstore://details?id=work.dial.mobile.android.
files: dial-sdk/distribution/android/solana-mobile-portal.json; dial-sdk/distribution/solana-mobile/README.md; dial-sdk/docs/mobile/android-store-distribution.md:17,106-118; dial-sdk/scripts/publish-solana-mobile-release.sh; dial-sdk/apps/dial-android/README.md:156-163; bot/services/swap_engine.py
risks: Public reviewed listing of an invite-gated testnet app risks bad reviews. KYC/KYB and wallet keypair custody are owner-held. Any MWC/wallet-signing work is MONEY-PATH-adjacent (key derivation) and needs review. Cross-stack: none for the listing itself.

## #17
**Recommendation: KILL / do not pursue Idea #17.** The sector is real, but it is dominated by $300M+ labs and billion-dollar-valued startups. The founder has no domain, data, lab, or code assets for it, and no 14-day ship has a plausible path to a paying customer.

**(a) Market (searched once; thin evidence)**
- Capital is concentrated in a few mega-rounds. CuspAI raised $450M on 2026-07-20 (Sifted reports Series B at $2.6bn valuation); investors include Bezos Expeditions, Kleiner Perkins and NEA. It launched an "AI Materials Foundry" consortium of 45+ members, including Nvidia, Samsung and Meta. Sources: https://siliconangle.com/2026/07/20/ai-materials-science-startup-cuspai-raises-450m-funding/ and https://sifted.eu/articles/cuspai-lands-450m-round-to-accelerate-ai-materials-discovery
- Periodic Labs raised a $300M seed in 2025 (a16z, Nvidia, Accel, DST; roughly $1B valuation). Its first target is higher-temperature superconductors. Source: https://techcrunch.com/2025/09/30/former-openai-and-deepmind-researchers-raise-whopping-300m-seed-to-automate-science
- A secondary tracker (last updated 2026-10-27) lists small rounds: Cambium $100M Series B (Jan 2026), Polaron $8M seed, alqem about $9.3M, Discovered Materials $9M. Treat these as UNVERIFIED. Source: https://newmarketpitch.com/blogs/news/ai-materials-discovery-funding-news
- Who pays: chemical, battery, semiconductor and consumer-electronics enterprises on multi-year R&D contracts, plus consortium membership. No self-serve or SMB pricing was found. Market size and pricing: UNVERIFIED, not found in my search.
- Demand evidence is mostly investor demand, not revealed customer demand. CuspAI's article frames the sector as entering a "validation phase" (eWeek, https://eweek.com/news/cuspai-ai-materials-funding/).

**(b) Competitors (funding and traction only partly verified)**
- CuspAI: $450M, with the Foundry consortium and the MIRA platform. Gap: enterprise-only and closed.
- Periodic Labs: $300M seed. It is building an autonomous lab, so it is capital-heavy and focused on physical experiments.
- Orbital Materials, Radical AI, Cambium, Polaron, Discovered Materials, alqem: UNVERIFIED. My search returned nothing usable on Orbital or Radical.
- Not researched: Microsoft MatterGen/MatterSim, DeepMind GNoME, Schrödinger, and Materials Project/Matgl, which is Materials Virtual Lab open source (UNVERIFIED). Open-source universal interatomic potentials such as MatGL and CHGNet are commoditized, which undercuts any thin wrapper built on them.
- Common gap: lab-validated results. Software-only players cannot prove that predicted materials work when synthesized.

**(c) Asset reality**
- In the suwappubot repo, the grep for matgl, chgnet, "materials discovery" and GaN matched only unrelated files: docs/research notes, api-ts/src/routes/mcp.ts, bot/handlers/enterprise.py, bot/config/settings.py, lock files. I did not open them. The hits are likely substring false positives, for example "GaN" case-insensitively matching words like "organization". That is UNVERIFIED because I did not inspect them.
- dial-sdk has zero matches.
- The matgl and chgnet repos, GaN-optimization- and active-materials-discovery are not cloned locally. Per the founder's note, they are forks or experiments (UNVERIFIED).
- There is no materials-science code, dataset, GPU infrastructure, lab access or domain credential among the verified assets. The swap router, policy engine and MCP assets do not transfer to this domain.

**(d) 14-day solo ship**
- Realistic: a hosted MCP server or notebook wrapping the open-source MatGL/CHGNet for property prediction. Under that name the idea is "free OSS wrapper" with no moat, and it needs a pricing and buyer thesis that I could not find.
- Unrealistic: anything that competes on discovery, or requires lab validation or enterprise sales.
- Distribution risk: Suwappu's integration PRs have all been closed and its example repos have 0 stars, so the founder has no proven channel into the research community. Dial is far more active, so attention is better spent there.
- Opportunity cost is high: this is a third unrelated domain for a founder already split across three orgs.

**Verdict:** The market is real but not winnable by a ~$0 solo founder with no domain edge. A scientist co-founder or a research-lab partner would be a prerequisite.

HANDOFF
agent: none
task: No build. If the founder still wants to test this idea, first spend 1-2 days on 5 customer-discovery calls with computational materials scientists, to find a paid pain point that CuspAI and Periodic Labs do not serve.
files: the suwappubot repo (grep only; the hits in docs/research/*.md, api-ts/src/routes/mcp.ts and bot/handlers/enterprise.py were not opened); dial-sdk (no matches)
risks: Opportunity cost and focus dilution across three orgs. Several competitor claims are UNVERIFIED because only one web search was run. No money-path, migration or cross-stack impact.
