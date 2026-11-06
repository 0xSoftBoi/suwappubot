# propamm publisher

Off-chain quote publisher for the Suwappu propAMM. It signs `PropOracle.push(feedId, price)` transactions with a hot
key and delivers them either to Titan ACE (`titan-ws`) or straight to an RPC (`rpc`, dev/testnet only).
**MONEY-PATH: this process controls a key that moves an on-chain price oracle.**

```
bun install
bun run check      # bun build of src + dev (no tsc in this repo)
bun run start      # needs the env below
bun run mock-titan # local mock of wss://{eu|us|ap}.rpc.titanbuilder.xyz/ws/sendquoteupdate
```

## Layout
`src/config.ts` zod env config (fail closed) | `src/prices/` Pyth Hermes SSE, Coinbase WS, DevWalk (chain 31337 only), median aggregator |
`src/quote.ts` clamp / skip / halt decisions (bigint only) | `src/signer/` KMS + LocalDev | `src/tx.ts` tx build + hard allowlist |
`src/transport/{titan,rpc}.ts` | `src/titan/` proto + codec | `src/chain.ts` head/nonce/oracle reference tracker | `src/loop.ts` main loop |
`src/http.ts` 127.0.0.1 `/healthz` `/metrics` `POST /halt` | `dev/mock-titan.ts`.

## Config (env)
Required always: `RPC_HTTP_URL RPC_WS_URL CHAIN_ID ORACLE_ADDRESS FEED_ID TRANSPORT(titan-ws|rpc) SIGNER(local|kms) MAX_ANCHOR_DEV_BPS KILL_SWITCH_FILE`.
- Signer: `LOCAL_PRIVATE_KEY` (refused unless chainId in 31337/560048/11155111, or `ALLOW_LOCAL_KEY_ON_MAINNET=I_UNDERSTAND`); or `KMS_KEY_ID`+`AWS_REGION` (+ optional `EXPECTED_PUSHER_ADDRESS`, strongly recommended).
- Titan: `TITAN_REGION` or `TITAN_WS_URL` (wss, or loopback ws for the mock), `TITAN_API_KEY` (unless loopback), `POOL_ADDRESS TOKEN0 TOKEN1`, `STATE_DIR`.
- Prices: `PRICE_SOURCES=pyth,coinbase` `PYTH_PRICE_ID` `COINBASE_PRODUCT` `MIN_SOURCES>=2` (1 only on 31337) `MAX_SOURCE_AGE_MS MAX_SOURCE_DISAGREE_BPS OUTLIER_BPS`. Quote asset is assumed ~USD (USD/USDC parity not modelled).
- Quoting: `UPDATE_INTERVAL_MS=50 MIN_MOVE_BPS HEARTBEAT_MS=300 STEP_SAFETY_BPS=8000 ANCHOR_SAFETY_BPS=8000 RECOVERY_TICKS REQUOTE_EVERY_BLOCK`.
- Tx: `GAS_LIMIT_CAP MAX_FEE_GWEI_CAP`.

## Behaviour
- Pushed price is clamped to < `maxStepBps * STEP_SAFETY_BPS` of the oracle price at the start of the target block (= price at head).
- Unhealthy prices (stale / too few sources / disagreement) => CANCEL, no signing, auto-resume after `RECOVERY_TICKS` healthy ticks.
- Clamped price further than `MAX_ANCHOR_DEV_BPS * ANCHOR_SAFETY_BPS` from fair => CANCEL + HALT (latched; owner must reseed the oracle).
- Kill switch (file exists, SIGUSR1, `POST 127.0.0.1/halt`) => CANCEL + stop signing; resumes only on restart. SIGINT/SIGTERM => CANCEL then exit.
- Titan: new 16-byte uuid + seq=1 on every (re)connect; same-nonce replacement txs; CANCEL = empty tx, same uuid, higher seq.
- Only `oracle.push(uint256,uint128)`, value 0, priority fee 0, chain-matched, gas/fee-capped txs can be signed (`tx.ts assertAllowed`).

## Threat model
A compromised host can sign pushes with the key: at most `maxStepBps` per block, but repeatable (~10% in 20 blocks at 50 bps)
and bounded vs the pool only by the mandatory anchor band and stop-loss. Mitigations: KMS key policy allowing `kms:Sign` only for this
key and only from this role (no export, no `kms:*`); pusher address is `setPusher`-whitelisted and revocable by the owner multisig;
run a separate guardian bot that pauses the pool on StopLoss/OracleStale reverts or oracle-vs-anchor drift; keep the HTTP port loopback.

## Hardening notes (post-review)
- Oracle ABI is `push(uint256 feedId,uint128 price,uint64 validBlock)` (selector 0xa94f14b9). The signer allowlist decodes calldata and requires
  feedId == FEED_ID, price in uint128, validBlock == the head+1 it signs for; a candidate is dropped if the head moves before send.
- Halt: `halted` is set synchronously, the transport latches on `cancel()` (send refused), the tick re-checks right before send, shutdown drains the in-flight tick.
  Halts (SIGUSR1, POST /halt, anchor-band, repeated sign errors, kill file) write KILL_SWITCH_FILE; a restart with the file present refuses to sign until the operator deletes it. SIGINT/SIGTERM do not write it.
- Quote asset: ETH/USD fair is divided by Pyth USDC/USD (`USDC_PYTH_PRICE_ID`); |USDC/USD - 1| > MAX_QUOTE_DEPEG_BPS (default 20, cap 100) => cancel+pause.
  **The pool's anchor adapter must be built on the same USDC-adjusted basis**, otherwise the anchor band and the oracle disagree during a depeg.
- `rpc` transport is refused outside 31337/560048/11155111. TLS required outside chain 31337. Logs: URLs reduced to origin, viem `shortMessage` only, registered secrets and long hex redacted.
- After a Titan reconnect (new uuid) no quote is signed for the rest of the last quoted block; the old uuid is cancelled over the new socket (Titan per-connection scoping of quotes is UNVERIFIED).
- KMS signer requires EXPECTED_PUSHER_ADDRESS; startup refuses unless `oracle.isPusher(signer)`.

## UNVERIFIED
- Protobuf field numbers/wire types (`src/titan/quote_update.proto`, all TODO(titan)); ack semantics (error strings, timestamp meaning, whether acks arrive for cancels); region endpoints; whether Titan accepts our asset_pairs/quote_address encoding.
- KMS path (DER parse, low-s, recovery-id search) has never run against real KMS.
- Pyth / Coinbase live sources were not exercised in the local run (only DevWalk).
- Reorg handling is conservative (1s quiet period) but untested; step-bound clamp not hit in the local run (walk stayed under the limit).
