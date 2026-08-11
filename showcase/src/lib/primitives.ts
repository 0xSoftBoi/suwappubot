import {
  http,
  type Address,
  createPublicClient,
  createWalletClient,
  custom,
  getAddress,
  parseAbi,
} from 'viem';
import { baseSepolia } from 'viem/chains';

// ── Deployment (Base Sepolia). Testnet only; unaudited immutable contracts. ──
export const ADDR = {
  chainId: baseSepolia.id,
  timeCurve: '0x13189B1fae4f7CBCfF12bb57fBB6fEF83abe1B5C' as Address,
  amortizingVault: '0x07Bc798F3f6D9a5C672C209CaBe69289AF19d8DA' as Address,
  mutualCredit: '0x3938B15649129B21f53dB20D58F9084366a5570b' as Address,
  reserveAsset: '0x75b2D073101f79f4A2289EF8312D5c7eD2524BD8' as Address, // MockUSD (public mint)
  collateralVault: '0xF459a90B2aEA6a8Dc8e98a2fd9c41CD7Fef678b4' as Address,
};

/** api-ts read surface; falls back to chain-direct when unreachable. */
export const API_BASE =
  process.env.NEXT_PUBLIC_PRIMITIVES_API ?? 'https://devapi.suwappu.bot/v1/primitives';

export const RPC =
  process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC ?? 'https://sepolia.base.org';

export const curveAbi = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function reserve() view returns (address)',
  'function basePrice() view returns (uint256)',
  'function slope() view returns (uint256)',
  'function rate() view returns (int256)',
  'function sinkRate() view returns (uint256)',
  'function totalSunk() view returns (uint256)',
  'function reserveBalance() view returns (uint256)',
  'function spotPrice() view returns (uint256)',
  'function multiplier() view returns (uint256)',
  'function quoteBuy(uint256) view returns (uint256)',
  'function quoteSell(uint256) view returns (uint256)',
  'function buy(uint256 tokenAmount, uint256 maxReserveIn, uint256 deadline) returns (uint256)',
  'function sell(uint256 tokenAmount, uint256 minReserveOut, uint256 deadline) returns (uint256)',
]);

export const vaultAbi = parseAbi([
  'function asset() view returns (address)',
  'function collateralVault() view returns (address)',
  'function borrowRate() view returns (uint256)',
  'function maxLtv() view returns (uint256)',
  'function liqLtv() view returns (uint256)',
  'function liqBonus() view returns (uint256)',
  'function cash() view returns (uint256)',
  'function poolAssets() view returns (uint256)',
  'function totalDebtAssets() view returns (uint256)',
  'function nextPositionId() view returns (uint256)',
  'function positions(uint256) view returns (address owner, uint256 shares, uint256 baselineAssets, uint256 debtScaled)',
  'function debtOf(uint256) view returns (uint256)',
  'function pendingYield(uint256) view returns (uint256)',
  'function supply(uint256 assets) returns (uint256)',
  'function openPosition(uint256 shares, uint256 borrowAssets, uint256 deadline) returns (uint256)',
  'function repay(uint256 id, uint256 assets)',
]);

export const creditAbi = parseAbi([
  'function owedBy(address debtor, address creditor, address token) view returns (uint256)',
  'function lineKey(address x, address y, address token) view returns (bytes32)',
  'function defaults(address) view returns (uint256)',
  'function proposeLine(address counterparty, address token, uint256 myLimit, uint256 feeRate, uint64 grace) returns (bytes32)',
  'function acceptLine(address proposer, address token, uint256 myLimit)',
  'function pay(address to, address token, uint256 amount)',
]);

export const erc20Abi = parseAbi([
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function mint(address to, uint256 amount)', // MockUSD test faucet
]);

export const publicClient = createPublicClient({ chain: baseSepolia, transport: http(RPC) });

export type Source = 'api' | 'chain';

/**
 * "Both"-source read: try the api-ts route first, fall back to a chain-direct
 * viem call. Returns the value plus which source answered.
 */
export async function readBoth<T>(
  apiPath: string,
  parse: (json: any) => T,
  chain: () => Promise<T>,
): Promise<{ value: T; source: Source }> {
  try {
    const res = await fetch(`${API_BASE}${apiPath}`, { cache: 'no-store' });
    if (res.ok) return { value: parse(await res.json()), source: 'api' };
  } catch {
    /* fall through to chain */
  }
  return { value: await chain(), source: 'chain' };
}

// ── Wallet (injected) ──
export type Eip1193 = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };

export function getInjected(): Eip1193 | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { ethereum?: Eip1193 }).ethereum ?? null;
}

const BASE_SEPOLIA_HEX = '0x14a34';

export async function connectWallet(): Promise<Address> {
  const eth = getInjected();
  if (!eth) throw new Error('No injected wallet found (install MetaMask or similar).');
  const accounts = (await eth.request({ method: 'eth_requestAccounts' })) as string[];
  await ensureBaseSepolia(eth);
  return getAddress(accounts[0]);
}

export async function ensureBaseSepolia(eth: Eip1193): Promise<void> {
  const current = (await eth.request({ method: 'eth_chainId' })) as string;
  if (current?.toLowerCase() === BASE_SEPOLIA_HEX) return;
  try {
    await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: BASE_SEPOLIA_HEX }] });
  } catch {
    await eth.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId: BASE_SEPOLIA_HEX,
          chainName: 'Base Sepolia',
          nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
          rpcUrls: [RPC],
          blockExplorerUrls: ['https://sepolia.basescan.org'],
        },
      ],
    });
  }
}

export function walletClient(account: Address) {
  const eth = getInjected();
  if (!eth) throw new Error('No injected wallet found.');
  return createWalletClient({ account, chain: baseSepolia, transport: custom(eth) });
}

// ── formatting helpers ──
export function fmt(wei: bigint | string | undefined, decimals = 18, dp = 4): string {
  if (wei === undefined) return '—';
  const v = typeof wei === 'string' ? BigInt(wei) : wei;
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = abs % base;
  const fracStr = frac.toString().padStart(decimals, '0').slice(0, dp).replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole.toString()}${fracStr ? `.${fracStr}` : ''}`;
}

export function parseUnits(value: string, decimals = 18): bigint {
  const [w, f = ''] = value.trim().split('.');
  const frac = (f + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt(w || '0') * 10n ** BigInt(decimals) + BigInt(frac || '0');
}

export const explorer = (addr: string) => `https://sepolia.basescan.org/address/${addr}`;
export const txExplorer = (hash: string) => `https://sepolia.basescan.org/tx/${hash}`;
