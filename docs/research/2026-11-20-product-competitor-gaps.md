# Suwappu: what we have, what we're missing, and the one bet worth testing (2026-11-20)

[V] = verified in code, git or a live probe by the cluster audits. [I] = inference. Competitor figures mostly come from vendor or affiliate sources and conflict with each other, so treat them as rough.

**Bottom line:** We built a lot, but nobody has used any of it: 0 completed swaps ever, 43 users, and agent traffic that is crawlers plus our own loops [V]. We aren't short of features; competitors don't have more features than we do. What we lack is proof that anything works, an easy first try, and distribution. The good news is that several real assets fit together into a product nobody sells as one bundle. That's the "something".

---

## 1. What we actually have (ranked)

1. **Agent-spend governance on one execute path** [V code, never exercised].
   - Pieces:
     - fail-closed USD caps and allowlists, including org-wide caps (`api-ts/src/services/PolicyService.ts`);
     - single-use step-up human approvals (`ApprovalService.ts`);
     - a hash-chained audit log with a `/audit/verify` endpoint (`services/audit.ts`);
     - a kill switch, Turnkey custody, and refund-on-failure, all inside `/v1/agent/swap/execute` (`routes/agent.ts` around 2949-3200).
   - Each piece exists somewhere else. All of them wired together and metered on one endpoint is rare and would take weeks to rebuild correctly.
   - The honest catch: Turnkey and Privy enforce policy inside enclaves, while ours runs on our own server, so users have to trust us.

2. **A multi-aggregator and bridge router with oracle-sanity ranking** [V code, 0 fills].
   - `bot/services/swap_engine.py` is 8.3k LOC with about 25 providers and an explicit EXECUTABLE_PROVIDERS guard.
   - Execution-quality tooling sits beside it: `execution_benchmark.py`, the scorer and the reconciler.
   - Its breadth goes far beyond any Telegram bot. It's worth nothing until it has filled real trades.

3. **Non-custodial EVM+Solana swap and bridge in the terminal, deployed** [V].
   - terminal.suwappu.bot returns 200 live.
   - Users sign with their own wallets: wagmi in `terminal/src/hooks/useExternalSwap.ts:49-88`, Phantom in `useSolanaSwap.ts:81-88`, plus `useBridgeExecute.ts`.
   - It also has agent approval and audit panels (`terminal/src/components/agent-control`). Whether those panels are wired end to end is [I].

4. **Verifiable-record primitives** [V code].
   - Autopilot seals each decision before execution and reveals it after, with optional on-chain anchoring (`api-ts/src/lib/seal.ts`, `services/autopilot/anchor.ts`).
   - Arbiter is a TDX-attested escrow verifier, settled end to end on NEAR testnet with tx hashes (`docs/arbiter-production.md:98-116`).
   - Both are rare. Both currently look empty: Autopilot sits at a $1,000 paper balance with 0 trades, and Arbiter's production route returns 404.

5. **Niche rails nobody else has in chat** [V code, no mainnet round trip].
   - Lightning to Starknet BTC yield with gasless AVNU, behind `/btc` (`bot/services/btc_bridge.py`, `starknet_yield.py`).
   - Hyperliquid perps with builder fees wired in (`hyperliquid_client.py:288-400`).
   - A Polymarket CLOB V2 signer, written because the official SDK is broken (`polymarket_v2_order.py`).

**Thin but real:** mpc-signer (FROST and CGGMP24, checked against RFC vectors) is serious engineering with no consumer. Its own README says it is not wired into production. Keep it on the shelf.

---

## 2. What we're missing (ranked by how much it stops anyone getting value)

