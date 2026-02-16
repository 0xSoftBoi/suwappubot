const API_BASE = 'https://api.suwappu.bot/public/swap'

export interface Chain {
  id: number
  key: string
  name: string
  logoURI: string
}

export interface Token {
  address: string
  symbol: string
  decimals: number
  name: string
  logoURI?: string
  priceUSD?: string
  balance?: string
}

export interface SwapQuote {
  quoteId: string
  fromChain: number
  toChain: number
  fromToken: { symbol: string; address: string; logoURI?: string }
  toToken: { symbol: string; address: string; logoURI?: string }
  fromAmount: string
  toAmount: string
  fromAmountUsd: string
  toAmountUsd: string
  estimatedGasUsd: string
  bridgeFeeUsd: string
  slippage: number
  routeSummary: string
  txData: {
    to: string
    value: string
    chainId: number
    gasLimit: string
  }
}

export interface SwapResult {
  success: boolean
  swapId: number
  status: string
  txHash: string | null
  message: string
  swap: {
    fromChain: number
    toChain: number
    fromToken: string
    toToken: string
    fromAmount: string
    expectedToAmount: string
  }
}

export interface SwapStatus {
  id: number
  status: string
  fromChain: number
  toChain: number
  fromToken: string
  toToken: string
  fromAmount: string
  toAmount: string
  txHash: string | null
  errorMessage: string | null
  createdAt: string
  completedAt: string | null
}

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options)
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(body.message || body.error || `API error ${res.status}`)
  }
  return res.json() as Promise<T>
}

export async function fetchChains(): Promise<Chain[]> {
  const data = await apiFetch<{ chains: Chain[] }>(`${API_BASE}/chains`)
  return data.chains
}

export async function fetchTokens(chainId: number): Promise<Token[]> {
  const data = await apiFetch<{ chainId: number; tokens: Token[] }>(
    `${API_BASE}/tokens?chainId=${chainId}`
  )
  return data.tokens
}

export async function fetchQuote(
  params: {
    fromChain: string
    toChain: string
    fromToken: string
    toToken: string
    fromAmount: string
  },
  jwt: string
): Promise<SwapQuote> {
  const qs = new URLSearchParams(params).toString()
  return apiFetch<SwapQuote>(`${API_BASE}/quote?${qs}`, {
    headers: { Authorization: `Bearer ${jwt}` },
  })
}

export async function executeSwap(quoteId: string, jwt: string): Promise<SwapResult> {
  return apiFetch<SwapResult>(`${API_BASE}/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({ quoteId }),
  })
}

export async function getSwapStatus(swapId: number, jwt: string): Promise<SwapStatus> {
  return apiFetch<SwapStatus>(`${API_BASE}/status/${swapId}`, {
    headers: { Authorization: `Bearer ${jwt}` },
  })
}

export async function authenticatePasskey(
  subOrgId: string,
  walletAddress: string
): Promise<{ jwt: string; user: { id: number }; walletAddress: string }> {
  return apiFetch(`${API_BASE}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subOrgId, walletAddress }),
  })
}
