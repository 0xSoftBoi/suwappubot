// Maps error types to agent-readable remediation hints

const GUIDANCE: Record<string, string> = {
  unauthorized: 'Include your API key via X-API-Key header or Bearer token. Get a key at https://app.suwappu.bot/enterprise.',
  forbidden: 'Your plan does not have access to this feature. Upgrade at https://app.suwappu.bot/enterprise.',
  rate_limited: 'You have hit the rate limit. Slow requests to 1/second or upgrade your plan for higher limits.',
  insufficient_balance: 'Insufficient balance for this swap. Use GET /v1/agent/portfolio to check current balances, then add funds.',
  slippage_exceeded: 'Slippage tolerance exceeded. Increase slippage_bps or reduce swap amount. Volatile pairs may need 100-300 bps.',
  token_not_found: 'Token not found on the requested chain. Use GET /v1/tokens?chain=CHAIN&search=SYMBOL to find the correct address.',
  unknown_chain: 'Unsupported chain. Supported chains: eth, base, sol, arb, polygon, bsc, op, hyperevm. Check GET /v1/chains for the full list.',
  quote_expired: 'Quote has expired. Fetch a fresh quote with GET /v1/agent/quote and retry within 30 seconds.',
  no_wallet: 'No wallet configured for this account. Register a wallet via POST /v1/agent/register.',
  payment_required: 'Upgrade required. Visit https://app.suwappu.bot/enterprise to enable this feature.',
  external_service: 'Upstream service error. Retry with exponential backoff (1s, 2s, 4s). Check https://status.suwappu.bot if the issue persists.',
  server_error: 'Transient server error. Retry with exponential backoff (1s, 2s, 4s). If the issue persists, contact support.',
}

export function getErrorGuidance(errorCode: string | undefined, message?: string): string | undefined {
  if (!errorCode) return GUIDANCE.server_error
  const key = errorCode.toLowerCase().replace(/-/g, '_')
  if (GUIDANCE[key]) return GUIDANCE[key]
  // fuzzy match
  for (const [k, v] of Object.entries(GUIDANCE)) {
    if (key.includes(k) || k.includes(key)) return v
  }
  if (message?.toLowerCase().includes('balance')) return GUIDANCE.insufficient_balance
  if (message?.toLowerCase().includes('slippage')) return GUIDANCE.slippage_exceeded
  if (message?.toLowerCase().includes('token')) return GUIDANCE.token_not_found
  return GUIDANCE.server_error
}
