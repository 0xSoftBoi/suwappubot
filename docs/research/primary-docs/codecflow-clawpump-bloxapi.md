# Primary sources — CodecFlow, ClawPump, BloxAPI

Read from repo READMEs, commit histories, and the projects' own doc pages. Quotes verbatim.

---

## CodecFlow

**Sources read:** github.com/codecflow (org listing), raw READMEs for fabric/optr/conductor/replayer/pano, fabric's commit history, github.com/codecflow/novnc, github.com/simarena, simarena.ai, codecflow.ai

### The repos, individually

**fabric** (Go, 14★/2 forks, **104 commits**, last update **Jan 14 2026**) — the real core:
> "A distributed workload orchestration system for cross-cloud computing... Weaver (Control Plane)... Shuttle (Node Runner)... gRPC API... provider drivers (CoreWeave, RunPod, GCP, K8s, KubeVirt, Nosana, AWS-Mac)"

Commit log shows near-daily commits **Aug 2 – Aug 31 2025** (OCI support, S3 support, cache layer, coordinator work) — real feature velocity, not a skeleton. Multi-binary system with `make build/weaver/shuttle/gauge` and `go test ./weaver/...` targets.

**optr** (Python, MIT, 9★, last update Oct 15 2025) — self-declared **"Early Alpha," APIs subject to change**:
> "automate desktop applications via GUI interaction... control physical robots through simulation and hardware interfaces"

Architecture: Operators/Connectors/Algorithms/Episodes plus a "Sentinel" safety layer. Honest alpha scaffolding.

**conductor** (TypeScript, 2★, **stale since Apr 25 2025**) — a thin demo: Chromium in Docker + GStreamer → RTMP, remote-controlled via CDP port 9222. Its README references `codecflow/captain`, a repo absent from the current org listing; fetching that URL returns the **fabric** README, suggesting captain was renamed/merged into fabric. ⚠️ Inferred from content match, not an explicit redirect — UNVERIFIED.

**replayer** (Svelte, 2★, Jun 8 2025) — ships as `npm install @codecflow/replayer`, flagged `[!WARNING] actively being developed and the API may change`. Small, real, single-purpose.

**pano** (Rust, 2★, Sep 15 2025) — Cargo-built desktop overlay window utility for streaming HUDs.

**novnc** — a straight fork of novnc/noVNC (2,556 inherited commits, MPL-2.0). Not original code; vendored for their VNC bridge.

### ⚠️ SimArena is not in the CodecFlow org

It lives under a **separate** org, github.com/simarena, containing only `viewport` (TypeScript, 1★, last touched **Jul 9 2026**) and `.github`. The marketing claims on simarena.ai and codecflow.ai — WASM physics via MuJoCo WASM/Rapier/PhysX, LeRobot export, "headless API... GitHub Actions for robot policies" — are **not backed by any public repo**. Only a thin frontend is open; the simulation engine is not open-sourced.

### Correction to my earlier report

I previously dated the repos to Jan–Apr 2025. That's wrong: **fabric's history starts Aug 2 2025**. The Jan–Apr 2025 dates belong to `conductor` and `novnc` — peripheral demo repos, not the core product. The substance of the earlier point survives — fabric (Aug 2025–Jan 2026) and optr (Oct 2025) both predate the Jan 19 2026 hackathon — but the specific dates were off.

### Verdict

Real, working software at the core. Fabric is a genuine multi-service Go orchestrator with commit cadence continuing into 2026; optr is honest declared alpha. The periphery (conductor, novnc, replayer, pano) is thin demos and utilities, several dormant since mid-2025. The flashiest public claim — SimArena's simulation stack — has no public source behind it.

---

## ClawPump

**Sources read:** clawpump.tech, /docs, /developers, plus Solscan/DexScreener for on-chain lookups.

### ⚠️ Correction: the fee share is 65%, not 80%

My earlier report repeated an 80% figure. The docs are explicit:
> "35% platform share on token launch trading fees"

and the landing page says agents "earn **up to 65% of trading fees**." **65% is the documented number**, and "up to" is doing work. Anyone acting on the 80% figure should not.

### What the docs actually specify

**REST API — real and documented:** 19 endpoints (`/agents`, `/skills`, `/automations`, `/price`, `/portfolio`, `/swap/quote`, `/swap/execute`, `/indicators`, `/signals/*`). Bearer auth via `cpk_*` tokens. Swaps are explicitly non-custodial:
> "ClawPump never touches private keys"

