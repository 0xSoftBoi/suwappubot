# Suwappu competitor report: the agent permission and spend layer (2026-11-20)

## 1. How crowded is this?

**Very crowded at the generic layer. Thin at the money-specific layer.** After deduping the five research sweeps, I count about 40 YC companies that are adjacent to the thesis. About 28 of them are relevant.

| Category | YC count | Examples |
|---|---|---|
| Agent auth, permissions, HITL, MCP gateways | ~14 | Alter, Agentic Fabriq, OneCLI, Executor, Routant, Clawvisor, Salus, GrayPass, Armorer, Multifactor, Golf, HumanLayer |
| Agent wallets, cards, payments | ~10 | Agentcard, Allowance, Locus, Sponge, Versine, Orthogonal, Maven, Uno Wallet |
| Observability, audit, AI cost tracking | ~6+ | Laminar, Respan, Sentrial, Carrot Labs, Callback, Papaya |
| Messaging channels for agents | 3 | Inkbox, AgentPhone, Chert |
| Finance ops and procurement (human-facing) | ~5 | Saldor, Peakflo, Alaan, Lumari, Balance |

**The batch trend is sharply up.** For the two core categories (permissions plus agent payments), YC funded:

- about 3 companies in 2024 (HumanLayer F24, Superagent W24, Saldor S24);
- about 6 in 2025 (Alter, Golf, ContextFort, Multifactor, Locus, Goodshelf);
- about 18 in 2026 so far, across W26, Spring, S26 and F26.

YC's Spring 2026 Request for Startups (RFS) explicitly named stablecoins and AI agents. Expect 3 to 6 more per batch. Outside YC, Dealroom reports about $115M raised by agent-payments startups in 2026 as of October 19 (Sapiom $35M, Natural $30M, Catena $30M). Agent-IAM rivals have raised more again: Arcade $72M total, Runlayer $42M, Keycard $38M.

**Counter-signal:** demand is unproven. TNW estimates global agentic payment volume at about $28k/day. Almost no YC page lists customers or revenue.

## 2. Master table (deduped, most relevant first)

Overlap is rated against the narrow wedge: a spend guard for money-moving agents plus chat-native approvals.

| Company | YC batch / investors | What they do | Overlap | Traction | Their gap vs us |
|---|---|---|---|---|---|
| Payman | YC status UNVERIFIED (one aggregator lists YC/Initialized; no YC page found). Coinbase, Visa named (UNVERIFIED) | Agent wallets with daily/per-transaction caps, approval thresholds, ACH and USDC payouts | **H** | Seed $4.2M (Jun 2025) vs $12.57M total, conflicting (UNVERIFIED) | Approval channels and receipts not evidenced; US/crypto rails |
| Locus | YC F25 | Agent identities, budgets, permissions, audit trail; USDC on Base | **H** | Team of 2; $50/mo tier; pivoting to "Locus Founder" | Crypto only; no human-approval channel; no tamper-evident receipts |
| Allowance | YC Spring 2026, solo | One-time virtual cards; each purchase approved on iPhone | **H** | Team of 1, no metrics | Consumer; iPhone-only approval; no org budgets or audit |
| Agentcard | YC Summer 2026 | Agent debit/one-time cards, PCI vault, checkout completion, MCP/CLI | **H** | $8M seed on Nov 13 2026 (investors UNVERIFIED); DoorDash first merchant | Card rail only; thin policy; no approval routing or receipts |
| Versine | YC Fall 2026 | "Agent-first bank": agents send money via MCP; passkey approval; $2,500/week cap | **H** | Launched Nov 17 2026 | Consumer P2P, US only, in-app approval |
| Agentic Fabriq | YC W26 | "Okta for agents": identity, scopes, approval flows, audit logs | H (policy), none on money | Team of 2 | No budgets, rails or chat approvals |
| OneCLI | YC S26 | Open-source; credentials kept from agents; sensitive actions wait for approval in chat; org policy | **H** | Team of 2; free self-host | Approvals not money-aware; no caps, rails or receipts |
| Alter | YC S25 | Zero-trust proxy; parameter-level RBAC/ABAC; real-time approve/deny; audit | H | Beta, no customers | Enterprise/regulated; no budgets or rails |
| Salus | YC W26 | Runtime action checks; plain-English policies; budget/loop protection; HITL escalation | M-H | Benchmarks only | Action correctness, not money movement |
| GrayPass | YC F26 | Allow/challenge/hold/deny on sensitive actions (incl. money movement) from identity and behavior signals | M-H | 900k+ sessions; $50K revenue in one month (self-reported) | Fraud signals, not agent budgets, reservation or receipts |
| Executor | YC S26, solo | Open-source MCP gateway; per-tool allow / needs-approval / blocked | M-H | 2.8k GitHub stars; ~14k npm/week | Not money-aware; approvals not chat-native |
| Routant | YC F26, solo | Single MCP endpoint; per-tool permissions; approvals; request log | M-H | None | CISO access control, not payments |
| Clawvisor | YC (batch UNVERIFIED) | Task-scoped authorization; off-task requests blocked; actions logged | M-H | Team of 3 | No monetary budgets |
| Sponge | YC W26, ex-Stripe | Agent wallet (bank, card, crypto) plus Gateway for selling to agents | M | No metrics | No policy or approval layer |
| HumanLayer | YC F24; acquired by Factory, Nov 4 2026 | Was HITL approvals via Slack/SMS/email; now coding IDE | Was H, now L | Hosted shutdown about Dec 4; core going Apache 2.0 | Left the category: **opening** |
| Armorer Labs | YC F26 | Runtime detection of injection/hijack; allow/hold/deny | M | Team of 2 | Detection-based; no money |
| Multifactor | YC F25 | Agent auth, revocable account sharing, audit | M | Team of 6; enterprise claims | Credential focus |
| Carrot Labs | YC W26 | AI spend tracking and anomaly alerts | M | n/a | After-the-fact LLM cost; no enforcement |
| Saldor | YC S24 | AI procurement / AP "request to paid" | M (procurement) | Free pilots | For human finance teams |
| Orthogonal | YC W26 | Prepaid balance for agents paying data APIs | L-M | Early named users | Marketplace, not governance |
| Balance | YC W26 | AI accounting agent via Slack/WhatsApp; human sign-off | L-M | Team of 20; SMB customers | Bookkeeping; proves SMBs accept chat-first finance |
| Palomma | YC W23, Medellín | LatAm real-estate bank; pay-by-bank; WhatsApp | M (EM rails) | $14M raise (UNVERIFIED, Nov 11 2026) | Vertical bank; no agent policy |
| Rebill | YC W22, Buenos Aires | LatAm local payments, payouts, stablecoins | M (rail partner) | Team of 11 | Merchant rails |
| Natural | Non-YC; Forerunner $30M Series A (Jul 2026), $40M+ total | FDIC-insured agent wallets; "vaults" an agent cannot drain alone | H | 17 staff; no named customers | Bank/wallet; no chat approvals |
| Runlayer | Non-YC; Khosla, Felicis; $42M | Enterprise MCP gateway and governance | M | "8 unicorns" (Nov 2025 claim) | Not money-aware |
| Arcade.dev | Non-YC; $72M | Agent authorization plus tool catalog | M | Enterprise | No spend guard |
| Catena / Skyfire / Nekuda / Sapiom | Non-YC; $5M to $35M rounds | AI-native bank / agent payment network and identity / agent checkout credentials / undetermined | M | Funding only | Rails and identity; no SMB chat approvals (UNVERIFIED) |
| Meta Business AI and Razorpay "Ray" | Platforms | WhatsApp business agents; UPI payments "coming soon"; payment links (Razorpay, Nov 17 2026) | M-H as bundlers | Bajaj Finance live on Razorpay | Merchant-side collection, not agent spend control |

## 3. The five closest threats to the narrow wedge

