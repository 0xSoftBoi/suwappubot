# Tektonic Blog — Study + Adoption Plan

Source: https://tektonic.company/blog (4 posts, all read 2026-08-26)
Branch: `claude/tektonic-blog-study-ytwizj`

---

## Part 1 — What each post actually teaches

### 1. Forensic Reconstruction of the Oct 10 ADL Cascade (`/blog/hyperliquid-adl-cascade-october-10`, 2026-05-25)

Reconstructed Hyperliquid's largest-ever auto-deleveraging cascade with no clearinghouse
access: 3.2M events, 437,723 accounts, $7.614B notional, 34,983 ADL fills, 12m51s, 27 waves.

**Method — 4-layer deterministic replay:**
- L1 raw event stream (S3 compressed shards) → L2 pre-event clearinghouse snapshot (validation
  anchor) → L3 canonical normalized+deduped+ms-timestamped+wave-tagged schema → L4 replayed
  account state (position, entry, uPnL, leverage at every event boundary).
- **HyperReplay engine**: fixed-point emulated in IEEE-754 with rounding to published precision
  (8dp price / 4dp qty); deterministic tiebreak = priority order (ADL > liquidation > trade >
  funding > fee) then lexicographic address; every 100 events a checkpoint hash vs L2, halt on
  >$0.01 divergence. ~50k events/sec single core, full cascade in ~64s.
- Hardest part was the **misc ledger** (internal transfers, spot transfers, vault flows,
  commissions, staking, liquidation overrides) — each with its own state transition.
- Max divergence across all 437,723 accounts at 847 checkpoints: **< $0.01**.
- Dataset published publicly (`gs://hyperliquid-adl-october10`), no keys. Lean deps
  (pandas, lz4, tqdm). Fed a paper with Tarun Chitra et al.; overshoot quantified at $45–52M,
  fixable to ~$3M with integer pro-rata instead of greedy most-profitable-first allocation.

**Findings worth internalizing:** the protective vaults (HLP + Liquidator) absorbed 95.1% of
fills and *were* the contagion vector; 99.4% of ADL'd accounts were profitable, median 0.20x
leverage — the algorithm punishes being right, creating an incentive to pull liquidity under
stress; cross-margin turns single-asset impairment into 89-ticker contagion by wave 13.

**Transferable lessons:** deterministic replay from public L1 + a snapshot anchor is enough;
emulate fixed-point deliberately; total event-type coverage or divergence compounds; continuous
checkpointing against ground truth is the debugging loop; publish the data; minimal deps win.

### 2. Procedural Human-Guided Aesthetic Extensions (`/blog/procedural-human-guided-aesthetic-extensions`, 2026-04-29)

Extracted YOUSUKE YUKIMATSU's live visual identity from a 93-min Boiler Room set and rebuilt it
as a live TouchDesigner system: 43 GLSL shaders (21 original + 21 mutations + 1 canonical),
2,705 lines, 3-layer additive compositing, C(43,3)=12,341 combos × 7 continuous audio params
≈ 6.4×10³⁷ states. 60 FPS at 0.2% CPU, 40KB `.toe`, zero compile errors.

**Pipeline:** 1,871 frames sampled (every 3s) → 64×64 downsample → 19-float feature vector
(5-means dominant colors, Canny edge density, mean brightness/saturation, color variance) →
k-means (k=40) → 7 canonical techniques.

**The canonical correction (the key idea):** the human's from-memory guess ("neon contour, edge
detection") was *wrong*. Clustering showed the identity lived in **diffusion** — chiaroscuro
bloom + chromatic aberration + crushed blacks — not sharp edges. High edge_density was luminance
boundaries between bloom and crushed black, not contours. Statistics corrected intuition.

**But statistics alone was insufficient:** clustering finds what is *common*, not what is *good*.
Human-curated frames (base64 → Claude Opus → GLSL) produced the best effects. "The human curates
intent. The AI executes with precision."