| # | Gap | Evidence | Competitor that shows it matters |
|---|---|---|---|
| 1 | **No proven fill on any rail.** We have no tx hash for a swap, bridge, BTC round trip or agent execute. | 0 swaps ever [V] | Every incumbent; trust starts from public fills |
| 2 | **A login wall on the first try.** Terminal `/webapp/swap/build` returns "Not authenticated". The MCP and `/v1/agent/quote` need a key. | live curls [V] | Jupiter, Uniswap and Matcha need no login; LI.FI's hosted MCP is open |
| 3 | **Dead links in the funnel.** app.suwappu.bot (the bot's Mini App, `settings.py:1105`) returns 404. suwappu.bot/positions returns 404. The default `SIGNAL_LAB_URL` host doesn't resolve. | [V] | Any of them; a dead CTA loses every visitor it gets |
| 4 | **Stale or unpublished packages and listings.** npm `@suwappu/mcp-server` is 0.1.1 while the repo is at 0.6.0. The Python SDK isn't on PyPI. The registry listings are drafted but unpublished (`docs/distribution/registry-listings.md`). | [V] | LI.FI, GOAT and Solana Agent Kit win through packages and registries |
| 5 | **No distribution engine:** no fee-share, referral rebates, owned channel or KOLs | [V] none in prod | Banana Gun 40% fee-share; Padre 35% cashback; Bankr lives inside social feeds |
| 6 | **No owner surface for governance:** no org-policy admin API (only per-agent policy CRUD) and no approvals inbox UI | `routes/enterprise.ts` [V] | Privy and Turnkey sell dashboards plus policy APIs |
| 7 | **No trust credentials:** no audit, SOC 2, enclave enforcement or sanctions screening | [V/I] | Turnkey verifiable policy decisions; Fireblocks; the Bloom and Polycule drains made trust table-stakes |
| 8 | **Thin safety data:** no GoPlus or RugCheck, and no tx simulation | `token_security/*` uses DexScreener and Blockscout only [V] | Trojan, Phantom and Rabby all ship risk warnings |
| 9 | **Copy trading only follows Suwappu users,** so it can't copy any on-chain wallet | `copy_service.py` [V] | GMGN, Trojan and Photon, whose top retention feature is copying any wallet |
| 10 | **Speed and feeds:** the pump.fun buy is a placeholder (`snipe_executor.py:364-370`) and detection polls every 2s | [V] | Axiom and Banana Gun use Geyser/Yellowstone feeds and sub-second landing |

Gaps 1-4 cost close to nothing but the founder's time, and every bet depends on them. Gaps 9-10 are races against funded teams, so don't run them.

---

## 3. Competitive landscape

| Cluster | Best competitor | Their moat | Our position | Verdict |
|---|---|---|---|---|
| TG trading bot | Trojan, Banana Gun, Maestro | Speed, wallet copy, fee-share distribution, hundreds of thousands of users | Widest router, 0 fills, 43 users | **Freeze sprawl**; keep only the router |
| Frontends / terminal | Axiom, FOMO, Phantom, Jupiter | Mobile UX, Solana liquidity, default-wallet distribution | Login-walled non-custodial swap, dead Mini App | **Reposition**: login-free swap only |
| Agent API / MCP | LI.FI MCP, Coinbase AgentKit, GOAT | Routing depth (we wrap LI.FI), platform bundling | Broader tool surface, stale packages | **Reposition** toward governance |
| Enterprise policy | Turnkey, Privy (Stripe), Fireblocks | Enclave enforcement, compliance, scale (Turnkey 100M+ policies) | Policy, approval and audit bundle; trust-us enforcement | **Reposition**: signer-agnostic layer |
| Arbiter | agora402, PayCrow, Kustodia, ERC-8183 evaluators | Already shipped on Base mainnet [I] | Only TEE-attested verifier; testnet only | **Freeze**, or a 2-week test only with a design partner |
| Neobank / token | Ether.fi Cash, TON Wallet, Xverse | Cards, fiat rails, Telegram-scale reach | Lightning to BTC-yield niche, untested | **Freeze** except the BTC rail as a side test |
| Data / intel | GMGN, Birdeye, Nansen, Cielo | Years of history, streaming, labels | 9 hours of pump data; methodology correct | **Freeze**; maybe a free scorecard later |
| NFT / creative | pump.fun, Zora, Clanker (both down about 98%) | Owning a social loop | Positions card undeployed, mint 404 | **Freeze**; free claim only if spare time |

---

## 4. "The something": bets that combine our assets

### Bet A: Agent Spend Guard (guardrails and a human approval inbox for AI agents that move money)

- **Target user:** builders shipping trading or payment agents (MCP, ElizaOS, AgentKit, x402) who are afraid to give an agent a funded wallet.
- **Why now:** agent wallets launched in 2026 (Coinbase in Feb, Privy under Stripe, Crossmint counts 9+ platforms). Their policy engines refuse transactions outright or leave the approval UX to the customer. Fireblocks refuses out-of-rule payments rather than queuing them [V]. Our pitch is that out-of-policy spends get queued for a human to approve over Telegram, and every decision is verifiable.
- **What exists:**
  - `PolicyService.ts`, `ApprovalService.ts` and `audit.ts`;
  - the `/v1/agent/*` routes;
  - a 23-tool hosted MCP (`routes/mcp.ts`);
  - the terminal's agent-control panels;
  - the Telegram bot as the approval channel;
  - `lib/seal.ts` for sealed decisions;
  - `hackathon/tokyo2026` trust modules (World ID, screening, caps).
- **What must be built:**
  - org-policy CRUD in `enterprise.ts`;
  - a Telegram approve/deny push wired to the ApprovalService step-up flow;
  - a keyless or auto-minted key on first MCP connect;
  - publishing mcp-server 0.6.0;
  - one $1-5 Base end-to-end that exercises the policy block, the approval, execution and the audit verify.
  - Later: a "check before you sign" mode that guards Turnkey, CDP or Privy signers, not only our own execution.
- **First 10 users:** hand-onboard them from MCP, ElizaOS and AgentKit Discords and the x402 builder channels. Publish the registry listings ($0). Make a 60-second demo: the agent is blocked, the human approves in Telegram, the audit verifies.
- **Kill criteria:** first, the competitor docs. If a primary-source check shows Privy, Turnkey or CDP already ship queued human approval plus a verifiable audit, narrow to the Telegram inbox only or kill. Second, if no external agent completes a policy-gated transaction by day 30, freeze.

### Bet B: Provable best-execution swap (no signup, with a receipt)

- **Target user:** EVM and cross-chain retail traders who aren't served by Solana-only terminals, and who are skeptical of fees after FOMO's fee-erosion study [V].
- **What exists:**
  - the router and `execution_benchmark.py`;
  - the terminal's non-custodial swap;
  - `seal.ts` and `anchor.ts` for sealed, timestamped quotes.
- **What must be built:**
  - remove auth from swap build and quote, with IP rate limiting and a check that fromAddress is the connected wallet (MONEY-PATH);
  - a per-fill "you saved $X vs single-DEX" receipt, sealed in advance so it can be checked;
  - a public fill-quality scoreboard.
- **First 10 users:** a "no signup, best route, receipt" link posted on X and Telegram, plus a free embed for small token communities.
- **Kill criteria:** 10 non-founder swaps within 30 days of launch.
- **Weakness:** this is a low-margin commodity, and Jupiter and LI.FI give the same routing away for free [I].

### Bet C: Lightning to BTC savings, gasless (the side niche)

- **Exists:** the `/btc` flow, Endur/Vesu yield and AVNU.
- **Must be built:** a prod env check. `atomiq_escrow_contracts` is empty by default at `settings.py:650`, a MONEY-PATH risk. Then a $5 round trip and an "earned $X" screen.
- **First users:** Stacker News and Nostr.
- **Kill criteria:** no outside deposit settles within 3 weeks.
- **Competition:** Xverse and Starknet surface similar routes [V], and OneSat already demoed the idea.

---

## 5. Recommendation: Bet A, with B's day-one work as the shared prerequisite

**Why A:** it is the only bet that draws on four clusters at once (agent-api, enterprise-policy, tg-bot as the approval channel, terminal panels). Its buyer is reachable by hand. Funded rivals sell signing, not the approval workflow. It doesn't require out-running Axiom on speed.

**Risk:** demand is unproven and the space is crowded, so validate before building.

**30-day plan**
- **Days 1-5, proof and plumbing (prerequisite for every bet):**
  - Run real fills: Jupiter SOL, LiFi/0x on Base, one bridge, and one `/v1/agent/swap/execute` with Turnkey env set. Record the tx hashes.
  - Fix or remove the 404 links: app.suwappu.bot and /positions.
  - Publish mcp-server 0.6.0.
- **Days 3-7, validate:**
  - A primary-source check of Privy, Turnkey, CDP and Fireblocks approval and audit features.
  - 10 agent-builder conversations.
  - Go/no-go on day 7: at least 3 builders say "I'd try this this month".
- **Days 8-16, build the minimum:**
  - org-policy API;
  - a Telegram approval push with step-up;
  - keyless MCP quote or auto-key on first connect;
  - a policy, approvals and audit page;
  - the demo video.
  - All money-path diffs go through money-path-reviewer.
- **Days 17-30, onboard and measure:**
  - Hand-hold 3-5 design partners.
  - Publish the registry listings.
  - Success means 1 or more external agents complete a policy-gated transaction, and 1 approval is answered by a real human.
  - If that misses on day 30, freeze the agent line. Fall back to Bet B only if its 10-swap test is cheap.

---

## 6. Freeze/kill list

- **TG bot:**
  - Freeze sniping, internal copy trading, battle, community/tip, earn/borrow, stocks, gift cards, P2P, enterprise/org handlers and tax.
  - Hide everything from the menu except /start, wallet, paste-to-buy, swap, positions, perps and predict, plus the new approvals flow.
  - Kill the pump.fun stub claims.
- **Frontends:**
  - Freeze webapp feature work (fix or retire the URL only).
  - Freeze mobile, which is abandoned since 2026-08-15.
  - Freeze extension publishing.
  - Stop showcase redesigns.
  - Flag off the non-swap terminal panels except agent-control.
- **Agent API:**
  - Remove the `/v1/chat/completions` and webmcp claims (vapor).
  - Hide the empty Autopilot transparency page until it has trades.
  - Freeze the A2A expansion.
- **Enterprise:** stop the CFO OS work (12 commits that serve no user). Freeze SSO/SCIM until a buyer asks.
- **Arbiter and protocol:**
  - Freeze Arbiter unless a design partner commits.
  - Freeze mpc-signer, searcher, contracts-hackathon, the Tokyo passport as a standalone, and the PQ settlement work.
- **Neobank and token:** freeze SUWP token, staking, bonds and OFT (launching a token with 0 users is a negative signal), the Membership NFT, the rewards marketplace and card plans. Keep the BTC rail only as Bet C.
- **Data:**
  - Kill holder-census and the ghostcatcher exporters.
  - Kill the duplicate marketdata services.
  - Freeze execution_sync and signal-lab.
- **NFT and creative:** freeze Positions (a free 444-claim test only if spare time), the art pieces and the gitbook expansion.

**Key paths:**
- api-ts/src/services/PolicyService.ts
- api-ts/src/services/ApprovalService.ts
- api-ts/src/services/audit.ts
- api-ts/src/routes/agent.ts
- api-ts/src/routes/enterprise.ts
- api-ts/src/routes/mcp.ts
- api-ts/src/lib/seal.ts
- packages/mcp-server/package.json
- bot/services/swap_engine.py
- bot/services/execution_benchmark.py
- terminal/src/hooks/useExternalSwap.ts
- api-ts/src/routes/pythonProxy.ts:113
- bot/config/settings.py:650,1105
- docs/distribution/registry-listings.md

**Caveats:** This synthesis rests on the cluster audits. I re-read no files and ran no new web checks. Bet A's core claim, that funded rivals don't ship queued human approval plus a verifiable audit, is still unverified and is the day-7 gate.

---

# Adversarial review

ADVERSARIAL REVIEW of the draft synthesis (2026-11-20)

ANSWER: The inventory and gap list (sections 1-3) mostly hold up. The recommendation (Bet A, "Agent Spend Guard") is weaker than presented. Its central differentiator is already contradicted by a primary source. For a solo founder with $0 and 0 users, I would not make A the lead bet. The stronger plan is a smaller one: prove fills, then run cheap distribution tests before any build.

(1) CLAIMS UNSUPPORTED OR LIKELY WRONG

- "Queued human approval + verifiable audit is rare / rivals don't ship it" is wrong for Privy.
  - Privy has human approval flows with key quorums (threshold of reviewers, biometric or TOTP MFA, nested quorums), an Approvals dashboard, and webhooks on intent created/authorized/executed/failed. Source: https://docs.privy.io/controls/dashboard/approvals and https://docs.privy.io/controls/quorum-approvals/overview
  - Privy gates manual approvals to Enterprise. A routine path under a cap plus a human quorum above the cap is a documented pattern, which is exactly the "queue, don't refuse" pitch. Source: https://privy.io/blog/upleveling-stablecoin-treasury-management-with-human-approval-workflows
  - Privy is now Stripe-owned, so it has distribution you cannot match.
  - Turnkey has quorum approvals, velocity rules and enclave-proven policy decisions (from your own competitor audit).
  - Still unconfirmed: whether Privy offers a hash-chained audit export. I found only webhooks. That is the one remaining sliver of differentiation: tamper-evident audit, and Telegram-native approval UX.
  - The draft's own day-7 kill gate has therefore mostly already fired. It should be reworded as "narrow to Telegram inbox + verifiable audit, or kill".
- Coinbase Agentic Wallets are the opposite design: session caps and per-transaction limits set up front, deliberately no per-transaction approval, plus KYT screening, in TEEs (https://www.coinbase.com/developer-platform/discover/launches/agentic-wallets). This supports "queue for human" as a distinct UX. But the same sources show Coinbase wins by letting agents run unattended. Whether builders want per-transaction approval at all is unvalidated.
- Reconcile "Privy approvals are an add-on" with this finding. The enterprise-policy audit and the draft call Privy's approvals an add-on, which is true only in the sense of being Enterprise-tier. They are not absent.
- "A Telegram approve/deny push is cheap" is an inference. The bot has 2 updates in 7 days and a 70-handler sprawl. The approval-to-Telegram link is [I], not verified in code. It touches the money path (approval consume, step-up). The "tg-bot as approval channel" cross-cluster synergy is asserted, not traced.
- "Wraps LI.FI" (agent-api audit) vs "about 25 providers" (tg-bot). These are two different engines: the Python swap_engine versus the api-ts agent route. The draft treats the router as one asset ("router + governance on one path"). The execute path calls Python via /internal/agent/execute-swap, but the quote path was described as thin LI.FI/Jupiter. Verify before pitching "oracle-ranked best execution" to agent builders.
- Bet B's "sealed, pre-committed best-execution receipt" is not shown to exist. seal.ts and anchor.ts belong to Autopilot. Reuse for quotes is inference.
- Bet B "10 non-founder swaps in 30 days" is a threshold with no acquisition mechanism behind it. The draft itself says no distribution engine exists.
- "Arbiter: freeze" is too hasty on one point. It is the only asset with a differentiator that the competitor sweep did not already contradict (TEE-attested verifier), though ERC-8183 evaluators are a plausible fit. Still correct to freeze without a design partner.
- Competitor numbers (Axiom, FOMO, Bankr $27.6M revenue, Trojan share) are vendor or affiliate figures that conflict across sources. The synthesis uses them correctly as rough. Do not quote them externally.
- Missing evidence for "43 users / 77 wallets" being Aug data (3 months stale). The "0 swaps in 30 days of worker logs" is the stronger fact.

(2) MISSED CATEGORIES (3 most important)

1. Polymarket / prediction-market tooling. Wrongly dismissed as a niche with "little competition". Telegram Polymarket bots are a crowded niche: PolyGun (1% fee), PolyCop (0.5%, claims partner status, unverified), PolyBot, PolyTap, plus the Polycule hack ($230k, Jan 2026). Polymarket also expanded taker fees to nearly all categories in 2026, which squeezes bot margins (secondary sources: https://dev.to/cryptodeploy/polygun-turns-polymarket-into-a-telegram-trade-45c2, https://defillama.com/protocol/polycule). The tg-bot audit's "unserved gap" claim is overstated. The V2 signer is still a real, narrow asset. UNVERIFIED: Polymarket's builder-program terms and whether Suwappu can earn builder fees there. Check the official docs.
2. Agent-wallet incumbents with approvals (Privy, Turnkey, Fireblocks, Coinbase). Covered above. The synthesis cited them but did not take the implication for Bet A.
3. Not researched, flagged as gaps (no evidence either way): intent-based and MEV-protected execution (CoW, UniswapX, Across, NEAR Intents at about $37B cumulative per ourcryptotalk), AI trading copilots, stablecoin payments rails, and Base app / Farcaster mini-apps. Zora/Clanker declines suggest Farcaster is a shrinking channel. Telegram-native wallets: TON Wallet in Telegram already offers yield (The Block, in the neobank audit) and is the real in-chat rival to Bet C. I did not research these further.

(3) IS BET A THE BEST?

Not as framed. Problems: (a) differentiator largely exists at Privy and Turnkey; (b) enforcement runs on your server, so trust-us versus enclaves; (c) the buyer (agent builders afraid to fund an agent) is unvalidated; (d) it is the largest build (org-policy API, Telegram push, keyless MCP, dashboard, all money-path) for a $0 solo founder; (e) 8-day build before any demand evidence.

STRONGER ALTERNATIVE ORDER (cheaper, demand-first):
1. Days 1-7, zero-build proof: run the $1-5 real fills (Jupiter, Base LiFi/0x, one bridge, one /v1/agent/swap/execute with Turnkey env). Record hashes. Fix the 404s (app.suwappu.bot, /positions), publish @suwappu/mcp-server 0.6.0, and submit the $0 registry listings (docs/distribution/registry-listings.md). All of these are build-free or near-free and reveal whether any agent traffic is real.
2. Days 3-10, validation by conversation: 10 builder conversations, but test the actual hypothesis against Privy and Coinbase. Ask "would you use per-transaction Telegram approval and a verifiable audit log instead of Privy approvals or Coinbase session caps?" Go only if 3 say yes this month.
3. Only then build the minimum, and scope Bet A down to the one differentiator that survives: a Telegram/mobile approval inbox plus a verifiable audit log as a signer-agnostic layer (guarding Privy/Turnkey/CDP keys), not another custodial wallet and not org-policy CRUD.
4. Run Bet B's login-free swap (auth removal on /webapp/swap/build, with rate limit and fromAddress check) as the parallel low-cost test. It is the shortest path to a non-founder fill. Mark it MONEY-PATH. But accept it is a commodity vs Jupiter/LI.FI.
5. Bet C stays a side test, only after confirming atomiq_escrow_contracts in prod (settings.py:650).

Revised recommendation: no single "bet" yet. Gate everything on real fills plus distribution (registries, packages, dead links) plus 10 buyer conversations that explicitly test Privy/Coinbase displacement. If the answers are weak, freeze and keep the router and terminal swap as infrastructure.

Suggested next steps / owners: deploy-ops (Railway env check, publish packages), bot-dev (real fills, fix settings.py:1105 URL), api-ts-dev (login-free build route), money-path-reviewer on any approval/execution change, researcher (primary-source pass on Privy audit export, Turnkey activity logs, Polymarket builder docs).

UNVERIFIED: Privy audit-log export; Polymarket builder program terms; all intent/MEV/copilot/Farcaster competitor claims.

HANDOFF
agent: none
task: Founder decision. Replace Bet A with the demand-first sequence above (fills + dead-link fixes + registry/package publish, then 10 builder interviews testing Privy/Coinbase displacement, then build only a Telegram approval inbox + verifiable audit if validated). Optional follow-up for researcher: primary-source check of Privy audit export and Polymarket builder program.
files: api-ts/src/services/ApprovalService.ts, api-ts/src/services/audit.ts, docs/distribution/registry-listings.md, bot/config/settings.py:650,1105, api-ts/src/routes/pythonProxy.ts:113 (from audits; I re-read none)
risks: MONEY-PATH for any approval/execution/login-free swap change; cross-stack (api-ts proxies to Python); competitor evidence is web search snippets and vendor pages, not full primary-source reads.

---

# Appendix: per-cluster audits and competitor research

## tg-bot
### Audit
TG-BOT CLUSTER AUDIT (read-only, 2026-11-20)

Caveat on activity [V]: git history starts 2026-08-15 (568 commits total, so the repo was imported/squashed then). Almost every handler shows exactly 1 commit in the last 90 days, which is that import or a mass fix. Real feature work since then is near zero. The last 30 days of bot/ commits are admin, web-events and growth-report plumbing (801d9bc, 9ec1fca). Only swap_engine (2 commits), token_security (2) and token_intel (3) got touched after the import.

Deployment [V]: every feature below is registered in bot/main.py add_handlers() (lines 388-1100) and ships with railway.python-api.json (1 replica). Registered still means "can be called". It does not mean "proven": 0 completed swaps ever.

FEATURE INVENTORY (LOC of handler + service; status from the code)
- Swap engine: bot/services/swap_engine.py 8,293 LOC, handlers/swap.py 2,335. About 25 quote sources: LiFi, Jupiter, OKX, 1inch, 0x (plus cross-chain), Kyber, CoW, Socket, Jito, CCIP, LayerZero, USDT0, CCTP, Across, Wormhole, SunSwap, AVNU, GOAT, JuiceSwap, Tempo, PropAMM, UniV3 forks. Ranking uses an oracle cross-check and a speed tie-break (_rank_quotes_with_price). There is an explicit EXECUTABLE_PROVIDERS guard, and an executor exists for each provider. Status: PARTIAL, code-complete but never proven. Breadth is far beyond any TG competitor; production fill evidence is 0 [V].
- Paste-to-trade / quickswap / NL trade: paste_trade.py 379, quickswap 383, nl_trade 424 plus nl_deterministic_parser 341 (regex only, no LLM on the money path). Status: works up to the swap hand-off [V code]. On par with Trojan/Maestro UX in concept.
- Sniping: handlers/snipe.py 1,247 plus services/sniping 2,226. The pump.fun buy tx is a placeholder with no buy instruction (snipe_executor.py:364-370 "pump.fun buy instruction would go here") [V], so the pump.fun path is BROKEN. The Raydium path (Jupiter plus Jito) is plausible. Detection is a pumpportal WebSocket plus Raydium polling every 2s, which is slow next to the gRPC/Yellowstone feeds Banana Gun and Axiom use. Status: STUB/PARTIAL.
- Copy trading: copy.py 1,009 plus copy_service.py 1,718. You can only follow other Suwappu users' in-bot swaps (handle_swap_submitted). It cannot follow arbitrary on-chain wallets [V]. With 43 users it is empty by construction. GMGN, Trojan, BullX and Photon all copy any wallet. Status: works internally, useless at 0 users.
- Limit orders / DCA / TWAP: orders.py 858 plus limit_orders 910. Price-poll triggers into swap_engine. Status: PARTIAL, unproven.
- Alerts: 402 LOC. Status: likely works (price polling).
- Perps (Hyperliquid): perps 731 plus perps_service 1,246 plus hyperliquid_client 1,476. Real L1 signing and builder-fee attachment (hyperliquid_client.py:288-400) [V]. Status: PARTIAL to near-complete. Builder fees only pay out once the builder account holds the required balance.
- Predict (Polymarket): 1,579 plus polymarket_api 933. polymarket_v2_order.py re-implements CLOB V2 EIP-712 signing because py-clob-client still signs for the deprecated V1 exchange [V, per the module's docstring]. Status: PARTIAL, not proven live.
- Community (tip / luckybox / split): about 520 handler LOC plus community_service 832. Off-chain custodial ledger, no on-chain transfers (tip.py:8) [V]. Status: works mechanically. It needs funded custodial balances, which nobody has.
- Points/XP, referrals, check-in, leaderboard, battle: points_service 1,377, referral 513, battle 579. Status: works, but it is gamification with no underlying activity.
- Token security: token_security 3,165 plus token_intel 1,000 (honeypot sim, mint/freeze authority, blacklist, dev_watch). External data comes from DexScreener and Blockscout only. No GoPlus, RugCheck or Birdeye [V]. Status: PARTIAL. Thinner data than the competitors, who all embed GoPlus/RugCheck-grade checks.
- Long tail (earn, borrow via Morpho, stocks, btc, giftcard, p2p escrow, tempo, mpp, enterprise/org, tax, 2FA, social recovery, AEGIS scan in observe mode): mostly PARTIAL, not exercised. This is maintenance drag.

HIDDEN GEMS (rare or hard to rebuild)
1. The multi-aggregator plus bridge router with oracle-sanity ranking, plus "execution intelligence": execution_scorer, execution_benchmark (k-anonymity threshold), execution_reconciler. No TG bot publishes "your fill vs everyone else's." [I]
2. The Polymarket CLOB V2 signer, written because the official Python SDK is broken. Narrow but real.
3. Hyperliquid perps with builder-fee monetization already wired.

WHAT'S MISSING vs Trojan / Maestro / Banana Gun / BONKbot / GMGN / Axiom [I, from the code gaps above]
- Copying any on-chain wallet (their #1 retention feature).
- A working pump.fun / launchpad buy, plus sub-second launch feeds.
- PnL cards, a trade-in-group flow and a wallet tracker as the viral loop. position_cards exists but has nothing to show.
- Solana-first speed tuning (priority-fee auto, multi-RPC send).
- Proof: one public tx per provider.

TOP 3 STRONGEST ASSETS
1. Swap engine breadth plus cross-chain bridging (8.3k LOC, about 25 providers, guarded execution).
2. Hyperliquid perps with builder fees (a revenue path that exists in code).
3. Polymarket V2 signing plus prediction UI (rare in TG bots).

TOP 3 WEAKEST
1. Sniping: the pump.fun tx is a placeholder; detection is 2s polling.
2. Copy trading is internal-only, so it is dead at 0 users.
3. Feature sprawl (about 70 handlers, 157 services) with no live proof that any swap has ever filled.

2 WEEKS TO MAKE THE BEST ASSET USABLE (the swap engine)
- Days 1-3: freeze everything except /start, wallet, paste-to-buy, swap, positions and sell. Hide the other commands from the menu.
- Days 3-7: run real small swaps on the 4 rails that matter: Jupiter (SOL), LiFi and 0x (Base/Arb), and one bridge (Across or CCTP). Fix what breaks and record the tx hashes. Rule #2 says no "live" claim without these.
- Days 7-10: add wallet-address copy trading reusing the existing copy_service execution path (watch the address via a Helius webhook or Alchemy notify, then call execute_copy). Add GoPlus/RugCheck to the paste card.
- Days 10-14: shareable PnL card plus "best route found / you saved $X vs single-DEX" on every fill. That turns the routing gem into a visible differentiator. Then put it in front of 20 real traders.

Key files: bot/main.py, bot/services/swap_engine.py, bot/services/sniping/snipe_executor.py, bot/services/copy_service.py, bot/services/hyperliquid_client.py, bot/services/polymarket_v2_order.py, bot/services/community_service.py, bot/services/execution_benchmark.py
### Competition
**Answer:** The TG-bot cluster is not a viable standalone business. The incumbents win on speed, wallet-copy and distribution, and Suwappu has none of those. Verdict: REPOSITION (freeze the sprawl; keep only the router, perps and the proof-of-fill angle). Do not double-down on "another Telegram trading bot".

**Competitors** (web figures are mostly vendor/affiliate guides, so treat them as rough; [V]=source seen, [I]=inference)
- **Banana Gun:** The guides call it the top-volume TG bot, with about $16B lifetime across 25M trades [V, Datawallet]. Fees are 0.5% on ETH and about 1% on SOL [V, DexTools]. It pays 40% of fees to token holders. Its edge is ETH/multi-chain sniping and fast execution. It had a $3M hack in Sep 2024, refunded from treasury [V, Cointelegraph].
  - https://www.datawallet.com/crypto/best-crypto-telegram-bots
  - https://www.dextools.io/tutorials/maestro-vs-trojan-vs-banana-gun
  - https://cointelegraph.com/news/banana-gun-crypto-bot-refunds-3m
- **Trojan:** About $24-25B lifetime volume, with Solana share reportedly sliding from over 50% to about 44% as mobile-native rivals grew [V, vendor guides, unreconciled]. Fee is about 1%, with tiered rebates. Wallet copy-trading and speed are its edge.
- **Maestro:** Reported at 573k+ users, roughly 1% fee, widest EVM chain list [V, DexTools]. It lost about $1.1M to router exploits in Oct 2023 [V, Blockworks]. Weakness: the Telegram-native cohort is described as hitting a product ceiling.
- **BonkBot:** About $13.8B lifetime [V, Datawallet]. Flat 1% fee, simplest UX, Solana-only.
- **Photon, Axiom, GMGN:** Terminals/apps rather than bots. Photon is reported above $45B lifetime volume [V, one guide]. Axiom has Hyperliquid perps. Revenue and user data not found. [UNVERIFIED]
- **Bloom:** Lost about $947k from 9 users' wallets on Oct 26 2026, cause unconfirmed [V]. Solareum shut down after a $523k drain. Polycule (a Polymarket TG bot) lost $230k in Jan 2026.
  - https://cryptobriefing.com/bloomtrading-bot-users-wallet-drains/
  - https://decrypt.co/224371/solana-telegram-trading-bot-shut-down-users-drained-523k
  - https://www.kucoin.com/news/flash/telegram-trading-bot-polycule-on-polymarket-hacked-230k-stolen
- **Bankr (chat/agent):** Social AI trading across X/Telegram/Farcaster/web/CLI. Fee is 0.8%. RootData says Q1 2026 revenue was $27.6M, which I could not confirm against a primary source. [UNVERIFIED] It was suspended from X in Oct 2025 (platform risk) and later paused swaps/transfers and promised reimbursement.
  - https://www.theblock.co/news/web3/2025-10-10-bankr-back-live-x
  - https://www.rootdata.com/projects/detail/bankrbot?k=MTU3NzA%3D
- **Sigma, Unibot, Basedbot, Hey Anon:** Not researched this pass. [UNVERIFIED] Unibot's Oct 2023 exploit is confirmed.
- **Acquisition [I]:** Incumbents grow through token and fee-share incentives, referral rebates, CT/X influencers and group trading. Banana Gun's 40% fee-share is the clearest example. Bankr's growth comes from being embedded in social feeds.

**Feature matrix** (Suwappu from the internal audit; competitor cells from the guides and general knowledge, so [I])

| Feature | Suwappu | Trojan | Banana Gun | Maestro | BonkBot |
|---|---|---|---|---|---|
| Proven live fills | No (0 swaps ever) | Yes | Yes | Yes | Yes |
| Sniping, fast feed | Partial: pump.fun buy is a placeholder (snipe_executor.py:364-370); 2s polling | Yes | Yes | Yes | Basic |
| Copy any on-chain wallet | No (Suwappu users only) | Yes | Yes | Yes | No |
| Multi-chain | Yes (about 7 chains) | SOL-first | Multi-chain | Wide EVM | SOL |
| Aggregator and bridge routing | About 25 sources, oracle-ranked (unproven) | Basic | Basic | Basic | Jupiter |
| Token security (GoPlus/RugCheck) | Thin: DexScreener and Blockscout only | Yes | Yes | Yes | Basic |
| Perps | Hyperliquid, builder fee wired | Limited | Limited | No | No |
| Prediction markets | Polymarket V2 signer | No | No | No | No |
| Limit/DCA | Partial, unproven | Yes | Yes | Yes | Limited |
| Viral loops (PnL cards, group trading) | Weak | Strong | Medium | Medium | Strong |
| Fee-share or token | No | Rebate tiers | 40% fee-share | Tiers | No |
| Users | Under 50 | Hundreds of thousands | Hundreds of thousands | 573k+ | Very large |

**(a) Missing table stakes**
- Proof: at least one real filled swap per route, and users who have actually traded.
- A working pump.fun or launchpad buy, plus a sub-second launch feed.
- Wallet-address copy trading.
- GoPlus/RugCheck-grade safety data on the paste card.
- Solana speed tuning.
- PnL and share cards.
- A distribution engine (fee-share or token, referral rebates, KOLs).
- Trust and security credentials. After the Bloom, Banana Gun and Polycule drains, any custodial bot has to show how it protects keys (KMS envelope encryption is a real asset here).

**(b) Ahead or unique** [I, honest]
- Nowhere that matters commercially today.
- Technically unique but unproven:
  - the oracle-ranked multi-aggregator and bridge router;
  - execution-benchmark intelligence ("your fill vs others");
  - the Polymarket CLOB V2 signer;
  - Hyperliquid builder fees.
- Breadth is not a moat, because 8.3k LOC of provider adapters with 0 fills has no demonstrated value.

**(c) Unserved gaps a solo founder could own** [I]
- "Provable best execution": a public fill-quality scoreboard and a per-trade "you saved $X" receipt. No competitor publishes this.
- Prediction-market and perps trading from chat (Polycule was hacked, so there is a trust gap). Polymarket Telegram trading is a niche with little competition, and Suwappu already has the V2 signer.
- Cross-chain "one command, any chain" for non-Solana users. Incumbents are SOL-centric or EVM-only.
- Agent-facing execution API, i.e. routing as infrastructure for AI agents and Bankr-style frontends. Bankr already uses 0x as infrastructure (https://0x.org/case-study/bankr), so the pattern exists. However, the internal audit shows the Suwappu agent API traffic is crawlers plus its own loops, with 1 quote that hit a 402, so there is no demand evidence.

**(d) Verdict: REPOSITION.** Freeze the 70-handler sprawl. Prove 4 real fills, then choose one wedge (best-execution receipts, or Polymarket/perps from chat). Do not compete with Trojan or Banana Gun on sniping or copy trading. If there are no real users or fills within about 30 days of that proof, freeze or kill the bot.

**Caveats:** The competitor volume and market-share figures come from affiliate and vendor guides and conflict across sources. I did not open the strategy review. Sigma, Basedbot and Hey Anon were not researched.

HANDOFF
agent: none
task: Founder decision only. Suggested next steps if repositioning: (1) bot-dev runs 4 real small swaps (Jupiter SOL, LiFi/0x on Base or Arb, one bridge) and records the tx hashes; (2) bot-dev hides all handlers outside /start, wallet, paste-to-buy, swap, positions, sell, perps and predict from the menu; (3) growth-marketing tests the "best-execution receipt" wedge with 20 traders.
files: bot/main.py, bot/services/swap_engine.py, bot/services/sniping/snipe_executor.py:364, bot/services/execution_benchmark.py
risks: MONEY-PATH (swap execution, custodial keys); no migrations. Hiding handlers touches only bot/main.py registration or menu config. Verify against both backends, since api-ts also exposes routing.

## frontends
### Audit
FRONTENDS CLUSTER AUDIT (read-only, 2026-11-20). [V] means I checked it in code or with a live curl. [I] means inference.

INVENTORY (git ls-files; LOC counts .ts/.tsx/.js/.py, excluding tests; commits are from git log --since=90.days)

1. terminal/ (Vite+React trading terminal). 347 files, about 46k LOC, 14 commits in 90d, last commit 2026-11-20. Deployed [V]: railway.terminal.json (2 replicas, /health), and https://terminal.suwappu.bot returns 200 ("Suwappu Terminal"), /health returns 200.
   - Non-custodial swap: partial, but closest to working. The server builds an unsigned tx and the user's own wallet signs it: wagmi sendTransaction, including the approve step, in terminal/src/hooks/useExternalSwap.ts:49-88, and Phantom signAndSendTransaction in terminal/src/hooks/useSolanaSwap.ts:81-88. Bridging works the same way in terminal/src/hooks/useBridgeExecute.ts. Blocker [V]: POST https://api.suwappu.bot/webapp/swap/build (proxied to Python, api-ts/src/routes/pythonProxy.ts:113) returns {"detail":"Not authenticated"}. A wallet user must finish SIWE, Google/Twitter OAuth or Telegram login before they can even build a quote tx (terminal/src/contexts/AuthContext.tsx:468-490). Uniswap, Jupiter and Matcha need no login for this.
   - Custodial swap through /webapp/swap/execute (terminal/src/lib/api.ts:409): partial. It depends on managed wallets, and 0 swaps have completed.
   - Perps: partial. HyperLiquid feed, candles, funding and margin-mode views exist (terminal/src/lib/hyperliquidFeed.ts, terminal/src/hooks/usePerps*.ts). /terminal/perps/orders reads orders, but I found no client-side order signing [V]. So this is a market-data view, not a trading venue.
   - Feature dirs: copilot, agent-control (PendingApprovalsPanel, AuditLogPanel), dca, lending, predict, signals, tweets, intel, curve, points, referrals, watchlist, hotkeys, orderbook. Most are UI over api-ts endpoints, and many are behind a dev mock (terminal/src/lib/devMock.ts) [V]. Breadth is wide, and I did not verify depth per panel [I].

2. webapp/ (Telegram Mini App). 287 files, about 46k LOC, 12 commits in 90d, mostly dependency patches. Its 31 pages include Swap, Wallet, DCA, LimitOrders, Perps, Predict, CopyTrading, P2P, Battle, Stocks, Enterprise, Arbiter, Subscriptions and Recovery (webapp/src/pages/).
   - BROKEN IN PROD [V]: the bot's configured Mini App URL is https://app.suwappu.bot (bot/config/settings.py:1105-1107), and it returns 404 {"message":"Application not found"} from Railway. Every "open dashboard" button in the bot therefore lands on a dead page unless WEBAPP_URL is overridden in env [I]. A railway.webapp.json exists, but the domain is not attached to a live service.
   - The mock API is limited to Storybook and tests (webapp/src/contexts/ApiContext.tsx:44) [V]. Swaps are custodial (managed wallet).

3. extension/ (MV3 wallet). 39 files, about 4.2k LOC, 5 commits in 90d (all dependency bumps). Real architecture [V] (extension/ARCHITECTURE.md): it injects EIP-1193/EIP-6963 window.ethereum and Wallet-Standard window.solana, and keeps the vault as a passkey-PRF-derived AES-GCM key held in chrome.storage.session. Key files are extension/src/background/rpc/eth.ts (459 LOC) and extension/src/background/rpc/signing.ts. Status: working prototype, not published to the Chrome Web Store [I]. No swap UI. Far behind Rabby, Phantom and MetaMask on simulation, multichain and audits.

4. mobile/ (Expo iOS). 31 files, about 1.3k LOC, 0 commits in 90d, last commit 2026-08-15. Four tabs: index, money, activity, ask. eas.json has an empty submit profile, so it has not been submitted to the App Store [V]. Stub.

5. showcase/ (Next.js marketing site). 482 files, about 33k LOC, 41 commits in 90d, the most active frontend. Live [V]: https://suwappu.bot returns 200, titled "The full-stack cross-chain trading platform". It has about 40 routes, including pricing, compare, enterprise, government, institutional, careers, research, reserve and arbiter. There is also an admin Growth dashboard with Google staff sign-in and Stripe "money-in". Most recent effort went into redesigning this site and the /arbiter page, not into the products users would use.

HIDDEN GEMS
- Non-custodial EVM+Solana build-and-sign swap and bridge pipeline in the terminal, including Solana priority-fee and Jito tiers (terminal/src/types/api.ts:101-114). Getting landing quality right across two VMs is hard [V code, I quality].
- Passkey-PRF-encrypted browser wallet with dual EVM/Solana injection. Few solo projects have a working MV3 provider plus Wallet Standard [V].
- Agent approval and audit panels in the terminal (components/agent-control): a human-in-the-loop UI for agent trades, which is rare among DEX frontends [V that it exists, I that it is wired end to end].

WHAT IS MISSING VS COMPETITORS (Jupiter, Uniswap, Matcha, Photon/BullX/Axiom, Rabby, Phantom) [I]
- Login-free quote and swap for wallet users.
- One polished core flow instead of 30+ shallow tabs.
- Transaction simulation and risk warnings.
- A working Mini App domain.
- Mobile in the store and a published extension.
- Any real usage telemetry tied to swaps.

TOP 3 STRONGEST ASSETS
1. Terminal non-custodial swap and bridge (deployed, real signing code).
2. Passkey browser wallet extension (rare architecture).
3. Showcase site (live, polished, heavily iterated). It is a distribution asset, not a product.

TOP 3 WEAKEST
1. webapp Mini App: the configured prod URL is 404, so the Telegram funnel is dead [V].
2. mobile: abandoned stub.
3. Breadth over depth. Perps, predict, P2P, battle, stocks, enterprise, copy trading and DCA panels all exist with 0 users and largely unverified backends, which dilutes a single working path.

TWO-WEEK PLAN: MAKE THE TERMINAL'S WALLET SWAP USABLE BY A STRANGER
1. Days 1-3: let /webapp/swap/build (and quote) accept unauthenticated calls when fromAddress equals the connected wallet, with IP rate limiting. Make SIWE optional and only needed for history and points.
2. Days 3-6: run a live end-to-end on Base (ETH to USDC, small amount) and Solana (SOL to USDC) from a fresh browser with MetaMask and Phantom. Fix whatever breaks, check slippage and approval UX, and record the tx hashes.
3. Days 6-9: hide every panel not on the swap/bridge path behind a flag, and make terminal.suwappu.bot open directly on the swap.
4. Days 9-11: add tx simulation or price-impact guards, add a fee disclosure, and record swaps via /webapp/swap/record.
5. Days 11-14: fix or remove the app.suwappu.bot Mini App link, then point the bot and the showcase CTA at the terminal swap. Ship one distribution push (for example a Telegram or X post with a "no signup" swap link) and measure completed swaps.

Success test: 10 completed swaps by people who are not the founder.
### Competition
**Verdict: REPOSITION / freeze breadth.** Suwappu has no product edge today. The one thing worth keeping is the terminal's login-free, non-custodial EVM+Solana swap and bridge. The market is dominated by well-funded, mobile-first, Solana-only social terminals. A solo founder should not fight them head-on.

## Competitors
- **Axiom.** Solana terminal, perps, 0.75-1% fee with cashback tiers. Reported ~$15B volume and ~650k wallets by mid-2026 [I: aggregator figures]. DeFiLlama shows ~$28M fees over 30 days and ~$37M for Sep 2026; RootData's numbers are lower. Its share fell from ~45% (Jun) to under 30% (Aug) as FOMO took volume. Sources: [DeFiLlama](https://defillama.com/protocol/axiom), [Solana Compass](https://solanacompass.com/projects/axiom_trade), [Crypto Briefing](https://cryptobriefing.com/fomo-surpasses-axiom-solana-trading-volume/).
- **FOMO.** Self-custodial mobile social-feed app. It covers Solana gas and priority fees, and added Hyperliquid-routed perps in Jun 2026 (non-US only). Weekly revenue reached $1.39M-$3.73M, with ~46% of Solana terminal volume by late Aug 2026. It reports 625k+ accounts and raised $75-94M (sources disagree). A Bitquery study found fees erased gains for a third of winning wallets, which is a user-complaint angle. Sources: [Solana Compass](https://solanacompass.com/news/fomo-captures-46-of-solana-trading-platform-spot-volume-as-weekly-revenue), [Cryptoslate](https://cryptoslate.com/fomo-fees-erased-gains-for-32-of-its-pre-fee-winning-solana-wallets/), [DeFiLlama](https://defillama.com/protocol/fomo).
- **Phantom.** Wallet with ~22M active users and ~$320M 2025 revenue (Forbes, Feb 2026). Perps via Hyperliquid passed $50B cumulative in Oct 2026. Cross-chain swaps via deBridge passed 1M. It gets distribution from being the default Solana wallet. Sources: [Crypto Briefing perps](https://cryptobriefing.com/phantom-surpasses-50b-perpetuals-volume/), [deBridge](https://cryptobriefing.com/phantom-1m-cross-chain-swaps-debridge/).
- **Jupiter.** No protocol fee. It ships an embeddable Terminal/Plugin where integrators add their own fee, plus Mobile v3 (Jan 2026) with a Classic/Trench mode. It is the free infrastructure that makes a Solana swap UI a commodity. Sources: [Jupiter docs](https://developers.jup.ag/docs/tool-kits/plugin), [crypto.news](https://crypto.news/jupiter-launches-mobile-v3-native-pro-trading-2026/).
- **GMGN, Photon, Padre.** Fees are roughly 0.5-1% and sources conflict. Padre offers up to 35% referral cashback. **BullX reportedly shut down in Jun 2026 [I: single source, MadeOnSol]**, which shows how brutal this category is. Sources: [coincodecap](https://coincodecap.com/padre-vs-gmgn-vs-photon-vs-bullx), [MadeOnSol](https://madeonsol.com/blog/gmgn-vs-photon).
- **Telegram bots (Trojan, Maestro, Banana Gun, BonkBot).** Lifetime volume of $12-25B and 0.5-2M users each, but from affiliate-style sites [I]. Press-release commentary says the category has a product ceiling. They were exploited before and often hold user keys. Sources: [crypto-reporter](https://www.crypto-reporter.com/press-releases/the-state-of-memecoin-trading-bots-in-2026-volume-fee-capture-and-market-share-across-the-top-8-126770/), [datawallet](https://www.datawallet.com/crypto/best-crypto-telegram-bots).
- **Not researched:** DEX Screener and the Hyperliquid UI. UNVERIFIED: pricing and traction for both.

## Feature matrix
Competitor cells are from the research above plus general knowledge [I]. Suwappu cells come from the audit [V].

| Feature | Suwappu | Axiom | FOMO | Phantom | Jupiter |
|---|---|---|---|---|---|
| Works today with real users | No (0 swaps) | Yes | Yes | Yes | Yes |
| Login-free wallet swap | No (build needs auth) | Yes | Yes | Yes | Yes |
| Non-custodial EVM + Solana | Partial (terminal) | Solana only | Solana mostly | Multi-chain | Solana |
| Meme-token discovery / sniping / copy-trade | Shallow tabs | Core feature | Social feed | Limited | Trench mode |
| Perps | Data view only | Yes | Yes (Hyperliquid) | Yes (Hyperliquid) | Yes |
| Mobile app in store | No | Web | Yes | Yes | Yes |
| Browser extension / wallet | Prototype, unpublished | No | No | Yes | No |
| Tx simulation / risk warnings | No | Partial | Partial | Yes | Partial |
| Telegram funnel | Dead (app.suwappu.bot 404) | Not core | No | No | No |
| Agent / API access with human approval | Yes (exists, unproven) | No | No | No | API only |
| Gas covered for user | No | No | Yes | No | Partial |

## (a) Missing, table-stakes
- Login-free quote and swap.
- A working Mini App link.
- Mobile in the store.
- Gas or priority-fee abstraction.
- Swap simulation and risk warnings.
- Social or leaderboard and discovery loops.
- Referral cashback that pays out.
- Any trader proof (volume, completed swaps).

## (b) Ahead or unique, honestly
- **Nowhere on market metrics.** Zero users and zero completed swaps.
- **Architecturally uncommon:** EVM+Solana non-custodial build-and-sign in one terminal, and a passkey-PRF MV3 wallet. These are assets, not wedges.
- **Agent human-in-the-loop approval panels** [V exists; I whether wired end to end]. This is the only angle where the incumbents have nothing.

## (c) Gaps a solo founder could own
- **Agent-trade safety and approval layer.** Agents hold keys or call APIs with no human approval and audit trail. The terminal's agent-control panels and the `/v1/agent/*` and A2A routes already exist. UNVERIFIED: real demand.
- **Non-Solana, cross-chain EVM+Solana "no signup" swap.** The loudest competitors are Solana-only; Phantom and Jupiter are wallet or aggregator products. This is thin and low-margin [I].
- **Fee transparency.** FOMO's fee-erosion study is a positioning hook, but it needs volume first.
- **Telegram-native funnel.** It looks saturated, and the Suwappu Mini App is dead.

## (d) Verdict
**Reposition.** Kill or flag off everything except the terminal swap/bridge, and treat the agent approval and audit layer as the possible wedge. Freeze the webapp, mobile and showcase redesigns. The two-week plan (login-free swap, then a 10-swap non-founder test) is the right cheap test. If it fails, stop building new surface area.

HANDOFF
agent: none
task: Decision for the founder. If proceeding, send the login-free /webapp/swap/build change to api-ts-dev, and the flag-off of non-swap terminal panels plus the Mini App URL fix to webapp-dev. Success test is 10 non-founder completed swaps.
files: terminal/src/hooks/useExternalSwap.ts:49, terminal/src/hooks/useSolanaSwap.ts:81, api-ts/src/routes/pythonProxy.ts:113, bot/config/settings.py:1105 (all from the audit, not re-read by me)
risks: MONEY-PATH. Making swap build unauthenticated needs rate limiting and a check that fromAddress equals the connected wallet. Cross-stack: the route proxies to Python, so both backends are involved.

## agent-api
### Audit
AGENT-API CLUSTER AUDIT (read-only, 2026-11-20)

Note: the hosted MCP rejects anonymous tool calls (live: "Missing Authorization header"), and so does POST /v1/agent/quote (live: "Authentication required"). That fits the ~0-usage finding. Discovery (tools/list, chains, agent card) is open. Execution and quotes need a registered key.

PRODUCT INVENTORY

1. Agent REST /v1/agent/* (api-ts/src/routes/agent.ts, 5,573 LOC, 16 commits in 90d). Mounted in api-ts/src/app.ts. Deployed via api-ts/railway.json. Live /health is ok, db connected [V].
   - Covers: register (self-onboarding with free starter credits), quote, simulate, execute, swap status/history, portfolio, wallets, webhooks, key rotation, billing/topup, openapi and postman exports [V].
   - Status: partial. Code is end-to-end, but no third-party swap has ever executed [V].
   - Versus Li.Fi, 0x, Jupiter APIs: thinner routing (it wraps Li.Fi/Jupiter) and no SLA. It is far richer on agent governance (item 2).

2. HIDDEN GEM: agent-wallet governance layer.
   - Pieces: PolicyService.ts (652 LOC), ApprovalService.ts (633 LOC), audit.ts (269 LOC), lib/spendPermission.ts. Routes: /wallet/policy, /approvals/:id/step-up/challenge|approve|deny, /audit/verify, /owner/audit/verify, /killswitch [V].
   - What it adds: per-agent spend policies, human approval with step-up, an audit log you can verify for tampering, an owner kill switch, and Turnkey-backed custody (services/WalletService.ts) [V].
   - This is the hard-to-rebuild part. Few swap APIs ship policy, approval and audit as a product; competitors here are Coinbase AgentKit/CDP wallet policies, Turnkey policies and Privy server wallets [I].
   - Status: code-complete. Never exercised by a real user [I].

3. Payments: x402 + MPP.
   - Code: middleware/x402Payment.ts (648), mppAuth.ts (199), FacilitatorService.ts (272), lib/x402Verify.ts, mppDirectory.ts [V].
   - Status: partial. Prepaid-credit metering works; the one real attempt hit 402 (prior finding). billing.ts has 0 commits in 90d [V].
   - Versus Coinbase x402 facilitator: on par as an early adopter [I], but not a moat.

4. Hosted MCP /mcp (mcp.ts 1,814 + mcpTools.ts 440 LOC).
   - Live: 23 tools [V] covering quote, swap, portfolio, prices, perps, predict, lend, NEAR intents and MPP directory, plus resources.
   - Status: works for discovery; calls need a key.
   - Versus Alchemy/thirdweb/GOAT MCPs: broader multi-protocol surface [I].

5. packages/mcp-server (stdio bridge, ~311 LOC). The repo is at v0.6.0, but npm has only 0.1.1 published [V].
   - This is stale distribution. Anyone installing from npm or Smithery gets the old bridge [I].

6. packages/sdk (5.4k LOC, 2 commits in 90d) is on npm as @suwappu/sdk 0.4.0 [V]. It includes a CLI with AI backends (src/cli/ai/backends.ts).

7. packages/sdk-python (3.4k LOC, 0 commits in 90d, last 2026-08-15). `suwappu` is not on PyPI [V]. Treat it as unshipped.

8. packages/openclaw (1.9k LOC, 1 commit in 90d): a typed TS client with retries and self-register, plus SKILL.md/server.json registry claim [V]. Publication not checked [I].

9. skills/suwappu (385 LOC of markdown, last 2026-09-26): an agent skill doc. Status: docs only.

10. A2A + agent card.
    - Code: a2a.ts (753 LOC, 0 commits in 90d). /.well-known/agent-card.json is served live [V].
    - Quote and discovery only; the card itself says "A2A does not execute swaps" [V].
    - Status: partial and dormant.

11. /v1/autopilot "suwappu-omni" (autopilot service 2,009 LOC: thesis, gates, executor, scheduler, anchor; route 388 LOC).
    - Live [V]: mode paper, status active, last cycle 2026-11-20T23:21Z, but equity $1000, 0 positions, PnL $0. It runs cycles and has never traded.
    - Gem inside: lib/seal.ts plus services/autopilot/anchor.ts seal every decision before execution and reveal it after, with optional on-chain anchoring, so the track record can be checked publicly [V]. This is rare.
    - Status: plumbing works; produces no output.

12. /v1/chat/completions: NOT SERVED by api-ts. The only match is the SDK CLI's client in packages/sdk/src/cli/ai/backends.ts [V]. Plan/claim only.

13. webmcp: no directory or route found [V]. Plan-only.

14. capabilities.yaml is an env-gated capability manifest checked by scripts/doctor.py. It is an internal tool, not a product.

TOP 3 STRONGEST
1. The governance layer on custodial agent wallets: policy, step-up approvals, tamper-evident audit, kill switch, on Turnkey. This is the actual differentiator: "let an AI agent hold money safely."
2. The hosted MCP with 23 multi-protocol tools (swap, perps, prediction, lending, NEAR), live with a self-register path.
3. Autopilot's seal-before/reveal-after decision record with on-chain anchoring, a verifiable-track-record primitive.

TOP 3 WEAKEST
1. Zero real usage. Every "works" is unproven: no external swap, the one metered call got a 402.
2. Distribution rot: npm MCP bridge is 0.1.1 against 0.6.0 in the repo, Python SDK unpublished, A2A and billing untouched for 90+ days, chat/completions and webmcp are vapor.
3. Autopilot has never traded, so the public "transparency" page shows an empty $1000 paper account. That reads as a negative signal.

2-WEEK PLAN: MAKE THE GOVERNANCE LAYER USABLE BY ONE REAL USER
1. Days 1-2: run it end-to-end yourself on Base with $5. Register, set a policy (daily cap, token allowlist), have an agent request an over-cap swap, approve it via step-up, execute, call /audit/verify, hit the kill switch. Fix whatever breaks.
2. Days 3-4: remove friction.
   - Let the MCP serve get_quote/list_tokens without a key, or auto-mint a key on first MCP connect.
   - Publish @suwappu/mcp-server 0.6.0 to npm/Smithery with a one-line Claude Desktop/Cursor config.
   - Make sure starter credits cover the first 5 swaps with no 402.
3. Days 5-7: build a minimal owner dashboard page (approvals inbox, policy editor, audit log, kill switch). Telegram approval push is enough if the bot path already exists [I].
4. Days 8-14: position it as "guardrails for AI agents that spend crypto" rather than "another swap API". Ship a 60-second demo video of an agent being blocked, a human approving, and the audit verifying. Hand-onboard 3-5 agent builders (MCP/x402/ElizaOS communities). Success metric: one external agent completing a policy-gated swap.

Key paths:
- api-ts/src/app.ts
- api-ts/src/routes/agent.ts
- api-ts/src/routes/mcp.ts
- api-ts/src/services/PolicyService.ts
- api-ts/src/services/ApprovalService.ts
- api-ts/src/services/audit.ts
- api-ts/src/lib/seal.ts
- api-ts/src/services/autopilot/anchor.ts
- api-ts/src/middleware/x402Payment.ts
- packages/mcp-server/package.json
- packages/sdk-python
- capabilities.yaml
### Competition
VERDICT: REPOSITION (narrow double-down on the governance layer). Do not build more swap or protocol surface. The swap-API and MCP layers are commoditized, and Suwappu has no traction in either. The only part that may be differentiated is the policy / approval / tamper-evident-audit layer on agent wallets. That layer is also what the big wallet vendors are now selling, so it is unproven and contested.

Research depth: 3 broad searches only. Traction and pricing are thin and mostly secondary sources. Items marked UNVERIFIED need primary-source checks.

COMPETITOR FINDINGS
- Coinbase (Agentic Wallets, AgentKit, CDP, x402). [V] Agentic Wallets launched 2026-02-11 on CDP Server Wallet v2, with MPC keys held in AWS Nitro Enclaves (https://www.coinbase.com/developer-platform/discover/launches/agentic-wallets, https://coinpaprika.com/news/coinbase-agentic-wallets-ai-agents-february-2026-launch/). Agentic.Market launched 2026-04-20 as a marketplace/distribution channel. x402 volume sources disagree: >100M transactions on Base per Chainalysis via Cointelegraph, June 2026 (https://cointelegraph.com/news/agentic-payment-activity-surpasses-100m-transactions-on-base); ~165M and ~$50M cumulative as of April 2026 (https://www.dextools.io/news/coinbase-agentic-market-x402-ai-agents-base-usdc). Active-agent counts conflict (~69k vs 480k), UNVERIFIED. Coinbase acquires users through its own marketplace, developer docs and Base. Weakness [I]: tied to the Coinbase/Base ecosystem, with a custodial and trust model that is not neutral.
- Privy (now Stripe-owned) and Turnkey. [V] Both ship agent-wallet policies. Privy: an agent acts as an additional signer with scoped policies covering transfer limits, approved protocols, recipient restrictions and time windows, plus an Agent CLI and sandbox (https://docs.privy.io/wallets/overview/solutions/agent-wallets). Turnkey: a policy engine that scopes users, services or agents, with per-signature usage pricing (https://turnkey.com/solutions/ai-agents, https://www.turnkey.com/vs/privy-pricing-and-licensing). Turnkey's page is a competitor's framing, so treat the pricing contrast with care. Privy prices by monthly active users, tiered. Turnkey says it has processed 100M+ policies (https://www.turnkey.com/blog/100m-policies--turnkey-protecting-transactions). Basic spend-limit policy is therefore table-stakes, not a differentiator. Weakness [I]: they are wallet infrastructure, so you build the approval UX, the audit trail and the swap routing yourself.
- LI.FI. [V] Hosted MCP at mcp.li.quest. It covers swaps and bridges across 58 chains, aggregating 27 bridges and 31 DEXs, with an Intents MCP and an agentic-commerce API; it also ran a $1,000-per-agent trading competition (https://docs.li.fi/mcp-server/overview, https://li.fi/agentic-commerce). It is the router Suwappu wraps, so Suwappu's routing is strictly a subset. The MCP is non-custodial, with the agent holding the key. No traction numbers found.
- GOAT SDK and Solana Agent Kit (SendAI). Marketing figures only: GOAT 200+ on-chain actions, Solana Agent Kit 60+ actions (https://genfinity.io/2026/02/17/mcp-servers-ai-agents-crypto-future). They are open-source toolkits distributed through GitHub and framework integrations. Weakness [I]: local keys with no policy or approval layer; this is the usual critique, not sourced.
- Not researched: 0x agent MCP, Virtuals ACP, Wayfinder, Thirdweb Nebula/Engine, Crossmint, Alchemy, ElizaOS. UNVERIFIED: no traction data found for 0x or Virtuals ACP. Crossmint publishes an agent-wallet comparison (https://crossmint.com/learn/agent-wallets-compared) and Fireblocks has one too (https://www.fireblocks.com/report/compare-agent-wallets), so both are active in this space. Do not make claims about them without a follow-up pass.
- Distribution pattern across the field [I]: winners are bundled into a platform (Coinbase and Base, Stripe and Privy, LI.FI's integrator base) or ship as an open-source kit. None acquired users through a standalone swap API.

FEATURE MATRIX ([V] = confirmed for Suwappu in the internal audit; competitor cells come from the sources above or are [I])
| Feature | Suwappu | Coinbase Agentic Wallets | Privy/Turnkey | LI.FI MCP | GOAT / SolAgentKit |
|---|---|---|---|---|---|
| Open anonymous quotes | No: 402 / auth required [V] | No [I] | No [I] | Yes, hosted MCP [I] | Yes, local |
| Managed custodial agent wallet | Yes (Turnkey-backed) [V] | Yes (CDP MPC/Nitro) | Yes | No | No |
| Spend policy | Yes, code-complete [V] | Yes | Yes (limits, allowlists, time windows) | No | No |
| Human approval with step-up | Yes [V] | Partial UNVERIFIED | Partial UNVERIFIED | No | No |
| Tamper-evident audit | Yes [V] | UNVERIFIED | UNVERIFIED | No | No |
| Kill switch | Yes [V] | UNVERIFIED | UNVERIFIED | No | No |
| x402 payments | Yes, partial [V] | Yes, native | Partial [I] | Partial [I] | Partial |
| Multi-chain routing | Wraps LI.FI/Jupiter [V] | Base-centric [I] | Wallet-only | 58 chains | Per-kit |
| Perps / prediction / lending tools | Yes, 23-tool MCP [V] | Limited [I] | No | No | Some |
| Marketplace / distribution | None | Agentic.Market | Stripe ecosystem | LI.FI integrators | GitHub / frameworks |
| Published packages | MCP npm stale, Python SDK unpublished [V] | Yes | Yes | Yes | Yes |
| Real usage | ~0 [V] | 100M+ x402 txns (ecosystem) | 100M+ policies (Turnkey) | Not found | Not found |

(a) MISSING (table-stakes)
- Anonymous or zero-friction first call: quotes and swaps need a registered key.
- Current published packages: npm MCP bridge is 0.1.1 against 0.6.0 in the repo; Python SDK is not on PyPI [V].
- One working end-to-end external transaction. Nobody can trust an unexercised money path.
- A distribution channel: marketplace listing, framework plugin (ElizaOS), or Smithery/registry entry.
- An owner UI for approvals, policy editing and audit viewing. The code exists, but a non-technical owner cannot use it [I].
- A reason to hold funds in Suwappu wallets instead of Coinbase or Privy wallets.

(b) AHEAD or UNIQUE (honest)
- Nowhere on routing, scale, trust or distribution.
- Plausibly unique: the bundle of policy, step-up human approval, verifiable audit and kill switch, shipped together with swap execution. Competitors expose policy primitives, but I could not confirm that anyone ships the approval workflow and a verifiable audit log as a product. This is UNVERIFIED and needs a primary-source check of the Coinbase, Privy and Turnkey docs.
- Autopilot's seal-before / reveal-after decision record with on-chain anchoring is a rare idea [V]. It is worth nothing while the account sits at an empty $1,000 paper balance with no trades.

(c) UNSERVED GAPS a solo founder could own [I]
- Chain-agnostic "agent firewall": policy, approval and audit as a neutral layer that sits in front of any wallet (Coinbase, Privy, Turnkey), instead of another custodial wallet. This avoids competing with their custody and fits Suwappu's existing code. Highest-conviction idea.
- Auditor and compliance evidence for agent spend: exportable, verifiable audit logs for teams that must show what an agent did.
- Verifiable agent track records using the sealed-decision primitive, for agents that want credible proof of performance. Needs real trading history first.
- Human-in-the-loop approval over Telegram or mobile for agents. Suwappu already has a Telegram surface, so this is cheap to ship.

NEXT STEPS
1. Verify the governance claim: read the Coinbase, Privy and Turnkey docs for approval flows and audit logs. If they already ship these, the differentiator disappears and the verdict moves to freeze.
2. Execute the 2-week plan from the audit: run a $5 end-to-end on Base, remove key friction, publish the packages, hand-onboard 3-5 agent builders.
3. Kill the vapor: remove chat/completions and webmcp claims from docs, and stop presenting the empty autopilot page as a feature.
4. Set a hard checkpoint: if no external agent completes a policy-gated swap within ~4 weeks, freeze.

HANDOFF
agent: none
task: Conductor decision needed on reposition (governance/agent-firewall) vs freeze. If reposition, dispatch researcher for a primary-source check of Coinbase, Privy and Turnkey approval and audit features, then deploy-ops/sdk-dev for the stale npm @suwappu/mcp-server 0.6.0 publish and the PyPI sdk-python publish.
files: api-ts/src/services/PolicyService.ts, api-ts/src/services/ApprovalService.ts, api-ts/src/services/audit.ts, packages/mcp-server/package.json, packages/sdk-python (paths taken from the audit; I did not re-read them)
risks: MONEY-PATH for any execution or approval work; competitor claims are secondary-source and the matrix is partly inference [I]; research covered about half of the requested competitors.

## enterprise-policy
### Audit
ENTERPRISE / CONTROL-PLANE AUDIT (api-ts). [V] means I checked it in the code, [I] means inference.

Activity [V]: there were 56 api-ts commits in the last 90 days. Only 4 touched PolicyService, ApprovalService, audit.ts or enterprise.ts, and the last of those landed today (2026-11-20). The history looks squashed or ported ("on corrected mainline" commits), so the commit counts understate how much work went in. api-ts is deployed through api-ts/railway.json, and api.suwappu.bot serves it. Usage is about zero, so nothing below has been exercised by a real customer.

PRODUCT INVENTORY

1. Org / members / API keys / usage: api-ts/src/routes/enterprise.ts (833 LOC). Mounted at /enterprise in app.ts:265 [V]. Endpoints: create org, get/patch org, list/add/patch/remove members, create/list/revoke API keys, and GET usage. Tests exist: __tests__/enterprise.test.ts and enterpriseRouting.test.ts [V]. Status: partial. CRUD is there, but I found no SSO/SAML, no invite-by-email flow and no RBAC beyond member roles [I]. UI: webapp/src/pages/Enterprise.tsx and showcase/src/app/dashboard/page.tsx (1086 LOC, fetches usage with a period switch) [V]. Against WorkOS-grade team management it is about 30%.

2. Policy engine: services/PolicyService.ts (652 LOC) and db/schema/policies.ts [V]. It has:
   - chain, token and contract allowlists, failing closed when the contract is unknown (lines 148-187);
   - per-tx and daily USD caps;
   - org-wide policies (agent_id NULL) that sum usage across the whole org;
   - caps that fail closed when usage cannot be computed (around lines 443-516).
   CRUD exists only per agent: POST/DELETE /v1/agent/wallet/policy (agent.ts:3647, 3721). There is no enterprise route to create org-wide policies [V, from grep]. So the org-wide caps work in the engine but an org admin has no way to set them. Status: engine works, admin surface partial. Against Turnkey policies, Privy/Coinbase CDP wallet policies or Safe guards it is about 60%, and the logic is solid.

3. Human approvals and step-up: services/ApprovalService.ts (633 LOC) and lib/approvalTerms.ts. Routes [V]: GET /approvals and /approvals/:id, POST step-up/challenge, approve and deny (agent.ts:4942-5125). Approvals are single-use. Consuming one is protected against concurrent requests, and a failed resubmit refunds the charge. Test: approvalOwnership.test.ts. Status: works in code. This is the "agent proposes, human approves" pattern that most agent-wallet competitors lack or offer only as a paid add-on [I].

4. Hash-chained audit log: services/audit.ts (269 LOC). Entries are chained per org with SHA over canonical JSON, and writes are serialized with pg_advisory_xact_lock. GET /v1/agent/audit/verify walks the chain (agent.ts:5235). Test: auditVerifyChain.test.ts [V]. Status: works. It is a small piece but correct, and it makes a good compliance talking point.

5. Managed execution: POST /v1/agent/swap/execute (agent.ts around 2949-3200) [V]. It applies metered payment, the swap:execute scope, an Idempotency-Key, the policy gate (enforcePolicyGateForFreshQuote), and refund-on-failure that tracks unknown outcomes. It then calls Python at INTERNAL_API_URL/internal/agent/execute-swap. Wallets come from TurnkeyService.ts (571 LOC), which turns off when TURNKEY_* env vars are missing, with FallbackSigningService (116 LOC) as backup. Status: partial. The gates are complete. That a swap actually completes is unproven: 0 swaps in 30 days, and I could not see whether Turnkey env is set in prod [I].

6. Billing: routes/billing.ts (957 LOC) and StripeService.ts (328 LOC) [V]. Stripe checkout, a webhook (with a test), a portal, invoices, credit checkout, and crypto top-up/subscribe at 1 credit ≈ $0.001, with tiers at $9.99, $29.99 and $99.99. lib/spendPermission.ts holds a recurring-pull primitive ("the auto-renew primitive x402 itself lacks"). Status: code-complete. The only payment attempt seen was a 402 challenge, so revenue has never flowed through it. Against Stripe Billing plus Orb or Metronome it is about 50%.

7. "CFO agent": lib/cfoOperatingSystem.ts (279 LOC), plus financeForecast, FinancePanel.tsx and an admin route [V]. It runs downside/base/upside cash-runway forecasts for the founder's own finances. It is an internal tool, not a customer product. There are 12 recent "feat(cfo)" commits, and that effort does not reach any user.

HIDDEN GEMS
- Fail-closed policy, single-use approval with step-up, hash-chained audit, refund-on-failure, all on one execute path [V]. Each piece is common on its own. Having all four wired into one metered agent endpoint is rare and takes weeks to rebuild correctly [I].
- spendPermission, the recurring-pull primitive for x402 [V]. It is new and fits the agentic-payments story [I].

TOP 3 STRONGEST ASSETS
1. PolicyService with org-wide caps and fail-closed behavior.
2. The approvals and step-up flow.
3. The hash-chained audit log with its verify endpoint.

TOP 3 WEAKEST
1. Managed execution has never completed a swap in production. The Turnkey/Python signing path is unverified, and that path is where the money moves.
2. The org-wide policy engine has no admin API or UI, so the enterprise feature cannot be configured.
3. CFO OS is founder-internal and drew a disproportionate share of commits.

MAKING THE BEST ASSET USABLE IN 2 WEEKS
Ship it as a "guardrails for agent wallets" API, not as a DEX:
1. Days 1-3: add POST/GET/DELETE /enterprise/orgs/:orgId/policies so org admins can set caps and allowlists, and add a policy panel to the dashboard.
2. Days 3-6: prove one real end-to-end swap. Set the Turnkey env vars, run a $1 swap on Base through /v1/agent/swap/execute, deliberately trip an approval, approve it, and check that /audit/verify passes. Record it.
3. Days 6-10: publish an MCP tool and an SDK snippet for "policy check + approval" that can run before any signer (Turnkey, CDP, Privy), so the policy layer is not tied to Suwappu's own execution.
4. Days 10-14: hand-onboard 3 agent builders, for example from Coinbase AgentKit or ElizaOS communities, free in exchange for feedback.

The competitive gap: Turnkey, Privy and CDP ship signer-level policies, but none of them combines dollar-denominated org caps, human step-up approvals and a tamper-evident audit trail with metered billing [I, not web-verified this run].

Key files: api-ts/src/services/PolicyService.ts, api-ts/src/services/ApprovalService.ts, api-ts/src/services/audit.ts, api-ts/src/routes/enterprise.ts, api-ts/src/routes/agent.ts (lines 2949-3200, 3647, 4942-5235), api-ts/src/routes/billing.ts, api-ts/src/services/TurnkeyService.ts, api-ts/src/lib/spendPermission.ts, api-ts/src/lib/cfoOperatingSystem.ts
### Competition
**Verdict: reposition or freeze. Do not double-down on the DEX.** The control-plane code (policy, approvals, audit) is real but has no customer. It is also not clearly ahead of funded rivals. Sources are thin: I ran 2 searches and 2 fetches. I did not get traction numbers, and I did not get Privy or CDP pricing. Fireblocks' comparison page is a rival's own marketing.

**Competitor facts**
- [V] Turnkey charges per signature, not per wallet. The free tier is 25 signatures a month. After that it is $0.10, or $0.05 on Pro at a $99 minimum. Enterprise can go as low as $0.0015 ([markaicode](https://markaicode.com/pricing/turnkey-pricing/), [Sacra](https://sacra.com/c/turnkey)). Sources disagree on the free-tier wallet cap (100 vs 1,000).
- [V] Turnkey's policy engine runs inside secure enclaves, and unauthorized requests are rejected before any signature exists. Policies are included in the base product. It supports multi-party approval and velocity rules. In December 2025 it added opt-in cryptographic proof that a policy decision ran in an enclave ([Turnkey blog](https://www.turnkey.com/blog/introducing-verifiable-policy-decisions)).
- [V] Fireblocks ships an Agentic Payments Suite. Its features include spend limits, merchant allowlists, time windows, contract-method rules, and a per-decision audit log tied to the authorizing rule. It has no per-transaction human review: out-of-rule payments are refused, not queued ([Fireblocks](https://www.fireblocks.com/report/compare-agent-wallets)).
- [V, self-reported by Fireblocks] On Privy, developer-controlled agent wallets can transact without prompting the user. Privy has manual and workflow approvals, and its chain support is tiered. Turnkey has no native sanctions/AML screening (as of 17 Sep 2026) and no mention of SAML or SCIM.
- [V] Privy is now part of Stripe, and a Privy wallet can pay Stripe x402 merchants ([Privy blog](https://privy.io/blog/when-agentic-wallets-meet-real-merchants)). A third-party comparison calls Privy's policy language the most expressive of Privy, Crossmint and Turnkey, and says a Turnkey root quorum can bypass every policy ([Stablecoin Insider](https://stablecoininsider.org/crossmint-vs-privy-vs-turnkey-for-agent-wallets/)).
- [V, one blog] Coinbase launched Agentic Wallets on 11 Feb 2026, built on a TEE and tied to x402 ([DEV](https://dev.to/ai-agent-economy/x402-in-2026-coinbase-tempo-moonpay-and-the-only-multi-chain-non-custodial-option-47g1)).
- [V] Crossmint's March 2026 comparison counts at least 9 agent-wallet platforms ([Crossmint](https://crossmint.com/learn/agent-wallets-compared)). This is a crowded, vendor-funded space.
- UNVERIFIED: traction (users, volume, revenue), acquisition channels, and pricing for Privy, CDP, Fireblocks, BitGo, Safe/Zodiac, Lit, Squads, Brale, Openfort and Dynamic. I found no x402 volume figures. [I] From memory, Safe plus Zodiac Roles is free and open-source and is the self-custody guardrail standard on EVM. Squads is the Solana equivalent.

**Feature matrix** (Suwappu column is from the internal audit; competitor cells are from the sources above, mostly vendor claims)

| Feature | Suwappu | Turnkey | Privy | Fireblocks | Coinbase CDP |
|---|---|---|---|---|---|
| Per-tx / daily USD caps | Yes [V code] | Yes (velocity) | Yes | Yes | UNVERIFIED |
| Org-wide aggregate caps | Engine yes; no admin API [V] | Quorum/velocity | Per-domain | Yes | UNVERIFIED |
| Allowlists (chain, token, contract) | Yes, fail-closed | Yes | Yes | Yes | UNVERIFIED |
| Where policy is enforced | Own server (trust us) [I] | In enclave, provable | In enclave | Own infrastructure | TEE |
| Human approval and step-up | Yes, single-use | Quorum | Yes | No; refuses out-of-rule payments | UNVERIFIED |
| Tamper-evident audit | Hash chain with verify endpoint | Activity logs plus enclave proofs | Webhooks | Per-decision log | UNVERIFIED |
| SSO/SAML/SCIM | No | Not referenced on the Fireblocks comparison page | UNVERIFIED | Yes (enterprise) [I] | UNVERIFIED |
| Sanctions/AML screening | No | No native product | Via partners | Yes | UNVERIFIED |
| Proven working in production | No (0 swaps) | Yes | Yes | Yes | Yes |
| Compliance attestations (SOC 2 and similar) | None [I] | Yes [I] | Yes [I] | Yes | Yes [I] |
| Pricing | Credits, about $0.001 each | Per signature | Per user/transaction | Enterprise | UNVERIFIED |

**(a) Missing table-stakes**
- A working production swap. This is the biggest gap.
- No signer-agnostic integration. Policies only guard Suwappu's own execute path.
- No admin surface for org-wide policies.
- No SSO/SAML or SCIM. Compliance buyers will expect them.
- No SOC 2 or sanctions screening.
- No named reference customer.

**(b) Where Suwappu is ahead or unique**
- Nowhere defensible today.
- The combination of fail-closed USD caps, single-use step-up approvals, hash-chained audit and metered billing on one endpoint is a real engineering package [I]. Each piece is replicated or exceeded by funded rivals.
- Turnkey and Privy enforce policy inside enclaves, so the enforcement itself is stronger. Suwappu's policy runs on its own server, so users must trust Suwappu.
- The audit hash chain verifies the log, not the policy decision.
- The only plausibly differentiated item is the queue-for-approval model (propose, then a human approves). Fireblocks refuses such payments outright, and Privy's approvals are an add-on.
- spendPermission (a recurring-pull primitive for x402) is novel [I]. It is unproven.

**(c) Unserved gaps a solo founder could own** [I, not validated with buyers]
- A signer-agnostic "policy and approval layer" sitting in front of Turnkey, CDP or Privy. These vendors sell signing, and Turnkey and Fireblocks leave reconciliation, reporting and human-in-the-loop UX to the customer.
- Approval inbox UX, such as Telegram or mobile push approvals, for agent spend. Suwappu already has a Telegram surface, and this fits a solo founder.
- Open-source Safe/Zodiac-style guardrails for non-EVM agents.
- Treat all three as hypotheses. Test them with 5 to 10 agent-builder conversations before writing any code.

**(d) Verdict: reposition.** Drop "cross-chain DEX bot" and sell "approval and audit layer for agent spend." Gate all further work on one proven $1 end-to-end swap and 3 real design-partner users. If neither happens within about 4 weeks, freeze. The CFO OS commits (12 of them) should stop now, because they serve no user.

HANDOFF
agent: none
task: Founder decision. Next research pass, if wanted: verify Privy, CDP, Safe/Zodiac, Squads and Openfort pricing and traction from their own pricing pages, plus x402 volume (for example from x402scan). A builder task, if repositioning is chosen, is to add POST/GET/DELETE /enterprise/orgs/:orgId/policies in api-ts/src/routes/enterprise.ts, and then run the $1 Base swap through /v1/agent/swap/execute.
files: api-ts/src/services/PolicyService.ts, api-ts/src/services/ApprovalService.ts, api-ts/src/services/audit.ts, api-ts/src/routes/enterprise.ts
risks: MONEY-PATH for any swap execution or Turnkey work. Cross-stack: execution calls the Python /internal/agent/execute-swap. Competitor pricing is unverified, so do not quote it externally.

## arbiter-protocol
### Audit
CLUSTER: arbiter-protocol. Audited from code, git log, and live curls on 2026-11-20. [V] means verified, [I] means inference.

**Inventory (src LOC, commits in last 90 days, status)**

1. **Arbiter escrow plus TEE verifier** (near/arbiter-contract, -v3, -github, -http, -wasm, -forensics, -reputation; about 2.2k LOC Rust; 15 commits; last change 2026-11-05).
   - Status: works end-to-end on testnet only [V].
   - `suwappu-arb3.testnet` (v3, with the `http_json_v1` rubric) and `arb2.suwappu-arbiter.testnet` were resolved by the real OutLayer TDX enclave (`outlayer.testnet`). Pass and fail runs are documented with tx hashes in docs/arbiter-production.md:98-116 [V].
   - Not deployed:
     - The API routes are mounted only behind `config.hackathonArbiter` (api-ts/src/app.ts:215-218).
     - `GET https://api.suwappu.bot/hackathon/arbiter/status` returns 404, so the flag is off in prod [V].
     - `www.suwappu.bot/arbiter` returns 200. It is the dry-run demo page [V].
   - Not on mainnet and no external audit. The resolver is still the testnet constant (docs/arbiter-production.md:63-66) [V].
   - arbiter-reputation (288 LOC) is a stub/index, not a product [I].
   - Compared with production competitors (UMA, Kleros, Reclaim/Opacity zkTLS), it is narrower: deterministic rubrics only, PR-merged plus HTTP-JSON. Your own research found no competitor doing "the TEE fetches the evidence and the contract releases on pass" (docs/plans/arbiter-improve-or-pivot.md) [V-doc, I-market].

2. **mpc-signer** (8.6k LOC Rust; 0 commits in 90 days; last change 2026-08-15).
   - Status: partial protocol core, not wired into anything. Its own README says "intentionally not wired into production" [V].
   - What it implements:
     - FROST Ed25519 per RFC 9591, checked byte-for-byte against the Appendix E.1 vector.
     - A 2-of-3 Feldman DKG.
     - CGGMP24 secp256k1 DKG, aux proofs (Pi_prm/mod/fac) and malicious presigning.
     - A crash-safe nonce tombstone ledger.
   - Against Turnkey, Lit or Fireblocks it is missing networking, HSM/TEE hosting, key refresh, ops and an audit.
   - Hidden gem #1 [I]: hand-built CGGMP24 plus FROST is genuinely rare and hard to rebuild. It is also dangerous to ship unaudited.

3. **contracts/** (10.4k LOC Solidity; 25 commits; last change 2026-09-02).
   - SUWP, Staking (Superfluid GDA streaming) and Bonds (TWAP LP pricing) are deployed on Base Sepolia only. Base mainnet is "not yet deployed" (contracts/DEPLOYMENTS.md:23) [V].
   - primitives/ (TimeCurve, AmortizingVault, MutualCredit; 1.2k LOC) has invariant and Medusa harnesses (contracts/MAINNET_READINESS.md). Status: plan to deploy on HyperEVM, not deployed [V].
   - hypercore/ CoreRouter, per-user bound router (1.5k LOC; 18 commits, the most active part). It has an internal audit (AUDIT_COREROUTER_2026-08-31.md). Deployment not found in DEPLOYMENTS.md [V].
   - Membership/Positions/OFT: code only [I].

4. **execution/searcher** (4k LOC Rust; 1 commit).
   - Status: research/measurement crate run on fixtures; "isolated from deployed services" per its README [V].
   - It does markouts, LVR decomposition and route sizing against an oracle. It is credible, but a real searcher needs live feeds and capital.

5. **hackathon/tokyo2026, the "Agent Swap Passport"** (1.8k LOC TS; 1 commit; last change 2026-09-26).
   - Status: a demo build. It combines World ID (signal bound to the trade intent, nullifier unique), Intercepta payTo screening, ENSv2 caps and the Uniswap Trading API [V-code].
   - It is not wired into the bot [I].
   - ERC-8004/8183: research references only. Arbiter as an ERC-8183 evaluator is an option, not code [V].

6. **contracts-hackathon** (Uniswap hook, Aqua SwapVM; about 1k LOC; 2 commits): hackathon stubs.

7. **PQ settlement profile** (docs/pq-settlement-profile.md): plan-only. It says "experimental / unavailable"; the real work lives in external repos [V].

**TOP 3 STRONGEST ASSETS**
1. **Arbiter.** The only item here with real third-party infrastructure (an OutLayer TDX enclave) settling testnet escrows end-to-end, plus a reproducible attestation spec (docs/arbiter-attestation-v1.md). The combination appears unclaimed.
2. **mpc-signer.** RFC-vector-verified FROST plus a CGGMP24 core. Rare engineering and a real long-term moat for self-custody. Today it has no consumer.
3. **CoreRouter bound-user plus the audited Staking/Bonds.** Most recent commit activity, internal audits with fixes verified on testnet, and a Medusa invariant harness.

**TOP 3 WEAKEST**
1. **The whole PQ / Lattice settlement line.** Docs only, depends on draft EIPs, and has zero bearing on users.
2. **contracts-hackathon plus the Tokyo passport.** One-off prize builds, idle for two months, not integrated.
3. **execution/searcher.** Needs capital and live order flow the project doesn't have. A solo founder with $0 can't run MEV.

Beyond the individual items: nothing in this cluster is on mainnet, and nothing is reachable from a production route.

**Make Arbiter usable by a real user in 2 weeks (Arbiter Pay, x402 pay-on-delivery)**
- **Days 1-2:**
  - Turn on `hackathonArbiter` and move the routes to `/v1/arbiter/*`.
  - Add `POST /v1/arbiter/attest` behind the existing x402 middleware.
  - Expose it as an MCP tool. mcpTools.ts already references Arbiter.
- **Days 3-6:**
  - Reuse `arbiter-http` to add HTTP predicates (status, JSON-schema, non-empty, latency).
  - Deal with GitHub rate limits by having PR rubrics accept an authenticated fetch, or drop PR rubrics from the pitch.
- **Days 7-9:**
  - Ship on NEAR mainnet, but cap it hard (for example $50 per escrow) with a visible "unaudited, capped" label.
  - Resolver set to `outlayer.near`; arbiter WASM hash pinned to a release.
  - Needs a money-path review.
- **Days 10-12:**
  - Run a public demo against 2-3 real x402 endpoints: one pass, one fail with a refund.
  - Publish the refund log.
- **Days 13-14:** Reach out directly to x402 API providers and ERC-8183 / Virtuals ACP job builders.
- **Kill criterion:** one external integration or one paid verification by week 4.

What can't be solved in 2 weeks: a third-party audit and demand. Your own research rates agent-commerce volume as thin and partly artificial.
### Competition
**Verdict: REPOSITION (freeze the rest).** Arbiter is the only asset with a real differentiator, but it is crowded by x402 escrow projects, has no demand, and is testnet-only. Spend at most 2-4 weeks on a capped, mainnet "pay-on-delivery verifier for x402" with a hard kill criterion. Freeze PQ, searcher, hackathon stubs and mpc-signer. Do not build more.

**Evidence base.** Internal facts are from the task brief [V]. Competitor data comes from a handful of web searches (low-effort pass). Most competitor figures are self-reported or promotional, marked [I] where unverified. I did not fetch primary pages for UMA, Kleros, Opacity, TLSNotary, Phala, Algora, CoW, UniswapX, Across or Anoma. Treat those as [I] from background knowledge, not verified here.

**Competitors (what they ship / traction / weakness)**
- **x402 escrow layer (direct competitors, 5+ already shipped).** Not on your original list, and the most important finding.
  - agora402: escrow on Base with JSON-schema or hash verification and an auto-refund timelock. 2% fee on release, $100 cap per escrow ([socket.dev/npm/package/agora402](https://socket.dev/npm/package/agora402)) [I, self-reported].
  - PayCrow `safe_pay`: auto-disputes on invalid JSON or a 5xx ([earezki.com write-up](https://earezki.com/ai-news/2026-03-14-add-escrow-protection-to-any-x402-agent-payment-in-5-minutes/)).
  - x402r refund protocol ([Product Hunt](https://www.producthunt.com/products/x402r-refund-protocol)).
  - Boson x402B, launched May 2026 ([ourcryptotalk](https://ourcryptotalk.com/news/boson-protocol-launches-x402b-escrow-agent-commerce)).
  - Kustodia: escrow exposed as MCP tools ([Cointelegraph PR](https://cointelegraph.com/press-releases/kustodia-launches-the-missing-escrow-layer-for-ai-agents-and-x402-payments)).
  - A402: academic TEE adaptor-signature design, not shipped ([arXiv 2603.01179](https://arxiv.org/html/2605.11781v1) [I]).
  - Weakness: no independent audits found; the volume behind these is unknown.
  - Your "unclaimed" claim in docs/plans/arbiter-improve-or-pivot.md is partly wrong. HTTP-JSON-schema pay-on-delivery is already built by others. The only unclaimed part is that the verifier is a hardware-attested TEE with a public attestation spec.
- **ERC-8183 / Virtuals ACP.** Draft standard co-authored by Virtuals and the EF dAI team, with an evaluator role that gates escrow release ([eips.ethereum.org/EIPS/eip-8183](https://eips.ethereum.org/EIPS/eip-8183)). Virtuals self-reports $3M+ agent-to-agent volume and 20k agents. Counts conflict across sources and are unverified ([Crypto Briefing](https://cryptobriefing.com/erc-8183-virtuals-ethereum-agent-commerce/)). Forum complaint: a stuck or offline evaluator strands jobs, and evaluator trust is unsolved ([Magicians thread](https://ethereum-magicians.org/t/erc-8183-agentic-commerce/27902)). This is an opening: a deterministic TEE evaluator is a plausible product.
- **UMA.** Optimistic oracle that settles Polymarket. Claims of 400K+ assertions and a 0.69% dispute rate are promotional and undated. Token Terminal shows fees -27.9% over 30 days, undated ([tokenterminal](https://tt-content-footer-links.preview.tokenterminal.com/terminal/projects/uma)) [I]. Risk: Polymarket may move resolution in-house. Weakness: human, subjective, slow, with conflict-of-interest criticism ([Finance Magnates](https://www.financemagnates.com/fintech/polymarkets-arbitration-model-faces-conflict-of-interest-questions/)).
- **Kleros.** Human jury court. One blog claims about 10 disputes a week [I, weak]. Slow and expensive for micro-payments.
- **Reclaim (zkTLS).** Freemium, with a free tier of 25 verifications a month and paid tiers unconfirmed. Self-claims of 20+ products and 5K proofs in 3 months ([Stellar grant](https://communityfund.stellar.org/submissions/recI47989fX12SZ6m)) [I]. About $10M Series A (via [Solana Compass](https://solanacompass.com/projects/reclaim-protocol)). It is the closest verification-as-a-service peer and shows that "verifier" is sold per-proof to developers.
- **Opacity, TLSNotary, Phala:** [I] not researched this pass. They are the same category (zkTLS/MPC-TLS and TEE hosting). Phala and OutLayer are infrastructure you would rent, not compete with.
- **NEAR Intents.** About $37B cumulative volume, $10.41B in Q3 2026 ([ourcryptotalk](https://ourcryptotalk.com/news/near-intents-volume-tops-37b-brave-leo), [coinfomania](https://coinfomania.com/near-protocol-reports-10-41b-in-q3-2026-volume/)). Analysts question how much is organic. I found no source tying OutLayer to the Intents verifier. This is the real competitor to the Suwappu DEX/bot, and it is not a competitor to Arbiter.
- **CoW, UniswapX, Across intents; Algora; Anoma:** [I] not researched. Intent swap infrastructure is dominated by well-funded teams, and a solo $0 swap bot cannot differentiate there.

**Feature matrix** (Suwappu column from the internal audit [V]; competitor columns from the searches above and [I] where noted)

| Feature | Suwappu Arbiter | agora402/PayCrow | Reclaim | UMA | ERC-8183 ACP |
|---|---|---|---|---|---|
| Mainnet live | No (testnet) | Yes (Base) [I] | Yes | Yes | Yes |
| Real users or volume | ~0 | unknown | claimed 20+ apps | high (Polymarket) | claimed $3M+ |
| Hardware-attested verifier | Yes (TDX via OutLayer) | No | No (zk) | No | No |
| HTTP-JSON/schema rubric | Yes (v3) | Yes | n/a | No | n/a |
| PR-merged (GitHub) rubric | Yes | No | n/a | No | n/a |
| x402 integration | Planned (not routed) | Yes | No | No | No |
| MCP tool | Referenced only | Yes (Kustodia) | No | No | No |
| Audit | None | None found | Unknown | Yes | n/a |
| Public docs/SDK | Docs, no SDK | npm package | SDK | Yes | Spec |

**(a) Missing, table stakes**
- Mainnet deployment and an audit. Users will not lock funds in unaudited code, even capped.
- Any live production route. The API returns 404 today (api-ts/src/app.ts:215-218).
- An SDK or npm package. agora402 ships one.
- A named customer or integration.
- A dispute path for the case where the rubric is wrong or the TEE is down.
- Public distribution: x402 directories, ACP and ERC-8183 listings.

**(b) Ahead or unique (honest)**
- Narrowly ahead: a documented TDX-attested verifier running a PR-merged rubric, with a reproducible attestation spec (docs/arbiter-attestation-v1.md). That is a differentiator in theory, but nobody has been shown to want it.
- mpc-signer is rare engineering (RFC 9591 vectors, CGGMP24). It has no consumer, so it is not a product.
- Everywhere else, including swaps, there is nothing ahead. Usage is ~0.

**(c) Unserved gaps a solo founder could own**
- A deterministic TEE evaluator for ERC-8183 jobs and Virtuals ACP. This targets the stuck-evaluator complaint; no competitor was found doing it. [I]
- A verifier with attestation receipts that third parties can check, which no x402 escrow project offers.
- Bounty/PR payout verification (Algora-style) with no human in the loop. [I, Algora not researched.]
- Niche: pay-on-delivery for paid MCP/API tools, once there are enough paid endpoints. Today there are few, and agent-commerce volume is thin and partly artificial.

**Suggested next steps**
- Do the 2-week plan from the brief, but first search for a real design partner. Without one signed commitment, skip the mainnet money-path work.
- Kill criterion stays: one external integration or paid verification by week 4. If it is missed, freeze the whole cluster.

HANDOFF
agent: none
task: Founder decision needed on REPOSITION vs FREEZE. If REPOSITION, dispatch api-ts-dev to enable the arbiter routes at /v1/arbiter/* with x402 middleware and an MCP tool, then money-path-reviewer on the NEAR mainnet capped deploy. Acceptance: one external integration or paid verification by week 4.
files: api-ts/src/app.ts:215-218; docs/arbiter-production.md:63-66,98-116; docs/plans/arbiter-improve-or-pivot.md; docs/arbiter-attestation-v1.md
risks: MONEY-PATH on any mainnet escrow deploy; cross-stack (api-ts routes plus NEAR contracts); unaudited code holding user funds; competitor claims above are mostly self-reported.

## neobank-token
### Audit
CLUSTER AUDIT: neobank-token (read-only, 2026-11-20)

Activity context [V]: the repo has 551 commits in the last 90 days. Almost every file in this cluster has 0 or 1 of them (`git log --since=90.days`). The cluster has been dormant since roughly Sep 26 (last touch on btc_bridge/starknet/savings/Membership). Production DB shows 0 completed swaps, so nothing below has been used by a real person.

PRODUCT INVENTORY (status / vs a production competitor / LOC / deployed)

1. USDC Savings `/save` (Aave V3, Base). bot/services/savings_service.py (399) + bot/handlers/savings.py (1400). It builds, signs and sends real deposit/withdraw txs via `send_raw_transaction` (savings_service.py:212-223, 292, 350). Registered at bot/main.py:522 [V]. Status: code-complete for the full path, but no live tx on record [I]. Compared with Coinbase USDC rewards or the Aave app it is functionally equivalent; the only extra is that it sits in a chat bot. Commodity.

2. Earn `/earn` (ERC-4626 vaults: Ethena, Sky, Morpho) plus Morpho borrow with a health-factor monitor. earn.py (653), vault_service.py (749, 2 commits), morpho_api.py (1067), morpho_monitor.py (235). The monitor starts in api/main.py:488 because `morpho_enabled` defaults to True [V]. Status: partial to complete, not functionally verified. Compared with Morpho's app or Summer.fi it is thinner, but the auto health alerts are a real plus.

3. Starknet BTC neobank `/btc`: Atomiq Lightning/BTC to Starknet WBTC (or Citrea cBTC) and back. btc_bridge.py (874), btc_bridge_poller.py (163), handlers/btc.py (798), starknet/{client,paymaster}.py (648), starknet_yield.py (485, Endur xWBTC / Vesu vWBTC). The poller is on by default (settings.py:643) and the AVNU gasless paymaster is on by default (settings.py:628) [V]. The design is careful: it uses a sha256 preimage claim, keeps the LN secret encrypted at rest and zeroized after reveal, allowlists escrow contracts, and records txs idempotently per Atomiq state. It has a Botanix denylist (btc_bridge.py:1-60). Status: code-complete, no evidence of a mainnet round trip [I]. One risk: `atomiq_escrow_contracts` defaults to an empty string (settings.py:650). If that is never set in prod, withdrawals may be blocked or unchecked; this needs checking [I]. **HIDDEN GEM.** I know of no Telegram bot that offers Lightning in and BTC yield out with sponsored gas. The comparable apps are Braavos/Ready (Starknet wallets) and Strike (custodial).

4. Gas sponsorship. AVNU SNIP-29 paymaster on Starknet (on by default) and Tempo fee sponsor (tempo_fee_sponsor.py 233, `tempo_fee_sponsor_enabled`=False) [V]. Partial. There is no EVM 4337 paymaster in the code, even though Robinhood Chain supports one (docs/plans/robinhood-membership-integration.md).

5. Custodial balances. bot/models/custodial.py (248), handlers/custodial.py and admin_custodial.py, used for reward credits and gift cards [V]. Partial. This is an internal ledger, not a product.

6. SUWP token, staking, bonds and OFT. contracts/SUWP.sol (73), SuwppuStaking.sol (392, Superfluid USDCx streaming), SuwppuBonds.sol (391, TWAP LP pricing), SuwpOFT.sol (84). Base Sepolia only; "Base Mainnet — not yet deployed" (contracts/DEPLOYMENTS.md:23) [V]. There have been two audit passes, and per-second USDC streaming to stakers was verified on testnet (DEPLOYMENTS.md). The off-chain side is staking_service.py (364), api-ts/src/routes/staking.ts (336), mounted at app.ts:256 [V]. Status: testnet-only. It has no value without users, and launching a token with 0 users is a negative signal.

7. Seasons, points, XP and the rewards marketplace. points_service.py (1377), seasons_service.py (561), onchain_rewards_service.py (612), handlers/points.py and rewards.py, all registered (main.py:442-449, 587-588) [V]. The api-ts rewards route is mounted at app.ts:233. The rewards marketplace runs through giftcard_api.py, which is a "Bitrefill-style ... scaffold. Blocked on: BITREFILL_API_KEY" (giftcard_api.py:1-11) [V], so it is a stub. Compared with Hyperliquid or Jupiter points: the mechanics are fine, but a points program with no users does nothing.

8. Membership NFT ("card") on Robinhood Chain. contracts/SuwappuMembership.sol (521, a soulbound ERC-721 that acts as the subscription) and membership_service.py (819). `suwappu_membership_contract` defaults to None, so the on-chain path is disabled (settings.py:1418) [V]. No mainnet address appears in DEPLOYMENTS.md [V]. Status: plan plus code, not deployed. Note that docs/plans/card-* refers to this NFT fee-discount card, NOT a Visa/Mastercard card. No debit-card integration exists anywhere in the code [V]. The founder's own analysis shows the $40 card loses $200 per year for each PRO user it converts (card-renewals-and-upgrades.md).

9. Position cards. SuwappuPositions.sol (1077), position_cards_service.py (640), `/cards` (main.py:443). Partial; it is a novelty.

10. Robinhood chain-native, BTCfi expansion, and the NEOBANK_ROADMAP items (ENS pay, recurring transfers, on/off-ramp, Visa card). docs/plans/robinhood-*.md, btcfi-expansion-plan.md, NEOBANK_ROADMAP.md. Mostly plan-only. Robinhood has RPC and Alchemy config (settings.py:361, 899), and deploy_robinhood_chain.py exists [V].

GAPS vs the neobank competitors (Ether.fi Cash, Gnosis Pay, Zeal, Coinbase, Strike, Félix) [I]:
- no fiat on-ramp
- no off-ramp
- no spend card
- no IBAN/ACH
- no balance statement or "you earned $X" view surfaced in the bot
- no recovery story for non-crypto users

These are exactly the items the founder's own roadmap marks "requires partner".

TOP 3 STRONGEST ASSETS
1. The Lightning to Starknet BTC bridge, with BTC yield (Endur/Vesu) and gasless AVNU accounts. It is rare, hard to rebuild (Atomiq secret-reveal flow, Starknet account deploys) and already wired into the bot.
2. The idle-USDC yield stack: Aave savings, ERC-4626 earn and Morpho borrow with health alerts. These are real tx paths, and they match the roadmap's main finding that trading bots leave idle balances earning 0%.
3. Audited SUWP staking with Superfluid real-yield streaming. It is technically solid, but its value depends on traction the product doesn't have.

TOP 3 WEAKEST
1. Rewards marketplace and gift cards: a scaffold with no provider key.
2. The membership NFT card: not deployed, and its pricing undercuts the subscription ladder.
3. The SUWP token and bonds: testnet-only and premature at 0 users; a regulatory and reputational risk with no upside today.

2-WEEK PATH: make the BTC bridge usable by a real person
- Days 1-2: in prod, confirm the Railway flags (`starknet_btc_bridge_enabled`, `starknet_paymaster_enabled`), the `avnu_paymaster_api_key`, and the populated `atomiq_escrow_contracts` allowlist. Do one $5 Lightning deposit and one withdrawal yourself; capture the tx hashes and check them with Blockscout or Voyager.
- Days 3-5: fix whatever breaks, and add a "BTC savings" screen that shows the WBTC balance, the Endur/Vesu APY and accrued yield.
- Days 6-8: cut everything unrelated from the bot's first screen so the flow is: pay a Lightning invoice, earn about X% on BTC, withdraw to any Lightning wallet.
- Days 9-14: get it in front of about 20 Lightning users (Nostr/Stacker News and Starknet BTCfi channels) and measure deposits.

It is only real once an outside user's deposit settles. Until then it is code-complete but not functionally verified, and what it needs is the live round trip.
### Competition
VERDICT: reposition and freeze, scoped to the BTC bridge. Suwappu is not behind in neobank features. It is behind in distribution and trust, and nothing in the cluster has had a real user. Freeze token, NFT card, rewards and gift cards. Make one live Lightning-in, BTC-yield, Lightning-out round trip the only goal. Do not chase the card or fiat gaps.

Scope: I ran 4 web searches (Ether.fi, Gnosis Pay, Kast/RedotPay, Lightning-to-Starknet) and used the supplied repo audit. I did not research Coinbase One, Revolut, Robinhood, Xverse, Bitget or Kraken in depth. Treat everything about them as [I]. The category figures below are mostly Paymentscan/SpendNode aggregates and vendor claims, not audited numbers.

COMPETITORS [V = sourced, I = inference]
- **Ether.fi Cash** (Visa card on OP Mainnet): [V] cumulative spend passed $800M by Sep 2026 ([Crypto Briefing](https://cryptobriefing.com/ether-fi-cash-exceeds-800m-spend/)). $123.7M spent in Sep 2026 across 48k active addresses ([SpendNode](https://www.spendnode.io/blog/ether-fi-1-billion-cumulative-card-spend-october-2026/)). Cashback is 3-4% by tier, with an FX margin. Aug 2026 added tokenized stocks and Aave-backed portfolio loans ([The Block](https://theblock.co/news/defi/2026-08-13-ether-fi-adds-tokenized-stocks-metals-and-aave-powered-portfolio-loans-in-latest-neobank-expansion-411704)). Acquisition is cashback plus staking-community pull (I). The effective cashback rate is below the advertised one.
- **Gnosis Pay**: [V] the consumer card shuts down on 20 Dec 2026 and the company is pivoting to B2B. Signups closed 30 Sep. Q2 2026 volume was about $26M ([Gnosis Q2 report](https://docs.gnosis.io/docs/knowledge/quarterly-report-2026-q2), [Crypto Briefing](https://cryptobriefing.com/gnosis-pay-shutdown-consumer-cards-b2b/)). Takeaway: a self-custody card with real distribution still failed as consumer B2C. This is a warning against building a card.
- **RedotPay**: [V] claims 8M+ users and $14B annualized volume (vendor claim). About 61% of cumulative card volume ([Crypto.news](https://crypto.news/stablecoin-card-spending-crosses-10-9b/)). It targets emerging-market users.
- **Kast**: [V] about $113M monthly volume in Sep 2026. It topped daily volume once, during a points campaign ([Crypto Briefing](https://cryptobriefing.com/kastxyz-surpasses-redotpay-crypto-card-spending/)). Acquisition is points-driven.
- **Category**: [V] about $1.1B per month of stablecoin card spend. Volume is concentrated in 3 programs, with 55.6% of the total.
- **Coinbase One/Base app, Revolut, Robinhood, Kraken, Strike, Bitget, Xverse**: UNVERIFIED. [I] They have regulated fiat rails, cards and brand trust. I did not check their numbers.
- **Telegram wallet with yield**: [V] TON Wallet in Telegram offers BTC/ETH/USDT yield ([The Block](https://www.theblock.co/news/ecosystems/2026-02-26-telegram-crypto-wallet-yield-bitcoin-ethereum-usdt-holdings-391338)). It reaches Telegram's whole audience, so it is the real in-chat rival.
- **Starknet BTC yield**: [V] Starknet and Xverse already surface Endur/Vesu/Troves yield and a native BTC to strkBTC route via Atomiq and Garden ([Starknet](https://www.starknet.io/blog/native-btc-to-strkbtc-powered-by-atomiq-and-garden/), [Xverse](https://www.xverse.app/blog/starknet-defi-dapps-exchanges)). A hackathon project, OneSat, shows the Lightning-to-Starknet-yield idea, so "nobody does this" is only partly true.

FEATURE MATRIX (Suwappu column from the audit; Y = code exists, 0 usage)
| Feature | Suwappu | Ether.fi Cash | Kast | RedotPay | TON Wallet in Telegram |
|---|---|---|---|---|---|
| Spend card | No | Yes (Visa) | Yes | Yes | No |
| Fiat on/off-ramp | No | Partial (I) | Yes (I) | Yes | Partial (I) |
| Idle-balance yield | Y (Aave/Morpho; untested live) | Yes | Partial (I) | Partial (I) | Yes |
| BTC yield | Y (Endur/Vesu) | No (I) | No (I) | No (I) | Yes |
| Lightning in/out | Y (Atomiq; untested live) | No | No | No | No (I) |
| Gasless UX | Y (AVNU on Starknet) | Yes (gas covered) | Yes (I) | Custodial | Yes (I) |
| Self-custody | Y (KMS envelope; bot holds keys) | Yes (non-custodial) | No (I) | No | Yes |
| Real users | ~0 | 48k active | Large | 8M claimed | Telegram-scale |

(a) MISSING, table stakes
- A spend card or fiat on/off-ramp. Every funded competitor has one. Gnosis's failure suggests that building one is not the path.
- Visible earnings ("you earned $X"), a statement view, and any recovery story for non-crypto users. [V] None surfaced in the bot, per the audit.
- Distribution and trust. Competitors have cashback, points and brand; Suwappu has none. [I]

(b) AHEAD or unique
- Only on the Lightning to Starknet BTC yield path, and only on paper. No competitor I found offers Lightning in, BTC yield and gasless gas in a chat bot. [I] The edge is thin: the pieces are public, a hackathon project covers the idea, and the code has never settled a mainnet transaction. Everywhere else (Aave savings, Morpho, tokens, points) Suwappu is commodity or behind.

(c) UNSERVED GAPS a solo founder could own
- BTC holders who use Lightning and want yield without bridging manually. A niche, but I found no live product that does it end to end. [I]
- Non-custodial, gasless BTC savings with a simple "earned $X" view, aimed at Lightning communities (Stacker News, Nostr). [I]
- Do not enter the card or fiat race. Gnosis Pay's shutdown and Ether.fi's lead (an $800M+ head start) make it a poor bet for $0 and one person.

(d) VERDICT: reposition and freeze, as above. The one-line version: Lightning to BTC yield to Lightning is the product, everything else is frozen, and it only counts once an outside deposit settles.

CAVEATS
- The mainnet round trip is unproven. `atomiq_escrow_contracts` is empty by default (settings.py:650). Verify the prod value before any user funds move.
- The Ether.fi 3-4% cashback figure comes from review sites, not Ether.fi's own pages.
- The Paymentscan/SpendNode volume figures are partial aggregates; KAST's numbers come from different reports and periods.

HANDOFF
agent: deploy-ops
task: Verify prod Railway env for the BTC bridge. Check `starknet_btc_bridge_enabled`, `starknet_paymaster_enabled`, `avnu_paymaster_api_key` and that `atomiq_escrow_contracts` is populated. Report values and any gaps. Then hand to bot-dev for a "BTC savings" screen showing WBTC balance, Endur/Vesu APY and accrued yield. After that the founder does a $5 mainnet Lightning round trip (a human step).
files: bot/config/settings.py:628,643,650; bot/services/btc_bridge.py; bot/handlers/btc.py; bot/services/starknet_yield.py
risks: MONEY-PATH (bridge claims, withdrawals, secret handling). Route any code change through money-path-reviewer. No migration expected. Python stack only.

## data-intel
### Audit
DATA-INTEL CLUSTER AUDIT (read-only, 2026-11-20). [V] = verified in code, git, or a live probe. [I] = inference.

Context: no code in this cluster has been touched in the last 54 days. The last commits are 2026-09-26/27 [V]. The side services sit on orphan branches that share no history with main (`git merge-base` fails), roughly 1,800 commits apart [V].

**Inventory**

1. **pump-onchain-ingest** (branch `feat/pump-onchain-ingest`, `ingest/pump_ingest.py` 616 LOC plus `pump_ingest_live.py`) [V]
   - What it does: collects Solana PumpSwap data from RPC only. It stores normalized tx, SOL-delta, token-delta and instruction facts, gzips raw payloads, enforces byte budgets and paginates by cursor. The engineering is careful.
   - Status: stalled. The ghostcatcher metadata endpoint, live today, shows block_time from 2026-08-19 02:02 to 11:00 UTC. That is about 9 hours of data: 127k tx, 3,215 mints, 1.29M instructions [V].
   - Deployment: Railway service `pump-onchain-ingest-prod`, manual deploys from a feature branch (`railway.services.json`, `docs/deployment/production-inventory.md`) [V].
   - 16 commits, all on 08-18/19 [V].
   - Versus Helius, Birdeye, Bitquery or Dune: a toy. It covers one program and has 9h of history.
2. **signal-lab** (`ingest/signal_lab.py` 247 LOC, `pump_research_pipeline_v2.py` 499 LOC) [V]
   - What it does: derives buy/sell direction from the fee payer's own token delta, labels forward order-flow only after a watermark passes, and states in the code that its score is an "UNVALIDATED heuristic".
   - `signal-lab-prod-production.up.railway.app/health` returns 200 [V].
   - Last commit: "stop signal lab worker" (08-27) [V].
   - The showcase pages `/signals` and `/dashboard/signals` proxy to `SIGNAL_LAB_URL`, which defaults to signal-lab-dev. That host does not resolve [V], so the default path is broken. `/signals` returns 307, probably a login gate [I].
   - Status: partial. The UI is up but its data is frozen.
3. **ghostcatcher exporters ×3** (`ghostcatcher_export.py`, snapshot server, compact export; about 400 LOC) [V]
   - A one-off research dump of the pump tables, labelled "temporary … should be removed".
   - The v2 endpoint is live and serves CSVs [V].
   - No product value beyond dataset provenance.
4. **holder-census** (branch `ops/suwappu-holder-census`, 322 LOC) [V]
   - Takes a census of the SUWAPPU token's holders on Base, using Transfer logs and RPC fallback.
   - The production URL returns 404 "Application not found" [V]. Effectively dead, and a vanity tool.
5. **market-data platform** [V]
   - Code: `bot/services/market_data.py` 504 LOC, `venue_data.py` 527 LOC, `bot/models/market_data.py` 229 LOC with tables candles, perps, prediction_snapshots, lend and api_usage, and `api/capture_main.py` (capture-only entrypoint).
   - API: api-ts `routes/data.ts` (1,056 LOC) plus `marketDataQueries.ts` (1,062 LOC). It registers `/v1/data` with metered auth and `/webapp/data` (`api-ts/src/app.ts:244,284`). It covers OHLCV, perps, predictions, lend, reference/resolve, status and usage.
   - UI: tabs in both the webapp and the terminal.
   - Live probes:
     - `/v1/data/status` returns 401, which is expected because the route requires auth [V].
     - `/webapp/data/*` on api.suwappu.bot returns a FastAPI-style 404 [V], so routing or deployment does not match the code [I].
     - `market-data-capture` (dev) points at a missing branch [V].
   - Status: partial. The code is complete, and the in-monolith capture starts in `api/main.py:414`. Data freshness and whether the deployment is live are unverified.
   - Versus CoinGecko, GeckoTerminal or Birdeye: a thin re-wrap of their own data (it backfills from GeckoTerminal), so there is no moat.
6. **launch_detector / sniping** (`bot/services/sniping/*`, about 2.2k LOC; started in `bot/main.py:949`) [V]
   - Watches Pump.fun and Raydium launches and has a snipe executor.
   - Status: wired, but it has never fired for a real user (0 swaps).
   - Versus Trojan, BONKbot or Photon: far behind on speed (no Jito or private RPC evidence) [I].
7. **token security / rug monitor** (`token_security/*`, about 3.1k LOC; `rug_service.py` alone is 1,121 LOC; started in `bot/main.py:962`) [V]
   - Covers authority checks, honeypot detection, simulation, blacklist and auto-exit.
   - Status: wired end-to-end in code, never exercised live. On par with free GoPlus, RugCheck or Honeypot.is [I].
8. **token_intel / deployer watch** (`/intel`, `/devwatch`; 1,427 LOC; on_launch hook at `bot/main.py:940`) [V]
   - Status: wired. A comparable feature exists free in Photon, GMGN and Bubblemaps [I].
9. **execution_sync shadow** (about 1,060 LOC across the services, plus 3 scripts) [V]
   - What it does: normalizes quotes, applies hard constraints, takes a Pareto frontier, ranks by utility, and adds receipts, calibration and walk-forward replay.
   - It is referenced only by `scripts/` and docs. No runtime caller exists, and `docs/product-status.md` calls it "Shadow" [V].
   - Status: plan-quality library. With 0 swaps it has no data to calibrate on.
10. **prediction snapshots** [V]
    - Polymarket odds go into `prediction_snapshots` through venue_data, with api-ts and Drizzle schema.
    - Status: partial, same state as item 5.

**Hidden gems**

- (a) **The direction-aware Pump research pipeline.** Inferring direction from signer-owned deltas, using point-in-time labels and leak-free watermarks is the methodology a quant desk would use. Most bots compute "buy pressure" wrongly by summing token transfers. This is rare and correct [V code / I value].
- (b) **The capture-only, money-path-free entrypoint and the metered `/v1/data` API.** It is a clean, sellable shape, but the data underneath is commodity.
- (c) **execution_sync.** Intellectually strong, but it is worthless without order flow.

**Top 3 strongest assets**

1. pump_ingest plus the research pipeline v2 (methodology and storage discipline).
2. The rug and token-security stack, wired into the bot (about 3k LOC with simulation and auto-exit).
3. The `/v1/data` market-data API surface (about 2.1k LOC of TypeScript plus capture services and UI tabs).

**Top 3 weakest**

1. The holder-census and ghostcatcher exporters: dead or temporary, vanity or research dumps. Delete them.
2. execution_sync: shadow only, no runtime caller, nothing to calibrate on.
3. The market-data copies (three manual "marketdata" preview services plus a capture service on a missing branch): duplicated infrastructure with commodity data and no customers.

**What is missing versus competitors** [I]
- Retention. GMGN, Photon and Birdeye have years of history; Suwappu has 9 hours.
- Breadth. Competitors cover every launchpad and every chain; Suwappu covers one program.
- Speed. Competitors get Geyser or Yellowstone streams; Suwappu polls RPC.
- Distribution. Competitors push alerts into TG/X channels; Suwappu has none.
- Proof. There is no published backtest showing the signal has any edge.

**Making the best asset usable by a real user in 2 weeks**
- Days 1–3: merge `ingest/` into main. It is self-contained, so files can be copied across the history break. Restart the ingest on a paid RPC or a Helius free-tier websocket, and let the pipeline accumulate forward labels.
- Days 4–7: publish one honest, auditable output: a free TG channel or bot command posting the "top 5 live Pump candidates, with evidence and the label 'unvalidated'". Fix `SIGNAL_LAB_URL` so it points at the prod service, and make `/signals` public.
- Days 8–14: after about 7 days of labels, publish hit-rate and calibration stats on the page, since forward labels make this measurable. Add a "check rug" button that reuses rug_service, and a "swap" deep link into the bot.
- Success test: 20 or more channel subscribers, with at least one coming back for a second visit.
- Do not spend effort on execution_sync, ghostcatcher, holder-census or the extra marketdata copies until users exist.
### Competition
**VERDICT: freeze the data-intel cluster as a product line and reposition the one real asset (direction-aware pump research + rug stack) as a free, honest signal feed. Do not double down on data infra. Kill holder-census, the ghostcatcher exporters and the extra marketdata copies.** [I]

Web research was shallow. Search returned mostly third-party and affiliate pages. Items marked UNVERIFIED need a primary-source check before use.

**1. Competitors (what they ship, price, traction, acquisition, weakness)**
- **Nansen**: smart-money labels, wallet analytics, API. Pro is $49/mo annual or $69/mo monthly; one plan was removed in Sept 2026 [costbench](https://costbench.com/changelog/nansen-plan-removed-2026-09/), [Nansen docs](https://academy.nansen.ai/en/articles/1287744-plans-and-pricing). API is $10 per 1,000 credits, plus pay-per-use in USDC ($0.01 basic, $0.05 advanced per call, Apr 2026) [KuCoin](https://www.kucoin.com/news/flash/nansen-launches-pay-per-use-model-with-base-or-solana-usdc-settlement). Moat is its label corpus. Acquisition is research content and brand. Weakness: price, and it is slow on fresh memecoins [I].
- **Arkham**: entity labels and an intel marketplace. API pricing sources conflict ($900/mo, $1,500/mo, or $0.20/credit via x402) [apis.io](https://apis.io/plans/arkham/arkham-plans/). UNVERIFIED which is right. Entity attribution is its moat.
- **Birdeye**: Solana-first data API. Tiers are Standard, Lite, Starter, Premium, Business and Enterprise [docs](https://docs.birdeye.so/reference/data-accessibility-by-packages). The free tier is about 30k compute units a month, with streaming at $250+ (Dec 2025 source, may be stale) [CoinGecko-style comparison](https://coinpaprika.com/education/best-free-dex-api-2025-dexpaprika-vs-dextools-vs-geckoterminal-vs-dexscreener-vs-birdeye). This is the direct incumbent for Suwappu's `/v1/data`.
- **GMGN, Axiom, Photon, Trojan, BullX**: these terminals are Suwappu's real competitors. GMGN Q1 2026 revenue was about $25.3M, mostly BSC [crypto-reporter](https://www.crypto-reporter.com/press-releases/the-state-of-memecoin-trading-bots-in-2026-volume-fee-capture-and-market-share-across-the-top-8-126770/). Fomo later passed GMGN on 7-day revenue [KuCoin](https://www.kucoin.com/news/flash/fomo-surpasses-gmgn-as-largest-trading-app-by-revenue). Per Dune data (Apr 2026) Axiom rose from 3.5% to 42.2% Solana share in two months, while Photon fell to 20.4%, BullX to 11.3% and Trojan to 5.4% [mexc/PANews](https://www.mexc.com/news/1110358). Blockworks says Axiom has more than 50% [Blockworks](https://blockworks.com/news/axiom-ycombinator-startup-solana-memecoin-revenue-10m). A second source says Trojan is near 44% [datawallet](https://www.datawallet.com/crypto/best-crypto-telegram-bots), which conflicts with the Dune number. The market share leader changes in months, so a new entrant can win share, but only with execution speed and UX. Suwappu has neither.
- **Cielo**: wallet tracking with Telegram alerts. Free tier covers 250 wallets, with Pro at $59 and Whale at $199 per month [Ramaris](https://ramaris-frontend.pages.dev/blog/cielo-vs-ramaris/), [QuickNode](https://www.quicknode.com/builders-guide/tools/cielo-finance-by-cielo). Prices conflict between sources.
- **RugCheck**: free Solana risk scoring. Paid API tiers exist but official prices were not found [third-party](https://www.oanor.com/api/rugcheck-api).
- **GoPlus**: free tier plus paid tiers (Free to Ultra), no prices retrieved [gopluslabs](https://gopluslabs.io/security-api).
- **Bubblemaps**: holder-cluster graphs. Data API uses credits tied to a Pro subscription [docs](https://docs.bubblemaps.io/llms-full.txt). Rebuilt in 2026 to pre-screen rugs [Hackernoon](https://hackernoon.com/bubblemaps-rebuilds-its-platform-to-screen-out-rug-pulls-before-traders-ever-see-the-token).
- **DEX Screener**: free keyless API, current state only, no history [madeonsol](https://madeonsol.com/api-alternatives/dexscreener).
- **Not found / UNVERIFIED**: Dune, Kaito and Moby/Assetdash pricing and traction. Nothing usable surfaced.

**2. Feature matrix** (Suwappu column from the internal audit; competitor cells from sources above or [I])

| Feature | Suwappu | Axiom/GMGN | Birdeye | Nansen | Cielo |
|---|---|---|---|---|---|
| Real users / volume | ~0 | millions, $B | large API base | large | large |
| Pump/launch history | 9h, one program | multi-year, all launchpads | yes | partial | n/a |
| Live streaming (Geyser-class) | no (RPC polling) | yes [I] | paid $250+ | yes | WS at $89+ API tier |
| Smart-money labels | no | yes | partial | core product | yes |
| Wallet alerts to Telegram | no | yes | no | limited | core product |
| Rug and honeypot check | wired, never used live | yes | yes | no | no |
| Direction-aware flow labels | yes (code only) | unknown | no | no | no |
| Swap execution | wired, 0 swaps | yes, core | no | no | no |
| Metered data API | built, deploy unclear | n/a | yes | yes | yes |
| Published track record | none | n/a | n/a | n/a | n/a |

**3. (a) Missing table stakes:** history, breadth, live streaming, wallet and smart-money alerts pushed to Telegram, any proof of signal edge, and above all users. Execution speed is also behind [I].

**3. (b) Ahead or unique:** nowhere in a way users can feel. One narrow item may be real: the signer-delta direction inference with watermarked, leak-free forward labels in `ingest/signal_lab.py`. [V code / I value] Competitors rarely publish methodology, but also no evidence they lack it. Unique and unproven is not ahead.

**3. (c) Gaps a solo founder could own** [I]
- A published, auditable scorecard: forward-labeled pump signals with hit rates and calibration. Competitors sell signals and almost none show out-of-sample results. Cheapest wedge, and it costs only RPC.
- A free "rug check plus evidence" bot command or channel. Rug tools are free commodities, so the gap is distribution and trust, not tech.
- Agent-readable data: x402 pay-per-call is spreading (Nansen and Arkham both offer it). Suwappu already has metered `/v1/data`. The data is commodity, so only a unique dataset (the labeled pump flow) makes it sellable.
- Avoid: general OHLCV, general wallet tracking, execution speed races, launch sniping. All are crowded and well funded.

**4. Verdict: freeze + reposition** as a free signal and proof feed. Spend nothing further on `execution_sync`, holder-census, ghostcatcher or extra marketdata services until 20+ real users exist. If the 2-week signal-feed test shows no retention, kill the cluster.

**Reasons for caution**
- 9 hours of data cannot support any hit-rate claim. Forward labels need about a week of continuous ingest first.
- Competitor price figures conflict across sources. Check primary pricing pages before quoting externally.

HANDOFF
agent: none
task: Conductor decision only. If approved, route to bot-dev (copy `ingest/` from `feat/pump-onchain-ingest` into main; fix `SIGNAL_LAB_URL` default to signal-lab-prod in showcase) and growth-marketing (free TG channel posting top-5 pump candidates labeled "unvalidated").
files: docs/research/2026-11-20-strategy-review.md; ingest/pump_ingest.py and ingest/signal_lab.py on branch feat/pump-onchain-ingest; api-ts/src/routes/data.ts; api-ts/src/app.ts:244,284; bot/main.py:940,949,962
risks: MONEY-PATH none for ingest/signals. Cross-stack: showcase proxy config plus Railway service wiring. Branches share no history with main (copy files, no merge).

## nft-creative
### Audit
CLUSTER nft-creative: audit (2026-11-20). [V] means verified from code, git or a live curl. [I] means inference.

**Commit-activity caveat [V]:** nft/, art/, flet-curve/, hackathon/ and contracts-hackathon/ each have one commit, a bulk import on 2026-09-26 (e136474). The "90-day activity" figure for them is meaningless: nothing has been touched since that import. showcase/ is the only part of the cluster still active (41 commits in 90 days). gitbook/ has 2 commits.

**Inventory**

1. **Suwappu Positions NFT (Robinhood Chain 4663).** Status: code-complete, not deployed [V].
   - Contract: contracts/SuwappuPositions.sol (1077 LOC) and RobinhoodChainlinkOracle.sol (238).
   - Renderer and tooling: nft/position-cards/ (render.py 1136, hero.py, graph.py, merkle allowlist, sweep, verify_feeds).
   - Bot: bot/services/position_cards_service.py (640) and the /cards handler, registered in bot/main.py:443.
   - Not deployed: docs/marketing/positions-launch.md says so, and SUWAPPU_POSITION_CARDS_CONTRACT is empty in .env.schema:642.
   - contracts/test/ has no test for Positions, Membership or the oracle [V].
   - **Broken link [V]:** bot/handlers/position_cards.py sets MINT_URL to https://suwappu.bot/positions, which returns **404** live.
   - Versus a production competitor (StonkBrokers, Spritehood on 4663): the economics research is unusually rigorous (README cites Blockscout holder data), but there is no mint page, no tokenURI route, no audit and no deployment.

2. **Suwappu Membership (soulbound tier NFT, gasless EIP-3009 subscribe).** Status: code-complete, not deployed [V].
   - Code: contracts/SuwappuMembership.sol (521), nft/membership/render.py (788), bot/services/membership_service.py (819), relayer settings at settings.py:1393-1431.
   - It solves nothing for 43 users [I].

3. **/battle (directional bets).** Status: wired, but the money-path is unproven [V].
   - Code: battle_service.py (864), battle_monitor.py (153), handlers/battle.py (579).
   - It has two backings: a HyperLiquid perps position, or prediction against a house treasury (sentinel user -1).
   - It is registered (main.py:520) and the settlement monitor starts at boot.
   - With 0 swaps in 30 days, it has almost certainly never settled a real battle [I].
   - The prediction backing makes the house the counterparty, which is a regulatory and solvency liability [I].

4. **Social features: copy trading, community, /tip, /lb leaderboard.** Status: wired [V].
   - Code: copy_service.py (1718), community_service.py (832), and models copy_trading/community/social.
   - Handlers are registered in main.py (lines 448, 547, 754-767).
   - Copy trading with no traders to copy is an empty room [I].

5. **flet-curve plus the vendored electric-router.**
   - Fork of michwill/flet-curve-demo: about 20.5k LOC in src/, about 52k LOC of Python in vendor/ (flet-curve/FORK.md). It is not deployed as its own service.
   - The useful part was ported: terminal/src/lib/erouter/ (793 LOC) calls the deployed RouteQuoter.vy at 0x9a32…e679.
   - The terminal has railway.terminal.json, and https://terminal.suwappu.bot returns **200** live [V].
   - Status: partial and live.

6. **Art: genesis-persimmon 1/1 SVG, genesis-3d, machined-bloom.** Status: one-off pieces, 836 LOC [V]. Nothing in the cluster mints or displays them [I].

7. **Hackathon: hackathon/tokyo2026, ETHGlobal "Trust Layer".**
   - Code: World ID step-up, Intercepta x402 screening, ENSv2 role caps and a Uniswap Trading API adapter (1843 LOC, with 6 test files). contracts-hackathon/ holds an aqua-swapvm and a uniswap-hook.
   - Status: a demo pipeline, not wired into the bot or api-ts [I].
   - Its combined idea — human-backed agent identity plus counterparty screening plus on-chain spend caps before an agent pays — is the most current concept in this cluster.

8. **gitbook/ (62 pages of API/MCP docs).** docs.suwappu.bot returns 200 [V]. Status: works, but it documents an API that no one calls.

9. **Marketing and distribution docs.**
   - docs/marketing/positions-launch.md is honest launch copy for an undeployed product.
   - docs/distribution/registry-listings.md holds listing drafts for Agent.market and MCP registries. They are marked "nothing here is auto-published", so they are plan-only [V].
   - These listings cost $0 and are not done.

10. **Showcase (Next.js, 33k LOC, 41 commits in 90 days).** It is the most-maintained surface and has no positions, NFT or battle page [V]. Polishing it is where recent effort went; it brings no users [I].

**Hidden gems**
- **Electric-router port in the terminal [V, live].** It is a physics-style cross-pool Curve router running against an on-chain quoter, and very few aggregators expose Curve routing this way. The underlying solver is upstream's (michwill), not ours, so the rare part is the integration [I].
- **The Robinhood Chain NFT market research and renderer [V].** It is a real dataset of holder and sale behaviour on chain 4663 (docs/research/robinhood-chain-nft-ground-data.md), plus a generative card system where the card shows the holder's real stamped entry price against a live Chainlink price. The concept of "a collectible that shows your real P&L" is distinctive. The engineering is replicable in about 2 weeks by a competent team.
- **The hackathon trust layer.** It fits the agent-payments narrative better than anything else in the repo.

**TOP 3 STRONGEST ASSETS**
1. The Positions card system (renderer, contract, oracle, research): the most complete creative product. It only needs deployment and a mint page.
2. The live terminal Curve venue with the electric-router quoter.
3. The Tokyo trust-layer modules (World ID, Intercepta, ENSv2 caps) as an agent-safety story.

**TOP 3 WEAKEST**
1. Membership NFT: on-chain subscription infrastructure for a product with 0 paying users.
2. /battle prediction backing: a house-bank gambling product, unproven and a liability.
3. Copy trading, community and leaderboard: social features with no network to run on.

**Making Positions usable by a real user in 2 weeks** (it is the only item here a stranger could plausibly want)
1. Write Foundry tests for SuwappuPositions and the oracle, and run a self-review with money-path-reviewer, since there is no external audit budget.
2. Deploy both contracts to 4663 with 2% royalty and the merkle allowlist from build_deploy_args.py.
3. Add a tokenURI/metadata route that serves render.py SVGs: a small api-ts or python route.
4. Build the missing suwappu.bot/positions mint page with wallet connect, ticker picker and mint. That fixes the 404 the bot already links to.
5. Set SUWAPPU_POSITION_CARDS_CONTRACT so the /cards handler and the 40% fee perk activate.
6. Seed distribution in the Robinhood Chain NFT communities named in the research. This step matters most.

Rough effort: about 5 days for contracts and tests, 3 for the mint page, 2 for metadata, 2 for launch.

Risks:
- Without an audit, a paid mint is a real exposure. Launch with the free Founder claim (444) first and validate demand before turning on the $19 / $119 tiers.

Key paths: contracts/SuwappuPositions.sol, nft/position-cards/README.md, bot/handlers/position_cards.py, terminal/src/lib/erouter/quoter.ts, hackathon/tokyo2026/README.md, docs/marketing/positions-launch.md, docs/distribution/registry-listings.md
### Competition
**Answer:** Reposition and freeze. Almost every comparable consumer-crypto product is shrinking in 2026, so Suwappu's problem is not only missing features. It also has no audience and picked a hard sector. The only asset a stranger could plausibly want is Positions (the "collectible showing your real P&L"). Run it as a cheap, time-boxed demand test. Freeze Membership, /battle prediction and copy/community. Do not add features.

**Competitors (traction and sources)**
- **Zora [V web]:** Coins revenue fell about 98%, from $5.64M in Q3 2025 to about $106K in Q2 2026. The last 30 days produced roughly $5K in fees. The team is under 10 people and the CEO changed in September 2026. The Base App creator rewards ended in Feb 2026 (one tracker). Fees were cut from 3% to 1%, with 50% going to the creator. Weakness: speculative content coins without retention. Sources: [DefiLlama](https://defillama.com/protocol/zora-coins), [Tokenomics](https://app.tokenomics.com/tokenomics/zora/revenue), [Cryptopolitan](https://www.cryptopolitan.com/dee-goens-takes-over-as-zora-ceo/).
- **Clanker (Farcaster/Neynar) [V web]:** Fees peaked at $22.4M in Feb 2026, then fell to $551K in Sep 2026 (about -98%). Buybacks have stopped. Neynar was seeking a new owner for Farcaster and Clanker as of Aug 2026. It acquired users through Farcaster casts and bot-triggered deploys. Sources: [DefiLlama](https://defillama.com/protocol/clanker), [The Defiant](https://thedefiant.io/news/nfts-and-web3/neynar-seeks-new-owner-farcaster-clanker). So Farcaster frames and mini apps are a shrinking channel, not a growth one.
- **pump.fun [V web]:** About $1.7M daily revenue (late Oct 2026), over $1.2B lifetime, and over 90% of Solana launches. Its pace is down roughly 36% quarter on quarter. It is losing days to the social trading app Fomo (105K vs 26K daily active users on one day). Users come from virality and an app-first UX. Sources: [The Block](https://www.theblock.co/post/370812/pump-fun-surpasses-hyperliquid-revenue), [Cryptobriefing](https://cryptobriefing.com/pumpfun-app-passes-fomo-solana-traders/). Lesson: the winner owns one chain and one loop. Suwappu is spread across 7+ chains and many features.
- **fxhash [UNVERIFIED, single source]:** One article says it closed on 17 Aug 2026 after layoffs ([RightClickSave](https://www.rightclicksave.com/article/farewell-to-fxhash-a-heartbreaking-moment-in-the-history-of-digital-art)). Highlight: I found no 2026 status, so UNVERIFIED. Generative-art platforms are a poor market even for funded teams.
- **Telegram games (Hamster, Notcoin, Catizen) [V for 2024, weak for 2026]:** Hamster lost about 86% of users (Cointelegraph, 2024). Telegram games struggled with revenue and retention in Q4 2024 ([The Block](https://www.theblock.co/news/web3/2025-02-07-telegram-games-had-trouble-earning-revenue-retaining-users-in-q4-report-339563)). The 2026 figures I found come from a single blog ([dev.to](https://dev.to/ton-adoption/hamster-kombat-what-remains-after-the-hype-in-2026-4c1n)) and are UNVERIFIED. Tap-to-earn spread through referral loops with token airdrops. Suwappu has no such loop, and those users churn.
- **Missing competitors [I]:** StonkBrokers and Spritehood, the direct 4663 NFT peers named in the audit. Also Telegram trading bots and Solana terminals (Trojan, Maestro, Photon, Fomo). I did not research these; no figures here.

**Feature matrix** (Suwappu column from the internal audit; competitor cells from the sources above)

| Feature | Suwappu | Zora | Clanker | pump.fun/Fomo | Telegram games |
|---|---|---|---|---|---|
| Live, used product | No (0 swaps in 30 days) | Yes, shrinking | Yes, shrinking | Yes | Yes, churning |
| One-click launch/mint | No (mint page 404) | Yes | Yes | Yes | n/a |
| Creator/referral rev-share | Code only, undeployed | 50% of 1% | Yes | Yes | Referrals |
| Native social distribution | No | Base App (rewards ended) | Farcaster | X, Fomo feed | Telegram |
| Cross-chain swap | Yes (7+ chains) | No | No | Solana only | No |
| Curve routing via electric-router | Yes (terminal) | No | No | No | No |
| Agent/MCP API | Yes, uncalled | No | Bot deploy | No | No |
| Audit/trust signals | None | Mature | Mature | Mature | n/a |
| Retention loop | None | Weak | Weak | Trading | Tap loop |

**(a) Missing table stakes**
- A working mint or launch page. https://suwappu.bot/positions returns 404 [V], and the bot links to it (bot/handlers/position_cards.py).
- A deployed contract. SUWAPPU_POSITION_CARDS_CONTRACT is empty (.env.schema:642) [V].
- A tokenURI/metadata route. Positions has no tests and no audit (contracts/test) [V].
- A distribution loop or community. Every competitor has an owned channel (Farcaster, X, Telegram virality). Suwappu has crawlers and its own loops [V].
- Revenue-share visibility for creators, and one chain with depth.

**(b) Where Suwappu is ahead or unique [I]**
- Nowhere on adoption. Technically, three things are rare:
  - The "NFT shows live real P&L against a Chainlink price" concept, plus a rigorous 4663 market dataset (docs/research/robinhood-chain-nft-ground-data.md).
  - Curve routing via electric-router in the terminal (terminal/src/lib/erouter/). The solver is upstream's, so the rare part is the integration.
  - The Tokyo trust-layer concept: World ID, Intercepta and ENSv2 caps for agent payments (hackathon/tokyo2026/README.md).
- Each is replicable in about 2 weeks by a competent team. None is a moat.

**(c) Unserved gaps a solo founder could own**
- Robinhood Chain (4663) is a niche with no incumbent tooling. Its tiny NFT community is reachable by hand, which is the opposite of competing with pump.fun.
- Agent-payment safety (human-backed identity, screening, spend caps) is an actual 2026 narrative, and Suwappu already has the code. Wrap the Tokyo modules into one small "agent spend guard" API or MCP and publish it.
- Free distribution, still undone: the Agent.market and MCP registry listings (docs/distribution/registry-listings.md). They cost $0. This is the cheapest test of whether any agent traffic is real.
- Positions as a free "Founder claim" (444 pieces) to measure demand before the paid tiers. Paid mint without an audit is exposure.

**(d) Verdict:** Reposition. Narrow to a single hypothesis: Robinhood Chain Positions plus the agent-safety wrapper, tested over 2-4 weeks with the free claim. Freeze Membership, /battle prediction and copy/community, and stop polishing showcase. If the free claim and registry listings bring no real users by about mid-December, kill the consumer products and keep only the infrastructure and the terminal. Note: sector-wide declines in Zora and Clanker are partly a market-cycle effect, but they show that launch and social-token products are not an easy win.

**Caveats:** Revenue figures come from DefiLlama and trackers with differing definitions. The 2026 Telegram-games numbers and fxhash/Highlight status are UNVERIFIED. I did not directly verify Suwappu internals beyond the audit text supplied.

HANDOFF
agent: none
task: Founder decision on the verdict. If reposition is approved: (1) api-ts-dev or showcase-dev builds the /positions mint page and tokenURI route; (2) test-engineer adds Foundry tests for SuwappuPositions only when explicitly requested; (3) money-path-reviewer self-audits before any deploy; (4) publish the registry-listings drafts by hand.
files: bot/handlers/position_cards.py (MINT_URL 404), contracts/SuwappuPositions.sol, docs/distribution/registry-listings.md, hackathon/tokyo2026/README.md
risks: MONEY-PATH for any paid mint or contract deploy (unaudited); cross-stack for tokenURI route; no migrations needed.
