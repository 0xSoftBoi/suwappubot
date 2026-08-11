# @suwappu/primitives-client

Typed [viem](https://viem.sh) client for the immutable Suwappu on-chain primitives:

- **SuwappuTimeCurve** — time-locked continuous bonding curve
- **SuwappuAmortizingVault** — self-repaying collateralized position
- **SuwappuMutualCredit** — bilateral credit lines + multilateral netting

It ships the ABIs, the current deployment addresses, and a small factory that wraps
every read and every state-changing call. No dependency on the Solidity source —
just viem.

## Usage

```ts
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { createSuwappuClient, baseSepoliaDeployment } from "@suwappu/primitives-client";

const publicClient = createPublicClient({ chain: baseSepolia, transport: http() });
const client = createSuwappuClient({ publicClient, addresses: baseSepoliaDeployment });

// reads (no wallet needed)
await client.curve.spotPrice();
await client.curve.quoteBuy(10n ** 18n);
await client.vault.debtOf(0n);
await client.credit.owedBy(debtor, creditor, token);

// writes (pass a walletClient)
const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http() });
const w = createSuwappuClient({ publicClient, walletClient, addresses: baseSepoliaDeployment });

await w.token.approve(baseSepoliaDeployment.reserveAsset, w.curve.address); // approve reserve
await w.curve.buy(10n ** 18n, maxReserveIn); // deadline defaults to max; pass one to bound MEV
```

`computeLineKey(a, b, token)` mirrors the contract's `lineKey` off-chain (sorted
pair → keccak256) so you can address credit lines without an RPC round-trip.

## Tests

Integration tests run against the **live Base Sepolia** deployment. They use the
`node:test` API so they run under either runner:

```bash
bun test                 # normal environments (direct network)
bun run test:node        # via node --import tsx (needed behind a TLS-terminating
                         # proxy; set NODE_USE_ENV_PROXY=1 so fetch honors HTTPS_PROXY)
```

Read paths need no key. To exercise the write path (a real `buy()`), set a funded
`TEST_PRIVATE_KEY`; otherwise that suite is skipped. Override the RPC with
`BASE_SEPOLIA_RPC_URL`.

> Testnet only. The underlying contracts are unaudited and immutable — see
> `contracts/MAINNET_READINESS.md`.
