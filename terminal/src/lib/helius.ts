import type { PulseToken } from '../types/api'

// Live Solana token-safety enrichment via the Helius RPC (keyed). Provides the
// real rug-check signals DexScreener can't: top-holder concentration and
// mint/freeze authority status. The key is read from the env (gitignored
// .env.local) — when absent, enrichment is skipped and tokens keep their
// neutral defaults (no fake signals).
//
// Production note: a client-side RPC key is visible in the bundle. For prod this
// should be proxied server-side or domain-locked in the Helius dashboard.

const KEY = import.meta.env.VITE_HELIUS_API_KEY as string | undefined
const RPC = KEY ? `https://mainnet.helius-rpc.com/?api-key=${KEY}` : null

export interface TokenSafety {
  topHolderPercent: number
  top10Percent: number
  mintRenounced: boolean
  freezeRenounced: boolean
  holders: number // count of non-zero token accounts (capped at one page)
  holdersCapped: boolean // true if the real count exceeds what one page returned
  riskLevel: 'safe' | 'caution' | 'danger'
  trustScore: number // 0-100
}

export function heliusEnabled(): boolean {
  return RPC != null
}

// Cache by mint so the 30s feed refresh doesn't re-hit the RPC for known tokens.
const cache = new Map<string, TokenSafety>()

