export type Intent = 'swap' | 'portfolio' | 'price' | 'help'

export function detectIntent(text: string): Intent {
  const lower = text.toLowerCase().trim()

  if (/\b(swap|buy|sell|trade|exchange|convert)\b/.test(lower)) {
    return 'swap'
  }
  if (/\b(portfolio|holdings|balance|positions|my tokens)\b/.test(lower)) {
    return 'portfolio'
  }
  if (/\b(price|cost|worth|value of|how much)\b/.test(lower)) {
    return 'price'
  }
  return 'help'
}

export function formatQuoteResponse(quoteData: {
  fromToken?: { symbol: string }
  toToken?: { symbol: string }
  fromAmount?: string
  toAmount?: string
  exchangeRate?: number
  priceImpact?: number
  gasUsd?: number
  estimatedGas?: string
  route?: string
}): { content: string; data: Record<string, unknown> } {
  const from = quoteData.fromToken?.symbol || '?'
  const to = quoteData.toToken?.symbol || '?'
  const fromAmt = quoteData.fromAmount || '0'
  const toAmt = quoteData.toAmount || '0'
  const rate = quoteData.exchangeRate?.toFixed(6) || '—'
  const impact = quoteData.priceImpact !== undefined ? `${quoteData.priceImpact.toFixed(2)}%` : '—'
  const gas = quoteData.gasUsd !== undefined ? `$${quoteData.gasUsd.toFixed(2)}` : '—'

  return {
    content: `Swap ${fromAmt} ${from} -> ${toAmt} ${to}\nRate: 1 ${from} = ${rate} ${to}\nPrice Impact: ${impact} | Gas: ${gas}`,
    data: quoteData,
  }
}

export function formatPortfolioResponse(portfolioData: {
  totalUsdValue?: number
  tokens?: Array<{ symbol: string; balance: string; usdValue: number }>
}): { content: string; data: Record<string, unknown> } {
  const total = portfolioData.totalUsdValue?.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  }) || '$0.00'

  const top5 = (portfolioData.tokens || []).slice(0, 5)
  const lines = top5.map(
    (t) => `  ${t.symbol}: ${t.balance} ($${t.usdValue.toFixed(2)})`
  )

  return {
    content: `Portfolio: ${total}\n${lines.join('\n')}`,
    data: portfolioData as unknown as Record<string, unknown>,
  }
}

export function formatPriceResponse(tokenData: {
  symbol?: string
  name?: string
  address?: string
  chain?: string
  balanceUsd?: number
}): { content: string; data: Record<string, unknown> } {
  const symbol = tokenData.symbol || '?'
  const name = tokenData.name || symbol
  const chain = tokenData.chain || 'unknown'

  return {
    content: `${name} (${symbol}) on ${chain}`,
    data: tokenData as unknown as Record<string, unknown>,
  }
}
