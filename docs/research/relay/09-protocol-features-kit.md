# Relay protocol, vaults, features, Relay Kit, and full changelog (digested from the docs crawl, 2026-09-08)

Source: every `references/protocol/*`, `references/relay-kit/*`, `features/*` page plus `how-relay-works` and `changelog` on docs.relay.link, crawled to `docs-crawl/`. Companion to `08-api-reference.md`.

# 1. Protocol (Relay Settlement)

## 1.1 Overview & how it works
Relay Settlement is an intents protocol optimized on 5 axes: **Speed** (sub-second optimistic fills, no auction delay), **Cost** (~21k gas native deposits, zero-overhead solver fills, ~$0.005 settlement on a dedicated chain), **Capital Efficiency** (solvers withdraw on their own schedule instead of batch windows), **Coverage** (80+ chains, minimal per-VM logic), **UX** (single-transfer deposits, instant solver-driven refunds). *(references__protocol__overview.md)*

**3 core contracts** *(references__protocol__how-it-works.md)*:

| Contract | Role | Location |
|---|---|---|
| Depository | Holds user deposits | every supported chain (80+) |
| Hub | Tracks token ownership / solver balances | Relay Chain |
| Allocator | Generates MPC withdrawal payloads | Aurora (NEAR) |

**3 sequential flows** per order — Execution → Settlement → Withdrawal:
- **Execution**: user deposits into Depository (orderId-tagged, ~21k gas) → solver fills on destination with own capital.
- **Settlement**: solver requests Oracle attestation → Oracle reads origin+destination chain state → signs EIP-712 attestation → solver submits to Oracle contract on Relay Chain → Hub executes MINT (credit user) then TRANSFER (user→solver).
- **Withdrawal**: solver → Oracle (initiate) → signed Hub execution moves balance to withdrawal address → Oracle (payload params) → solver → RelayAllocatorSpender (verifies Oracle sig, forwards to Allocator) → Allocator MPC-signs chain-specific proof (EIP-712 EVM / Ed25519 Solana) → solver submits proof to Depository → funds released.

**Fast Refund**: if a solver can't fill, it refunds the user directly on the origin chain (mirrors the fill flow) and gets settled identically via an Oracle attestation. *(references__protocol__how-it-works.md)*

## 1.2 Components

**Allocator** *(references__protocol__components__allocator.md)* — authorizes withdrawals via NEAR MPC chain signatures (no single key holder); gated by `APPROVED_WITHDRAWER_ROLE`, held in production by the `RelayAllocatorSpender` gateway contract, which itself verifies `ORACLE_ROLE` signers before forwarding. Payload Builders per VM: EVM (EIP-712 `CallRequest`), Solana (Ed25519 `TransferRequest`, Borsh), Bitcoin (ECDSA secp256k1). Security: MPC signing, Oracle-gated access, balance-bounded (cannot mint), Security Council suspend/replace, nonce+expiry replay protection. Source: `RelayAllocator.sol` + `RelayAllocatorSpender.sol` in `settlement-protocol`.

**Deposit Addresses** *(references__protocol__components__deposit-addresses.md)* — counterfactual CREATE2 + EIP-1167 minimal-proxy addresses derived per `(orderId, depositor)`; salt = `keccak256(orderId, depositor)`. Two contracts: `DepositAddressFactory` (`computeDepositAddress(orderId, depositor)` view; `sweep(orderId, depositor, tokens)`) and stateless `DepositAddress` implementation (reads balance, calls `depositErc20`/`depositNative` on the Depository via delegatecall proxy). Zero address = native ETH. Non-upgradable, atomic sweep, re-sweepable.

**Depository** *(references__protocol__components__depository.md)* — deployed on every supported chain (80+), non-upgradable escrow. EVM: `depositNative(depositor, id)`, `depositErc20(depositor, token, amount, id)`. Solana (Anchor program): `deposit_native(amount, id)`, `deposit_token(amount, id)` into a PDA vault. Bitcoin: MPC-controlled address, ECDSA withdrawals. Withdrawal only via registered Allocator; nonce+expiration replay protection. Audited by Spearbit (Feb 2025), Certora (Jun 2025); settlement protocol broadly by Zellic (Nov 2025).

**Hub** *(references__protocol__components__hub.md)* — ERC6909 multi-token ledger on the Relay Chain. Actions: `MINT` (deposit attested), `TRANSFER` (fill attested), `BURN` (withdrawal attested), each idempotent. Interface includes `balanceOf(owner, tokenId)`, `transfer(receiver, tokenId, amount)`, `approve(spender, tokenId, amount)`, operator system, EIP-712 permits. Withdrawal addresses are deterministic hash-derived virtual routing aliases (chain, depository, currency, amount, recipient, nonce) — not real contracts. Order addresses (Hub-internal) are derived via the settlement SDK formula (see §1.4 below). Source: `RelayHub.sol`.

**Oracle** *(references__protocol__components__oracle.md)* — offchain Oracle Service (reads chain data, signs EIP-712 attestations) + onchain `RelayOracle` contract (verifies authorized signer, executes Hub actions, idempotent). Attests deposits, fills, refunds, and 3 withdrawal sub-steps (initiation, payload authorization, completion/burn). Pull-based (no cross-chain messaging infra needed) — validators read chain data on demand. Batch execution via `executeMultiple()` (per-item skip-on-already-processed). Authorized signer can be an EOA or EIP-1271 contract (e.g. `RelayOracleMultisig`). Security: even a compromised Oracle can only mis-attribute Hub balances, not steal Depository funds directly (Allocator independently balance-checks).

**Relay Chain** *(references__protocol__components__relay-chain.md)* — purpose-built settlement chain. Chain ID **537713**, RPC `https://rpc.chain.relay.link`, Explorer `explorer.chain.relay.link`, native asset ETH, **Sovereign Stack rollup**, DA = **Celestia**, EVM-compatible. Hosts Hub, Oracle contract, `ERC20View` wrapper. Allocator lives on Aurora, not the Relay Chain.

**Security Council** *(references__protocol__components__security-council.md)* — multisig, tiered thresholds:

| Action | Threshold |
|---|---|
| Suspend approved withdrawer | 1-of-N |
| Restore approved withdrawer | governance action |
| Update Allocator (add payload builders) | quorum |
| Add/remove Oracle instances | quorum |
| Replace Allocator | supermajority |
| Change membership | supermajority |

Cannot: modify Hub ledger/create balances, withdraw Depository funds, alter Oracle attestations, access funds in any contract. In production, suspending `RelayAllocatorSpender` (the sole approved withdrawer) is an effective global withdrawal halt — a deployment property, not a contract invariant.

## 1.3 Contracts — Solidity/Anchor API

**EVM Depository** *(references__protocol__contracts__evm-depository.md)* — errors `AddressCannotBeZero()`, `InvalidSignature()`, `CallRequestExpired()`, `CallRequestAlreadyUsed()`, `CallFailed(bytes returnData)`; events `RelayNativeDeposit(address from, uint256 amount, bytes32 id)`, `RelayErc20Deposit(address from, address token, uint256 amount, bytes32 id)`, `RelayCallExecuted(bytes32 id, Call call)`. Key functions:
```solidity
constructor(address _owner, address _allocator)
function setAllocator(address _allocator) external
function depositNative(address depositor, bytes32 id) external payable
function depositErc20(address depositor, address token, uint256 amount, bytes32 id) public
function depositErc20(address depositor, address token, bytes32 id) external // uses full allowance
function execute(CallRequest request, bytes signature) external returns (CallResult[] results)
```
`CallRequest { Call[] calls; uint256 nonce; uint256 expiration; }`, `Call { address to; bytes data; uint256 value; bool allowFailure; }`, `CallResult { bool success; bytes returnData; }`.

**Solana Depository** *(references__protocol__contracts__solana-depository.md)* — Anchor program, version 0.1.0. Functions: `initialize(ctx)`, `set_allocator(ctx, new_allocator: Pubkey)`, `set_owner(ctx, new_owner: Pubkey)`, `deposit_native(ctx, amount: u64, id: [u8;32])`, `deposit_token(ctx, amount: u64, id: [u8;32])`, `execute_transfer(ctx, request: TransferRequest)`. Account `RelayDepository { owner, allocator, vault_bump }`; `TransferRequest { recipient: Pubkey; token: Option<Pubkey>; amount: u64; nonce: u64; expiration: i64 }` with `get_hash()`. `CustomError` enum: `TransferRequestAlreadyUsed, InvalidMint, Unauthorized, AllocatorSignerMismatch, MessageMismatch, MalformedEd25519Data, MissingSignature, SignatureExpired, InvalidRecipient, InvalidVaultTokenAccount, InsufficientVaultBalance`.

## 1.4 Guides

**For Apps** *(references__protocol__guides__for-apps.md)* — `requestId` (Relay-level intent, from quote API `steps[].requestId`) vs `orderId` (protocol-level `bytes32` deposit id, readable on-chain from Depository events without an API call). Quote response includes a `protocol` block when settled via the protocol:
```json
{
  "steps": [...],
  "protocol": {
    "orderId": "0x1234...abcd",
    "depositChainId": 10,
    "paymentDetails": { "recipient": "0xDepositoryAddress...", "amount": "1000000", "token": "0xUSDCAddress..." }
  }
}
```
Hub order-address derivation (settlement SDK formula):
```js
const hash = keccak256(encodePacked(
  ["string","bytes","uint256","bytes32"],
  [chainId, encodeAddress(depositor, vmType), timestamp, depositId]
));
const orderAddress = `0x${hash.slice(2).slice(-40)}`;
```
Worked example given for Relay request `0xd5695a...` / Arbitrum deposit tx `0x693af85...` → derived order address `0xab73c17f93668cda196db73334e5f1f2ba08257a`.

**For Solvers** *(references__protocol__guides__for-solvers.md)* — lifecycle: monitor deposits → fill (any onchain action, gas-efficient as a plain transfer) → wait for Oracle attestation of both deposit+fill → submit to Oracle contract (Hub balance updates in real time) → withdraw anytime via any Depository. Solver fee = deposit-amount minus fill-amount, fixed at quote time; settlement gas ~$0.005/order paid by solver.

