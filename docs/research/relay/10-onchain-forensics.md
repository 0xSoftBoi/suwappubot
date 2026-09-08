# Relay on-chain forensics (Base, 2026-09-08)

Sources: Blockscout MCP (verified source, labels) and the public Blockscout REST API for Base, Ethereum, Arbitrum. Addresses come from live quotes (`protocol.v2.paymentDetails.depository`, `orderData.solver`).

## The depository: `0x4cD00E387622C35bDDB9b4c962C136462338BC31` (Base)
- Verified contract **RelayDepository**, Solidity 0.8.28, compiled via IR, optimizer off, no proxy, no upgradability. First transaction 2025-06-30. Constructor args: owner `0xf3d63166F0Ca56C3c1A3508FcE03Ff0Cf3Fb691e`, allocator `0x51203C6be98052fb6D7fe1333ee6859B90d21cDf`.
- Labelled by Blockscout / Open Labels Initiative as "Relay Depository: Provides secure deposit functionality and execution of allocator-signed requests for EVM chains", with verified integrating domains: oku.trade, superbridge.app, kyberswap.com, relay.link, inkonchain.com, opensea.io, currentx.app, highlight.xyz, app.rocketx.exchange, leodex.io, rempart.app, app.shapeshift.com, app.superlend.xyz, app.qwerti.ai. That list is a customer list Relay does not publish.
- **Blockscout marks the address `reputation: scam`, `is_scam: true`.** That is Blockscout's automated reputation flag, not a Relay wrongdoing finding; the most likely cause is drainer or phishing flows that used Relay to move stolen funds cross-chain (Relay warned about Robinhood Chain honeypots in July 2026). It is still a fact a wallet's explorer may show to a user who inspects the deposit target. Ours should explain the deposit target in the confirm screen.

### What the contract does (from `src/RelayDepository.sol`)
```
depositNative(address depositor, bytes32 id) payable       → emits RelayNativeDeposit(from, amount, id)
depositErc20(address depositor, address token, uint256 amount, bytes32 id)  → safeTransferFrom, emits RelayErc20Deposit
depositErc20(address depositor, address token, bytes32 id)  → pulls the full current allowance
execute(CallRequest request, bytes signature)              → only with a valid EIP-712 signature from `allocator`; nonce+expiry replay protection; executes arbitrary Call[] {to, data, value, allowFailure}
setAllocator(address)                                       → onlyOwner
```
Read:
1. Deposits are just events. The contract does no accounting; the `id` (our `requestId`) is the only link between a deposit and an order. Everything else is off-chain (Oracle attests, Hub credits, Allocator signs withdrawals).
2. **Withdrawals are whatever the allocator signs.** `execute` can move any token or native balance anywhere. There is no per-user balance, no timelock, no pause. Security reduces to the allocator key (MPC per their docs) and the owner key that can rotate it. The docs' claim "no admin backdoor" is true only in the sense that the owner cannot withdraw directly; the owner can point `allocator` at any address it controls.
3. The three-argument `depositErc20` pulls the entire allowance. Our executor caps the approve to exactly the input amount, so a stale unlimited allowance cannot be swept by a later deposit call.
4. The deposit calldata we sign (`0x49290c1c…`) is `depositNative(depositor, id)` with `depositor = 0xdEaD` placeholder in unauthenticated quotes and the real user in ours.

### Balances (Base, at read time)
Depository holds transient float only: USDC 32.6K, USDT 8.7K, WETH 0.44, ETH 6.8, plus dust of DEGEN, BASEJUICE, AERO, cbXRP, SYND. Consistent with "funds sit in the depository for seconds to minutes".

Recent 50 transactions on page 1: `depositNative` ×36, `execute` ×8, `depositErc20` ×6. Executes are the allocator sweeping to the solver; roughly one sweep per 5 deposits.

## The solver: `0xf70da97812CB96acDF810712Aa562db8dfA3dbEF`
- An EOA (not a contract), first seen 2024-01-29. Labelled "Relay: Solver — Relay's primary solver wallet, responsible for executing cross-chain actions on behalf of users." Same address on every EVM chain.
- **Inventory on Base**: USDC 3,670,132 · cbBTC 19.39 · SOL (wrapped) 1,185 · USDT 52,788 · ETH ~41 at read time · DAI 466 · EURC 22 · memecoins from fills (TOBY 295M, DOG 15K, FAI 3.4K).
- **ETH balance swings daily** (Base, last 12 days): 521 → 316 → 329 → 292 → 214 → 130 → 199 → 389 → 268 → 166 → 299 ETH. A single hot wallet rebalanced by hand or by their vault system, holding roughly $4–5M of working capital on Base alone. Ethereum mainnet balance 16.3 ETH, Arbitrum 7.3 ETH at read time.
- This is the wallet that fills 97.7% of orders in our firehose sample. Its liquidity is the network's liquidity. The 08-30 "liquidity shortage" incident and the `SOLVER_BALANCE_TOO_LOW` error code are this wallet running low.

## Implications for Suwappu
1. **Counterparty risk is one EOA plus one MPC signer.** Our provider race means a Relay outage or drained solver only removes one quote from the race. Message that.
2. **Sizing.** With ~$3.7M USDC on Base, single fills above low seven figures will fail or price badly. Our `_get_relay_quote` should not be preferred for whale tickets without checking `SOLVER_BALANCE_TOO_LOW`; the min-out guard already protects the user, but the router should fall through to Across/CCTP for size.
3. **Explorer reputation.** Because Blockscout flags the depository as scam, a user who clicks the deposit address in Rabby/Blockscout will see a red label. Show "Relay depository (verified contract, audited by Spearbit/Certora)" in the confirmation to pre-empt support tickets.
4. **We can monitor them for free.** `RelayErc20Deposit` / `RelayNativeDeposit` events on each chain's depository give per-chain deposit counts and volumes without their API, and survive the November 2026 firehose retirement. Worth a small indexer if we keep a competitive dashboard.