1. **Payman.** This is literally "spend guard for money-moving agents": per-agent caps, approval thresholds, audit, payouts. If its funding is in the $4M to $12M range, it can out-ship a solo founder on the refund/payout wedge. *Not doing (evidenced):* chat-native approvals, UPI/Pix, cryptographic receipts, cross-rail budgets. Verify on payman.ai before any pitch.
2. **Agentcard.** It has the most capital ($8M, last week), a merchant in production, and MCP/CLI distribution. Adding a policy engine and a Slack approval button is a few weeks of work for them. *Not doing:* org-wide budgets with reservation, allow/block/approve routing, receipts, non-card rails.
3. **Locus.** It already pitches "budgets, permissions, audit trails" for agents. It is the closest on messaging and is crypto-native like Suwappu's existing stack. *Not doing:* human-approval channels, fiat/UPI/Pix, tamper-evident receipts. Its pivot to a business builder suggests the governance pitch did not pull demand. That is a warning sign for us as well as an opening.
4. **OneCLI (with Executor).** Open-source approval-in-chat with org policy. If either adds an "amount > X → approve" rule, the generic part of our product becomes free. *Not doing:* money awareness, spend reservation, payment rails, receipts.
5. **Platform bundlers (Stripe, Meta/WhatsApp, Razorpay).** Stripe's agent stack (Issuing, shared payment tokens) can ship spend controls natively. Meta and Razorpay own the WhatsApp/UPI surface in India. *Not doing:* neutral cross-rail policy, an independent audit trail, or approval for outbound agent spend. They serve the merchant collecting money, not the business whose agent is spending it.

Honorable mention: **Allowance**, a solo YC founder with the same "approve each agent purchase" story, consumer-side.

## 4. White space (unserved combinations)

- **Chat-native approval of agent spend.** No YC or funded company found does Telegram/WhatsApp approval of agent payments. HumanLayer did Slack/SMS approvals but has exited (hosted product sunsets about Dec 4 2026). Allowance and Versine use native-app or passkey approval. OneCLI's chat approval is not money-aware. Evidence: four independent sweeps found none.
- **Cross-rail budgets with reservation.** Every money player is single-rail: cards (Agentcard, Allowance), USDC (Locus), bank/P2P (Versine, Natural). Nobody holds one org budget across Stripe, cards, x402 and UPI/Pix with reserve-then-settle semantics.
- **Verifiable, tamper-evident receipts.** Everyone says "audit logs". No one sells signed, independently checkable receipts of what a human approved and what the agent then spent. Auditors, insurers (AIUC raised $40M, Armilla $25M) and finance teams are natural buyers.
- **Emerging-market SMBs (India UPI, Brazil Pix).** All YC permission companies sell to US CTOs and CISOs. EM YC players (Palomma, Rebill, Bujeti) are rails or human spend management. Caveat: this may be empty because demand is weak, not because it is neglected.
- **HumanLayer's orphaned users.** They have about 30 days to export or self-host. This is a concrete, time-boxed acquisition channel.

## 5. What YC's pattern tells us

- **What got funded:** 2-person technical teams (often ex-Stripe, Vercel, AWS or Coinbase) with a crisp, single-noun product, such as "debit cards for agents" or "Okta for agents". Solo founders do get in (Allowance, Executor, Routant).
- **Positioning that works:** a concrete artifact (card, wallet, gateway, bank account), not a "layer". Open-source plus MCP distribution is the default go-to-market.
- **Typical traction at Demo Day:** low. Most pages show nothing. Standouts show GitHub stars and npm downloads (Executor), a production merchant (Agentcard), or early revenue ($50K/month at GrayPass).
- **Could Suwappu apply credibly?** Yes, but not as "the permission layer for AI agents", which reads as a crowded, generic layer. A credible story would be:

  > "Agents are starting to move money for SMBs. The owner approves in WhatsApp or Telegram with one tap. Every payment is held against a budget and leaves a signed receipt. We work across Stripe, cards, UPI/Pix and x402."

  It would need, in about 8 to 10 weeks:
  - 5 to 10 design partners actually routing refunds or payouts through it;
  - a measurable dollar volume guarded, even about $10k;
  - at least one "blocked a bad spend" anecdote;
  - an OSS SDK or MCP server with visible adoption (500+ stars, or weekly npm pulls);
  - Suwappu's existing Telegram bot and multi-chain execution as proof of shipping speed.

  Being solo is acceptable, but a technical co-founder with payments or fintech-EM background would materially help.

## 6. Recommendation: sharpen, do not abandon

**Drop** the broad "permission layer for AI agents" framing. Generic agent IAM, MCP gateways and approvals are saturated (14+ YC companies, $150M+ non-YC funding), and open source is commoditizing them.

**Sharpen to:** *"Spend guard for money-moving agents, approved in chat, with signed receipts."*

- **Buyer:** SMBs and operators whose agents issue refunds, payouts or vendor payments.
- **Wedge capability:** budget reservation, approval in Telegram/WhatsApp/Slack, and a verifiable receipt.
- **Rails:** start with one fiat rail (Stripe refunds/payouts) plus x402. Add UPI/Pix as the emerging-market differentiator once a design partner pulls for it.

**Immediate moves:**

1. Ship an OSS "spend guard" MCP server or SDK this month, so we are not out-distributed by OneCLI or Executor.
2. Target HumanLayer migrants before its hosted product sunsets.
3. Integrate *on top of* Agentcard/Sponge/Stripe rather than competing on cards.
4. Recruit 5 design partners and treat "dollars guarded" as the north-star metric.

**Kill criteria:** if, by roughly February 2027, there are no paying or committed design partners, or Payman or Agentcard ships chat approvals plus receipts, treat the wedge as closed. In that case, move to the receipts/assurance angle (selling to insurers and auditors) instead.

**Key UNVERIFIED items to resolve before investor use:**
- Payman's YC status and funding;
- Agentcard's investors;
- Clawvisor's batch;
- Palomma's $14M raise;
- all self-reported traction figures.