**Third-Party Oracle** *(references__protocol__guides__third-party-oracle.md)* — Dockerized stateless HTTP service. Utility routes: `GET /lives/v1`, `GET /chains/v1`, `GET /documentation`. Attestation routes: `POST /attestations/depository-deposits/v1`, `/depository-withdrawals/v1`, `/solver-fills/v1`, `/solver-refunds/v1`, `/withdrawal-initiation/v1`, `/withdrawal-initiated/v1`. Supported VM attestors: `ethereum-vm, solana-vm, bitcoin-vm, hyperliquid-vm, lighter-vm, tron-vm`. Signing modes: `raw-private-key` (default) or `aws-kms`. Quorum/peering: `PEERS=url|key;...`, `ORACLE_SIGNERS=0xaddr;...` (allowlist), `ORACLE_SIGNERS_THRESHOLD` (default 1; validated at startup against allowlist size, local signer must be in the list). Rate limit default: 2 req/1000ms per IP, `x-api-key` bypasses it; `API_KEYS=key:name;...` required for the `force` option on fill/refund attestations. Core env vars: `ENVIRONMENT`, `ECDSA_PRIVATE_KEY`/`AWS_KMS_SIGNER_KEY_ID`+`AWS_KMS_SIGNER_KEY_REGION`, `HTTP_PORT`/`PORT`, `UNAUTHENTICATED_RATE_LIMIT_MAX/WINDOW_MS`, `PEER_REQUEST_TIMEOUT_MS` (default 10000), plus per-chain RPC vars (`ETHEREUM_RPC_URL`, `BASE_RPC_URL`, ... `HYPERLIQUID_RPC_URL`) and supplemental service vars (`HYPERLIQUID_HUB_API_URL/KEY`, `BITCOIN_ESPLORA_COMPATIBLE_API_URL`, `BITCOIN_BLOCKSTREAM_CLIENT_ID/SECRET`, `BITCOIN_MAESTRO_API_KEY`, `LIGHTER_RPC_API_KEY`). Deploy: `docker build -t relay-protocol-oracle .` / `docker run --rm -p 3000:3000 --env-file .env relay-protocol-oracle` (also loads `/vault/secrets`). Railway is the recommended host for third-party operators. Recommended sequence: dedicated signer → RPC provisioning → deploy → verify health/chains → configure API keys/edge auth → HTTPS → peering in shadow mode → observe → onboard signer.

**Programmatic Withdrawals** *(references__protocol__guides__withdrawals.md)* — thin wrapper over 3 public, keyless (signature-authorized) endpoints at `https://api.relay.link`: `POST /withdrawals/attest-deposit`, `POST /withdrawals/request` (prepare then execute), `GET /withdrawals/status`. Supported: EVM, Hyperliquid, Solana, Tron, TON; **not** Bitcoin/Lighter (400 → support). No ERC-1271 path — owner must sign raw messages itself.
Flow: 
1. `GET /requests/v3?id={requestId}` → check `protocol.isWithdrawable`, `protocol.deposit.origin.depositor` (=owner).
2. `POST /withdrawals/attest-deposit {chainId, transactionId}` — idempotent, `chainId` here is numeric (the one exception).
3. `POST /withdrawals/request` (no signature) — protocol chain slugs for `chainId`/`ownerChainId` (e.g. `"base"`), returns `{nonce, amount, additionalData}`; nonce is deterministic per 1-min window and short-lived.
4. Sign SHA-256 digest of `json-stable-stringify({operation:"withdrawal", chainId, currency, amount, ownerChainId, owner, recipient, nonce, additionalData})`. Per-chain signing: EVM/Hyperliquid `personal_sign`; Solana `signMessage`; Tron `tronWeb.trx.signMessageV2`; TON `TonConnect signData` (+`additionalData["ton-vm"] = {timestamp, domain}`).
5. `POST /withdrawals/request` again with `nonce, additionalData, signature` → `{jobId, status:"processing"}`; only one in-flight withdrawal per `(chain, owner, currency)` (else 409 `WITHDRAWAL_IN_PROGRESS`).
6. `GET /withdrawals/status?id={jobId}` — statuses `processing/initiating/attesting → ready → executed`, or `expired`/`failed` (restart from prepare). Status retained 24h.
7. Broadcast: on `ready`, owner wallet must broadcast the returned tx (except TON, which the solver broadcasts).

**Security & Audits** *(references__protocol__security.md)* — trust model per component (Depository: non-upgradable, single-authority, no admin backdoor; Oracle: main trust-bearing component, bounded by Allocator+Council; Hub: rule-based/idempotent/transparent; Allocator: MPC/balance-bounded/Oracle-gated/Council-governed/replay-protected). Audits:

| Date | Scope | Auditor |
|---|---|---|
| Feb 2025 | Relay Depository (EVM) | Spearbit |
| Jun 2025 | Relay Depository (EVM) | Certora |
| Nov 2025 | Settlement Protocol | Zellic |
| Apr 2026 | Oracle | Zellic |

Source repos: `settlement-protocol`, `relay-protocol-oracle`.

## 1.5 Addresses *(references__protocol__addresses.md)*

Relay Chain (537713): Hub `0xDDD361727C22A01EB137880678A20b0BEaE69318`, Oracle `0xd4b9fdB83C723c096d7fBE72da252aa23f1387aa`.
Aurora: Allocator `0x7EdA04920F22ba6A2b9f2573fd9a6F6F1946Ff9f`, Security Council Multisig `0xb538ee6515F9d16eBD0BACD0503733815c9b070c`.
Depository contracts (live-fetched, 80+ chains) — the majority of EVM chains share `0x4cd00e387622c35bddb9b4c962c136462338bc31`; some chains use `0x59916da825d2d2ec1bf878d71c88826f6633ecca` (Cronos, Metis, Mantle, Linea); non-EVM: Hyperliquid `0x66cf0aace1b4e562593bec10ec7868fba9932224`, XRP `rJBdWA9p5KwBoqSQTyMdg3UHLsJVzGVu5m`, Lighter `731033`, Bitcoin `bc1qzmtn0q92ayejt2hpffvlktcpmyy7vvsd06sefu`, Eclipse/Solana `99vQwtBwYtrqqD9YSXbdum3KBdxPAVxYTaQ3cfnJSrN2`, TON `EQCrdGsDTqA2t6xRR4N6V4J705F7w_VQbUdHnofsh-8lVIPs`, Tron `TXtEs6t2oUWQsNos7m68gbHdE9Q5n6x2oN`. Full 60-row table is in the source file (chain, address, VM type, chain ID) — too long to reproduce here in full; representative subset above. UNVERIFIED: this table is described in-doc as "fetched live" so it may already be stale relative to today.

---

# 2. Vaults (Relay Vaults — separate protocol)

**Overview** *(references__protocol__vaults__overview.md)* — permissionless, **ERC4626**-compliant yield-bearing pools that give solvers instant cross-chain rebalancing liquidity, sourced from idle capital in lending markets (Aave currently, Morpho-compatible). Depositors earn base yield (from the underlying lending pool) + boost yield when solvers use the capital for rebalancing. Deployed initially on Ethereum Mainnet and Arbitrum. Backend indexing API at `https://vaults-api.relay.link/`. Dev packages: `@relay-vaults/abis`, `@relay-vaults/client` (GraphQL); Hardhat tasks for deposit/withdraw.

**Architecture** *(references__protocol__vaults__architecture.md)* — `RelayPool.sol` is the ERC4626 vault (one per EVM chain + currency; native currencies handled via wrapped tokens + a Native Gateway). Each pool has a **base yield pool** (Aave/Morpho or any ERC4626) and **origins** — bridging contracts on other chains. `RelayBridge` uses **Hyperlane** to message the vault; on message receipt the vault instantly disperses funds pulled from the yield pool, while the underlying bridge (native bridge etc.) separately settles in the background — the vault is an "accelerator." `BridgeProxy` abstracts the underlying bridge per origin. Origin fees represent bridging "opportunity cost" (shorter bridge ⇒ lower fee). Yield/fees stream over a configurable period to resist inflation attacks.

**Backend** *(references__protocol__vaults__backend.md)* — GraphQL API at `https://vaults-api.relay.link/` for balances, yields, and vault metrics.

**Security** *(references__protocol__vaults__security.md)* — contracts non-upgradable. **Curator** (owner) changes route through a **timelock**; Relay-curated vaults use a **3-of-5 multisig** curator. **Origin risk**: each origin has a `maxDebt` (loss cap) and a `coolDown` (min delay between bridge tx and fund dispersion); each origin also has its own curator who can instantly pause it. Audited by Spearbit (reports in the Relay Vaults GitHub repo).