Returns unsigned transactions for user-side signing — a sound design.

**MCP server:** `npx @clawpump/agents --claude` / `--cursor`. But the tool count is inconsistent across their own pages — "132 tools" on the landing page vs "126 total" / "78 tools" in the docs body. A documentation-quality flag.

**Gasless launches** are **"first 3 sponsored per user"** on the free tier with Google sign-in — i.e. ClawPump fronts the SOL launch fee (a relayer/fee-payer pattern), not a zero-marginal-cost mechanism. No technical description of the relayer architecture is published.

### Claims that don't survive the docs

| Claim | Reality per primary docs |
|---|---|
| 80% fee share to agents | **65%**, "up to" |
| x402 compute payments | Listed as **"UP NEXT"** — not shipped |
| Kamino/Drift yield integration | **Not found on any fetched page** |
| Automated buyback/burn | **Not found** |
| Routing across 10+ DEXes | 4 named (Jupiter, Raydium, Phoenix, pump.fun); "10+" unverified |

**No ClawPump Solana program ID appears anywhere in the docs.** The only on-chain address is the $CLAW SPL mint itself (`739dnZEG4yaBWFsY8L8ZwrfhGG6dhtCSercW8Umspump`), a pump.fun-launched token — not a custom program. Launches appear to ride pump.fun's own bonding-curve program. **The fee split is therefore enforced by ClawPump's off-chain backend, not by a verifiable on-chain contract.**

### Verdict

A real, documented API/SDK product — more than a landing page. But the bundle of claims that differentiates it does not hold up: the headline fee share is wrong as commonly stated, x402 is roadmap, two DeFi integrations are unsupported by any page, and there is no on-chain enforcement of the economics.

---

## BloxAPI / bloxx.gg — settled

**Sources read:** bloxx.gg (via r.jina.ai; direct fetch under-renders the JS SPA), bloxx.gg/docs, bloxx.gg/developers, bloxxbuilder.com, GitHub org search, npm search, DexScreener.

**The `/docs` and `/developers` routes return byte-identical content to the homepage.** Confirmed across three separate fetches — they are SPA router fallbacks, not documentation. No docs exist.

Full extracted homepage text:
> "BLOXX: Building blocks for what's next... Build. Connect. Activate... Two product families... Bloxx.fm — Experiential audio... BloxxBuilder & more — Games... Choose where you want to start."

There is **no mention of Roblox blockchain integration, AI agents, on-chain data, MCP, SDK, or API** anywhere in the current live site — only a Roblox icon in the social row.

**This is a pivot away from what it won for.** At hackathon time it was pitched as a "Game Creator Launchpad" where "in-game actions react to real token buys, real community hype, and real market momentum." The current site has been stripped to a content-free two-product teaser.

**No GitHub org, npm package, or Luau/Roblox module exists.** `github.com/orgs/bloxxgg` returns 404. Searches surfaced only unrelated third-party projects (an unaffiliated Bogdan11212/BloxAPI Python package, generic bloxy/bloxlink Roblox wrappers, an Arch-Linux game clone called "BloXX"). None reference bloxx.gg, $BLOXX, or the hackathon.

`bloxxbuilder.com` returns a single header — "Bloxx Builder: Game Studio at your Fingertips" — with no reachable body, docs, or pricing.

⚠️ web.archive.org was blocked by tooling, so whether bloxx.gg ever hosted real docs before the rebrand is **UNVERIFIED**.

**Note on market cap:** DexScreener showed ~$634K here vs ~$127K from CoinGecko in the earlier pass. Sources disagree materially; treat any single figure as a rough snapshot.

### Verdict

Confirmed, with no contradicting evidence found: **no technical documentation, API reference, SDK, or Roblox module exists.** The only concretely real artifacts are the trading $BLOXX token and the hackathon prize record. The product claims made at hackathon time are backed by no public code, and the site has since pivoted away from the pitch that won.

---

## Batch verdict

| | Real code? | Real docs? | Headline claims hold? |
|---|---|---|---|
| CodecFlow | ✔ fabric is substantial | ✔ READMEs | ✖ SimArena engine not public |
| ClawPump | ~ off-chain only | ✔ 19 endpoints | ✖ 65% not 80%; x402 unshipped |
| BloxAPI | ✖ none found | ✖ SPA fallbacks | ✖ pivoted away entirely |