**Generation discipline:** every generated effect passed a 4-step gate — `ast.parse()` syntax,
required exports (`EFFECT_META` + callable `fx_function`), test run against mock audio + zero
input, output shape/dtype match (480×640×3 uint8) — with auto-retry (2x) feeding the error back
to the model. **Mutation beat generation**: 21 controlled mutations (vary ≥3 of palette,
particle behavior, displacement, feedback, temporal dynamics) expanded vocabulary faster and
more coherently than new effects. **Composition beat variety**: 3-layer compositing turned 43
effects into 12,341 combinations — more leverage than any individual shader.

Built via MCP bridge (JSON-RPC 2.0 → TouchDesigner Python API, 36 tools, 120s timeouts, retry)
in 5 sequenced build scripts — programmatic construction far faster than manual.

### 3. How We Built tektonic.company (`/blog/building-tektonic-company`, 2026-03-27)

Next.js 16 / React 19 / Turbopack / TS5 / Tailwind 4 on Vercel — **zero dependency bundle
overhead for all visual effects** (no Three.js, no WebGL framework).

- **ASCII dither hero**: 97-glyph density ramp, cell = `fontSize*0.6` × `fontSize` (≈355×120
  cells at 9px/1920px), three overlapping sine waves weighted 0.55/0.25/0.2 modulating cell
  brightness, direction driven by device tilt, luminosity `0.299R+0.587G+0.114B`, RGB tint
  preserved. Taps spawn expanding sinusoidal ripples, 2.5s fade, max 10 concurrent.
  **60fps at 42,000+ chars/frame.**
- **Shallow-water fluid overlay**: two Float32Array height buffers, new height = avg of 4
  neighbours − previous height, damping 0.985; tilt injects current via height gradients;
  caustics from steep gradients. **Adaptive grid**: every 60 frames, grow cell size if avg frame
  time > 18ms, shrink if < 12ms.
- **OKLCH tokens** for perceptual uniformity across themes: dark theme is achromatic (chroma 0,
  `oklch(0.145 0 0)` → `oklch(0.985 0 0)`); aurora adds hue 270, chroma 0.04–0.15, primary
  `oklch(0.75 0.15 300)`, gold `oklch(0.82 0.12 85)`, borders as alpha percentages.
  600ms eased cross-fade on `html`+`body` background-color.
- **Interaction**: first-visit theme "boot flicker" at 400/1200/2000/2800ms (localStorage-gated);
  scroll/swipe >30px on hero toggles theme with 800ms cooldown; DeviceOrientation with mouse
  fallback, lerp smoothing 0.08 gyro / 0.05 mouse, **all through refs, never React state**;
  `prefers-reduced-motion` honored with a live listener; 8ms `navigator.vibrate()` on mobile.
- **Glass**: card = `rgba(255,255,255,0.03)` + `blur(12px)` + 1px 8% border; liquid glass =
  `rgba(255,255,255,0.08)` + `blur(20px) saturate(180%)` + inset highlight + drop shadow.
- **Perf**: dynamic import `{ ssr: false }` for canvas components; RAF loops check
  `document.hidden` and skip; canvas over DOM; `pointer-events:none` on CSS star/meteor layers.

### 4. Institutional-Grade x402 Analytics on BigQuery (`/blog/x402-analytics-solana-base`, 2026-04-03)

Public CC-0 SQL ledger of all x402 payments on Solana + Base: 173.9M successful payments,
$49.26M USDC (Solana 47.8M tx / $8.59M; Base 126.1M tx / $40.67M). Avg ticket Base $0.32 vs
Solana $0.17.

**Why explorers undercount:** x402scan indexes via webhooks on *registered* facilitators (blind
to unregistered ones) and does no ATA→owner resolution — worth **40x** unique-transaction
detection on Solana in the March 2026 window. Head-to-head March 2026: 15,949 transfers vs
14,644 (+8.9% tx, +6.6% volume), with 118 failed tx explicitly excluded.

**Three institutional constraints:**
1. **Atomic state validation** — only `tx.err = ''` (Solana) / `receipt_status = 1` (Base) count.
   "0.00% inflation from reverted executions." A compliance report with failed payments is wrong.
2. **Signer-level attribution** — resolve ATAs to owner wallets *inside the warehouse*.
3. **Temporal precision** — daily `block_timestamp` partitioning. Unpartitioned Solana scans
   100TB+ = $5,000–$20,000; partitioned single-day = $0.50–$2.00.

