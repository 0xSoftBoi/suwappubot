import { http, type Address, createPublicClient, fallback } from 'viem';
import { baseSepolia } from 'viem/chains';

export const CHAIN = baseSepolia;
export const CHAIN_ID_HEX = `0x${baseSepolia.id.toString(16)}` as const;

/**
 * Deployed primitives — Base Sepolia (chain 84532).
 * Testnet only; unaudited immutable contracts (see contracts/MAINNET_READINESS.md).
 */
export const CONTRACTS = {
  timeCurve: '0x13189B1fae4f7CBCfF12bb57fBB6fEF83abe1B5C',
  amortizingVault: '0x07Bc798F3f6D9a5C672C209CaBe69289AF19d8DA',
  mutualCredit: '0x3938B15649129B21f53dB20D58F9084366a5570b',
  /** MockUSD — 18-dec test token with a public mint(). Reserve + debt asset. */
  reserveAsset: '0x75b2D073101f79f4A2289EF8312D5c7eD2524BD8',
  /** MockYieldVault — ERC-4626 collateral. */
  collateralVault: '0xF459a90B2aEA6a8Dc8e98a2fd9c41CD7Fef678b4',
} as const satisfies Record<string, Address>;

export const RPC_URLS = [
  process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC,
  'https://sepolia.base.org',
].filter(Boolean) as string[];

/** Optional api-ts read layer; UI falls back to chain-direct when absent. */
export const API_BASE = process.env.NEXT_PUBLIC_PRIMITIVES_API ?? '';

export const publicClient = createPublicClient({
  chain: CHAIN,
  transport: fallback(RPC_URLS.map((u) => http(u, { batch: true, retryCount: 2 }))),
  // Batch same-block eth_calls into multicall3 automatically.
  batch: { multicall: { wait: 16 } },
});

export const EXPLORER = CHAIN.blockExplorers?.default.url ?? 'https://sepolia.basescan.org';
export const addressUrl = (a: string) => `${EXPLORER}/address/${a}`;
export const txUrl = (h: string) => `${EXPLORER}/tx/${h}`;

/** Trading defaults, user-overridable in Settings. */
export const DEFAULT_SLIPPAGE_BPS = 50; // 0.50%
export const DEFAULT_DEADLINE_MINUTES = 20;

export function deadlineFromNow(minutes: number): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + Math.round(minutes * 60));
}

/** Apply slippage to a quote. `up` for max-in (buys), `down` for min-out (sells). */
export function applySlippage(amount: bigint, bps: number, dir: 'up' | 'down'): bigint {
  const b = BigInt(Math.round(bps));
  return dir === 'up'
    ? (amount * (10_000n + b)) / 10_000n
    : (amount * (10_000n - b)) / 10_000n;
}
