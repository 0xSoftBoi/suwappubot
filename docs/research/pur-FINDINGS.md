# Priority Update Registry (PUR) — can a maker run a propAMM permissionlessly?

Date 2026-11-06. Full agent notes + cloned repo + verified sources are untracked in `docs/research/pur/` (do not commit `repos/`).
Tags: VERIFIED = code/Blockscout/docs; INFERRED = reasoning or conflicting sources.

## Verdict
**The registry is permissionless. Getting a builder to ORDER your update before takers is not** — every builder channel found is API-key gated. The only ungated route is a taker-relayed signed-update bundle with no freshness guarantee (full toxic-flow exposure).

## 1. The contract (VERIFIED)
- Two verified `PrioUpdateRegistry` deployments (solc 0.8.28, same ABI): canonical `0xda7afeed021eafc1c1af9c362de477dad0396b81` (adds `LANE_STORAGE_NAMESPACE` to the lane slot hash) and legacy `0xDa7AfeeD01fe625CF15d187a19f94B45f00b8C5F` (what the FermiSwap engine uses; last tx ~block 26.0M). Canonical still active at 26.355M ⇒ market moved to canonical. Use canonical: builders only recognise the fixed address.
- Both constructed with `MAX_UPDATE_AGE = 0`, `MAX_UPDATE_LEAD_TIME = 0`.
- State keyed by **(target contract, laneIndex)**. Slot 0 = timestamp(32b) | slot count(8b) | 216-bit value, plus up to 254 more words.
- Auth: `updateState` requires `isUpdater[target][msg.sender]`; a target registers its own updaters via `addUpdater` (called FROM the target). Nobody else's permission needed ⇒ **permissionless to deploy a target and register updaters**.
- `batchUpdateStateWithSignature`: EIP-712 `UpdateState(target, lane, ts, slots)`; anyone can relay; signer = registered EOA updater, or the target via ERC-1271.
- Write timestamp must equal `block.timestamp` exactly and be >= stored value. `getState` is callable only by the target and reverts `StaleUpdate` outside the caller's `[min,max]` window ⇒ an update is only valid in the block it was written; if none landed earlier in that block the taker's swap reverts (protects the maker, hurts UX).
- Signed updates can be replayed within the window (harmless, rewrites same state).

## 2. Ordering is a builder convention, not a contract property (VERIFIED README; builder behaviour INFERRED)
Builder keeps a side pool of unlanded updates, inserts the registry tx right before any tx touching the target, drops unused ones. ERC-8324 draft says producers should prioritise txs whose top-level `to` is the registry.
- **BuilderNet** (Flashbots): `wss://rpc.buildernet.org/ws/sendquoteupdate`, same protobuf `PWebsocketQuoteUpdateV1Args` as Titan. Key picks mode: Top-of-Block (maker pays gas every block) or Conditional (lands only when the block emits a registered consumption event; takers held >= 50 ms). **"API keys are issued on request" — via Telegram.**
- **Titan:** same format, "Access is API-key gated"; freshness buffer, ~50 ms cadence, 400 ms eviction, per-pair volume fee; only "exploring" PUR.
- **Quasar:** reportedly adopted the Titan PropAMM API; no own docs found.
- Block share (INFERRED, sources conflict): Titan ~50%, BuilderNet ~30%, Quasar ~15%. Builders without maker deals ~14% of blocks and almost no propAMM fills.
- No builder found that honours PUR updates without a key.

## 3. Taker flow
Takers send ordinary bundles; the builder re-simulates on each quote update and places the maker's update first. BuilderNet needs no taker action (detects consumption from fill logs). INFERRED ungated fallback: maker publishes signed updates each slot; a taker prepends `batchUpdateStateWithSignature` to its own bundle (ts must equal the target block's timestamp, and a builder must accept the bundle). No freshness buffer.

## 4. What WE need
- Permissionless: deploy the pool as the PUR *target*; `addUpdater` on canonical PUR (or ERC-1271 on the pool); sign updates; choose the `getState` window; publish a signed-update feed + pool address.
- Still gated: builder keys (top-of-block/conditional ordering, 50 ms buffer); Titan's state-override/quote streams (whitelisted takers/aggregators); aggregator/router listing.
- Note Titan works with arbitrary oracle contracts (Metric uses its own CompressedOracle), so PUR is NOT required for Titan. PUR matters for BuilderNet's flow and for the shared convention.

## 5. Risks
Latency adverse selection without guaranteed ordering; trust in builder honesty (nothing on-chain enforces it); freshness buffer exists only where a builder applies it; no incidents documented on ethresear.

## Implication for our pool (design choice, not yet built)
`registry.getState` is callable only by the target, so a PUR price source must be read BY the pool (an external adapter cannot call it). A PUR-native pool would: implement `addUpdater` flow, read `getState(lane, block.timestamp, block.timestamp)`, and move the per-block step bound INTO the pool (PUR has none; the anchor band stays). Defer until BuilderNet states its conditional-mode requirements (which consumption event to register).

## Not verified
Titan's default freshness buffer; any real fill by an ungated maker; Quasar docs; how Fermi's router (0x68f9dd…) composes bundles.