Sources validator-level exports (not RPC polling — polling drops batches during spikes) and uses
BigQuery's **pre-decoded** Token Transfers table rather than brittle JSON extraction. Registries:
15 orgs / 22 pubkeys (Solana), 28 orgs / 100+ addresses (Base). Five pre-built aggregation views
(summary, per-seller, per-facilitator, hourly timeseries, top buyers). Every published figure
ships with its exact query — "institutional users trust reproducible SQL far more than dashboard
screenshots."

---

## Part 2 — The plan: what Suwappu does about it

Four workstreams, ordered by leverage. Each is independently shippable; none blocks another.

### W1 — Deterministic replay + checkpoint validation for the money path *(from post 1)*

The single most transferable idea. Suwappu's fee math, seasons/points accounting, and perps
positions are all event-sourced-ish state that we currently trust rather than verify.

- **W1.1** Define an L3 canonical event schema for the money path (swap fill, fee accrual, fee
  sweep, points award, referral credit, withdrawal) — normalized, deduped, ms-timestamped,
  with an explicit deterministic tiebreak rule (priority order + lexicographic user id).
- **W1.2** Build `scripts/replay/` — replay canonical events from a known snapshot and rebuild
  balances/points. Lean deps only. Target: reprocess a full day in seconds.
- **W1.3** Checkpoint validation every N events against the live DB, halt on divergence beyond a
  stated epsilon. Wire it as a nightly job that alerts through `alert_service`.
- **W1.4** Fixed-point discipline audit: sweep `bot/services/` + `api-ts/src/` for float money
  math; pin decimal precision per asset and round once, at the published precision.