async function rpc(method: string, params: unknown): Promise<any> {
  const res = await fetch(RPC as string, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  if (!res.ok) throw new Error(`Helius ${res.status}`)
  const json = await res.json()
  if (json.error) throw new Error(json.error.message || 'Helius RPC error')
  return json.result
}

function scoreSafety(
  topHolderPercent: number,
  top10Percent: number,
  mintRenounced: boolean,
  freezeRenounced: boolean,
): { riskLevel: TokenSafety['riskLevel']; trustScore: number } {
  // Penalize concentration + live authorities; clamp to 0-100.
  let score = 100
  score -= Math.min(topHolderPercent, 60) // a single whale is the biggest risk
  score -= Math.min(top10Percent, 40) * 0.5
  if (!mintRenounced) score -= 25 // can mint more supply
  if (!freezeRenounced) score -= 15 // can freeze your tokens
  const trustScore = Math.max(0, Math.round(score))

  let riskLevel: TokenSafety['riskLevel'] = 'safe'
  if (!mintRenounced || topHolderPercent > 50 || trustScore < 40) riskLevel = 'danger'
  else if (!freezeRenounced || topHolderPercent > 20 || trustScore < 70) riskLevel = 'caution'
  return { riskLevel, trustScore }
}

async function fetchSafety(mint: string): Promise<TokenSafety | null> {
  try {
    const supplyRes = await rpc('getTokenSupply', [mint])
    const total = supplyRes?.value?.uiAmount ?? 0
    const largestRes = await rpc('getTokenLargestAccounts', [mint])
    const largest: Array<{ uiAmount?: number }> = largestRes?.value ?? []
    const infoRes = await rpc('getAccountInfo', [mint, { encoding: 'jsonParsed' }])
    const info = infoRes?.value?.data?.parsed?.info ?? {}

    const top1 = largest[0]?.uiAmount ?? 0
    const top10 = largest.slice(0, 10).reduce((s, a) => s + (a.uiAmount ?? 0), 0)
    const topHolderPercent = total > 0 ? +((100 * top1) / total).toFixed(2) : 0
    const top10Percent = total > 0 ? +((100 * top10) / total).toFixed(2) : 0
    // SPL mints expose mintAuthority/freezeAuthority; null === renounced.
    const mintRenounced = info.mintAuthority == null
    const freezeRenounced = info.freezeAuthority == null

    // Real holder count = non-zero token accounts. One page (1000) is plenty for
    // discovery-age tokens; if it fills the page we flag the count as capped.
    const PAGE = 1000
    let holders = 0
    let holdersCapped = false
    try {
      const ta = await rpc('getTokenAccounts', { mint, page: 1, limit: PAGE })
      const accounts: Array<{ amount?: string | number }> = ta?.token_accounts ?? []
      holders = accounts.filter((a) => Number(a.amount ?? 0) > 0).length
      holdersCapped = accounts.length >= PAGE
    } catch {
      // best-effort — leave holders at 0 (UI shows "—")
    }

    const { riskLevel, trustScore } = scoreSafety(
      topHolderPercent,
      top10Percent,
      mintRenounced,
      freezeRenounced,
    )
    return {
      topHolderPercent,
      top10Percent,
      mintRenounced,
      freezeRenounced,
      holders,
      holdersCapped,
      riskLevel,
      trustScore,
    }
  } catch {
    return null
  }
}

// Run `tasks` with a fixed concurrency cap so we don't burst the RPC.
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  async function worker() {
    while (i < items.length) {
      const idx = i++
      out[idx] = await fn(items[idx])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

// Merge live safety signals onto a batch of tokens. Cached mints are free;
// uncached are fetched with bounded concurrency. No-ops without a key.
export async function enrichWithSafety(tokens: PulseToken[]): Promise<PulseToken[]> {
  if (!RPC || tokens.length === 0) return tokens

  const uncached = [...new Set(tokens.map((t) => t.address))].filter((m) => !cache.has(m))
  if (uncached.length) {
    // Concurrency 2 keeps us under the Helius free-tier rate limit; cached mints
    // are skipped entirely, so steady-state cost is near zero.
    const results = await mapLimit(uncached, 2, fetchSafety)
    uncached.forEach((mint, idx) => {
      const safety = results[idx]
      if (safety) cache.set(mint, safety)
    })
  }

  return tokens.map((t) => {
    const s = cache.get(t.address)
    if (!s) return t
    return {
      ...t,
      topHolderPercent: s.topHolderPercent,
      trustScore: s.trustScore,
      riskLevel: s.riskLevel,
      holders: s.holders,
    }
  })
}

// ── Wallet inspector (live, client-side) ──────────────────────────────────────

export interface WalletToken {
  mint: string
  symbol: string
  name: string
  amount: number
  usd: number | null
}

export interface WalletPortfolio {
  address: string
  nativeSol: number
  nativeUsd: number | null
  tokens: WalletToken[]
  tokensUsd: number
  totalUsd: number | null
  assetCount: number
}

// Full Solana portfolio for any address via DAS getAssetsByOwner — native SOL
// (with USD) + fungible holdings. Per-token USD is shown only where Helius
// supplies a price, so the total is honest (native + priced tokens).
export async function getWalletPortfolio(address: string): Promise<WalletPortfolio | null> {
  if (!RPC) return null
  const res = await rpc('getAssetsByOwner', {
    ownerAddress: address,
    page: 1,
    limit: 1000,
    displayOptions: { showFungible: true, showNativeBalance: true },
  })
  const items: any[] = res?.items ?? []
  const nativeSol = res?.nativeBalance?.lamports ? res.nativeBalance.lamports / 1e9 : 0
  const nativeUsd = res?.nativeBalance?.total_price ?? null

  const tokens: WalletToken[] = items
    .filter((i) => i.interface === 'FungibleToken' || i.interface === 'FungibleAsset')
    .map((i) => {
      const ti = i.token_info ?? {}
      const decimals = ti.decimals ?? 0
      const amount = ti.balance != null ? ti.balance / Math.pow(10, decimals) : 0
      return {
        mint: i.id,
        symbol: ti.symbol || i.content?.metadata?.symbol || '?',
        name: i.content?.metadata?.name || '',
        amount,
        usd: ti.price_info?.total_price ?? null,
      }
    })
    .filter((t) => t.amount > 0)
    .sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0))

  const tokensUsd = tokens.reduce((s, t) => s + (t.usd ?? 0), 0)
  const totalUsd = nativeUsd != null ? nativeUsd + tokensUsd : null
  return { address, nativeSol, nativeUsd, tokens, tokensUsd, totalUsd, assetCount: res?.total ?? items.length }
}

export interface WalletTxn {
  signature: string
  type: string
  description: string
  timestamp: number
  source: string
}

// ── Live Solana priority fees ─────────────────────────────────────────────────

// Network priority-fee estimate (micro-lamports per compute unit) per level, in
// one call via Helius getPriorityFeeEstimate(includeAllPriorityFeeLevels).
export interface PriorityFees {
  medium: number
  high: number
  veryHigh: number
}

export async function getSolanaPriorityFees(): Promise<PriorityFees | null> {
  if (!RPC) return null
  try {
    const res = await rpc('getPriorityFeeEstimate', [
      { options: { includeAllPriorityFeeLevels: true } },
    ])
    const lv = res?.priorityFeeLevels ?? {}
    return { medium: lv.medium ?? 0, high: lv.high ?? 0, veryHigh: lv.veryHigh ?? 0 }
  } catch {
    return null
  }
}

// Recent human-readable transactions via the Helius Enhanced Transactions API.
export async function getWalletActivity(address: string, limit = 15): Promise<WalletTxn[]> {
  if (!KEY) return []
  const r = await fetch(
    `https://api.helius.xyz/v0/addresses/${address}/transactions?api-key=${KEY}&limit=${limit}`,
  )
  if (!r.ok) return []
  const j = await r.json()
  if (!Array.isArray(j)) return []
  return j.map((t: any) => ({
    signature: t.signature ?? '',
    type: t.type ?? 'UNKNOWN',
    description: t.description ?? '',
    timestamp: t.timestamp ?? 0,
    source: t.source ?? '',
  }))
}