Sources (new this pass):
- [CB Insights: Payman](https://www.cbinsights.com/company/payman-ai)
- [StartupHub: Payman](https://www.startuphub.ai/startups/payman)
- [YC Payments directory](https://www.ycombinator.com/companies/industry/Payments)

All other sources are as cited in the sweep results: YC company pages, TNW, Fortune, SiliconANGLE, SecurityWeek, Dealroom, and the Razorpay newsroom.

---

# Verification pass

**Verdict up front:** The draft's core thesis holds. Generic agent permissions are crowded, and no one checked ships money-aware chat approvals plus signed receipts. But the draft is wrong or overreaching on Payman, Agentcard's policy depth, Clawvisor, and the "nobody does chat approval" claim. Several threat rankings need adjusting.

I checked 8 claims. Primary pages were YC company pages and paymanai.com. Search snippets were used where marked.

**Claims checked**

1. **Payman is the #1 closest threat and is "YC": WRONG as written.**
   - `ycombinator.com/companies/payman` returns 404.
   - The YC "YC/Initialized $4.2M" claim comes from one aggregator. A repeat search found funding figures of $0.8M, $3M, $4.2M, $12.57M and $14M, so funding is unusable.
   - paymanai.com (fetched; the page was truncated at 100k of 142k characters) now pitches "agentic AI for banks and credit unions" with SOC 2 Type II and a credit-union CEO testimonial. It has no visible Slack/Telegram/WhatsApp approvals, receipts, or pricing.
   - The draft's "SMB refund/payout spend guard" framing of Payman is stale. The company appears to have pivoted up-market to banks. Demote Payman from threat #1 to "pivoted, possibly vacated the SMB slot." This may be good news for us, but check the rest of the page and its docs.

2. **Agentcard has the most capital, and adding policy is "a few weeks": PARTLY HOLDS.**
   - YC page (fetched): Summer 2026; $8M headline dated Nov 13, 2026; no investors named; no spend limits or policy controls described.
   - The only approval is a "human authorization & checkout handoff": the user's cart URL is shared with Agentcard to complete the purchase.
   - "$8M seed" is a news headline, and the page doesn't say it's a seed. Investors are still UNVERIFIED.
   - The "few weeks to add policy" claim is my inference, not evidence.

3. **Locus: "budgets, permissions, audit trails", F25, team of 2, $50/mo: HOLDS.**
   - YC page: "permissions and limits for every transaction" and "traceable, auditable, and reconcilable". No human approval workflow is described.
   - The $50/mo and 5%-over-$1k pricing is for Locus Founder, not the payments product. Pay With Locus pricing is not listed.
   - The "pivot signals weak governance demand" reading is the draft's inference. It is reasonable but not evidence.

4. **Allowance: Spring 2026, solo, per-purchase iPhone approval: HOLDS.**
   - Confirmed: team of 1, one-time virtual cards, spending limits, merchant restrictions, expiry, revoke.
   - The YC page itself calls it "a spend control layer for AI agents", so it is a closer messaging match than the draft implied.

5. **OneCLI: "approval in chat", S26, free OSS: MOSTLY HOLDS, with a batch error.**
   - YC page: Summer 2026, Tel Aviv. Sensitive actions "wait for approval in the chat". Examples are sending an email, deleting a Linear ticket, emptying an S3 bucket. Admins set policy. Every call is logged with the employee and the policy that allowed it.
   - It mentions only chat/Slack. There are no spend or budget features and no receipts.
   - Correct the draft: OneCLI's approvals are Slack/chat for ops actions, not money.

6. **Clawvisor batch: WRONG row.**
   - `/companies/clawvisor` served the Wakeshift page, which is Spring 2026, a 3-person MCP wake-up SDK. The founder (Eric Levine) lists Clawvisor as a separate product.
   - Clawvisor has no YC page of its own that I could fetch. Its YC batch is UNVERIFIED, and the two sweeps assigned it inconsistent batches (P26 vs S26).
   - Drop Clawvisor from the YC count or mark it "founder is YC (Wakeshift, Spring 2026); product not confirmed YC".

7. **HumanLayer exit: HOLDS.**
   - Multiple outlets agree Factory announced the acquisition on Nov 4, 2026. Hosted access has a 30-day floor. Paying customers are refunded. HumanLayer core is Apache 2.0. "Hundreds of DAU" is Factory's claim.
   - One aggregator dates the deal Oct 2026. The "hosted shutdown about Dec 4" date is a floor, not a fixed date.
   - "HumanLayer migrants" are mostly coding-agent users, not payment users. The draft's acquisition-channel idea is weaker than it sounds.

8. **White space: "no one does Telegram/WhatsApp/Slack approval of agent spend": PARTLY WRONG.**
   - Slack approval of agent spend exists. A search for Slack agent-payment approvals returned several items, none opened or primary-verified:
     - a "Stripe spend requests" pattern where a one-time token is released after user approval;
     - open-source Slack approval gates (Aegis, Kova-style wallets);
     - Payhawk's Financial Controller agent in Slack (fetched; the page confirms Slack approvals of requests but not spend specifically, so UNVERIFIED for spend).
   - Telegram and WhatsApp approval of agent spend: the search found nothing. This narrower claim holds as "not found", not as proven absent.
   - Reword the white space to "WhatsApp/Telegram plus UPI/Pix approval, cross-rail". Do not claim Slack is empty.

**Missed or under-weighted competitors**

- **Stripe's own agent spend stack** (shared payment tokens, spend-request pattern, Issuing controls). The draft names it only as a bundler and never verified it. This is the biggest unverified risk for the Stripe-refund wedge.
- **Payhawk** (spend management with a Slack agent). It is a human-spend incumbent that is adding agents.
- **Open-source Slack approval gates** (Aegis, Kova, and similar). These show approval-in-chat is easy to copy.
- **Sapiom** ($35M Series A, Aug 2026, per Dealroom) was left in the draft as "undetermined". It is the largest round in the category and should be opened before any pitch.

**Still unverified:** Agentcard's investors, Palomma's $14M, the Razorpay and Meta claims, Skyfire, Natural and Catena funding (not checked), and all self-reported traction figures.

**Final verdict (5 lines)**
1. The thesis holds: Telegram/WhatsApp plus UPI/Pix approval, cross-rail reservation, and signed receipts are not found in any YC page I checked.
2. Do not claim "nobody does chat approval". Slack approval for agent spend and OSS approval gates already exist.
3. Payman is not the top threat: it appears to have pivoted to banks, and its YC and funding claims are unreliable.
4. The real threats are Agentcard (capital plus a merchant), Allowance (same story, consumer-side) and Stripe's native spend controls (unverified).
5. Before investor use, fix the Clawvisor row, open Sapiom and Stripe's agent docs, and treat all funding figures as press-level.

HANDOFF
agent: none
task: Optional follow-up for researcher. Read paymanai.com fully (past char 100000) and its docs. Read Stripe agent-spend docs. Open Sapiom's site. Confirm Telegram/WhatsApp approval in TON and Mailgent wallets.
files: none (web research only)
risks: not MONEY-PATH, no migration. Mostly YC self-reported pages. Aggregator funding figures are unreliable.

---

# Appendix: raw sweeps

## yc-agent-payments
**Answer:** The YC agent-payments field is crowded at the "wallet / card / checkout" layer. Almost none of it is a true *permission layer* with org-wide budgets, multi-channel human approval and verifiable receipts. The closest overlaps are Locus (F25), Allowance (Spring 2026), Agentcard (Summer 2026, $8M seed), Agentic Fabriq (W26) and Salus (W26). Nobody I found covers chat-native approvals (Telegram/WhatsApp/Slack), UPI/Pix, or tamper-evident receipts. All rows below are from YC pages unless tagged otherwise.

Method caveat: the YC directory is JS-rendered and WebFetch returned nothing for `/companies?query=`. I enumerated through search plus individual company and launch pages, so this is not exhaustive. YC now labels batches by season and year (Winter/Spring/Summer/Fall 2026) as well as W/S codes.

| Company | Batch / investors | Product | Overlap | Pricing | Traction (date) | Gap vs us |
|---|---|---|---|---|---|---|
| Allowance | YC Spring 2026, solo founder, SF | One-time virtual cards for agents. User approves each purchase on iPhone; limits, merchant restrictions, expiry. [YC](https://www.ycombinator.com/companies/allowance) | High (approval + caps) | n/a | Team of 1; no metrics | iPhone-only approval, consumer, no org budgets, no audit/receipts, no chat channels |
| Agentcard | YC Summer 2026; seed backed by Peak XV, Fin Capital, YC (UNVERIFIED, press) | Debit/one-time cards, PCI vault, agent-browser integrations, checkout completion; MCP/CLI/API. [YC](https://www.ycombinator.com/companies/agentcard), [launch](https://www.ycombinator.com/launches/Qx6-agentcard-debit-cards-for-ai-agents) | High | Not listed | $8M seed, Nov 13 2026 (YC page news item; [thesaasnews](https://www.thesaasnews.com/news/agentcard-raises-8m-seed/)); team of 4; self-claimed 99% checkout success; DoorDash first merchant | Card rails only; no policy engine, allow/block/approve routing, or receipts. Best-funded direct rival |
| Locus | YC F25 (Fall 2025); team of 2; no investors stated | Agent identities, budgets, permissions, audit trails; USDC on Base, ACH/wire "coming soon". [YC](https://ycombinator.com/companies/locus) | High (policy + audit) | Locus Founder $50/mo; free daily tier; 40+ pay-per-use APIs | No customer or revenue numbers. Pivoting toward "Locus Founder" (text-prompt business builder, launch Jun 15) | Crypto-only, no human approval channel, no tamper-evident receipts, no SMB or EM focus |
| Sponge | YC W26; 3 ex-Stripe founders | Wallet (bank accounts/cards/crypto) for agents, plus Gateway so businesses sell to agents from an API spec. [YC](https://www.ycombinator.com/companies/sponge) | Med | Not stated | No metrics | Wallet and merchant side; no policy or approval layer |
| Versine | YC Fall 2026; 3 founders (ex-Stripe Connect, Databricks) | "Agent-first consumer bank": agents send money via MCP; passkey/Face ID approval; per-recipient autonomy; $2,500/wk cap. [YC](https://www.ycombinator.com/companies/versine), [fourweekmba](https://fourweekmba.com/ai-versine-lets-chatgpt-and-claude-send-money-2500-a-week/) | High (payouts + approval) | $100 send credit (promo) | Launched Nov 17 2026; no metrics | Consumer P2P, US-only, in-app approval only, no org budgets or audit |
| Payman | YC-backed per third parties (UNVERIFIED: no YC page found, `/companies/payman` is 404). Seed reported $4.2M Jun 2025 vs $12.57M on CB Insights; conflicting | Agent wallets with daily/per-txn caps and approval thresholds; ACH + USDC payouts. [dupple](https://dupple.com/reviews/payman), [CB Insights](https://www.cbinsights.com/company/payman-ai) | High (closest to the refund/payout spend-guard wedge) | UNVERIFIED | UNVERIFIED | Limited rails; chat approvals and receipts not evidenced |
| Orthogonal | YC W26; team of 3 (ex-Vercel/Coinbase billing) | Marketplace where agents pay for data APIs from one prepaid balance via MCP/SDK. [YC](https://www.ycombinator.com/companies/orthogonal) | Low-Med | Per-request provider pricing | Early users named (Precip, Riveter, Andi, others); 3 open jobs; TheStreet piece Jun 25 2026 | Marketplace, not governance |
| Maven | YC W26; team of 2 | Payments API for chat/voice agents taking customer payments, PCI handled. [YC](https://www.ycombinator.com/companies/maven) | Low | Not stated | No metrics | Inbound collection, not agent spend |
| Protegee | YC (batch UNVERIFIED) | Payments API for voice agents. Only seen in a search snippet; my fetch of the company page returned unrelated content | Low | UNVERIFIED | UNVERIFIED | Same as Maven |
| Agentic Fabriq | YC W26; team of 2 | Control plane: per-agent identity, scoped permissions, approval flows, audit logs. [YC](https://www.ycombinator.com/companies/agentic-fabriq) | High on policy/approval, zero on money | Not stated | No metrics | No payment rails, budgets or receipts. A threat if it adds spend |
| Salus | YC W26; team of 2 | Runtime action checking: YAML/plain-English policies, budget and loop protection, human-in-the-loop escalation. [YC](https://www.ycombinator.com/companies/salus) | Med-High | Not stated | Self-reported benchmarks only; hiring 2 | Action correctness, not money movement or receipts |
| Alter | YC S25; team of 2 | Zero-trust identity and RBAC/ABAC per tool call, short-lived scoped credentials. [YC](https://www.ycombinator.com/companies/alter) | Med (policy) | Not stated; beta access request | Seeking design partners | No payments, no human approval UX |
| Saldor | YC S24; team of 2 | AI procurement and accounts payable, "request to paid". [YC](https://www.ycombinator.com/companies/saldor) | Med (procurement wedge) | Free white-glove pilot | No customer numbers | Software for human finance teams, not an agent-governance layer |
| Lumari | YC Spring 2025 | Procurement agents with configurable guardrails and approval layers, Slack integration (search snippet; not fetched, UNVERIFIED) | Low-Med | UNVERIFIED | UNVERIFIED | Does not move money |
| Wildcard / Goodshelf | YC (Goodshelf W25; Wildcard shown as YC in [Rye's roundup](https://rye.com/blog/agentic-commerce-startups)) | Merchant-side agentic commerce: retailer for AI shopping agents; SKU visibility in AI assistants. [YC](https://www.ycombinator.com/companies/wildcard) | Low | Not stated | Wildcard: "20+ brands live" (self-reported) | Sell-side, not buy-side control |
| Trepo | YC Fall 2026; team of 2 | Grocery-shopping agent plus kitchen device. [YC](https://www.ycombinator.com/companies/trepo) | Low | Pre-orders | Pre-launch | Consumer |
| Uno Wallet | YC Spring 2026; team of 2 | "AI mobile wallet that replaces Apple Pay". [YC](https://www.ycombinator.com/companies/uno-wallet) | Low | n/a | None | Consumer wallet, not agent governance |
| Peakflo | YC W22, Singapore | Agentic invoice-to-cash, procure-to-pay, expenses (via [YC industry listing](https://www.ycombinator.com/companies/industry/Payments)) | Low-Med (EM SMB finance) | UNVERIFIED | UNVERIFIED | Back-office automation; no agent permissioning |
| Alaan | YC W23, Dubai | AI-native finance, corporate cards, policy-breach flagging (same listing) | Low-Med | UNVERIFIED | UNVERIFIED | Human spend management, not agents |

Non-YC context:

| Company | Investors / funding | Product | Overlap | Traction |
|---|---|---|---|---|
| Natural | Forerunner led $30M Series A, Jul 21 2026; over $40M total ([TNW](https://thenextweb.com/news/natural-series-a-agentic-payments-ai-agents)) | FDIC-insured agent wallets and "vaults" an agent can't withdraw from alone; cards, per-call billing and credit lines planned | High | 17 staff; no named customers; market estimated at about $28k/day globally |
| Lava Payments | Lerer Hippeau led $5.8M seed, Aug 6 2025 ([TechCrunch](https://techcrunch.com/?p=3034583)); YC status not stated | Usage-credit wallet for agents paying models and merchants | Med | Unknown |
| Skyfire | $9.5M total ([Rye roundup](https://rye.com/blog/agentic-commerce-startups); YC status not stated) | Agent identity and payments (KYAPay) | Med | Unknown |
| Nekuda | $5M seed, Madrona (same roundup) | Agentic payments SDK for credentials and authorizations | Med-High | Unknown |

**Takeaways**
- **The cards/wallet layer is the YC hotspot.** At least 6 relevant companies launched from W26 to Fall 2026 (Sponge, Agentcard, Allowance, Versine, Maven, Orthogonal). Agentcard's $8M seed (Nov 13 2026) shows capital is flowing, but only to rail and checkout plays.
- **Governance and money are split.** Control-plane companies (Agentic Fabriq, Salus, Alter) don't move money. Money companies (Agentcard, Sponge, Allowance) have thin policy: per-card budgets and one-tap approval. Locus and Payman come closest to a spend guard, and both are crypto/ACH with no chat approvals. A combined policy, approval, receipt and rails product is an open slot, though it is early and could close fast.
- **Approval UX is in-app or iPhone only.** Allowance and Versine use native-app, passkey or Face ID approvals. I found no YC company doing Telegram, WhatsApp or Slack approvals, or UPI/Pix, and no one pitching tamper-evident receipts (Locus only says "auditable").
- **Traction is near-zero everywhere.** Apart from Agentcard's seed and Natural's Series A, no YC page shows customers or revenue. TNW estimates global agentic payment volume at about $28k/day, so demand is unproven for everyone, including us.
- **Threats:** Allowance is also a solo founder, with a clean consumer story. Agentcard has capital and a merchant (DoorDash) in production. Agentic Fabriq or Locus could add spend caps in weeks. Payman is the nearest to our refund/payout wedge, but its YC status and funding are unverified. Differentiate on policy-plus-receipts, chat channels and emerging-market rails rather than on cards.

UNVERIFIED summary: Payman (batch, funding, traction), Protegee, Lumari, Peakflo and Alaan traction, Agentcard investors, and any pricing not stated on the pages above. An earlier search snippet describing "Blaze (S24)" as agentic finance was wrong; Blaze's YC page is W22 marketing automation, so it is excluded.

HANDOFF
agent: none
task: Optional follow-up research: (1) verify Payman's YC batch and funding via payman.ai, its launch post or Crunchbase; (2) read Agentcard, Locus and Sponge pricing pages and docs for approval and receipt features; (3) check whether anyone (YC or not) offers WhatsApp/Telegram/Slack approvals or UPI/Pix for agent spend.
files: none (web research only)
risks: Source quality is mixed. Funding and investor claims for Agentcard and Payman come from press or aggregators, not primary pages. The YC directory could not be enumerated directly, so some YC agent-payment companies may be missing.

## yc-agent-auth-hitl
**Answer:** The YC agent auth/permissions/HITL lens is crowded with tiny 1-6 person teams (W26 to F26). Almost none show public traction. The best-funded rivals are non-YC (Runlayer, Arcade, Keycard). The original YC HITL leader, HumanLayer, was acquired by Factory on 2026-11-04 and pivoted to coding-agent IDEs, so the "approval in Slack/SMS/email" slot is now vacant. No company found here ties approvals to money movement or spend budgets, and none does chat-native approval on WhatsApp/UPI/Pix. That is Suwappu's open wedge.

Fetched from YC pages: all rows marked "YC page" below. Non-YC rows come from web search snippets only, so treat them as UNVERIFIED beyond the cited facts.

| Company | Batch / investors | Product | Overlap | Pricing | Traction (date) | Gap vs us |
|---|---|---|---|---|---|---|
| HumanLayer | YC F24 (YC page). Acquired by Factory, announced 2026-11-04 | Started as human-in-the-loop approvals (Slack/SMS/email) for agents. Now a multiplayer coding-agent IDE/cloud | High (original), low now | Hosted access ends after 30 days from 2026-11-04. Core going Apache 2.0 | Funding conflicts: $0.5M (CB Insights, Oct 2024) vs >$3M (company-reported). "Hundreds of DAU" per Factory. Team of 2 | Left HITL for coding. No spend policy, receipts, or payment rails. Open-sourced SDK may seed competitors |
| Agentic Fabriq | YC W26 (YC page) | "Okta for agents": per-agent identity, scoped permissions, approval flows, audit logs | High | None listed | None listed. Team of 2 | General IAM. No spend caps or reservation, no chat-native approvals, no payment rails |
| Alter | YC S25 (Launch YC page) | Zero-trust proxy for agent tool calls. Parameter-level RBAC/ABAC, real-time approve/deny, short-lived tokens, MCP hosting, SOC2/HIPAA focus | High | Beta request only, no public pricing | No named customers. Launch post is over 1 year old | Enterprise/regulated focus. Parameter policy, but no budgets or money rails, and no WhatsApp/Telegram approvals |
| Clawvisor | YC P26 (batch per the Wakeshift founder bio on YC; the Clawvisor page itself did not load) | "Authorization layer for AI agents" for Gmail/Slack/Drive without exposing credentials. UNVERIFIED (search snippet only) | Med-High | UNVERIFIED | Founder Eric Levine (ex-Berbix, Airbnb T&S, YC visiting GP). No metrics | Task/app-level authorization, not money. No spend budgets |
| OneCLI | YC S26 (YC page) | Open-source platform where agents prepare changes and wait for approval when rules require it. Credentials kept away from agents, every call logged | High | Free, self-hostable. Cloud pricing unlisted | None listed. Team of 2 (Tel Aviv) | Generic business apps. No payments, spend caps, or tamper-evident receipts mentioned |
| Executor | YC S26 (YC page) | Open-source MCP gateway. Per-tool permission of always-allow, needs-approval, or blocked | High (policy) | Free MIT local app. Self-hosted. Hosted "Executor Cloud" | 2,800+ GitHub stars, ~14k npm downloads/week, ~3k local users (page, undated). Solo founder ex-Vercel | Per-tool allow/approve/block only. No budgets or money awareness. Approval UX is not chat-native |
| Multifactor | YC F25 (YC page) | Auth, authorization and audit for agents. Revocable account sharing, event history, password manager | Med | Free today. Enterprise tier "coming soon" | Team of 6. Claims enterprise partners with agents in "$7.5B+ manufacturing supply chains" (company claim). Forbes mention | Credential sharing focus. No spend policy or rails |
| Golf | YC S25 (YC page) | Open-source production MCP servers plus a hosted gateway. Shadow-AI visibility, policy enforcement, audit trails | Med | Demo only | Spoke to 40+ MCP builders, "running in production with companies". No numbers | Enterprise visibility. No approvals-in-chat, no money |
| ContextFort | YC S25 (YC page) | Chrome extension that detects AI browser agents, records their actions, blocks risky ones | Low-Med | Not listed | None. Team of 2. Its YC page also mentions a different construction product, so focus is unclear | Browser-only. No payments |
| Armorer Labs | YC F26 (YC page) | Runtime check of agent actions for prompt injection, goal hijacking, data leaks, then allow/hold/deny. Also finds security issues in customers' agents | Med (hold/deny) | Demo only | Team of 2 (ex-AWS security). Advisor/investor Paul Vixie. Quotes a Just Eat Takeaway director. Benchmark claims are self-reported | Detection-based. Not policy/budget-based, no payments |
| GrayPass | YC F26 (YC page) | Decides allow/challenge/hold/deny on sensitive actions (moving money, exports, admin changes) using identity, device, and behavior signals. Covers agent actions | Med-High (money-moving) | Not listed | 900k+ sessions. Reports $50K revenue "this month" per launch post (undated) | Human-identity and fraud signals, not agent spend budgets, org-wide reservation, or receipts. Strongest traction in this lens |
| Superagent | YC W24 (YC page) | Security for AI-native developers. PR checks, runtime boundaries on agents, red teaming. Earlier launched as an AI firewall | Low-Med | "Free for open source". Paid tiers unlisted | None listed. Team of 2 | Dev-security framing. No approvals or payments |
| PromptArmor | YC W24 (directory listing only) | GenAI security. Details UNVERIFIED | Low | UNVERIFIED | UNVERIFIED | Prompt-injection detection |
| Traceforce | YC S26 (directory listing) | Visibility into employee AI-app use, blocks unsafe actions | Low | n/a | n/a | Employee-AI governance, not agents with money |
| Fabraix | YC S26 (directory listing) | Red-teaming agents that test customer AI agents with planted payloads | Low | n/a | n/a | Testing, not runtime control |
| Kestrel AI | YC F25 (directory listing) | Automation layer for platform teams (CLI, Python SDK, MCP server) | Low | n/a | n/a | Out of scope |
| Runlayer | Non-YC. Khosla (Keith Rabois), Felicis | MCP gateway, threat detection, observability, and governance control plane | High | Pricing page exists. Terms UNVERIFIED | $11M seed (Nov 2025). $30M Series A led by Felicis (June 2026), $42M total. "Dozens of customers, 8 unicorns" (Nov 2025 claim). Per press (TechCrunch, SecurityWeek, Fortune) | Enterprise MCP security. Not money-aware, no chat-native approvals |
| Arcade.dev | Non-YC. SYN Ventures led, Morgan Stanley and Wipro participated | Agent authorization/governance plus an MCP tool catalog | High | UNVERIFIED | $60M Series A (June 2026), $12M seed earlier (SiliconANGLE) | Enterprise tool auth. No spend guard or SMB chat approvals |
| Keycard | Non-YC. Acrew led $30M Series A. $8M seed earlier | Identity and access management for agents (ephemeral credentials) | High | UNVERIFIED | $38M total (Oct 2025). Acquired Anchor.dev in 2026 (SiliconANGLE, UNVERIFIED) | Enterprise IAM. No budgets or approvals in chat |
| Permit.io, NeuralTrust TrustGate, Microsoft agent-governance-toolkit, agentgateway | Non-YC | Policy and approval gates (Permit HITL on Enterprise), MCP security gateways, open source | Med-High | Permit.io HITL is Enterprise-tier | Details not checked. Sources are vendor blogs and GitHub | Developer/enterprise infrastructure. Commodity approval gates are being given away free |

**Takeaways**
- **The generic "agent IAM + MCP gateway" space is saturated and commoditizing.** At least 6 YC companies (Alter, Agentic Fabriq, Executor, OneCLI, Golf, Multifactor) plus Runlayer, Arcade and Keycard ($38M-$72M raised) already do identity, tool permissions and audit. Executor and OneCLI are free and open source. Competing on "policy for agent tool calls" generally is a losing position for a solo, $0 founder.
- **The money-specific layer is open.** Across the YC pages I fetched, none offers spend caps, org-wide budgets with reservation, or payment rails. The closest are GrayPass (human fraud-signal decisions on money movement, $50K/month reported) and Armorer (detection-based hold/deny). Position as "a spend guard for money-moving agents", not a general permission layer.
- **HITL-in-chat lost its YC leader.** HumanLayer pivoted and was acquired (2026-11-04, hosted shutdown ~30 days). Its customers are being told to export or self-host, which is a possible acquisition window for Suwappu. Its Apache-licensed SDK may also lower the cost for others to build approvals. No other YC company found here ships WhatsApp, UPI or Pix approvals.
- **Traction is thin everywhere in YC.** Only GrayPass (900k sessions, $50K revenue) and Executor (2.8k stars, 14k npm/week) show numbers. The rest are 2-person teams with no metrics. Open-source distribution (Executor, OneCLI, HumanLayer) is the common go-to-market, so a free OSS spend-guard SDK or MCP server is probably table stakes.
- **Verifiable receipts and tamper-evident audit are only claimed as plain "audit logs".** Nothing found shows cryptographic receipts, and SOC2/HIPAA is the pitch (Alter). That is a potential differentiator, but I only checked descriptions.

**Not checked:** I did not view the Clawvisor YC page directly. I did not check PromptArmor, Traceforce, Fabraix or Kestrel pages, or Composio, Lasso, Obot, MintMCP and Descope. I did not run a full YC directory crawl; its "Loading more" pagination cut the lists off, so more companies likely exist. Dates for Alter's and GrayPass's launch posts were not shown. Customer counts and benchmarks are all company-reported.

Sources:
- https://www.ycombinator.com/companies/humanlayer
- https://www.ycombinator.com/companies/agentic-fabriq
- https://www.ycombinator.com/launches/OCi-alter-identity-and-access-control-platform-to-secure-agents
- https://www.ycombinator.com/companies/onecli
- https://www.ycombinator.com/companies/executor
- https://www.ycombinator.com/companies/multifactor
- https://www.ycombinator.com/companies/golf
- https://www.ycombinator.com/companies/contextfort
- https://www.ycombinator.com/companies/armorer-labs
- https://www.ycombinator.com/companies/graypass
- https://www.ycombinator.com/companies/superagent
- https://www.ycombinator.com/companies/industry/security
- https://www.ycombinator.com/companies/industry/identity
- https://www.ycombinator.com/companies/clawvisor
- https://runtimewire.com/article/factory-acquires-humanlayer-multiplayer-coding-agents
- https://www.beri.net/article/factory-humanlayer-acquisition-hosted-platform-30-day-transition-export-self-host-open-source-refunds-coding-agents-customer-continuity
- https://www.securityweek.com/runlayer-raises-30-million-in-series-a-funding/
- https://fortune.com/2026/06/24/exclusive-vinod-khosla-felicis-runlayer-nanit-30-million-enterprise-ai/
- https://siliconangle.com/2026/06/15/ai-agent-authorization-startup-arcade-nabs-60m-investment/
- https://www.helpnetsecurity.com/2025/10/22/keycard-ai-agents-identity-access-platform/
- https://www.permit.io/blog/software-factory-security-ai-coding-agents

HANDOFF
agent: none
task: Pure research. Conductor should merge this lens with the payments/rails and chat-approval lenses. Suggested follow-ups: (1) have researcher pull Clawvisor (launch post and site), the Executor and OneCLI GitHub repos, and the HumanLayer OSS repo, to see whether a spend-guard plug-in or Pix/UPI approval channel could be built on them; (2) confirm no YC company ships money-aware budgets, using the YC directory with queries "agent payments" and "spend".
files: none (web research only)
risks: Not MONEY-PATH, no migration. Data caveat: YC pages are company-written and undated. Funding and traction figures are mostly self-reported. Listing-only rows (PromptArmor, Traceforce, Fabraix, Kestrel) are not verified beyond the directory blurb.

## yc-agent-audit-ops
**Answer:** The YC agent-audit/ops lens is crowded at the "agent authorization/approval gateway" layer, but all the YC entrants I found are enterprise/CISO-targeted, MCP/tool-call-scoped, pre-traction, and none touch money rails, spend budgets, chat-native approvals for SMBs, or UPI/Pix. The one clear money-adjacent gap is spend reservation plus verifiable receipts. Evidence is mostly YC directory pages (self-reported). Searches were limited (about 8), so the list is not exhaustive. I did not reach the 10-25 target. 12 companies are listed, and several rows are thin.

| Company | Batch / investors | Product (one line) | Overlap | Pricing | Traction (date) | Gap vs Suwappu |
|---|---|---|---|---|---|---|
| Alter | YC S25 | Identity/access layer between agents and tools: RBAC/ABAC, parameter-level policy, real-time approve/deny, short-lived tokens, full audit log, SOC2/HIPAA/GDPR controls. Source: [YC launch](https://www.ycombinator.com/launches/OCi-alter-identity-and-access-control-platform-to-secure-agents) | HIGH (policy, approvals, audit) | Not public (beta, alterai.dev) | No customers named; beta | No spend caps, budgets or payment rails. No chat-native human approval. Receipts are logs, not stated as tamper-evident. Enterprise/regulated focus. |
| Clawvisor | YC listing; batch not confirmed. UNVERIFIED: the YC page fetched was Wakeshift (S26, same founder) | "Authorization layer for agents": approve a task once, each request checked against it, risk-scored, blocked if off-task, every action logged. Source: [YC page](https://ycombinator.com/companies/clawvisor) | HIGH | Not public | Team of 3; no customers or funding listed | Task-scoped authorization, not monetary budgets. No payment rails, no org-wide spend reservation. |
| OneCLI | YC S26 (Tel Aviv, 2 founders) | Open-source self-hosted platform for delegating work to agents: network-layer credential injection, org-wide policy, sensitive actions wait for approval in chat, all calls logged. Source: [YC page](https://www.ycombinator.com/companies/onecli) | HIGH. It is the closest on "approval in chat" and org policy. | Free to self-host; paid tier not stated | None stated | Approvals are generic, not money-specific. No spend caps, no payments, no verifiable receipts. OSS means price pressure. |
| Routant | YC F2026 (SF, solo founder, ex-IMC options trader) | Zero-trust access layer: single MCP endpoint, per-tool permissions, approval for sensitive actions, request log. Source: [YC page](https://www.ycombinator.com/companies/routant) | MED-HIGH (hosted MCP, policy, approval) | Not public | None stated | Targets CTO/CISO access to private systems, not payments. No spend budgets or chat-native approvals stated. |
| Executor | YC S2026 | MCP gateway: one sign-in for org integrations, unified agent-access management. Source: [YC AIOps list](https://www.ycombinator.com/companies/industry/AIOps) | MED (hosted MCP) | Unknown | Unknown | Integration management only. No policy-on-money, no approvals, no receipts stated. |
| Callback | YC S2024 | Auditable, permissioned system of record for enterprise operational workflows. Source: [YC AIOps list](https://www.ycombinator.com/companies/industry/AIOps) | LOW-MED | Unknown | Unknown | Workflow system of record, not an agent spend guard. |
| Raindrop | Seed $15M led by Lightspeed (Dec 2025). Series A led by CRV (Sep 2026), about $50M total. YC link UNVERIFIED: a founder-adjacent directory lists it, but I found no official YC confirmation. | Detects silent agent failures in production. Launched "Simulations" in Sep 2026. Sources: [TNW](https://thenextweb.com/news/raindrop-series-a-50m-crv-agent-failures-simulations), [Pulse2](https://pulse2.com/raindrop-15-million-seed-funding/?noamp=mobile) | LOW (observability) | Not found | Customers Vercel, Clay, Framer | Observes but does not enforce policy or approve. No payments. Shows the money available in observability. |
| Laminar | YC S24 | Open-source agent observability: trace replay, debugging, anomaly detection. Source: [YC list](https://www.ycombinator.com/companies/industry/AIOps) | LOW | OSS; paid tier not checked | Not checked | Observability only. |
| Respan | YC W24 | Open-source AI gateway plus observability and evals. Source: [YC list](https://www.ycombinator.com/companies/industry/AIOps) | LOW | Unknown | Unknown | A gateway could add budgets (LiteLLM already does token budgets), but not payment-level spend control. |
| Sentrial | YC W26 | Production agent monitoring: loops, hallucinations, user frustration, fix recommendations, Experiments. Sources: [LinkedIn](https://linkedin.com/company/sentrial), [ecosistemastartup](https://ecosistemastartup.com/?p=66934) | LOW | Unknown | Unknown | Monitoring only. |
| Carrot Labs | YC W26 | Tracks AI spend across providers, attributes costs to customers and features, anomaly alerts. Source: [YC AIOps list](https://www.ycombinator.com/companies/industry/AIOps) | MED. It is spend visibility for LLM cost, not agent-initiated money movement. | Unknown | Unknown | Reports after the fact. No enforcement, reservation or approval. Could add caps. |
| Truth Systems | YC (batch not verified) | Governance agent that monitors AI use and flags policy violations. Targets law firms and banks. Source: [YC page](https://www.ycombinator.com/companies/truthsystems), summarized via search | LOW-MED | Unknown | Unknown | Employee AI-use compliance, not agent actions or spend. |
| Galini | YC F2024 | Guardrails-as-a-service filtering harmful AI inputs and outputs per company policy. Source: [YC Compliance list](https://www.ycombinator.com/companies/industry/Compliance) | LOW | Unknown | Unknown | Content guardrails, not transaction guardrails. |
| Others seen (one-liners only) | See below | Details below | LOW | n/a | n/a | n/a |

Others seen, from the YC lists above:
- LogosGuard (F2025): prompt redaction.
- TrustAI: one search summary called it AI-agent compliance for ERP. A direct fetch of its YC page returned an unrelated company (OneTriangle). Treat the TrustAI description as UNVERIFIED.
- Papaya (F2026): agent traces to ranked fixes.
- HyperProbe (S2026): runtime debugging.
- Skillsync (W2026): agent session history.
- Baserun (S2023): LLM testing and observability.
- LiteLLM (W2023): LLM gateway.
- Agnost AI, BentoLabs, Buildbox (YC S26), The Context Company, Coval, zeroeval: agent analytics, monitoring or simulation.
- Zalos (F25): screen-records automations for audit (UNVERIFIED).
- TectoAI (S25): "AI governance at scale" (UNVERIFIED).
- Bretton AI (S2023): bank compliance agents.

**Non-YC adjacent (insurance/assurance):**
- AIUC: $15M seed (Jul 2025, NFDG), $40M Series A (Sep 2026, Ribbit). Pairs the AIUC-1 standard with insurance. Source: [fintech.global](https://fintech.global/2026/09/17/aiuc-raises-40m-to-police-risk-in-frontier-ai-agents/). No YC link found.
- Armilla AI: $25M (Jan 2026), AI liability coverage. Source: [fintech.global](https://fintech.global/2026/01/23/armilla-ai-raises-25m-to-expand-ai-liability-coverage). No YC link found.
- Kastra: Product Hunt only, "runtime authorization layer for agents". No YC listing found.

**Takeaways**
- The authorization/approval-gateway slot is already filled by at least 4 YC companies from S25 to F26 (Alter, Clawvisor, OneCLI, Routant), plus Executor. Competing on generic "permissions for agents" is a losing frame. The wedge must be the money-specific layer.
- OneCLI (open source, approval in chat) and Alter (parameter-level policy) are the nearest threats. Neither shows spend caps, org budgets with reservation, payment rails (Stripe, cards, x402, UPI/Pix) or tamper-evident receipts. None of the YC pages I read mention these.
- Everyone targets CTO/CISO buyers in enterprise or regulated industries. No one found targets SMB owners approving in WhatsApp/Telegram or emerging markets. That is an open gap, but it may reflect weak demand rather than neglect. UNVERIFIED.
- Observability is where the money is (Raindrop about $50M total, with Vercel, Clay and Framer as customers) but it is a different job. The takeaway is that buyers pay for agent reliability, so position the spend guard as loss prevention with an auditable trail.
- Pre-traction is the norm among the YC authorization startups: no customers, pricing or funding on their pages. Buyer demand is unproven, so a quick-to-ship spend-guard demo with real design partners could beat them on traction. Next step: check pricing and customers on alterai.dev, routant.ai and the OneCLI repo (stars/activity).

HANDOFF
agent: none
task: Conductor to decide whether to deep-dive Alter, OneCLI and Routant (pricing pages, GitHub stars, HN threads such as news.ycombinator.com/item?id=50187367) via a follow-up researcher run.
files: none (web research only)
risks: Descriptions are YC-directory self-reports. Raindrop's YC status, Clawvisor's batch, TrustAI's description and the TectoAI/Zalos/Truth Systems details are UNVERIFIED.

## yc-chat-commerce-emerging
**Answer:** No YC company in this lens combines policy plus spend caps, chat-native human approval and verifiable receipts. The closest to our thesis is Locus (agent wallets with limits and auditability) and Sponge (agent wallet and gateway). The chat and emerging-market YC companies sit on the messaging, collections or bookkeeping side. None builds an approval layer. The chat-native approval wedge for SMBs (UPI/Pix) looks open. The main threat there is the platforms bundling it: Meta Business AI on WhatsApp and Razorpay's WhatsApp agent.

Coverage: about 14 companies in total. The YC directory has no clean "agent payments in WhatsApp for emerging markets" cluster. Searches found none. I did not do exhaustive directory crawls, so the lens could be missing companies (UNVERIFIED). Each row's batch, product and traction come from the company's YC page unless marked.

| Company | Batch / investors | Product | Overlap | Pricing | Traction (as stated) | Gap vs us |
|---|---|---|---|---|---|---|
| [Locus](https://ycombinator.com/companies/locus) | YC F25 | Payment infra for agents. Wallets funded with user-defined permissions and limits. Payments are traceable, auditable and reconcilable. Pay/Build/Checkout With Locus (USDC SDK), 40+ pay-per-use APIs. | **High** | Free daily tier, $50/mo, 5% of profit above $1k/mo | Team of 2. No revenue or funding on the page. | USDC-centric. No chat or Telegram/WhatsApp/Slack approvals, no org-wide reservation or tamper-evident receipts shown on the page. No fiat or UPI/Pix. |
| [Sponge](https://www.ycombinator.com/companies/sponge) | YC W26 | "Financial infrastructure for the agent economy". Sponge Wallet and Sponge Gateway. Founders are ex-Stripe. | **High** | UNVERIFIED (none on page) | Team of 3. No metrics on the page. | Wallet and gateway focus. No human-approval-in-chat, policy engine or audit receipts visible. |
| [Inkbox](https://www.ycombinator.com/companies/inkbox) | YC S26 | Agent identity: email, phone, iMessage, WhatsApp, and an encrypted credential vault with TOTP. | Low-med (identity and comms, not money) | UNVERIFIED | Team of 3. Plugins for OpenClaw, Claude Code, Codex. | No spend policy or payments. Could be a channel partner. |
| [AgentPhone](https://ycombinator.com/companies/agentphone) | YC S26 | Phone numbers for agents (SMS, iMessage, WhatsApp, RCS). | Low | Free credits only | Team of 2. Claims builders at Google ADK, Replit, LangChain and Alchemy. | Pure telephony. No policy or payments. Channel infrastructure we could consume. |
| [Chert](https://ycombinator.com/companies/chert) | YC S26 | iMessage API ("Twilio for iMessage"). | Low | UNVERIFIED | Team of 2. Works with B2C startups (no names given). | Messaging only. |
| [Balance](https://www.ycombinator.com/companies/getbalance) | YC W26 | AI accounting firm. Agent "Bea" reachable via Slack, WhatsApp or email. Human accountants sign off. | Low-med (chat-native SMB finance agent) | Flat pricing, no numbers published | Team of 20. Customers in tech, ecommerce, florists and consultants. | Bookkeeping, not money movement. No spend control. Shows SMBs accept chat-first finance agents. |
| [Palomma](https://www.ycombinator.com/companies/palomma) | YC W23, Medellín | AI-native bank for LatAm real estate. Agents for leasing, sales and collections, plus pay-by-bank. | Med (LatAm collections and payments, WhatsApp confirmations) | Zero fees on first 5,000 transactions for YC companies | Team of 8. UNVERIFIED: Crunchbase headline of a $14M raise on 2026-11-11. Claims merchants save 70-80% on card fees. | Vertical (real estate) and a bank. No agent permission layer. |
| [Domu](https://www.ycombinator.com/launches/LH8-domu-building-ai-agents-for-collections) | YC (batch not stated; launch post is about 2 years old) | AI agents for collections and insurance sales over calls, SMS, WhatsApp and email. | Low-med | UNVERIFIED | Says it works with 8 of the top 20 banks and insurers in the Americas (own claim). | Enterprise, outbound collections. No approvals or spend guard. |
| [AgentCollect](https://www.ycombinator.com/companies/agentcollect) | YC S23, SF | B2B debt collection by AI agents (call, email, text, negotiate payment plans). | Low | UNVERIFIED | Team of 42. Lists Dell, Microsoft, FedEx, Plaid, Checkr. The page mixes in the founder's earlier company's stats (458 customers). | Inbound cash collection, the opposite direction of spend. Not emerging-market. |
| [Rebill](https://ycombinator.com/companies/rebill) | YC W22, Buenos Aires | LatAm financial infrastructure: local payments, installments, recurring billing, stablecoin rails, payouts. | Med (rails we would plug into) | UNVERIFIED | Team of 11. $3.6M raised (2022 press, UNVERIFIED). | Merchant-side rails. No agent policy or approval layer. |
| [Bujeti](https://techcabal.com/2025/10/24/yc-backed-bujeti/) | YC-backed, Africa | Business spend management and cards. Founders cite expenses being tracked over WhatsApp. | Med (spend controls and approvals, Africa) | UNVERIFIED | Search snippet says a $2M seed led by YC in late 2023 (UNVERIFIED). | Human spend management, not agent-focused. Not chat-native, per the sources I saw. |
| [Conta Simples](https://www.ycombinator.com/companies/industry/SMB) | YC S20, São Paulo | Account, expense management and corporate cards for LatAm companies. | Low-med | UNVERIFIED | UNVERIFIED | Cards and expenses for humans. No agent layer. |
| [Zoko](https://www.ycombinator.com/launches/IyS-zoko-unleash-ai-inside-your-whatsapp-business-number) | YC (batch not stated, India) | AI sales agent inside the merchant's WhatsApp Business number. | Low-med (WhatsApp commerce, India) | None public. Demo item priced at 1 INR via WhatsApp Pay. | Claims paying customers and "millions in revenue", no figures (UNVERIFIED). | Sales chat for merchants. No agent spend control. |
| Swipe | YC S21 (from a search summary only, UNVERIFIED) | Invoicing over WhatsApp for local businesses. | Low | UNVERIFIED | UNVERIFIED | Invoicing only. |
| Razorpay (non-YC platform context) | Razorpay is YC-backed in the search summary (UNVERIFIED) | WhatsApp agent ("Ray") and a payment-link integration announced 2026-11-17 for eligible Indian SMBs. | **Med-high as a bundler** | UNVERIFIED | Per [Razorpay's newsroom](https://razorpay.com/newsroom/?p=4747), Bajaj Finance is among the first to go live. | Merchant-side payment links. Not spend guard for agents. |

**Non-YC adjacent, seen in search (all UNVERIFIED beyond the snippet):** Meta Business AI on WhatsApp India ([launched May 2026, UPI payments "coming soon"](https://about.fb.com/news/2026/05/introducing-business-ai-on-whatsapp-for-small-businesses-in-india/)), TON agentic wallets on Telegram, Mailgent (agent USDC wallet on Base with spend cap), Pear Pay (payments over iMessage/Telegram via x402), Mercately (LatAm, Techstars, agents take payments in WhatsApp), Haptik (WhatsApp agents from ₹10,000).

**Context:** YC's Spring 2026 RFS prioritizes stablecoins and AI agents ([summary](https://www.onebullex.com/news/articles/y-combinator-spring-2026-request-for-startups-prioritizes-stablecoins-tokenization-and-ai-agents)). YC also began allowing startups to take funds in stablecoins, per [The Block](https://www.theblock.co/news/markets/2026-02-03-y-combinator-stablecoin-funding-388230). Expect more agent-wallet entrants in the next batches.

**Takeaways**
- **Closest YC overlap is thin and early.** Locus (2 people) and Sponge (3 people) have no public revenue or funding, and neither shows chat approvals or org-level budgets. The "permission layer" is not owned yet, but wallet vendors can add limits quickly.
- **Messaging is being commoditized as infrastructure.** Inkbox, AgentPhone and Chert (all 2026 batches) sell channels (iMessage, WhatsApp, phone) to agents. We should consume them rather than build channels, and position approvals as a layer on top.
- **No YC company does chat-native approval for money-moving agents.** Balance (Slack/WhatsApp) and Zoko (WhatsApp) prove SMBs accept chat-first agents, but only for accounting or sales, not authorizing spend.
- **Emerging-market YC players are rail or vertical plays.** Palomma and Rebill (LatAm) and Bujeti (Africa) own local rails or spend management. There is no agent-spend-guard for UPI/Pix. The bigger risk is Meta and Razorpay bundling WhatsApp payments, so the wedge must be policy, approval and receipts, not payment links.
- **Low confidence on completeness.** YC directory filtering was not crawled, and several rows (Swipe, Conta Simples, Bujeti details, Razorpay's YC status) rest on search snippets. Run a directory crawl on the "agent payments", "agentic" and "stablecoin" tags and on S26 and F26 batch lists before treating the field as small.

**Suggested next steps:** None are builder tasks. If a follow-up is wanted, a researcher should do a deeper pass on Locus and Sponge docs and pricing, and on the Telegram/WhatsApp approval UX of Mailgent and TON agentic wallets.

HANDOFF
agent: none
task: Research only. Optional follow-up: a researcher crawls YC directory tags (agents, stablecoin, payments) for S26/F26 batches and verifies Locus and Sponge docs for approval, audit and receipt features.
files: none (web research only)
risks: Several rows are UNVERIFIED (search snippets only). No money-path or migration impact.

## non-yc-funded
**Answer.** This is a partial, search-snippet-level scan of the non-YC funded lens. I got roughly 5 companies verified against secondary sources, and I did NOT open primary pages for the rest. Everything below is UNVERIFIED unless a source is noted. Treat it as a starting list to verify, not a finished competitor table.

**Recommendation.** The open positioning space is likely "policy + chat-native human approval + verifiable receipts across rails" for SMBs and emerging markets. The funded players listed below are mostly rails or identity (Skyfire, Catena, Natural, Nekuda). Payman is the closest overlap on policy. No funded player surfaced here as doing chat-native (Telegram/WhatsApp/UPI/Pix) approvals, but I did not search that specifically.

| Company | Batch / investors | Product (one line) | Overlap | Pricing | Traction (date) | Gap vs us |
|---|---|---|---|---|---|---|
| Skyfire | non-YC; Coinbase Ventures, a16z CSX. Seed ~$9.5M total ([The Block](https://www.theblock.co/post/322742/coinbase-ventures-and-a16zs-csx-bring-skyfires-tal-funding-to-9-5million)). A Finextra headline says "$8.5M", and the earlier seed figure is not reconciled | Payment network and identity for autonomous agents | med | UNVERIFIED | 2024-era funding; no 2026 round found | Rails and identity focus; no chat-native human approval seen (UNVERIFIED) |
| Payman | YC status conflicting: one aggregator lists "Y Combinator, Initialized" seed $4.2M, Jun 2025 (UNVERIFIED). Totals reported as $3M, $12.57M and $14M by different aggregators ([CB Insights](https://www.cbinsights.com/company/payman-ai), [StartupHub](https://www.startuphub.ai/startups/payman)) | Fund a wallet; set daily/per-tx limits and approval thresholds; agent pays within the rules | **high** (closest to our policy thesis) | UNVERIFIED | Early-stage per reviews; funding figures conflict | Check approval channels (Slack/Telegram/WhatsApp), receipts, emerging-market rails. If YC, it belongs in the YC lens too |
| Catena Labs | non-YC; Acrew Capital, a16z crypto. $30M Series A, 2026-05-20 ([Fortune](https://fortune.com/2026/05/20/catena-labs-series-a-sean-neville-ai-native-bank/)). An earlier $18M round is also reported ([PYMNTS](https://www.pymnts.com/?p=2703725)); the PYMNTS items conflict on which year it was | "AI-native bank" for agents; applying for a New York trust charter (per Dealroom) | med | UNVERIFIED | Founded by the Circle co-founder | Regulated-bank angle; enterprise/institutional rather than SMB chat approvals (UNVERIFIED) |
| Natural | non-YC; Forerunner led $30M Series A on 2026-07-20, and a credit facility of up to $100M followed 2026-08-19 ([Dealroom](https://dealroom.co/charts/startup-stack-ai-spending)) | Agent payments (details not checked) | med | UNVERIFIED | Well funded; product status not checked | Product details not checked. Best-funded name; verify the product |
| Nekuda | non-YC; Madrona led a $5M round, undated in the source ([Crowdfund Insider](https://www.crowdfundinsider.com/?p=239660)). A Hashnode post claims $12M in Mar 2026; I could not confirm it | Agentic payments credentials (wallet for agent checkout) | med | UNVERIFIED | Funding only | UNVERIFIED |
| Sapiom | non-YC (UNVERIFIED); $35M Series A, 2026-08-05, the largest 2026 round in the Dealroom data ([Dealroom](https://dealroom.co/charts/startup-stack-ai-spending)) | Agent payments/infra (not checked) | UNVERIFIED | UNVERIFIED | Largest 2026 round in this category | Not researched; check first |

**Not researched (no data gathered).** Everything below is background-knowledge only, so treat it as unverified:
- Crossmint
- Basis Theory
- Lithic / Highnote
- Ramp / Brex agent features
- Permit.io
- Arcade
- Composio
- Descope
- Stytch
- Okta/Auth0 for agents
- Microsoft Entra Agent ID
- Stripe agentic stack (Shared Payment Tokens (SPT), Issuing, Link)
- Visa Intelligent Commerce / Mastercard Agent Pay
- Coinbase x402 / AgentKit

**Takeaways.**
- Dealroom says agent-payments startups raised about $115M in 2026 as of Oct 19, more than in all of 2025, and most were founded in 2025-26. The category is crowded and getting funded. It cites Sapiom ($35M) as the largest round, with Natural ($30M) and Catena ($30M) close behind.
- Funded players cluster on rails, identity and banking. Payman is the one that surfaced with policy-style controls (limits and approval thresholds), so it is the one to study first.
- Founder-friendly gap, UNVERIFIED: none of these showed chat-native approvals (Telegram, WhatsApp, Slack) or UPI/Pix rails in what I read. Confirm by checking each company's site.
- Big-platform risk (Stripe, Visa, Mastercard, Coinbase, Microsoft, Okta) likely commoditizes the basic rails and the identity layer. I did not verify their current agent features, so check before relying on that.
- Funding-figure conflicts (Payman, Nekuda, Catena) show the aggregators are unreliable. Use company announcements or press releases for any investor-facing claim.

**Suggested next steps.** Run a second researcher pass on primary pages: payman.ai, nekuda.ai, natural, sapiom, Stripe agentic docs, Visa/Mastercard agent programs, and Permit/Arcade/Composio pricing pages.

HANDOFF
agent: none
task: Optional follow-up for researcher, not a builder task. Verify the "Not researched" list and fill pricing and traction columns from primary sources; confirm whether Payman is YC via ycombinator.com/companies.
files: none (web research only; no code files touched)
risks: none. Do not use the aggregator funding numbers in investor-facing material without primary confirmation.
