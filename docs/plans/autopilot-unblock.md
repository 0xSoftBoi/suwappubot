# Autopilot: the plan to make it actually trade

24 Aug 2026. Every claim here is measured, and the measurement is named. Written
after the agent completed a clean five-chain cycle and refused all 12 candidates.

## The one-paragraph version

The agent is not broken in the places it looks broken. Discovery works, the
gates work, the accounting works, the seal works. It refuses everything because
of **one field that is declared and never assigned**, and it would still refuse
most things because of **one upstream that returns HTTP 200 with the body
`"Internal server error"`**. Both are invisible in the output: they render as
ordinary, plausible refusals. Fix those two and the agent trades.

---

## Root causes, measured

### RC1 — `lp_locked` is never populated. The gate can never pass.

```
$ grep -rn "lp_locked" --include=*.py .
./api/routes/internal.py:507:    lp_locked: Optional[bool] = None
```

One hit in the entire Python codebase: the Pydantic field declaration. Nothing
assigns it. So the response always carries `lp_locked: null`, api-ts's
`if (typeof data.lp_locked === 'boolean')` never fires, `security.lpLocked` is
always `undefined`, and `DEFAULT_RULES.requireLpLocked: true` fails **on every
token, on every chain, forever.**

Confirmed live: all 12 refusals in the first five-chain cycle failed `lp_locked`,
including the ones that also had holder data.

**This is the whole story.** Even with perfect holder data the agent would never
open a position. Everything below is secondary.

### RC2 — Base Blockscout `/holders` returns 200 with an error body

```
$ curl -s .../api/v2/tokens/0x3ec2.../holders
"Internal server error"
$ curl -o /dev/null -w "%{content_type} %{size_download}b"  .../holders
application/json; charset=utf-8 23b
```

Status 200. Content-type JSON. Body is a valid JSON *string*. So `res.ok` passes,
`res.json()` succeeds, and the caller then treats a string as a dict, throws, and
the exception handler leaves `top_holder_pct` unset.

This is not a rate limit and not a timeout — my first hypothesis was both, and
both were wrong. `tokens/{addr}` returns real data on the same host at the same
moment; only `/holders` is broken. Retry alone will not fix a persistent 500.

Measured impact, `suwappu-alpha`, 40 decisions on Base:

```
holder_concentration  FAIL  observed=unknown   x32
holder_concentration  PASS  observed=17.51     x8   <- all one cached token
```

### RC3 — HyperEVM has no holder source

`hyperevm.blockscout.com` and `hyperliquid.blockscout.com` 404;
`hyperscan.com` redirects to `hl.eco`. There is no Blockscout instance. Already
recorded as `CHAINS_WITHOUT_HOLDER_DATA`.

---

## Plan

Five phases. Each phase ends in a verifiable state, and phase N+1 is pointless
until phase N holds. Sizes are relative, not calendar promises.

### Phase 1 — Make the agent capable of trading at all `[small]`

The goal is one honest fill, not good fills.

1. **Implement LP-lock detection** for EVM chains: LP tokens burned to
   `0x0`/`0xdead`, or held by a known locker (Unicrypt, Team Finance, PinkLock).
   Populate `lp_locked` truthfully; leave it `null` where genuinely unknowable.
2. **Distinguish "not locked" from "cannot tell".** Today the gate collapses
   both into refusal. Split into `lp_locked` (a real negative — refuse) and
   `lp_lock_unknown` (no data — operator's choice via a rule flag). Same
   treatment `holder_concentration` needs.
3. **Add a boot-time contract test**: for a known-good token on each allowed
   chain, assert the security payload comes back with the fields the gates
   require. A gate that can never pass must fail loudly at startup, not silently
   forever at runtime.

**Done when**: `suwappu-omni` opens a position, and a test proves each gate is
satisfiable on each allowed chain.

### Phase 2 — Make holder data reliable `[medium]`

1. **Treat a 200 with a non-object body as a failure.** The Blockscout client
   must validate shape, not status. This is the generic bug — anywhere we trust
   `res.ok` we are one bad gateway from silently wrong data.
2. **Fallback source order** per chain rather than one hardcoded host: Blockscout
   → the chain's native explorer API → GoPlus/Moralis-style aggregator. Return
   the first that yields a usable shape.
3. **Retry with backoff** on the holder call, mirroring what GeckoTerminal now
   has. Necessary but, per RC2, not sufficient — do it after the fallback.
4. **Cache negative results briefly** so a broken upstream is not re-queried
   every cycle for every token.

**Done when**: holder coverage on Base is measured over 50+ decisions and is
above 80%, reported as a number rather than an impression.

### Phase 3 — Close the remaining discovery and sizing gaps `[medium]`

From `docs/research/autopilot-literature.md`, items 5–7:

1. **Unique-buyer and wash-trade signals** (item 5). MELT's ablation puts
   market-activity features as the most predictive group; GeckoTerminal already
   returns per-window buyer/seller counts, so this is a parsing change in
   `market.ts`. Our system prompt already tells the model to distrust turnover
   far above depth — and never gives it the data to apply that.
2. **Decide HyperEVM** (RC3). Either drop it from `allowedChains` until a source
   exists, or accept a permanent refusal stream. Leaving it is the feed-noise
   problem the screener fix removed. Recommendation: drop, revisit when a
   holder source appears.
3. **Clustered-holder concentration** (item 7). Real work in `token_intel`:
   `topHolderPct` is trivially defeated by splitting across 20 fresh wallets.

### Phase 4 — Earn the track record `[long, unshortenable]`

Nothing here is code. The paper agent runs, unattended, until MinTRL is met or
the edge is visibly negative. The panel already reports both honestly.

The one code task: **the sizing map recalibration** (item 6) stays blocked until
the reliability curve has data. Changing how we size on confidence before
measuring whether that confidence is calibrated would repeat the mistake the
research identified.

**Done when**: `track_record.significant` is true, or the record is long enough
to say the edge is not there.

### Phase 5 — Mainnet `[gated on human judgement]`

From `docs/agents/autopilot-mainnet-readiness.md`. B1–B4 and B6 are closed. What
remains is not mine to close:

1. A human money-path review of the diff. I wrote it; I am the wrong reader.
2. One real testnet swap through `ManagedExecutor`. Eight tests against a stub
   prove the branches, not the live API's response shape.
3. B5 — the track record — i.e. Phase 4.
4. First live agent: smallest viable size, one chain, `maxOpenPositions: 1`, a
   loss halt that would not hurt to hit.

---

## The pattern worth naming

Six bugs this session, one shape:

| bug | how it presented |
|---|---|
| paper sells filled above mid | plausible P&L |
| exits marked at mid, not fill | plausible P&L |
| impact halved (TVL vs quote reserve) | plausible P&L |
| time stop passed as `undefined` | positions "still open" |
| discovery 429s | "quiet market, scanned 0" |
| `lp_locked` never assigned | "token failed the safety gate" |

None threw. None logged an error. Every one rendered as a reasonable-looking
number or a sensible-looking refusal. **The defining risk in this system is not
a crash; it is a plausible lie.**

So each phase above carries the same acceptance test: *if this dependency broke
right now, would anything say so?* Phase 1's boot-time gate check and Phase 2's
shape validation exist specifically to answer yes.
