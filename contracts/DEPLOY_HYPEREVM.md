# Deploying the Suwappu primitives to HyperEVM

Why HyperEVM: we own the whole execution path and the fee take (TimeCurve sink,
vault spread) with **zero external protocol dependencies** — the primitives import
nothing (no Chainlink, no Superfluid, no aggregators), so the only trust surface
is Hyperliquid itself. Permissionless: no HIP, no HYPE stake, no auction.

Background and the HIP-3/HIP-4 landscape: `docs/research/hyperliquid-hip4-primitives.md`.

## Chain facts

| | Testnet | Mainnet |
|---|---|---|
| Chain ID | 998 | 999 |
| RPC | `https://rpc.hyperliquid-testnet.xyz/evm` | `$HYPEREVM_RPC_URL` (default `https://rpc.hyperliquid.xyz/evm`) |
| Gas token | HYPE (testnet faucet via app.hyperliquid-testnet.xyz) | HYPE |
| EVM | Cancun-compatible — our EIP-1153 `tstore`/`tload` guards work | same |

Foundry aliases (in `foundry.toml`): `hyperevm_testnet`, `hyperevm_mainnet`.

## Native HyperCore layer

`contracts/hypercore/` is our verified-against-docs integration layer:
- `L1Read.sol` — read precompiles 0x800-0x810 (positions, spot balances, vault
  equity, prices, BBO, margin summary, coreUserExists). Wire decimals documented
  in the header; values match HyperCore state at EVM block construction.
- `CoreWriterLib.sol` — typed CoreWriter actions (limit order, spot send, vault
  transfer, staking, borrow/lend #15, outcome ops #17, builder fee, cancels).
  Wire format `[version=1][uint24 action id][abi.encode(fields)]`, locked by
  `test/HyperCoreTest.t.sol`.
- **Design rule**: CoreWriter actions are ASYNC (executed on HyperCore seconds
  later; a rejected action does not revert the EVM tx). Native contracts must be
  two-phase — act, then verify via L1Read in a later block. Never assume an
  order filled in the tx that placed it.

## Gotcha 1: big blocks

HyperEVM has dual blocks: small (~1s, 3M gas) and big (~1min, 30M gas). Contract
deployments generally exceed the small-block gas cap. The **deployer address** must
flip itself to big blocks first — this is a HyperCore L1 action, not an EVM tx:

- Action: `{"type": "evmUserModify", "usingBigBlocks": true}` signed by the deployer
  key, sent to the HyperCore API (`https://api.hyperliquid.xyz/exchange`, or
  `api.hyperliquid-testnet.xyz` for testnet).
- We already have signing infra for HyperCore L1 actions in
  `bot/services/hyperliquid_signing.py` / `hyperliquid_client.py` — reuse it.
- The deployer must have an initiated HyperCore account (send it any dust on
  HyperCore first, or use a key that has traded).
- Flip back (`usingBigBlocks: false`) after deploying if the key will also send
  normal txs — big blocks confirm in ~1 minute.

## Gotcha 2: constructor asset addresses must be HyperEVM-native

The deploy scripts are chain-agnostic; only the env-var addresses change:

- `CURVE_RESERVE` — an ERC-20 **on HyperEVM** (≤18 decimals, standard transfer
  semantics). Candidates: wrapped HYPE (WHYPE) or a HyperEVM-native stable.
  Do NOT reuse Base addresses.
- `VAULT_COLLATERAL_4626` — a **vetted** ERC-4626 on HyperEVM. Its share price is
  the vault's oracle (see `MAINNET_READINESS.md`). No suitable vetted 4626 on
  HyperEVM yet ⇒ don't deploy the vault yet; the primitives are independent.
- `SuwappuMutualCredit` — no constructor params; deployable as-is.

## Deploy (testnet first)

```bash
export PATH="$PATH:/root/.foundry/bin"
cd contracts
export DEPLOYER_PRIVATE_KEY=0x...   # funded with testnet HYPE, big blocks ON

# MutualCredit (no params)
forge script deploy/DeployPrimitives.s.sol:DeployMutualCredit \
  --rpc-url hyperevm_testnet --broadcast -vvvv

# TimeCurve (set CURVE_* env vars per DeployPrimitives.s.sol header,
# with a HyperEVM-native CURVE_RESERVE)
forge script deploy/DeployPrimitives.s.sol:DeployTimeCurve \
  --rpc-url hyperevm_testnet --broadcast -vvvv
```

Verification: Etherscan v2 multichain API is configured (`ETHERSCAN_API_KEY`,
chains 998/999, hyperevmscan.io front-end). Blockscout fallback:
`--verifier blockscout --verifier-url https://hyperliquid.cloud.blockscout.com/api`
(check current instance URL before relying on it). Sourcify also supports 999.

Record every deployment in `DEPLOYMENTS.md` (address, params, deployer, explorer link).

## Mainnet gate (do not skip)

1. `MAINNET_READINESS.md` still applies: no independent audit / bounty yet.
2. Testnet soak on 998 with real interactions through the bot.
3. MONEY-PATH review (`money-path-reviewer`) on the full deploy diff + params.
4. Params are **immutable forever** — triple-check WAD values before broadcast.
5. Deployer key handling per `SECURITY.md`; ownership n/a (contracts are unowned).