- **W1.5** Write down the exact acceptance number the way Tektonic did ("max divergence < $0.01
  across N accounts at M checkpoints") in `docs/DECISIONS.md` — a claim we can be held to.

**Cross-check from their findings, applies directly to our perps + fee vaults:** any pooled
vault that absorbs losses is a contagion vector, not just a backstop; and greedy
most-profitable-first selection is provably suboptimal vs integer pro-rata. If Suwappu has any
socialized-loss or pooled-fee mechanism, audit its allocation rule against pro-rata.
Route the resulting diff to `money-path-reviewer`.

### W2 — x402 / revenue analytics with institutional constraints *(from post 4)*

We already sit on the x402 money path. Their three constraints are cheap to adopt and turn our
revenue numbers from "dashboard screenshot" into "reproducible query."

- **W2.1** Enforce **atomic state validation** at ingest: no failed/reverted tx ever counts
  toward volume, fees, or points. Verify this holds today; it is a correctness bug if not.
- **W2.2** Enforce **partition discipline** on any warehouse/analytics query we run — make an
  unpartitioned full-history scan architecturally impossible, not merely discouraged.
- **W2.3** **Registration-independent detection**: identify our own on-chain settlements by
  signer matching rather than by an internal registry that can silently go stale.
- **W2.4** Ship 5 pre-computed views mirroring theirs (summary, per-user, per-chain/facilitator,
  hourly timeseries, top payers) for whatever surface reports revenue.
- **W2.5** Every published revenue figure ships with the query that produced it.
- **W2.6** Filter-at-extraction, not at query — purity guaranteed by the pipeline, not by the
  analyst remembering a `WHERE` clause.

Use the **Blockscout MCP** for on-chain verification rather than hand-rolling RPC polling —
their post is explicit that polling misses batches during volume spikes.

### W3 — Canonical-correction methodology for the NFT / card renderers *(from post 2)*

We have generative art surfaces and an `art-director` gate. Post 2 is a complete, proven recipe
for "extract an identity, then extend it" — and its central warning is that our *memory* of our
own visual identity is probably wrong.

- **W3.1** **Run the canonical correction on ourselves.** Sample frames/renders of the existing
  collection, extract a feature vector (dominant colors k-means, edge density, brightness,
  saturation, variance), cluster, and compare the clusters against what our design docs *claim*
  the Suwappu look is. Expect a correction. Record it.
- **W3.2** **Mutation over generation.** New visual variety comes from controlled mutations of
  canonical effects (vary ≥3 of: palette, motion, displacement, feedback, temporal dynamics),
  not from net-new generation. Cheaper and stays coherent.
- **W3.3** **Composition over variety.** Prefer N-layer compositing of a small canonical set over
  a large flat catalog — C(n,k) growth is where the leverage is.
- **W3.4** **A hard validation gate on every generated asset**, mirroring their 4-step pipeline:
  parse → required exports present → test-run against mock/zero input → output shape+dtype match,
  with 2 auto-retries that feed the error back to the model. This is the generative analogue of
  our parse/boot-import gate and belongs in CI.
- **W3.5** Keep the human in the loop explicitly: human curates intent (which frames are *good*),
  the model executes precision. Statistics find what is common, not what is good — that is
  exactly the `art-director` role, so keep it as a blocking gate, not an advisory one.

### W4 — Showcase visual upgrade, zero-dependency *(from post 3)*

`showcase/` is Next.js; every technique in post 3 is directly portable and adds **0 KB** of deps.

- **W4.1** Migrate design tokens to **OKLCH** and single-source them (`brand-guardian` owns this).
  Achromatic dark base + one accent hue with chroma 0.04–0.15 gives multi-theme parity with no
  per-token hand-tuning.
- **W4.2** One canvas hero effect, canvas-native, no Three.js. ASCII dither or shallow-water are
  both fully specified above (glyph ramp, wave weights 0.55/0.25/0.2, damping 0.985, luminosity
  coefficients) — implementable from the post alone.
- **W4.3** **Adaptive rendering**: measure avg frame time every 60 frames, coarsen the grid above
  18ms, refine below 12ms. This is what makes it safe on low-end phones, which is most of our
  Telegram Mini App traffic.
- **W4.4** Perf hygiene, all four: dynamic import `{ssr:false}` for canvas components;
  `document.hidden` check inside the RAF loop; refs not React state for pointer/tilt input;
  `pointer-events:none` on decorative layers.
- **W4.5** `prefers-reduced-motion` with a live listener, plus DeviceOrientation → mouse fallback.
  Non-negotiable, and cheap.
- **W4.6** Glass tokens at the two documented levels (0.03/blur12 card, 0.08/blur20/saturate180
  interactive) rather than ad-hoc per-component values.

---

## Sequencing

1. **W2.1 + W1.4 first** — they are correctness checks on live money, not features. Any failure
   there is a bug we are shipping right now.
2. **W1.2/W1.3** — replay + checkpointing gives every later change a ground-truth harness.
3. **W4** — highest visible return per hour, zero dependency risk, parallelizable with W1.
4. **W3** — largest scope; start with W3.1 (the audit) since it may invalidate current direction.

## Standing principles adopted from all four posts

- Minimal dependencies beat platforms — every post ships lean and stays reproducible.
- Validate continuously against ground truth; do not batch verification to the end.
- Publish the query, the dataset, and the exact number, not the screenshot.
- Statistics correct intuition; human judgment supplies intent. Neither alone is sufficient.
- Composition and mutation generate more range than net-new generation.
- Filter at ingest so correctness is structural, not remembered.

---

## Execution status (2026-08-27)

All four workstreams executed. No tests were written, by request; every claim below is
backed by a run recorded in the commit message or the linked report.

| Item | Status | Evidence |
|---|---|---|
| W1.1 canonical event schema | done | `scripts/replay/canonical.py` |
| W1.2 replay engine | done | 3,467 events / 40 accounts / ~384k ev-s |
| W1.3 checkpoint validation | done | injected +7 drift halts, exits 1 |
| W1.3 nightly job + alerting | done | `bot/services/ledger_reconciler.py`, wired in lifespan |
| W1.4 fixed-point audit + fix | done | `docs/plans/tektonic-w1-money-precision-audit.md` |
| W1.5 acceptance number recorded | done | `docs/DECISIONS.md` |
| W2.1 atomic state | done | fixed in `referral_service`; enforced in every view |
| W2.2 partition discipline | done | `validate_window` refuses; verified exit 1 |
| W2.3 registration-independent | n/a | we settle our own payments; no external registry |
| W2.4 five views | done | `scripts/analytics/views.py` |
| W2.5 query with every figure | done | `ViewResult.reproduce()`, `--show-sql` |
| W2.6 filter at extraction | done | predicates live in the view bodies |
| W3.1 canonical correction | done | `docs/plans/tektonic-w3-canonical-correction.md` |
| W3.4 validation gate | done | 4 defect classes caught at the right step |
| W3.4 gate in CI | done | blocking step in `Tests & Quality Gates` |
| Schema conformance gate | done | catches SQL drift from `bot/models/` in CI |
| W4.3 adaptive rendering | done | simulated convergence, no oscillation |
| W4.4 perf hygiene | done | 2 missing visibility pauses; 120 renders/s removed |
| W4.5 live reduced-motion | done | `lib/motionPreference.ts` |

### Wiring (second pass)

The first pass built the tools but connected two of them to nothing, which is the
failure mode the plan itself warns about — a reconciliation nobody runs is a document,
not a control.

- **`bot/services/ledger_reconciler.py`** replays the previous day's window once a day
  and alerts admins on divergence past the published epsilon, with the reproduce command
  in the alert. Started and stopped in `api/main.py`'s lifespan under `_track_degraded`,
  so a reconciler failure degrades rather than blocking boot. It collects every
  divergence rather than halting at the first — a nightly report that stops at one bad
  account says nothing about blast radius, and there is nobody there to re-run it.
  It also reports a clean run roughly weekly, because a monitor that only ever speaks on
  failure is indistinguishable from one that died.
- **Alert channel correction.** The plan said "alerts through `alert_service`". That was
  wrong: `alert_service` is the user-facing *price* alert service. Reconciliation failure
  is operational, so it goes where `health_monitor` sends its alerts —
  `support_notifier.post_admin_update`.
- **`scripts/audit/schema_conformance.py`** closes the risk the reconciler introduced.
  The replay and analytics SQL reads production tables by hand rather than through the
  ORM — deliberately, so the replayer runs anywhere a `DATABASE_URL` does — but that
  means a column rename in `bot/models/` cannot break it at import time or in tests. It
  breaks it at 03:00, as a log line. The gate materialises the real 126-table schema
  from `Base.metadata`, seeds the seven tables our readers touch, and runs all five
  extractors, both snapshot loaders and all five views against it. Seeding is the part
  that matters: an extractor over an empty table proves the SQL names real columns but
  never runs the Python that reads the row, and half the mapping lives in
  `row["realized_to_amount_usd"]` rather than in the SELECT. All five extractors return
  a real event, so that path is exercised. Verified to catch drift both ways — a renamed
  extractor column and a renamed view column each fail it, exit 1.
- **CI**: the asset gate is a blocking step, scoped to `nft/` (mint assets) rather than
  `art/`, because the size budget it enforces is a wallet/marketplace constraint that
  would wrongly fail the posters in `art/`. The money-precision scan runs advisory
  (`continue-on-error`) — gating on a heuristic with known false positives only teaches
  people to ignore it.

### Deliberately not done, and why

- **W4.1 OKLCH token migration.** The showcase already has a mature, explicitly
  reasoned hex token system across 8,139 lines of CSS with documented rationale for
  each colour. Retokenising it wholesale is a large-blast-radius change to something
  that is not broken; the plan's premise was that our tokens needed the perceptual
  uniformity, and on inspection they were already deliberate. Left alone.
- **W4.2 replace the heavy 3D dependency.** There is none. `ChainSphereGL` is raw
  WebGL2 and its header already argues the same case the post makes, citing the same
  Vercel/COBE precedent. The plan was written before reading the code; the code won.
- **W4 device tilt / DeviceOrientation.** Would mean threading gyro input through
  seven components for a desktop-first marketing site. Not worth the surface area.
- **Retyping 48 `Float` money columns to `Numeric`.** A dual-ORM migration
  (ADR 0003) that needs its own change and its own review, not an appendix to an
  audit pass. `bot/utils/money` mitigates in the meantime.
- **W3.2 mutation / W3.3 compositing.** These generate *new* art. W3.1 just found
  that we do not currently agree with ourselves about what the identity is, and
  generating more of it before resolving that would multiply the drift. Blocked on a
  human decision, which is the correct place for it to be blocked.
