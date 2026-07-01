/**
 * P2P.me on-chain integration config.
 *
 * P2P.me is a non-custodial USDC marketplace on Base (EIP-2535 Diamond).
 * Contract addresses are verified from the P2P.me builder docs. The diamond
 * (and USDC) handle every read/write the webapp performs; the SDK's
 * `SdkConfig` additionally requires a `p2pTokenAddress` (the protocol's reward
 * token) which is only touched by stake/reward flows we do not use — it is
 * env-overridable and defaults to the zero address so price/limit reads work.
 *
 * Reads (`getPriceConfig`, `getTxLimits`, `getUsdcBalance`) go through the viem
 * publicClient against the diamond and need NO wallet and NO subgraph. Only
 * order-HISTORY reads use `subgraphUrl`, so a placeholder there degrades
 * gracefully (history fails, prices/limits/execution still work).
 */

import { createPublicClient, http } from 'viem'
import { base, baseSepolia } from 'viem/chains'

// === Networks ===

export type P2PMeNetwork = 'base' | 'baseSepolia'

export interface P2PMeChainConfig {
  readonly network: P2PMeNetwork
  readonly chainId: number
  readonly diamond: `0x${string}`
  readonly usdc: `0x${string}`
  readonly rpc: string
  /**
   * Protocol reward token. Required by the SDK's SdkConfig but only used by
   * stake/reward flows (not by price/limit/order execution). Override via env
   * once known; defaults to zero address.
   */
  readonly p2pToken: `0x${string}`
  /** Default Graph studio subgraph for order history (only history reads use it). */
  readonly subgraphUrl: string
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const

export const P2PME_CHAINS: Record<P2PMeNetwork, P2PMeChainConfig> = {
  base: {
    network: 'base',
    chainId: 8453,
    diamond: '0x4cad6eC90e65baBec9335cAd728DDC610c316368',
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    rpc: 'https://mainnet.base.org',
    p2pToken: ZERO_ADDRESS,
    subgraphUrl: 'https://api.studio.thegraph.com/query/p2pme/base-mainnet/version/latest',
  },
  baseSepolia: {
    network: 'baseSepolia',
    chainId: 84532,
    diamond: '0xce868398FDaDcA368EAc203222874D6888532aE2',
    usdc: '0xDABa329Ed949f28F64019f22c33c3B253B2Ded60',
    rpc: 'https://sepolia.base.org',
    p2pToken: ZERO_ADDRESS,
    subgraphUrl: 'https://api.studio.thegraph.com/query/p2pme/base-sepolia/version/latest',
  },
}

// === Env-driven defaults ===

function readEnv(key: string): string | undefined {
  // Vite injects import.meta.env at build time.
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env
  return env?.[key]
}

/** Default network from `VITE_P2PME_NETWORK` (defaults to base mainnet). */
export function getDefaultP2PMeNetwork(): P2PMeNetwork {
  const raw = readEnv('VITE_P2PME_NETWORK')
  return raw === 'baseSepolia' ? 'baseSepolia' : 'base'
}

/**
 * Resolve the full chain config for a network, applying any env overrides for
 * the subgraph URL and p2p token address.
 */
export function getP2PMeConfig(network: P2PMeNetwork = getDefaultP2PMeNetwork()): P2PMeChainConfig {
  const base = P2PME_CHAINS[network]
  const subgraphOverride = readEnv('VITE_P2PME_SUBGRAPH_URL')
  const tokenOverride = readEnv('VITE_P2PME_TOKEN_ADDRESS')
  return {
    ...base,
    subgraphUrl: subgraphOverride && subgraphOverride.length > 0 ? subgraphOverride : base.subgraphUrl,
    p2pToken:
      tokenOverride && /^0x[0-9a-fA-F]{40}$/.test(tokenOverride)
        ? (tokenOverride as `0x${string}`)
        : base.p2pToken,
  }
}

// === viem clients ===

/**
 * Build a viem PublicClient pointed at the P2P.me diamond's chain. The return
 * type is inferred (viem's concrete client) — it satisfies the SDK's structural
 * `PublicClientLike` (readContract + multicall).
 */
export function createP2PMePublicClient(network: P2PMeNetwork = getDefaultP2PMeNetwork()) {
  const cfg = P2PME_CHAINS[network]
  const chain = network === 'baseSepolia' ? baseSepolia : base
  return createPublicClient({ chain, transport: http(cfg.rpc) })
}

// === Order types (P2P.me Diamond order kinds) ===

export const P2PME_ORDER_TYPE = {
  /** fiat → USDC (taker pays fiat, receives USDC) */
  BUY: 0,
  /** USDC → fiat (taker locks USDC, receives fiat) */
  SELL: 1,
  /** direct pay */
  PAY: 2,
} as const

export type P2PMeOrderType = (typeof P2PME_ORDER_TYPE)[keyof typeof P2PME_ORDER_TYPE]

// === Supported fiat currencies ===
//
// The SDK's on-chain enum uses MEX for Mexican peso and VEN for Venezuelan
// bolívar (NOT the ISO MXN/VES). We expose the SDK codes since they are what the
// contract accepts.

export const P2PME_CURRENCIES = [
  'INR',
  'IDR',
  'BRL',
  'ARS',
  'MEX',
  'VEN',
  'EUR',
  'NGN',
  'USD',
  'COP',
] as const

export type P2PMeCurrency = (typeof P2PME_CURRENCIES)[number]

export function isP2PMeCurrency(c: string): c is P2PMeCurrency {
  return (P2PME_CURRENCIES as readonly string[]).includes(c)
}

/**
 * Map an ISO-ish fiat code (as used elsewhere in the webapp) to the SDK's
 * on-chain currency code. Returns null when P2P.me does not support it.
 */
export function toP2PMeCurrency(iso: string): P2PMeCurrency | null {
  const upper = iso.toUpperCase()
  const alias: Record<string, P2PMeCurrency> = {
    MXN: 'MEX',
    VES: 'VEN',
  }
  if (alias[upper]) return alias[upper]
  return isP2PMeCurrency(upper) ? (upper as P2PMeCurrency) : null
}

// === Local payment rails ===

export interface P2PMeRail {
  /** Human label for the rail. */
  label: string
  /** Placeholder for the payment-address input (UPI id, PIX key, etc.). */
  placeholder: string
}

/** currency → local payment rail (for the SELL payment-address field). */
export const P2PME_RAILS: Partial<Record<P2PMeCurrency, P2PMeRail>> = {
  INR: { label: 'UPI', placeholder: 'name@upi' },
  IDR: { label: 'QRIS', placeholder: 'QRIS payload / merchant id' },
  BRL: { label: 'PIX', placeholder: 'PIX key (CPF, email, phone)' },
  ARS: { label: 'MercadoPago', placeholder: 'MercadoPago alias / CVU' },
  MEX: { label: 'MercadoPago', placeholder: 'MercadoPago alias / CLABE' },
  VEN: { label: 'PagoMóvil', placeholder: 'Phone + cédula + bank' },
}

export function getRail(currency: P2PMeCurrency): P2PMeRail | null {
  return P2PME_RAILS[currency] ?? null
}

// === USDC / fiat decimals (both 6dp on P2P.me) ===

export const P2PME_DECIMALS = 6 as const

/** Parse a human decimal string into a 6dp bigint (USDC/fiat). */
export function toUnits6(value: string | number): bigint {
  const s = typeof value === 'number' ? value.toString() : value.trim()
  if (!s) return 0n
  const neg = s.startsWith('-')
  const clean = neg ? s.slice(1) : s
  const [whole, frac = ''] = clean.split('.')
  const fracPadded = (frac + '000000').slice(0, 6)
  const combined = `${whole || '0'}${fracPadded}`.replace(/^0+(?=\d)/, '')
  const result = BigInt(combined || '0')
  return neg ? -result : result
}

/** Format a 6dp bigint back to a human number string. */
export function fromUnits6(value: bigint, maxFractionDigits = 2): string {
  const neg = value < 0n
  const abs = neg ? -value : value
  const whole = abs / 1_000_000n
  const frac = abs % 1_000_000n
  const fracStr = frac.toString().padStart(6, '0').slice(0, maxFractionDigits).replace(/0+$/, '')
  const out = fracStr ? `${whole}.${fracStr}` : `${whole}`
  return neg ? `-${out}` : out
}

/** Deeplink to complete a trade on P2P.me when no in-app walletClient exists. */
export function p2pMeDeeplink(action: 'buy' | 'sell', currency: P2PMeCurrency): string {
  return `https://www.p2p.me/en?action=${action}&fiat=${currency}`
}
