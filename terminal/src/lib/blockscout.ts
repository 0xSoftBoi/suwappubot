/**
 * EVM wallet inspector data via public Blockscout v2 APIs (CORS-open, no key).
 *
 * The Wallet Tracker's inspector was Solana-only (Helius) even while the desk
 * sat on Ethereum/Base/Arbitrum — pasting an EVM address was rejected outright.
 * This mirrors the Helius shapes so the same panel renders both.
 */
import type { WalletPortfolio, WalletToken, WalletTxn } from './helius'

const HOSTS: Record<string, string> = {
  ethereum: 'https://eth.blockscout.com',
  base: 'https://base.blockscout.com',
  arbitrum: 'https://arbitrum.blockscout.com',
  optimism: 'https://optimism.blockscout.com',
  polygon: 'https://polygon.blockscout.com',
}

const NATIVE_SYMBOL: Record<string, string> = {
  ethereum: 'ETH',
  base: 'ETH',
  arbitrum: 'ETH',
  optimism: 'ETH',
  polygon: 'POL',
}

export const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/

export function blockscoutSupports(chain: string): boolean {
  return Boolean(HOSTS[chain])
}

/** Chains the inspector can serve, for the chain picker. */
export const BLOCKSCOUT_CHAINS = Object.keys(HOSTS)

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`Blockscout ${res.status}`)
  return (await res.json()) as T
}

function scale(raw: string | number | null | undefined, decimals: number): number {
  const n = Number(raw ?? 0)
  if (!Number.isFinite(n)) return 0
  return n / 10 ** decimals
}

export async function getEvmWalletPortfolio(chain: string, address: string): Promise<WalletPortfolio | null> {
  const host = HOSTS[chain]
  if (!host) return null
  const [info, balances] = await Promise.all([
    getJson<{ coin_balance?: string | null; exchange_rate?: string | null }>(`${host}/api/v2/addresses/${address}`),
    getJson<Array<{ token: Record<string, unknown>; value: string }>>(
      `${host}/api/v2/addresses/${address}/token-balances`,
    ).catch(() => [] as Array<{ token: Record<string, unknown>; value: string }>),
  ])

  const native = scale(info.coin_balance, 18)
  const nativePrice = info.exchange_rate != null ? Number(info.exchange_rate) : NaN
  const nativeUsd = Number.isFinite(nativePrice) ? native * nativePrice : null

  const tokens: WalletToken[] = balances
    .filter((b) => String(b.token?.type ?? '').startsWith('ERC-20'))
    .map((b) => {
      const t = b.token
      const decimals = Number(t.decimals ?? 18) || 0
      const amount = scale(b.value, decimals)
      const price = t.exchange_rate != null ? Number(t.exchange_rate) : NaN
      return {
        mint: String(t.address ?? t.address_hash ?? ''),
        symbol: String(t.symbol ?? '?'),
        name: String(t.name ?? ''),
        amount,
        usd: Number.isFinite(price) && price > 0 ? amount * price : null,
      }
    })
    .filter((t) => t.amount > 0)
    // Priced tokens first (the unpriced long tail on a whale wallet is spam).
    .sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1))

  const tokensUsd = tokens.reduce((s, t) => s + (t.usd ?? 0), 0)
  return {
    address,
    nativeSymbol: NATIVE_SYMBOL[chain] ?? 'ETH',
    nativeSol: native,
    nativeUsd,
    tokens,
    tokensUsd,
    totalUsd: nativeUsd != null ? nativeUsd + tokensUsd : null,
    assetCount: tokens.length + (native > 0 ? 1 : 0),
  }
}

interface TokenTransfer {
  transaction_hash?: string
  timestamp?: string
  from?: { hash?: string }
  to?: { hash?: string }
  token?: { symbol?: string }
  total?: { value?: string; decimals?: string | number }
  type?: string
}

export async function getEvmWalletActivity(chain: string, address: string, limit = 15): Promise<WalletTxn[]> {
  const host = HOSTS[chain]
  if (!host) return []
  const me = address.toLowerCase()
  try {
    const { items } = await getJson<{ items: TokenTransfer[] }>(`${host}/api/v2/addresses/${address}/token-transfers`)
    return (items ?? []).slice(0, limit).map((t) => {
      const incoming = (t.to?.hash ?? '').toLowerCase() === me
      const counterparty = incoming ? t.from?.hash : t.to?.hash
      const amount = scale(t.total?.value, Number(t.total?.decimals ?? 18) || 0)
      const symbol = t.token?.symbol ?? ''
      return {
        signature: t.transaction_hash ?? '',
        type: incoming ? 'RECEIVE' : 'SEND',
        description: `${amount >= 1 ? amount.toFixed(2) : amount.toPrecision(3)} ${symbol} ${incoming ? 'from' : 'to'} ${(counterparty ?? '').slice(0, 6)}…${(counterparty ?? '').slice(-4)}`,
        timestamp: t.timestamp ? Math.floor(Date.parse(t.timestamp) / 1000) : 0,
        source: 'blockscout',
      }
    })
  } catch {
    return []
  }
}
