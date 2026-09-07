# Relay — live API probe (hands-on, 2026-09-07)

Everything below was measured against `https://api.relay.link` from this session with plain `curl`.
No API key, no signup. Raw responses are in `docs/research/relay/probe/`.

## What you get with zero auth

| Endpoint | Auth | Notes |
|---|---|---|
| `GET /chains` | none | 61 chains, ~150 KB JSON. Includes VM type per chain. |
| `POST /quote` | none | Full quote + ready-to-sign tx steps. **401 if you pass `referrer`.** `appFees` works without a key. |
| `GET /intents/status?requestId=` | none | Returns `{"status":"unknown"}` until deposit lands. |
| `GET /requests/v2` | none | Public firehose of every request (any user's), with full tx data. |
| `POST /currencies/v1` | none | Token search by chainIds/term. Returns groups of tokens across chains. |

### API-key gate isolated
- `referrer: "suwappu"` → `401 {"message":"Please provide an api key","errorCode":"UNAUTHORIZED_QUOTE"}`
- Same body without `referrer` → 200.
- `appFees:[{recipient, fee:"30"}]` (30 bps) → 200, `fees.app.amountUsd = 0.074991` on a $25 swap. **Monetization works unauthenticated.**
- Cross-VM (Base USDC → Solana SOL) → 200 without a key.

## Chain coverage (61 total, from `/chains`)

- **EVM (52)**: ethereum, optimism, cronos, bsc, gnosis, unichain, polygon, monad, sonic, manta, boba, zksync, shape, world-chain, flow-evm, stable, hyperevm, metis, lisk, soneium, ronin, abstract, morph, tempo, megaeth, robinhood, mantle, somnia, superseed, B3 (deposits disabled), base, plasma, apechain, mode, mythos, arbitrum, celo, avalanche, gunz, zircuit, ink, linea, bob, animechain, berachain, blast, doma, plume, scroll, gensyn, katana, ethereal, zora
- **Non-EVM (9)**: hyperliquid (`hypevm`, id 1337), xrp (`xrpvm`), lighter (`lvm`), bitcoin (`bvm`, id 8253038), eclipse (`svm`), ton (`tonvm`, id 224235520), tron (`tvm`, id 728126428), solana (`svm`, id 792703809)

Suwappu overlap: we cover 7+ chains. Relay covers every one of ours **plus** Solana, Bitcoin, TON, Tron, XRP, HyperLiquid, Lighter. TON is notable: that's Telegram's native chain and we are a Telegram bot.

### Non-EVM address conventions (needed to integrate)
- Solana native: `11111111111111111111111111111111`
- Bitcoin native: `bc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqmql8k8` (8 dp)
- XRP: `xrp` (6 dp) · TON: `EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c` (9 dp) · Tron TRX: `T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb`, USDT `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`
- HyperLiquid (1337): 16-byte hex token ids, e.g. `USDT0 0x25faedc3f054130dbb4e4203aca63567` (2 dp), `UBTC …` (5 dp). Native `0x0…0` is **rejected** ("Invalid output currency").

## Measured fee curve (Base USDC → Arbitrum USDC, EXACT_INPUT)

| Size | relayerService fee | relayerGas | Effective | timeEstimate |
|---|---|---|---|---|
| $25 (ETH→ETH) | $0.0224 | $0.0014 | **0.10%** | 1 s |
| $50,000 | $4.7694 | $0.0030 | **0.0095%** | 6 s |
| $1,000,000 | $95.009 | $0.0132 | **0.0095%** | 6 s |
| $25 USDC→SOL (cross-VM, +30 bps app fee) | $0.0374 | $0.0004 | 0.15% + 0.30% app | 1 s |

Read: Relay charges ~1 bp on stable-to-stable at size, with a ~$0.02 floor on small swaps. Across (our current bridge, `bot/services/across_api.py`) quotes ~4 bp. Relay is the price leader on the routes we actually run.

`slippageTolerance.total = "200"` (2%) by default on the small ETH quote, 1.99% destination-side. Tune with `slippageTolerance` in bps.

## Quote response shape (what our adapter must parse)

```
{
  requestId,                     // 0x… track via /intents/status
  steps: [                       // ordered; each step has items[] with signable data
    { id: "approve"|"deposit"|…, kind: "transaction"|"signature",
      action, description, requestId, depositAddress,
      items: [{ status, data: {from,to,data,value,chainId,gas,maxFeePerGas,maxPriorityFeePerGas},
                check: {endpoint:"/intents/status?requestId=…", method:"GET"} }] }
  ],
  fees: { gas, relayer, relayerGas, relayerService, app, subsidized }   // each {currency, amount, amountFormatted, amountUsd, minimumAmount}
  details: { operation:"swap"|"bridge"|…, sender, recipient, currencyIn, currencyOut{…,minimumAmount},
             totalImpact{usd,percent}, swapImpact, rate, slippageTolerance{total,origin,destination}, timeEstimate(s), fallbackType },
  protocol: { v2: { orderId, hubType:"onchain", orderData:{ solver, inputs[{payment, refunds[]}], output{payments[{minimumAmount,expectedAmount}], deadline} }, paymentDetails{depository,currency,amount} } }
}
```

Key facts for the adapter:
- Deposit goes to a **depository contract** (`0x4cd00e387622c35bddb9b4c962c136462338bc31` on Base) with calldata `0x49290c1c…` encoding the requestId. Native ETH sent as `value`.
- ERC-20 flows return an `approve` step first (2 txs). Native flows are 1 tx.
- `protocol.v2.orderData.inputs[].refunds[]` shows Relay's refund fallback: on failure funds are returned to `recipient` on origin **or** destination chain, deadline ≈ 2 hours out.
- The solver is a single address per order (`0xf70da978…` on Base): Relay is a **centralized solver set today** (see technical doc), which is a trust point to message against.

## Public firehose = free market intel

`GET /requests/v2` with no auth returns every request on Relay in real time, including user addresses, amounts, chains, and full tx payloads. That is:
1. A live volume/route-mix oracle for our competitive dashboard (which pairs, sizes, and chains dominate).
2. A privacy weakness in their product we should not replicate.

## Failure modes seen
- 401 `UNAUTHORIZED_QUOTE` → `referrer` without key.
- 400 `Invalid output currency` → HyperLiquid native address.
- 400 `INVALID_INPUT_CURRENCY` → wrong BTC token id (must use the `bc1qqq…mql8k8` sentinel).
- `/currencies/v2` does not exist (404); v1 is POST.