**Guides**:
- *Bridging* *(references__protocol__vaults__guides__bridging.md)*: identify vault (by currency+chain, via Backend API), identify origin (check `outstandingDebt` vs `totalAssets`, and the vault's `authorizedOrigins` for `bridgeFee`/`cooldown`); call `getFee(amount, recipient, poolGas)` on the bridge contract (default `poolGas` ~300,000), then `bridge(amount, recipient, poolGas, extraData)` passing `value = getFee` result; track via Hyperlane Explorer using the `messageId` from the origin `Mailbox`'s `DispatchId` event.
- *Interacting* *(references__protocol__vaults__guides__interacting.md)*: LPs use the Relay UI or direct contract calls (Etherscan/Blockscout); developers use `@relay-vaults/abis` + `@relay-vaults/client`, or Hardhat tasks from the Relay Vaults GitHub repo.

## 2.1 Vault contracts

**RelayBridge** *(references__protocol__vaults__contracts__RelayBridge.md)*:
```solidity
interface IRelayBridge {
  function bridge(uint256 amount, address recipient, address poolAsset, uint256 poolGas, bytes extraData)
    external payable returns (uint256 nonce);
}
constructor(address asset, BridgeProxy bridgeProxy, address hyperlaneMailbox)
function getFee(uint256 amount, address recipient, uint256 poolGas) external view returns (uint256 fee)
function bridge(uint256 amount, address recipient, address poolAsset, uint256 poolGas, bytes extraData)
  external payable returns (uint256 nonce)
```
Errors: `BridgingFailed(uint256 nonce)`, `InsufficientValue(uint256 received, uint256 expected)`, `FailedFeeRefund(uint256 value)`. Events: `BridgeInitiated(nonce, sender, recipient, ASSET, poolAsset, amount, BRIDGE_PROXY)`, `BridgeExecuted(nonce)`, `BridgeCancelled(nonce)`. State: `transferNonce`, immutable `ASSET`, `BRIDGE_PROXY`, `HYPERLANE_MAILBOX`.

**RelayBridgeFactory** *(references__protocol__vaults__contracts__RelayBridgeFactory.md)*:
```solidity
constructor(address hMailbox)
function deployBridge(address asset, BridgeProxy proxyBridge) public returns (address)
```
State: immutable `HYPERLANE_MAILBOX`, `mapping(address => address[]) bridgesByAsset`. Event: `BridgeDeployed(address bridge, address asset, BridgeProxy proxyBridge)`.

**RelayPoolFactory** *(references__protocol__vaults__contracts__RelayPoolFactory.md)*:
```solidity
constructor(address hMailbox, address weth, address timelock, uint256 minTimelockDelay)
function deployPool(ERC20 asset, string name, string symbol, address thirdPartyPool,
  uint256 timelockDelay, uint256 initialDeposit, address curator) public returns (address)
```
Also a `RelayPoolTimelock` interface: `function initialize(uint256 minDelay, address[] proposers, address[] executors, address admin) external`. State: `HYPERLANE_MAILBOX`, `WETH`, `TIMELOCK_TEMPLATE`, `MIN_TIMELOCK_DELAY`, `mapping(address => address[]) poolsByAsset`. Errors: `UnauthorizedCaller(sender)`, `InsufficientInitialDeposit(deposit)`, `InsufficientTimelockDelay(delay)`. Event: `PoolDeployed(pool, creator, asset, name, symbol, thirdPartyPool, timelock)`.

**RelayPool** *(references__protocol__vaults__contracts__RelayPool.md)* — ERC4626 vault receiving bridged assets via Hyperlane. Key structs:
```solidity
struct OriginSettings { uint32 chainId; address bridge; address curator; uint256 maxDebt;
  uint256 outstandingDebt; address proxyBridge; uint32 bridgeFee; uint32 coolDown; }
struct OriginParam { address curator; uint32 chainId; address bridge; address proxyBridge;
  uint256 maxDebt; uint32 bridgeFee; uint32 coolDown; }
```
Constructor: `constructor(address hyperlaneMailbox, ERC20 asset, string name, string symbol, address baseYieldPool, address weth, address curator)` — "owner should always be a timelock with significant delay."
Notable functions: `updateStreamingPeriod(uint256 newPeriod)`, `updateYieldPool(address newPool, uint256 minSharePriceFromOldPool, uint256 maxSharePricePriceFromNewPool)`, `addOrigin(OriginParam origin)` (owner/timelock only), `disableOrigin(uint32 chainId, address bridge)` (origin curator only, sets maxDebt=0), `maxDeposit/maxWithdraw/maxMint/maxRedeem`, `totalAssets()` (yield-pool balance + outstandingDebt − pending fees − streaming assets), `handle(uint32 chainId, bytes32 bridgeAddress, bytes data)` (Hyperlane-only entrypoint, provides instant liquidity), `claim(uint32 chainId, address bridge) returns (uint256 amount)`, `setTokenSwap(address newTokenSwapAddress)`, `swapAndDeposit(address token, uint256 amount, uint24 uniswapWethPoolFeeToken, uint24 uniswapWethPoolFeeAsset, uint48 deadline, uint256 amountOutMinimum)` (Uniswap V3 swap for non-asset tokens received), `collectNonDepositedAssets()`, `processFailedHandler(uint32 chainId, address bridge, bytes data)` (owner-only manual recovery). Errors include `TooMuchDebtFromOrigin`, `MessageTooRecent` (cooldown enforcement), `SharePriceTooLow/High` (yield-pool-migration slippage protection), `NotAWethPool`. Fee/streaming state: `pendingBridgeFees`, `totalAssetsToStream`, `lastAssetsCollectedAt`, `endOfStream`, `streamingPeriod`, `FRACTIONAL_BPS_DENOMINATOR`.

**RelayPoolNativeGateway** *(references__protocol__vaults__contracts__RelayPoolNativeGateway.md)* — wraps/unwraps ETH for WETH-based pools with slippage protection:
```solidity
constructor(address wethAddress)
function deposit(address pool, address receiver, uint256 minSharesOut) external payable returns (uint256 shares)
function mint(address pool, address receiver, uint256 minSharesOut) external payable returns (uint256 shares)
function withdraw(address pool, uint256 assets, address receiver, uint256 maxSharesIn) external virtual returns (uint256 shares)
function redeem(address pool, uint256 shares, address receiver, uint256 minAssetsOut) external virtual returns (uint256 assets)
```
Errors: `EthTransferFailed()`, `OnlyWethCanSendEth()`, `RemainingEth()`, `SlippageExceeded()`.

---

# 3. Features

**App Fees** *(features__app-fees.md)* — additional bps fee on top of Relay's own fee, accrued off-chain in USDC, withdrawable on demand. Set via quote request:
```json
"appFees": [{ "recipient": "0x999999cf1046e68e36E1aA2E0E07105eDDD1f08E", "fee": "100" }]
```
`fee` is bps of input token; `recipient` must be EVM-format even for non-EVM chains. Fee must exceed **$0.025** to be taken (else silently skipped — verify via monitoring). Same-chain solver-mismatched-currency triggers an extra swap. Support matrix: cross-chain swaps ✅ all combos; same-chain swaps ✅ (EVM full; SVM input-currency-only); bridges/calls/wraps ✅; sends/transfers ❌; gasless swaps ✅ (from original quote); gasless execution w/o prior quote ❌. Verify via `GET /requests/v2` (`appFees` vs `paidAppFees`) or `GET /app-fees/{address}/balances`. Withdraw: `POST /app-fees/{address}/claim` → sign → `POST /execute/permits?signature=...`. Supports EIP-1271 for smart-contract claim recipients.

**Deposit Addresses** *(features__deposit-addresses.md)* — bridge/swap by sending funds to an address, no wallet connect/sign. Quote param `useDepositAddress: true`. Key params: `useDepositAddress`, `user`, `recipient`, `refundTo` (native-currency-address sentinel = auto-refund original depositor; supported EVM/Bitcoin/Solana), `recoveryAddress` (integrator-controlled origin-chain EOA fallback, never receives refunds directly), `tradeType`, `amount`, `strict`. **Open** addresses: reusable per route, flexible amount/token/chain (same-VM) within limits, `refundTo` recommended not required. **Strict** addresses: bound to one order, `strict: true`, `refundTo` required, no wrong-token/wrong-chain recovery. Example open request:
```bash
curl -X POST 'https://api.relay.link/quote/v2' -H 'Content-Type: application/json' -d '{
  "user":"0xF0AE...", "originChainId":8453, "originCurrency":"0x0000...0000",
  "destinationChainId":10, "destinationCurrency":"0x0000...0000",
  "tradeType":"EXACT_INPUT", "recipient":"0xF0AE...", "amount":"100000000000000000",
  "useDepositAddress": true, "refundTo": "0xF0AE..." }'
```
Overpayment handling differs by strict/open and by tradeType (EXACT_INPUT fills full deposit no refund of excess; EXACT_OUTPUT fills quoted amount + refunds excess). Track via `GET /requests/v2?depositAddress=...` or `includeChildRequests=true`; regenerated requests expose `supersededByRequestId` on `GET /requests/v3`. Reindex stuck/wrong-chain deposits: `POST /transactions/deposit-address/reindex {chainId, depositAddress[, targetChainId, currency]}`. Gas overhead: native ~33,000 gas, ERC-20 ~70,000 gas vs direct calldata. Full solver-currency table per chain is in-file (60+ chains). Bitcoin: 1 conf standard, 2 conf above per-currency threshold. Calldata execution on destination not allowed.

**Fast Fill** *(features__fast-fill.md)* — accelerates destination fill before origin deposit finalizes. Requires: API key, linked Fee Sponsorship Wallet, sufficient App Balance (a hold equal to fill amount is placed until origin deposit lands; if the deposit never lands, the sponsoring app permanently loses the held amount). SDK: `getClient().actions.fastFill({ requestId[, solverInputCurrencyAmount] })`, call immediately after tx submission (before confirmation). `maxFillAmountUsd` caps exposure. App-balance top-up via direct on-chain deposit to the Base solver `0xf70da97812cb96acdf810712aa562db8dfa3dbef`, using calldata format `0x[012345abcdef][address-to-credit or zeros for msg.sender][012345abcdef]`.

**Fee Sponsorship** *(features__fee-sponsorship.md)* — covers destination-chain fees (not origin gas). Requires API key + funding wallet + app balance. Quote params: `subsidizeFees` (bool), `maxSubsidizationAmount` (USDC, 6dp string, hard cap), `subsidizationBps` (0–10000, per-bucket share, swap-execution-only, 400 on bridge/deposit-address), `subsidizeRent` (Solana ATA rent, requires `subsidizeFees`; without it, ATA-creating requests fall back to user-paid to avoid a rent-reclaim exploit), `depositFeePayer` (Solana address paying origin deposit fees, independent of app balance — signing order matters: integrator must sign first, exploitable for same-chain swaps with untrusted users), `sponsoredFeeComponents` (string[] selective bucket sponsorship). Example:
```json
{"subsidizeFees": true, "maxSubsidizationAmount": "5000000"}
```
Response includes:
```json
{"fees": {"relayerService":"...","relayerGas":"...","relayer":"...","app":"...",
  "subsidized": {"amount":"500000","amountUsd":"0.50"}}}
```
Does not cover: origin gas, app fees, first-time permit approval tx.

**Gas Top-Up** *(features__gas-top-up.md)* — `topupGas: true` (+optional `topupGasAmount`) adds destination native gas to a fill. Requires: EVM chain, non-native destination token, and `tokenSupport: "All"` or `currency.supportsBridging`.

**Gasless Execution** *(features__gasless-execution.md)* — `/execute` API for arbitrary raw EVM calls (`to, data, value`, optional EIP-7702 `authorizationList`) submitted by a relayer that pays gas. Flow: `POST /quote/v2` with `originGasOverhead` → `POST /execute { requestId, executionKind:"rawCalls", data:{chainId,to,data,value}, executionOptions }` → poll `GET /intents/status/v3?requestId=...`. Simulation errors return decoded revert detail (`ExecuteSimulationErrorResponse` / `SimulationErrorDetails` / `SimulationErrorFrame` types, `UNKNOWN_CUSTOM_ERROR_<selector>` fallback). Only EVM; no partial sponsorship; `tx.origin`-dependent txs unsupported; `msg.sender`-dependent txs need a smart wallet signer.

**Gasless Swaps** *(features__gasless-swaps.md)* — 3 approaches: **Permit-based** (BYO EOA wallet, `usePermit: true`, EIP-3009/Permit2 signature, USDC fully gasless / others need one approval); **ERC-4337** (`originGasOverhead: 300000`, zero gas fields, submit via `/execute` targeting `handleOps`); **7702 BatchExecutor** (`originGasOverhead: 80000` for Calibur — value is executor-specific, atomic approve+deposit via EIP-7702 delegation). Same-chain gasless swaps require fee sponsorship since same-chain swaps route through DEXes directly. Each has a linked worked example repo (`byo-eoa-permit`, `4337-gasless`, `7702-batch-executor`).

**Price Stabilization** *(features__price-stabilization.md)* — two mechanisms for stablecoin swaps: **Fee Sponsorship** (`subsidizeFees: true` — sponsor covers ~$0.02+1bps flat costs, output still floats with peg deviation) vs **Fixed Rates** (`fixedRate: "1:1"` or any ratio — user always gets the fixed rate, integrator absorbs/earns the spread, needs arbitrage monitoring). Works for solver-held stablecoins (USDC, USDC.e, USDT, USDe, USDH, mUSD, DAI — chain-dependent via `solverCurrencies`). Example:
```json
{"user":"0x0350...","originChainId":8453,"destinationChainId":42161,
 "originCurrency":"0x8335...","destinationCurrency":"0xfd08...",
 "amount":"100000000","tradeType":"EXACT_INPUT","subsidizeFees":true,"fixedRate":"1:1"}
```

---

# 4. Relay Kit

## 4.1 SDK

**Overview** *(references__relay-kit__overview.md)*: 3 packages — SDK, Hooks, UI.

**Installation** *(references__relay-kit__sdk__installation.md)*: `yarn add @relayprotocol/relay-sdk viem`. Requires node 18+, TS ^5.0.4.
```ts
import { createClient, convertViemChainToRelayChain, MAINNET_RELAY_API } from '@relayprotocol/relay-sdk'
createClient({ baseApiUrl: MAINNET_RELAY_API, source: "YOUR.SOURCE", chains: [convertViemChainToRelayChain(mainnet)] });
```
`configureDynamicChains()` (from `/chain-utils`) fetches chains live.

**createClient** *(references__relay-kit__sdk__createClient.md)* options: `baseApiUrl` ✅, `apiKey` (server-side only), `chains`, `source`, `logLevel`, `pollingInterval`, `maxPollingAttemptsBeforeTimeout`.

**Actions**:
- **getQuote** *(actions__getQuote.md)*: `getQuote({parameters}, includeDefaultParameters?, headers?)`. Params: `chainId`, `toChainId`, `currency`, `toCurrency`, `user`, `recipient` (✅ unless `includeDefaultParameters`), `tradeType` (`EXACT_INPUT`/`EXPECTED_OUTPUT`/`EXACT_OUTPUT`), `amount`, `wallet`, `txs`, `options`, `disableCapabilitiesCheck`. Never pass `x-api-key` in client-side headers.
- **execute** *(actions__execute.md)*: `execute({quote, wallet, depositGasLimit?, onProgress?, disableCapabilitiesCheck?})`. `onProgress` returns `{steps, fees, breakdown, currentStep, currentStepItem, txHashes, details}`.
- **executeGaslessBatch** *(actions__executeGaslessBatch.md)*: `executeGaslessBatch({quote, walletClient, executor?, subsidizeFees?, originGasOverhead?, onProgress?})`. Requires API key via `createClient({apiKey})`. `onProgress` statuses: `signing_authorization → signing_batch → submitting → polling → success|failure`.
- **fastFill** *(actions__fastFill.md)*: `fastFill({requestId, solverInputCurrencyAmount?})`.
- **claimAppFees** *(actions__claimAppFees.md)*: `claimAppFees({wallet, chainId, currency, recipient?, amount?, onProgress?, disableCapabilitiesCheck?})`.
- **getAppFees** *(actions__getAppFees.md)*: `getAppFees({wallet})`.

**Adapters** *(sdk__adapters.md)* — interface: `vmType, getChainId, handleSignMessageStep, handleSendTransactionStep, handleConfirmTransactionStep, address, switchChain` (✅ all), plus optional `transport, getBalance, supportsAtomicBatch, handleBatchTransactionStep, isEOA`. Official adapters: SVM, Bitcoin (bitcoinjs-lib), Viem (default), Ethers, Tron (tronweb), Lighter (owns full session lifecycle incl. `changeApiKey`), TON (never signs directly — caller supplies `sendTransaction` callback; confirmation via read-only `@ton/ton` `TonClient`). `adaptViemWallet(walletClient, { disableCapabilitiesCheck })`.

**API Types** *(sdk__api-types.md)*: `import { paths } from '@relayprotocol/relay-sdk'` — typed API request/response shapes, e.g. `paths['/execute/call']['post']['requestBody']['content']['application/json']`.

**Chain Utils** *(sdk__chain-utils.md)*, imported from `/chain-utils` subpath for tree-shaking: `configureViemChain(chain)`, `configureDynamicChains(): Promise<RelayChain[]>`.

## 4.2 Hooks *(references__relay-kit__hooks__*.md)*

Install: `yarn add react react-dom viem @tanstack/react-query @relayprotocol/relay-kit-hooks` (TanStack Query required).

| Hook | Signature / notes |
|---|---|
| `useQuote` | `useQuote(client, wallet?, options, onRequest?, onResponse?, queryOptions?)` → `{data, isLoading, executeQuote, error}`. Query fn `queryQuote(baseUrl, options)`. |
| `useExecutionStatus` | `useExecutionStatus(baseApiUrl?, options?, queryOptions?)` → data incl. `status, details, inTxHashes, txHashes, time, originChainId, destinationChainId`. Query fn `queryExecutionStatus()`. |
| `useRelayChains` | `useRelayChains(baseApiUrl?, options?, queryOptions?)` → `{chains, viemChains}`. Query fn `queryRelayChains()`. |
| `useRequests` | Reads `GET /requests/v3` — **requires `x-api-key`**; point `baseApiUrl` at a server-side proxy, never ship the key client-side. `useRequests(baseApiUrl?, options?, queryOptions?)`. Query fn `queryRequests()`. |
| `useTokenList` | `useTokenList(baseApiUrl?, options?, queryOptions?)` e.g. `{limit, term}`. Query fn `queryTokenList(...)`. |
| `useTokenPrice` | `useTokenPrice(options, queryOptions?)` e.g. `{address, chainId}`. Query fn `queryTokenPrice(baseApiUrl, options)`. |

## 4.3 UI

**Installation** *(ui__installation.md)*: `yarn add viem wagmi @tanstack/react-query @relayprotocol/relay-kit-ui`. Must wrap with `QueryClientProvider` → `RelayKitProvider` → `WagmiProvider`; import `'@relayprotocol/relay-kit-ui/styles.css'`. `RelayKitProvider options` supports `appName, appFees, codexConfig, chains, baseApiUrl`. Warns client-side if `baseApiUrl` points directly at the Relay API (since `GET /requests/v3` needs `x-api-key`) unless `acknowledgeApiKeyExposure: true`.

**RelayKitProvider** *(ui__relay-kit-provider.md)* options: `codexConfig.apiKey`, `codexConfig.apiBaseUrl` (default `https://graph.codex.io`), `disablePoweredByReservoir`, `appName`, `appFees` (`[{recipient, fee}]`, bps), `themeScheme` (`light`/`dark`), `acknowledgeApiKeyExposure`.

**SwapWidget** *(ui__swap-widget.md)* — required prop: `supportedWalletVMs`, `onConnectWallet`. Notable optional props: `fromToken/setFromToken`, `toToken/setToToken`, `lockFromToken/lockToToken`, `lockChainId`, `wallet`, `multiWalletSupportEnabled` (+`linkedWallets`, `onSetPrimaryWallet`, `onLinkNewWallet`), `defaultToAddress`, `defaultAmount`, `defaultTradeType`, `slippageTolerance` (bps), `disableInputAutoFocus`, `popularChainIds`, `disablePasteWalletAddressOption`, `singleChainMode`, `onAnalyticEvent`, `onSwapValidating/onSwapSuccess/onSwapError`. Also exports `SlippageToleranceConfig({setSlippageTolerance, onAnalyticEvent?})`.

**Theming** *(ui__theming.md)* — `RelayKitTheme` (e.g. `font, primaryColor, focusColor, text.{default,subtle}, buttons.primary.{color,background,hover}`); light/dark via `<html class="light|dark">`; pass `theme` prop to `RelayKitProvider`.

**Troubleshooting** *(ui__troubleshooting.md)* — common failures: `WagmiProviderNotFoundError` (duplicate wagmi versions), missing `QueryClientProvider` (duplicate tanstack/react-query versions), unstyled UI (missing `styles.css` import or CSS reset conflict), type incompatibility (duplicate peer deps), "Missing a valid wallet" (no wallet prop / missing WagmiProvider / duplicate wagmi-viem versions).

---

# 5. Changelog *(changelog.md — full file, 2903 lines, all entries below)*

Categories per entry: API, SDK, UI Kit, Hooks, Adapters. Table below is every dated entry in the file, condensed to one row per date with product areas and a short description; multiple sub-bullets under one date are semicolon-joined.

| Date | Areas | Summary |
|---|---|---|
| 2026-09-01 | API, UI Kit | Deprecated `GET /requests/:id/signature[/v2]` (use `includeProtocolData` + `getOrderId`); UI Kit 11.0.5 fee-label rename (Swap Cost, Platform Fee, Execution Cost, Deposit gas) |
| 2026-08-26 | API | `/authorize` rate limit now per (API key, wallet): 5/60s + 30/60s aggregate |
| 2026-08-25 | UI Kit, Adapters | UI Kit 11.0.4: Nightly/OKX replace Backpack for Eclipse; fix swap-completion showing provisional amount before terminal status; SVM adapter 21.0.3 skips unresolvable ALTs |
| 2026-08-20 | API | `POST /execute`: `executionOptions.referrer` now optional |
| 2026-08-19 | API | `GET /requests/v3`: `referrer` filter restored, requires paired `apiKey`, ownership-checked |
| 2026-08-14 | SDK, UI Kit | XRP route pricing pre-wallet-connect; `isDeadAddress` covers Tron/Zero/XRP — SDK 7.0.2, UI Kit 11.0.3 |
| 2026-08-13 | API | Same-chain Solana quotes now reject >1232 bytes at quote time; size gate reverts to raw 1232-byte limit (undoes 2026-07-09 60-byte reservation); new `subsidizationBps` param; new `SOLANA_TX_TOO_LARGE` errorCode |
| 2026-08-07 | API | `GET /intents/status/v3` gains `failReason`/`refundFailReason`; new `MANUAL_REFUND_REQUIRED` reason |
| 2026-08-06 | API | `GET /requests/v3` gains `apiKeyName` (gated) |
| 2026-08-04 | API, SDK, UI Kit | `GET /requests/v2` 429 gets route-specific body + deprecation headers (`Deprecation/Sunset/Link`) + body `deprecation` object; `GET /requests/v3` filters gain `null` operator; SDK 7.0.1 regenerated types; UI Kit 11.0.2 adds chains to Uniswap Wallet |
| 2026-08-03 | API, UI Kit | `GET /requests/v3` gains opt-in `includeTotal`; UI Kit 11.0.1 fixes Uniswap Wallet connector naming |
| 2026-07-30 | API | `GET /requests/v3` `data.route.actual.origin` now reflects real deposit on no-fill-attempted rows; TON `inTxs[].txHash` now bare hex |
| 2026-07-28 | API, UI Kit | Quote/price transient failures reclassified: `SERVICE_UNAVAILABLE`(503), `PRICE_FETCH_FAILED`(503), `UNSUPPORTED_CURRENCY`(400); `GET /requests/v3` elevated limit → 20rps; **UI Kit 11.0.0 major**: Dune→Codex balance migration (breaking: `duneConfig`→`codexConfig`, `useDuneBalances`→`useCodexBalances`, new `useSolanaBalance`, Soon chain dropped) |
| 2026-07-27 | API | Gasless `/execute` failures split into `TRANSACTION_SUBMISSION_FAILED` / `TRANSACTION_NOT_INCLUDED` |
| 2026-07-24 | UI Kit, Hooks | UI Kit 10.0.1: complete `RefundReason` mapping; graceful broken-logo fallback; UI Kit 10.0.1/Hooks 4.0.1 block token-contract addresses as recipient |
| 2026-07-22 | API | `GET /requests/v2` deprecated (sunset **2026-11-24**); recipient pre-quote validation (`INVALID_ADDRESS`/`INVALID_RECIPIENT`); `GET /requests/v3` introduced as recommended API |
| 2026-07-21 | SDK, UI Kit, Hooks | **SDK 7.0.0 / UI Kit 10.0.0 / Hooks 4.0.0 major**: migrate Requests API v2→v3 (breaking: response shape, `x-api-key` now required client-side via proxy, `inTxs[].hash`→`txHash`, `metadata.currencyIn/Out` removed, new `submitted` status, `secureBaseUrl` removed) |
| 2026-07-10 | UI Kit | Base wallet can no longer target Robinhood Chain — UI Kit 9.1.4 |
| 2026-07-09 | API | Solana deposit-tx size check reserves 60-byte compute-budget headroom (limit effectively 1172 bytes) |
| 2026-07-08 | SDK, UI Kit, Hooks, Adapters | Embed sourcemaps sourcesContent across SDK 6.1.3 / UI Kit 9.1.3 / Hooks 3.0.24 / adapters; UI Kit 9.1.3 hides non-deposit-address chains without wallet support |
| 2026-07-02 | API | `includeProtocolSignature` renamed `includeProtocolData` (breaking); `protocol.v2` gains `hubType`, `orderSignature` |
| 2026-06-30 | SDK, UI Kit, Adapters | Fix Bitcoin route pre-connect pricing — SDK 6.1.2; **SDK 6.1.0/UI Kit 9.1.0 minor**: TON support (`adaptTonWallet`, `tonvm`); TON adapter 1.0.0 |
| 2026-06-29 | SDK | `convertViemChainToRelayChain` refactor, no behavior change — SDK 6.0.1 |
| 2026-06-26 | SDK, UI Kit, Adapters | **SDK 6.0.0/UI Kit 9.0.0**: Sui support removed; native TRX call_value + sentinel-address fix |
| 2026-06-23 | API | `slippageTolerance`/`latePaymentSlippageTolerance` validated as 0–10000 bps integer strings (breaking); new `INVALID_SLIPPAGE_TOLERANCE` |
| 2026-06-19 | API | TON `GET /requests/v2` `inTxs[].hash` now bare hex; `GET /chains` exposes TON `explorerPaths.transaction` |
| 2026-06-17 | SDK, UI Kit | TON route pre-connect pricing — SDK 5.2.8; UI Kit 8.0.11 TON destination bridging |
| 2026-06-10 | API | Base reorg-detected deposits now correctly reported `failure` in `inTxs[]`; new `metadata.reorg` object |
| 2026-06-05 | API | Transient RPC failures reclassified `REQUEST_TIMED_OUT`/`RPC_HTTP_ERROR` (previously mis-tagged `DESTINATION_TX_FAILED`) |
| 2026-05-29 | API | Solana-origin aggregator quotes >1232 bytes now return 400 (breaking) |
| 2026-05-28 | API | Bitcoin-origin requests hit `pending` on mempool observation, not first confirmation |
| 2026-05-27 | API | `depositAddress` object gains `depositTxHash` |
| 2026-05-26 | API, UI Kit | Webhook `data` gains `details/failReason/refundFailReason`; UI Kit 8.0.10 switches CEX address list source |
| 2026-05-21 | API | Hyperliquid `/authorize` EIP-712 domain v1→v2, new `depositor` field (breaking for hand-rolled integrators) |
| 2026-05-20 | API | `/execute` raw-call simulation failures return decoded error label/message/details |
| 2026-05-15 | API | `failReason` gets specific values for reverted same-chain swaps / double-spend refunds; new `TRANSACTION_TOO_LARGE`, `SOLVER_BALANCE_TOO_LOW` |
| 2026-05-11 | SDK, UI Kit | Testnet websocket `wss://ws.testnets.relay.link` — SDK 5.2.7; UI Kit 8.0.9 withdraw-page link on fill failure |
| 2026-05-07 | API, UI Kit | Strict EXACT_OUTPUT deposit-address overpayment now fills quoted amount + separate refund leg (not scale-up); UI Kit 8.0.8 fixes Hyperliquid spot/perps USDC label collision |
| 2026-04-28 | API, UI Kit | Same-chain quotes <$0.05 now 400 `AMOUNT_TOO_LOW` (breaking, wraps/calls exempt); UI Kit 8.0.7 token-selector gap fix |
| 2026-04-24 | SDK, Adapters | New Lighter wallet adapter package — SDK 5.2.4; `disableCapabilitiesCheck` option added |
| 2026-04-21 | SDK | Atomic batching supports N leading approve steps (zero-reset flows) — SDK 5.2.3 |
| 2026-04-16 | SDK, UI Kit, Hooks | Deposit-address status gains `depositing` step; UI Kit 8.0.4 Hyperliquid unified-account balance routing |
| 2026-03-09 | UI Kit | Namespaced keyframes; `onHapticEvent` callback — UI Kit 8.0.3 |
| 2026-03-05 | UI Kit | **UI Kit 8.0.0 major**: Panda CSS → Tailwind CSS migration; CSS layer/tree-shake fixes |
| 2026-02-26 | Hooks, Adapters | Bitcoin adapter bumps bitcoinjs-lib; `useTokenPrice` default stale time — Hooks 3.0.11 |
| 2026-02-25 | SDK, UI Kit, Hooks | `useQuote`/widgets now throw `Error` objects not bare strings; unhandled promise rejection fixes — SDK 5.2.1, UI Kit 7.1.5, Hooks 3.0.10 |
| 2026-02-23 | SDK, UI Kit | **SDK 5.2.0 minor**: `executeGaslessBatch` action added (7702 flow) |
| 2026-02-19 | UI Kit, Adapters | Solana adapter validates base58 signature format — SVM adapter 17.0.2; multi-wallet dropdown for Hyperliquid |
| 2026-02-17 | SDK, UI Kit | `sameChainOption` in chain selector; max-amount execution buffer extended to SVM; Hyperliquid wallet-compat skip (AGW recipient exception); suggested tokens from API not local storage |
| 2026-02-10 | UI Kit, Hooks | Deposit-address tracking reads from Requests API — UI Kit 7.1.1, Hooks 3.0.7 |
| 2026-02-02 | SDK, UI Kit | **Breaking**: `useEOADetection` removed, replaced by `useExplicitDeposit` — SDK 5.1.0, UI Kit 7.1.0 |
| 2026-01-30 | SDK, UI Kit | New `fastFill` SDK action + types — SDK 5.0.3; widget fee breakdown uses `details.expandedPriceImpact` |
| 2026-01-21 | SDK, UI Kit | Every SDK request now sends `relay-sdk-version` header; custom logger support — SDK 5.0.2 |
| 2026-01-14 | SDK | Improved `SolverStatusTimeout` error log — SDK 5.0.1 |
| 2026-01-13 | UI Kit | Lighter EVM address lookup support — UI Kit 7.0.8 |
| 2026-01-12 | UI Kit | EOA-detection timeout raised 1s→2.5s — UI Kit 7.0.7 |
| 2026-01-08 | SDK, UI Kit, Hooks | **SDK 5.0.0 major**: `configureViemChain`/`configureDynamicChains`/`fetchChainConfigs` moved to `/chain-utils` subpath (bundle-size); Hooks 3.0.2 mirrors move |
| 2026-01-06 | SDK, UI Kit | `amount` param on `claimAppFees` — SDK 4.0.1; 0% slippage allowed — UI Kit 7.0.4 |
| 2025-12-19 | UI Kit | Clearer EOA logs — UI Kit 7.0.2 |
| 2025-12-18 | UI Kit | EOA-detection tracking — UI Kit 7.0.1 |
| 2025-12-17 | SDK, UI Kit, Hooks | **SDK 4.0.0/UI Kit 7.0.0/Hooks 3.0.0 major**: upgrade to `/quote/v2` API |
| 2025-12-15 | UI Kit, Adapters | Hyperliquid spot-coin balance fetching — UI Kit 6.1.1 |
| 2025-12-10 | SDK, UI Kit | Hyperliquid direct deposits integrated — SDK 3.2.0/UI Kit 6.1.0; `apiKey` param in `createClient` |
| 2025-12-02 | UI Kit | Dep fixes; stabilized ENS resolution & wallet selection — UI Kit 6.0.10 |
| 2025-11-25 | UI Kit | TokenWidget post-launch fixes — UI Kit 6.0.9 |
| 2025-11-24 | UI Kit | No-routes error handling fix — UI Kit 6.0.8 |
| 2025-11-21 | SDK, UI Kit | Lighter VM + destination txs — SDK 3.1.1/UI Kit 6.0.6; stabilized tab switches |
| 2025-11-20 | UI Kit | Mobile payment selector improvements — UI Kit 6.0.5 |
| 2025-11-19 | UI Kit | Mobile UX fix — UI Kit 6.0.4 |
| 2025-11-17 | UI Kit | Improved mobile actions — UI Kit 6.0.3 |
| 2025-11-12 | UI Kit | Token widget improvements — UI Kit 6.0.2 |
| 2025-11-11 | UI Kit | Broader gas top-up support — UI Kit 6.0.1 |
| 2025-11-07 | UI Kit | **UI Kit 6.0.0 major**: TokenWidget added |
| 2025-11-06 | UI Kit | New mobile token selector — UI Kit 5.1.2 |
| 2025-10-29 | SDK, UI Kit, Adapters | Tron adapter + balance logic — SDK 3.1.0/UI Kit 5.1.0/Tron adapter 1.0.0; mobile UI improvements |
| 2025-10-17 | SDK | `getQuote` accepts headers — SDK 3.0.1 |
| 2025-10-16 | UI Kit | Sponsored-tokens logic switched to `useSecureApi` — UI Kit 5.0.5 |
| 2025-10-13 | UI Kit | Fill-time display + formatting improvements — UI Kit 5.0.4 |
| 2025-10-06 | UI Kit | Starred chains feature — UI Kit 5.0.2/5.0.3 |
| 2025-10-02 | SDK, UI Kit | **SDK 3.0.0/UI Kit 5.0.0 major**: revamped transaction steps |
| 2025-10-01 | SDK, UI Kit | Tenderly error API fix — SDK 2.4.6; recent-address local storage, fill-time on success screen — UI Kit 4.0.19 |
| 2025-09-22 | SDK, UI Kit, Adapters | Bitcoin public key added to quote params — SDK 2.4.5/UI Kit 4.0.18/Bitcoin adapter 10.0.6; slippage UI refactor |
| 2025-09-19 | UI Kit | Remove protocol v2 threshold — UI Kit 4.0.16 |
| 2025-09-18 | UI Kit | Gas top-up copy/logic/UI updates — UI Kit 4.0.13–4.0.15 |
| 2025-09-17 | UI Kit | Protocol v2 threshold raised to $10k — UI Kit 4.0.13 |
| 2025-09-15 | UI Kit | Explicit-deposit fixes; protocolv2 threshold bump — UI Kit 4.0.10–4.0.12 |
| 2025-09-12 | UI Kit | Remove `explicitDeposit` param; remove gas-top-up re-enable on success — UI Kit 4.0.9 |
| 2025-09-11 | SDK, UI Kit | EOA detection added — SDK 2.4.4; logged-out quote fetch fix — UI Kit 4.0.6–4.0.8 |
| 2025-09-10 | Hooks | Fix base URL for `queryQuote` — Hooks 2.0.2 |
| 2025-09-09 | UI Kit | Fee-subsidization normalization fix — UI Kit 4.0.4 |
| 2025-09-05 | UI Kit | Button CTA font theming — UI Kit 4.0.3 |
| 2025-09-04 | SDK, UI Kit | Batching capabilities check updated for MetaMask — SDK 2.4.3; Porto wallet compat — UI Kit 4.0.2 |
| 2025-09-02 | UI Kit, Hooks | **UI Kit 4.0.0/Hooks 2.0.0 major**: React 19 upgrade |
| 2025-08-28 | UI Kit, Adapters | Protocol v2 gated on destination support — UI Kit 3.0.2; Bitcoin adapter 10.0.3 default sighash |
| 2025-08-27 | UI Kit | Gas-subsidization data tracking — UI Kit 3.0.1 |
| 2025-08-25 | SDK, UI Kit, Hooks, Adapters | Relay rebranding across packages — **UI Kit 3.0.0 major**, SDK 2.4.2, Hooks 1.13.0, several adapters 10.0.2/22.0.2/11.0.2 |
| 2025-08-21 | UI Kit | Modal gap fix on mobile — UI Kit 2.17.5 |
| 2025-08-20 | SDK, UI Kit, Hooks | Gas sponsorship functionality added — SDK 2.4.1/UI Kit 2.17.4/Hooks 1.12.1 |
| 2025-08-19 | UI Kit | Always show price impact — UI Kit 2.17.3 |
| 2025-08-15 | UI Kit | Re-enable Solana for protocol v2 — UI Kit 2.17.2 |
| 2025-08-14 | UI Kit | Disable protocol v2 on Solana — UI Kit 2.17.1 |
| 2025-08-12 | SDK, UI Kit, Hooks, Adapters | **Minor**: websocket support + `executeSteps` refactor — SDK 2.4.0/UI Kit 2.17.0/Hooks 1.12.0/Bitcoin adapter 10.0.0/Ethers adapter 22.0.0/SVM adapter 11.0.0 |
| 2025-08-08 | UI Kit | Prefer-v2 threshold to $100 — UI Kit 2.16.2 |
| 2025-08-07 | UI Kit | Revert overflow fix — UI Kit 2.16.1 |
| 2025-08-06 | UI Kit | Token amount overflow fix, Hyperliquid wallet compat, protocolv2 USD threshold bump — UI Kit 2.16.0 |
| 2025-08-05 | UI Kit | `refundTo` for HL withdrawals — UI Kit 2.15.11 |
| 2025-08-01 | SDK, UI Kit | Hyperliquid USD send functionality — SDK 2.3.2/UI Kit 2.15.10 |
| 2025-07-29 | SDK, UI Kit | Protocol v2 enabled programmatically per chain — SDK 2.3.1/UI Kit 2.15.9 |
| 2025-07-28 | UI Kit, Hooks | Trending tokens in selector; more protocolv2 chains — UI Kit 2.15.8/Hooks 1.11.1 |
| 2025-07-25 | UI Kit | More protocol v2 chains — UI Kit 2.15.7 |
| 2025-07-24 | UI Kit | Accessibility fixes; protocol v2 chains added — UI Kit 2.15.6 |
| 2025-07-22 | UI Kit | Enable prefersV2 for Ethereum/Polygon/BNB/OP/zkSync — UI Kit 2.15.5 |
| 2025-07-17 | UI Kit | Re-enable prefers-protocolv2 subset — UI Kit 2.15.4 |
| 2025-07-14 | Adapters | `payerKey` option for gas payer — SVM adapter 10.0.1 |
| 2025-07-11 | UI Kit | Disable protocol v2 usage — UI Kit 2.15.3 |
| 2025-07-10 | UI Kit | Enable prefersV2 for Avalanche/Unichain/Gnosis; disable gas top-up by default — UI Kit 2.15.1/2.15.2 |
| 2025-07-09 | SDK, UI Kit, Hooks, Adapters | **Minor**: viem upgrade to ≥2.26.0 — SDK 2.3.0/UI Kit 2.15.0/Hooks 1.11.0/adapters 9.0.0/10.0.0; Blast protocol v2 custom logic — SDK 2.2.0/UI Kit 2.14.0 |
| 2025-06-27 | UI Kit | Missing-token-price warning + alert styling — UI Kit 2.13.3 |
| 2025-06-24 | UI Kit | Hide gas-token badge for Hyperliquid USDC — UI Kit 2.13.2 |
| 2025-06-20 | SDK, UI Kit | `getAppFees`/`claimAppFees` actions added — SDK 2.1.3; destination-wallet alert fix, `themeScheme` for SSR — UI Kit 2.13.0 |
| 2025-06-18 | UI Kit, Hooks | Switch to Dune Sim API for balances; UX/USD fee display polish — UI Kit 2.12.0/Hooks 1.10.4 |
| 2025-06-13 | SDK, UI Kit, Hooks | Endpoint updates; HypeEVM destination vmtype; UI polish — SDK 2.1.2/UI Kit 2.11.3/Hooks 1.10.2/1.10.3 |
| 2025-06-05 | SDK, UI Kit | Configurable polling interval + RPC config — SDK 2.1.1/UI Kit 2.11.2 |
| 2025-06-04 | SDK, UI Kit, Hooks | Dedupe request IDs; same-chain swap receipt optimization — SDK 2.1.0/UI Kit 2.11.0/Hooks 1.10.0 |
| 2025-05-31 | UI Kit | Fix tx confirmation error-screen bug — UI Kit 2.10.12 |
| 2025-05-29 | UI Kit | 0.01% slippage floor; eclipse RPC for balances — UI Kit 2.10.11 |
| 2025-05-27 | UI Kit | Suggested-token-pill width, token-selector scroll fixes — UI Kit 2.10.10 |
| 2025-05-22 | SDK, UI Kit | `DEPOSIT_SUCCESS` pending-status check — SDK 2.0.3/UI Kit 2.10.9 |
| 2025-05-21 | SDK, UI Kit | Sync API types — SDK 2.0.2; suggested-token logoUrl / ME wallet compat fixes — UI Kit 2.10.7/2.10.8 |
| 2025-05-16 | SDK, UI Kit, Hooks, Adapters | Lock viem to patch-only — SDK 2.0.1/UI Kit 2.10.6/Hooks 1.9.11/adapters 6.0.1/18.0.1/7.0.1; quote-error status/gas-top-up copy |
| 2025-05-13 | SDK, UI Kit, Adapters | **Breaking (SDK 2.0.0)**: `getQuote` optionally includes defaults; matching Ethers adapter 18.0.0 breaking change; receipt/gas-top-up bigint fixes — UI Kit 2.10.4/2.10.5 |
| 2025-05-09 | UI Kit | Fix event race condition — UI Kit 2.10.3 |
| 2025-05-08 | UI Kit | `quote_request_id`/`quote_id` fixes — UI Kit 2.10.1/2.10.2 |
| 2025-05-07 | SDK, UI Kit | Analytics events overhaul — SDK 1.8.0/UI Kit 2.10.0; 15-min hash regen, quote refresh on modal close |
| 2025-05-01 | SDK, UI Kit, Adapters | Sui wallet adapter added; ESM/address-comparison fixes — SDK 1.7.4/UI Kit 2.9.14/SVM adapter 5.0.4 |
| 2025-04-30 | SDK, UI Kit, Hooks | Custom logger override; `quoteRequestId`; analytics improvements — SDK 1.7.3/UI Kit 2.9.13/Hooks 1.9.6 |
| 2025-04-28 | SDK, UI Kit | Add-Ethereum-chain error fixes; estimated USD before quote — SDK 1.7.2/UI Kit 2.9.12 |
| 2025-04-24 | SDK, UI Kit | RPC fallback mechanism; suggested-token logoURI sync — SDK 1.7.1/UI Kit 2.9.11 |
| 2025-04-22 | SDK, UI Kit, Hooks | **Minor**: gas top-up functionality — SDK 1.7.0/UI Kit 2.9.10/Hooks 1.9.3 |
| 2025-04-18 | SDK, UI Kit, Hooks | Additional refund-reason messaging; Ronin wallet compat; new Dune SVM balance API — SDK 1.6.15/UI Kit 2.9.9/Hooks 1.9.2 |
| 2025-04-14 | UI Kit | Reset widget after success; AGW tx rejection handling — UI Kit 2.9.8 |
| 2025-04-10 | SDK, UI Kit | `endpoint` added to `APIError`; chain-scroll fixes — SDK 1.6.14/UI Kit 2.9.6/2.9.7 |
| 2025-04-09 | UI Kit | Prevent AGW receiving incompatible funds — UI Kit 2.9.5 |
| 2025-04-07 | UI Kit | Token-symbol overflow fix; `privateChainIds` provider option — UI Kit 2.9.4 |
| 2025-04-04 | UI Kit | `useCurrencyBalance` hook bug fix — UI Kit 2.9.3 |
| 2025-04-03 | UI Kit | Token-selector analytics + undefined-token fix — UI Kit 2.9.2 |
| 2025-04-02 | SDK, UI Kit, Hooks | **Breaking**: `useTokenLists`→`/currencies/v2`; token-selector redesign (removed chain selector, `defaultToToken/defaultFromToken`; added `toToken/setToToken`, `fromToken/setFromToken`, `disableInputAutoFocus`, `popularChainIds`) — SDK 1.6.13/UI Kit 2.9.0/2.9.1/Hooks 1.9.0 |
| 2025-03-31 | UI Kit | Dune API config refactor; disable-paste-address option; conversion-rate fix — UI Kit 2.8.0 |
| 2025-03-25 | SDK | Fix HyperEVM chain config — SDK 1.6.12 |
| 2025-03-21 | SDK, UI Kit | API type sync, React 19 type fixes — SDK 1.6.11/UI Kit 2.7.18 |
| 2025-03-20 | SDK, UI Kit | Sui VM support — SDK 1.6.10/UI Kit 2.7.16; onramp robustness; deposit-address QR always shown — UI Kit 2.7.17 |
| 2025-03-18 | UI Kit | Uniswap wallet compat; max-capacity error-message fix — UI Kit 2.7.15 |
| 2025-03-17 | SDK, UI Kit, Hooks | Static version-bundling scripts; custom block-explorer tx-page handling — SDK 1.6.9/UI Kit 2.7.14/Hooks 1.8.5; deposit-address logic and VM-switch fixes |
| 2025-03-13 | SDK, UI Kit | Update Tron dead address — SDK 1.6.8; chain-select analytics, approval-tx display, dup price-impact warning fix — UI Kit 2.7.11–2.7.13 |
| 2025-03-10 | SDK, UI Kit, Hooks | Tron support — SDK 1.6.7/UI Kit 2.7.9; sender dead-address fix — SDK 1.6.6; tvm filter fix — UI Kit 2.7.10 |
| 2025-03-07 | SDK, UI Kit | Tenderly-based tx-confirmation error enhancement — SDK 1.6.5; TransactionModal freshness fix — UI Kit 2.7.6/2.7.7 |
| 2025-03-05 | UI Kit | Dune token API chain-id update; consolidated tx flow (removed Review Quote step) — UI Kit 2.7.5 |
| 2025-03-04 | UI Kit | Suggested/default-token fixes; wallet-compat + abstract-address detection — UI Kit 2.7.3/2.7.4 |
| 2025-02-26 | UI Kit | Slippage-tolerance logic for remote swaps — UI Kit 2.7.2 |
| 2025-02-25 | SDK, UI Kit, Hooks | Config option to omit gas-fee estimates — SDK 1.6.4; **UI Kit 2.7.0/Hooks 1.8.0 minor**: removed `usePrice`/`queryPrice`/`PriceResponse` |
| 2025-02-24 | SDK, UI Kit | Confirmation error handling — SDK 1.6.3/UI Kit 2.6.11 |
| 2025-02-21 | UI Kit | Same-chain slippage display fix; slippage-config component added — UI Kit 2.6.8–2.6.10 |
| 2025-02-20 | UI Kit | Hide fiat-currency selector; onramp `onTokenChange` callback — UI Kit 2.6.6/2.6.7 |
| 2025-02-19 | SDK, UI Kit | API-type sync, MoonPay id; solver-status-timeout UI split — SDK 1.6.2/UI Kit 2.6.3; onramp bug fixes — UI Kit 2.6.3–2.6.5 |
| 2025-02-12 | UI Kit | Default chain-icons fix — UI Kit 2.6.2 |
| 2025-02-11 | UI Kit | Onramping-input bug fixes — UI Kit 2.6.1 |
| 2025-02-10 | UI Kit, Hooks | **Minor**: `OnrampWidget` + `useTokenPrice` hook — UI Kit 2.6.0/Hooks 1.7.0 |
| 2025-01-24 | UI Kit | Radix-dialog update; `slippageTolerance` widget prop; theme/recipient fixes — UI Kit 2.5.2–2.5.4 |
| 2025-01-22 | SDK | Post same-chain tx to solver, fixing status-timeout errors — SDK 1.6.1 |
| 2025-01-21 | SDK, UI Kit, Hooks, Adapters | **Minor**: batch-transaction / EIP-5792 support — SDK 1.6.0/UI Kit 2.5.0/Hooks 1.6.0/Bitcoin adapter 3.0.0/Ethers adapter 15.0.0/SVM adapter 4.0.0 |
| 2025-01-15 | SDK, UI Kit, Hooks, Adapters | **Minor**: viem peer-dep upgrade — SDK 1.5.0/UI Kit 2.4.0/Hooks 1.5.0/Bitcoin adapter 2.0.0/Ethers adapter 14.0.0/SVM adapter 3.0.0 |
| 2025-01-10 | UI Kit | Approve+swap UX flow — UI Kit 2.3.10 |
| 2025-01-09 | UI Kit | Analytics error-data extraction, `quote_error` fixes — UI Kit 2.3.8/2.3.9 |
| 2025-01-08 | UI Kit, Hooks | `quote_error` event; token-selector height fix — UI Kit 2.3.7/Hooks 1.4.16 |
| 2025-01-07 | SDK, UI Kit | Pre-tx chain-id check robustness; dead-address burn fix — SDK 1.4.10/UI Kit 2.3.6 |
| 2025-01-03 | SDK, UI Kit, Adapters | Expose instructions in signature function — SDK 1.4.9/SVM adapter 2.0.9; token-selector optimization/overflow fixes — UI Kit 2.3.5 |
| 2024-12-20 | Hooks | Fix `useRequests` base URL — Hooks 1.4.13 |
| 2024-12-19 | UI Kit | Token-selector dimension/breakpoint update; slippage UI fixes — UI Kit 2.3.3 |
| 2024-12-18 | UI Kit | Token-selection bugs (lockChainId/restrictedTokens); switch-wallet event data — UI Kit 2.3.2 |
| 2024-12-16 | UI Kit, Hooks | `usePrice` hook optimization (skip invalid canonical routes) — UI Kit 2.3.1/Hooks 1.4.12 |
| 2024-12-12 | UI Kit, Hooks | **Minor**: Deposit Address fallback functionality — UI Kit 2.3.0/Hooks 1.4.11 |
| 2024-12-10 | SDK, UI Kit | TS error fix in `RelayChain` — SDK 1.4.8; slippage-UI restore, same-chain selection — UI Kit 2.2.27/2.2.28 |
| 2024-12-04 | UI Kit | Slippage UI temporarily hidden then fixed; slippage details on review screen — UI Kit 2.2.24–2.2.26 |
| 2024-12-03 | UI Kit | `onSwapValidating` callback; success-screen tx-data source fix — UI Kit 2.2.23 |
| 2024-11-22 | UI Kit | New theme tokens/section ids; custom-address undefined-chain fix — UI Kit 2.2.22 |
| 2024-11-12 | SDK, UI Kit | Zero-address-for-zero-chain fix — SDK 1.4.7; dead-address/quote-error/price-impact fixes — UI Kit 2.2.20/2.2.21 |
| 2024-11-11 | UI Kit | Single-chain-mode route-selector cleanup; connector-list override — UI Kit 2.2.17–2.2.19 |
| 2024-11-07 | SDK, UI Kit, Hooks, Adapters | Eclipse SVM support — SDK 1.4.6/UI Kit 2.2.15/SVM adapter 2.0.6; single-chain-mode widget — UI Kit 2.2.16; `usePrice` error-handling fix — Hooks 1.4.8 |
| 2024-11-04 | SDK, UI Kit | Suggested tokens in selector; max-capacity fix — SDK 1.4.5/UI Kit 2.2.14 |
| 2024-11-01 | Adapters | **Minor**: new Solana adapter, abstract-txs adapted-wallet — SVM adapter 1.0.0 |
| 2024-10-31 | SDK, UI Kit | Wallet-switch error handling; max-capacity fallback parsing — SDK 1.4.4/UI Kit 2.2.13 |
| 2024-10-30 | SDK, UI Kit | Solana dead-address update — SDK 1.4.3; unverified-token setting removed; token-uri fallback styling — UI Kit 2.2.10–2.2.12 |
| 2024-10-29 | SDK, UI Kit | Unverified-token support — SDK 1.4.2/UI Kit 2.2.9; Bitcoin pending-balance display |
| 2024-10-28 | UI Kit | Bitcoin time-estimate doubled; selector-theme optional; canonical disclaimer; 0-price-impact fix — UI Kit 2.2.6–2.2.8 |
| 2024-10-24 | UI Kit, Hooks | Parallel quoting fix; Bitcoin address validation (taproot/base58); price+quote fetched in parallel — UI Kit 2.2.2–2.2.5/Hooks 1.4.2 |
| 2024-10-23 | SDK, UI Kit | Bitcoin implementation bug fixes — SDK 1.4.1/UI Kit 2.2.1 |
| 2024-10-22 | SDK, UI Kit, Adapters, Hooks | **Minor**: Bitcoin support — SDK 1.4.0/UI Kit 2.2.0/Bitcoin adapter 1.0.0; remove auto-refresh in `useQuote` — Hooks 1.4.0 |
| 2024-10-21 | UI Kit | Keyboard navigation in token selector — UI Kit 2.1.9 |
| 2024-10-18 | UI Kit | Input/output amount added to max-capacity event — UI Kit 2.1.8 |
| 2024-10-17 | SDK, UI Kit | `exact_output`→`expected_output` tradeType rename — SDK 1.3.4/UI Kit 2.1.7; canonical-selector UX fix |
| 2024-10-14 | UI Kit | Price-impact / no-instant-liquidity UX — UI Kit 2.1.5 |
| 2024-10-10 | UI Kit | Canonical-fallback UX improvements — UI Kit 2.1.4 |
| 2024-10-04 | UI Kit | Disabled-token-selector styling; hardcoded canonical currencies removed — UI Kit 2.1.2/2.1.3 |
| 2024-10-03 | UI Kit | **Minor**: canonical+ support in SwapWidget, ChainWidget removed — UI Kit 2.1.0/2.1.1 |
| 2024-09-24 | SDK, UI Kit | switchChain missing-chain fix — SDK 1.3.3; token-selector-balance / modal-close fixes — UI Kit 2.0.7/2.0.8 |
| 2024-09-20 | UI Kit | Solana + multi-wallet-dropdown UI patches; custom-address-modal fixes — UI Kit 2.0.4/2.0.5 |
| 2024-09-19 | SDK, UI Kit | Wallet-switch fix in ChainWidget, viem-chain conversion helper fix — SDK 1.3.2/UI Kit 2.0.3; Solana max-buffer/balance-cache fixes — UI Kit 2.0.1–2.0.3 |
| 2024-09-18 | SDK, UI Kit | **UI Kit 2.0.0 major**: Solana UI support in SwapWidget — SDK 1.3.1/UI Kit 2.0.0 |
| 2024-09-16 | UI Kit | High-price-impact copy improvement — UI Kit 1.4.1 |
| 2024-09-12 | SDK, UI Kit, Hooks, Adapters | **Minor**: abstract txs in Adapted Wallet + new Solana adapter — SDK 1.3.0/UI Kit 1.4.0/Hooks 1.3.0/Ethers adapter 12.0.0 |
| 2024-09-10 | SDK, UI Kit | Expanded SVM-chain address support — SDK 1.2.2/UI Kit 1.3.20; modal close-button fixes |
| 2024-09-06 | UI Kit | Chain-selector UX tweaks — UI Kit 1.3.19 |
| 2024-09-05 | UI Kit | High-price-impact warning logic; widget padding/shadow — UI Kit 1.3.18 |
| 2024-09-03 | UI Kit | Conversion-rate formatting fix; overflow fix; no-custom-address Solana quotes — UI Kit 1.3.16/1.3.17 |
| 2024-08-30 | UI Kit | Chain-displayName search fix; CTA update; token-selector fixes — UI Kit 1.3.14/1.3.15 |
| 2024-08-29 | UI Kit | Chain-filter fixes; default token list; chain-selector improvements — UI Kit 1.3.10–1.3.13 |
| 2024-08-28 | SDK, UI Kit, Hooks, Adapters | New swap-widget UI — SDK 1.2.1/UI Kit 1.3.9/Hooks 1.2.4/Ethers adapter 11.0.1 |
| 2024-08-23 | SDK, UI Kit | Better in-flight-tx handling, refund-status polling — SDK 1.2.0/UI Kit 1.3.8 |
| 2024-08-21 | SDK | `getPrice` action added — SDK 1.1.2 |
| 2024-08-20 | UI Kit | Analytics fix, Solana balance/token-selector updates — UI Kit 1.3.3–1.3.6 |
| 2024-08-14 | SDK, UI Kit | API-type update — SDK 1.1.1; conversion-rate decimals, block-explorer link, UX polish — UI Kit 1.3.2 |
| 2024-08-09 | UI Kit | Solana deposits in SwapWidget — UI Kit 1.3.1 |
| 2024-08-07 | UI Kit, Hooks | **Minor**: upgrade `/requests`→`/requests/v2` — UI Kit 1.3.0/Hooks 1.2.0 |
| 2024-08-06 | SDK, UI Kit, Hooks | **Minor**: switch execute/swap→quote API — SDK 1.1.0/UI Kit 1.2.0/Hooks 1.1.0 |
| 2024-08-02 | SDK, UI Kit | `iconUrl` chain-icon override — SDK 1.0.13/UI Kit 1.1.18; price-impact warning added |
| 2024-07-31 | UI Kit | Safari modal-flicker fix; `defaultExternalChainToken` — UI Kit 1.1.17 |
| 2024-07-29 | SDK | `supportsBridging` added to RelayChain; API-type sync — SDK 1.0.11/1.0.12 |
| 2024-07-25 | UI Kit, Hooks | Chain-widget testnet config fix; swap-widget CTA fix — UI Kit 1.1.12–1.1.14/Hooks 1.0.16 |
| 2024-07-23 | UI Kit | Decouple Dune balance loading from token selector — UI Kit 1.1.11 |
| 2024-07-22 | SDK, UI Kit, Hooks, Adapters | Review-quote step; `usePrice` hook added — SDK 1.0.10/UI Kit 1.1.10/Hooks 1.0.15/Ethers adapter 9.0.10 |
| 2024-07-18 | UI Kit | Dropdown hover-color fix — UI Kit 1.1.9 |
| 2024-07-15 | SDK, UI Kit | Better action contextualization; `blockProductionLagging` on RelayChain — SDK 1.0.9/UI Kit 1.1.8 |
| 2024-07-10 | UI Kit | Canonical-selection reset; tx-hash/validating events — UI Kit 1.1.4–1.1.7 |
| 2024-07-09 | SDK, UI Kit | JSON-error-spread fix in `executeSteps` — SDK 1.0.8; canonical success screen — UI Kit 1.1.3 |
| 2024-07-03 | UI Kit | ChainWidget canonical functionality — UI Kit 1.1.2 |
| 2024-07-01 | SDK, UI Kit, Hooks | Tests + global axios fix — SDK 1.0.7/Hooks 1.0.12; **UI Kit 1.1.0 minor**: SwapWidget refactor + new ChainWidget |
| 2024-06-26 | Hooks | `useQuote` source fixes — Hooks 1.0.10/1.0.11 |
| 2024-06-25 | UI Kit | Pass `source` in widget — UI Kit 1.0.14 |
| 2024-06-20 | SDK, UI Kit | Faster post-tx polling — SDK 1.0.6/UI Kit 1.0.13; Coinbase-wallet capabilities-check fix |
| 2024-06-19 | UI Kit | Swap-time icon color; hide balance column when disconnected; capabilities disabled except Coinbase — UI Kit 1.0.12 |
| 2024-06-18 | SDK, UI Kit, Hooks | Move chain-id check later in flow — SDK 1.0.5/UI Kit 1.0.11/Hooks 1.0.8; locked-token-selector color, powered-by-logo, `onSuccess/onError` callbacks |
| 2024-06-14 | SDK, UI Kit | Pass `request` into `execute` — SDK 1.0.4; same-currency-different-recipient swap; provider-init fix — UI Kit 1.0.8 |
| 2024-06-13 | SDK, UI Kit, Hooks | Lodash import optimization — SDK 1.0.3; app-fee breakdown UI, icon/input fixes, token-search filter — UI Kit 1.0.7; `useRelayConfig` hook — Hooks 1.0.5 |
| 2024-06-12 | SDK, UI Kit, Hooks, Adapters | Strip layers from stylesheet — SDK 1.0.2/UI Kit 1.0.5/Hooks 1.0.4/Ethers adapter 9.0.2; app name/fees in provider; peer-dep fixes (tanstack, wagmi); ESM import fixes |
| 2024-06-11 | SDK, UI Kit, Hooks, Adapters | Deploy-script fix — 1.0.1 patches; **major 1.0.0**: SDK/UI Kit/Hooks refactor + ui packages, Ethers adapter |
| 2024-05-28 | SDK | **Minor**: migrate to v2 of call/bridge API — SDK 0.7.0 |
| 2024-05-24 | SDK | `txs` first-class param in swap action; swap+extra-call txs — SDK 0.6.1/0.6.2 |
| 2024-05-23 | SDK | `getSolverCapacity` upgraded to config-v2 API; square Relay-Chain icons; methods moved to `actions`; progress state; typed fee-execute types — SDK 0.6.0 |
| 2024-05-21 | SDK | Post deposit txs to solver; quote-method return-type fix — SDK 0.5.4 |
| 2024-05-15 | SDK | Internal tx-hash chain-id fix — SDK 0.5.3 |
| 2024-05-14 | SDK, Adapters | Await tx receipt for tx steps — SDK 0.5.2; swap action + `getSwapQuote` — SDK 0.5.1/Ethers adapter 6.0.1; **Minor**: Swap SDK action — SDK 0.5.0 |
| 2024-04-22 | SDK | **Minor**: improved `onProgress` callback — SDK 0.4.0 |
| 2024-04-18 | SDK | API-type sync + `useExactInput` demo param — SDK 0.3.10 |
| 2024-04-09 | SDK | Remove `requestId` from `Execute` type — SDK 0.3.9 |
| 2024-04-04 | SDK | Skip check object for canonical bridges — SDK 0.3.8 |
| 2024-04-03/02/01 | SDK | API-type syncs; `currencyId` added to RelayChain — SDK 0.3.4–0.3.7 |
| 2024-03-19 | SDK | Handle `inTxHashes` for signature step items — SDK 0.3.3 |
| 2024-03-15 | SDK | `isValidatingSignature` added to step item — SDK 0.3.2 |
| 2024-03-12 | SDK | API-type sync, `erc20Currencies` on RelayChain — SDK 0.3.1 |
| 2024-03-08 | SDK | **Minor**: bridge action uses new bridge API + USDC support — SDK 0.3.0; rainbow-wallet null-txHash fix |
| 2024-03-04 | SDK | Dedup call/bridge action types; route breakdown in `onProgress`; remove tx-intent-trigger call — SDK 0.2.5 |
| 2024-02-29 | SDK | API-type sync; README added — SDK 0.2.4 |
| 2024-02-27 | SDK | Wallet param made optional for quote methods — SDK 0.2.3 |
| 2024-02-26 | SDK | `gasLimit` param for deposit txs; `currentStep`/`currentStepItem` in `onProgress` — SDK 0.2.2 |
| 2024-02-22 | SDK | `getSolverCapacity`/`getCallQuote`/`getBridgeQuote` methods — SDK 0.2.1 |
| 2024-02-14 | SDK, Adapters | **Minor**: mismatched-chain handling pre-execution — SDK 0.2.0/Ethers adapter 3.0.0; simplified bridge action |
| 2024-02-13 | SDK, Adapters | **Minor**: wagmi/viem/rainbowkit v2 upgrade — SDK 0.1.0/Ethers adapter 2.0.0; automatic source detection |
| 2024-02-09 | SDK | Source-attribution param on call action — SDK 0.0.13 |
| 2024-02-05 | SDK, Adapters | Chain-conversion fallback logic — SDK 0.0.12; **Major**: Relay SDK Ethers wallet adapter — Ethers adapter 1.0.0 |

---

## Notable cross-cutting facts / gotchas worth flagging to the conductor

- **API v2 sunset**: `GET /requests/v2` deprecated 2026-07-22, retiring **2026-11-24** — anything in Suwappu's api-ts using v2 Requests should migrate to `/requests/v3` before then (`references__api__api_guides__migrating-to-requests-v3` was in the crawl but not required reading for this digest; flagging since it's directly actionable).
- `GET /requests/v3` and the Hooks/UI kit's `useRequests` **require `x-api-key`** and must be proxied server-side — never call from browser code with a raw key.
- Relay Chain ID is **537713**; Depository contract address is uniform (`0x4cd0...bc31`) across most EVM chains but **not** Cronos/Metis/Mantle/Linea (`0x5991...ecca`) — worth a guard if Suwappu hardcodes a single Depository address.
- Solana deposit-tx size limit (1232 bytes wire limit) has changed behavior twice in 2026 (2026-07-09 reserved headroom, 2026-08-13 reverted) — if Suwappu builds Solana deposit txs client-side, check current behavior against the live docs, not this snapshot.
