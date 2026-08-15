// E2E for the shared-accounts fallback against LIVE Jupiter. Some SOL->USDC
// routes go through a simple AMM that rejects shared accounts; this hammers the
// pair until that 400 appears, then proves the retry-without-shared-accounts
// recovers — mirroring jupiter.get_swap_transaction's new fallback.
const JUP = 'https://lite-api.jup.ag/swap/v1'
const SOL = 'So11111111111111111111111111111111111111112'
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const USER = '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9'

// Build with a given quote + shared-accounts flag (mirrors get_swap_transaction).
async function build(quote, useSharedAccounts) {
  const r = await fetch(`${JUP}/swap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: USER,
      wrapAndUnwrapSol: true,
      useSharedAccounts,
      dynamicComputeUnitLimit: true,
      computeUnitPriceMicroLamports: 26085,
    }),
  })
  const j = await r.json()
  return { ok: r.status === 200 && !!j.swapTransaction, status: r.status, error: j.error }
}

const errKinds = {}
let reproduced = null
for (let i = 0; i < 30 && !reproduced; i++) {
  // Vary the amount slightly so Jupiter re-routes between attempts.
  const amount = 10_000_000 + i * 137_000
  const q = await (
    await fetch(`${JUP}/quote?inputMint=${SOL}&outputMint=${USDC}&amount=${amount}&slippageBps=50`)
  ).json()
  if (q.error) {
    errKinds['quote:' + q.error] = (errKinds['quote:' + q.error] || 0) + 1
    continue
  }
  const shared = await build(q, true) // shared accounts ON
  if (shared.ok) {
    errKinds['sharedOk'] = (errKinds['sharedOk'] || 0) + 1
    continue
  }
  const key = String(shared.error)
  errKinds[key] = (errKinds[key] || 0) + 1
  if (key.toLowerCase().includes('shared account')) {
    // Apply the fallback on the SAME quote.
    const fb = await build(q, false)
    reproduced = { attempt: i, sharedError: shared.error, fallback: fb.ok ? '200 OK ✅' : fb }
  }
}

console.log(JSON.stringify({ outcomes: errKinds, reproduced }, null, 2))
console.log(
  '\nFALLBACK E2E:',
  reproduced
    ? reproduced.fallback === '200 OK ✅'
      ? 'PASS ✅ — reproduced the shared-accounts 400; retry without shared accounts succeeded'
      : 'FAIL ❌ — reproduced but fallback did not recover'
    : 'NOT TRIGGERED (no simple-AMM route hit in 30 tries) — fallback logic in place, condition did not occur',
)
