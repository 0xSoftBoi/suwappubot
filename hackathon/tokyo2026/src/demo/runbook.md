# Demo runbook — 3 minutes, no slides

_Pre-reqs: `.env` filled (see `.env.example`), `bun install` done,
`bun test tests/` green. Two terminals: one for logs, one for the QR._

## 0. Pre-demo (15 min before)

- [ ] `bun test tests/` → 27 pass
- [ ] Confirm Sepolia subname live: `agent.demo.suwappu.eth` resolves,
      `suwappu.policy` = `{"maxTxUsd": 500, ...}`
- [ ] Staging simulator tab open (World): https://simulator.worldcoin.org
- [ ] Two counterparties ready: one clean address, one flagged
      (e.g. a known mixer-interaction address for the block path)

## 1. The happy path (90s)

1. Telegram bot: agent proposes **"Swap 1.5 ETH → USDC on Base"**.
2. Backend calls `startTradeVerification` — show the QR (`connectorURI`).
   Point at the `signal`: `sha256(agent|chain|from|to|amount|nonce)` — this
   proof can't authorize any other trade.
3. Scan with World App (staging) → backend polls → `verifyTradeProof` hits
   `POST /v4/verify/{rp_id}` → nullifier stored.
4. Intercepta `screenPreSign(payTo)` — clean → `allow`. Say it: _"screened
   before the agent signed anything."_
5. `UniswapTradingProvider.quote` → show route type (Classic vs UniswapX),
   `ensureApproval` (Permit2-aware) → `buildExecution`.
6. `resolveAndCheckPolicy('agent.demo.suwappu.eth')` — onchain caps pass →
   trade executes.

## 2. The block paths (60s)

1. Same flow, flagged counterparty → Intercepta returns `block` with the
   **visible reason** (`PolicySignal.reason` on screen). Agent never signs.
2. Trade of $5,000 with a $500 onchain cap → `resolveAndCheckPolicy` returns
   the ENS block reason. _"The agent can't raise its own caps — it doesn't
   hold LIMIT_WRITER."_
3. Deny the World ID prompt in the simulator → `ok:false`, reason shown,
   **no execution**.

## 3. The held path (30s, optional if time)

- Medium-risk score → `require_approval` → escalates to **World ID step-up**
  instead of a plain approve button. Human scans, trade proceeds.

## If something breaks live

- World ID: fall back to the recorded staging-simulator video; the unit
  tests (`intentHash`, `worldIdStepUp`) still prove the security properties.
- Intercepta: the verdict-mapping tests run keyless; show the code path.
- ENS: have an Etherscan link to the policy record ready as backup.
- Uniswap: have a cached quote JSON ready; show the dispatch logic.

## One-liner for judges

> Before an AI agent moves money, World proves who backs it, Intercepta checks
> whether the counterparty is safe, ENSv2 proves what the named agent is
> allowed to do, and Uniswap provides the executable route.
