// Real E2E of the Solana priority-fee wiring against the LIVE Jupiter API.
// Builds a real SOL->USDC swap tx with the exact request shape our server's
// jupiter.get_swap_transaction produces, decodes the returned VersionedTransaction
// with the same @solana/web3.js the app uses, and reads the ComputeBudget
// SetComputeUnitPrice instruction to prove the priority fee actually lands.
// No funds needed — this exercises the BUILD half (where the wiring lives).
import { VersionedTransaction } from '@solana/web3.js'

const JUP = 'https://lite-api.jup.ag/swap/v1'
const SOL = 'So11111111111111111111111111111111111111112'
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const USER = '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9' // valid pubkey; no funds needed to BUILD

const CB = 'ComputeBudget111111111111111111111111111111'

function inspectTx(b64) {
  const tx = VersionedTransaction.deserialize(Buffer.from(b64, 'base64'))
  const msg = tx.message
  const keys = msg.staticAccountKeys.map((k) => k.toBase58())
  let cuPrice = null
  let cuLimit = null
  for (const ix of msg.compiledInstructions) {
    if (keys[ix.programIdIndex] !== CB) continue
    const d = ix.data
    const dv = new DataView(d.buffer, d.byteOffset, d.byteLength)
    if (d[0] === 3) cuPrice = Number(dv.getBigUint64(1, true)) // SetComputeUnitPrice (u64 µlamports/CU)
    if (d[0] === 2) cuLimit = dv.getUint32(1, true) // SetComputeUnitLimit (u32)
  }
  return { cuPriceMicroLamports: cuPrice, cuLimit }
}

// Mirror jupiter.get_swap_transaction's exact mutually-exclusive precedence.
function priorityField({ jitoTipLamports, computeUnitPriceMicroLamports, maxLamports, priorityLevel }) {
  if (jitoTipLamports) return { prioritizationFeeLamports: { jitoTipLamports } }
  if (computeUnitPriceMicroLamports) return { computeUnitPriceMicroLamports }
  return { prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports, priorityLevel } } }
}

async function build(label, opts) {
  const q = await (
    await fetch(`${JUP}/quote?inputMint=${SOL}&outputMint=${USDC}&amount=100000000&slippageBps=50`)
  ).json()
  const body = {
    quoteResponse: q,
    userPublicKey: USER,
    wrapAndUnwrapSol: true,
    useSharedAccounts: false, // avoid route-specific "simple AMM" conflict; irrelevant to priority fee
    asLegacyTransaction: false,
    dynamicComputeUnitLimit: true,
    ...priorityField(opts),
  }
  const r = await fetch(`${JUP}/swap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const j = await r.json()
  const out = { label, status: r.status }
  if (j.swapTransaction) {
    Object.assign(out, inspectTx(j.swapTransaction), {
      jupReportedFeeLamports: j.prioritizationFeeLamports,
    })
  } else {
    out.error = j.error || JSON.stringify(j).slice(0, 160)
  }
  return out
}

const LIVE = 26085 // a real Helius "high" estimate (µlamports/CU)
const a = await build('A: live per-CU price (my new path)', { computeUnitPriceMicroLamports: LIVE })
const b = await build('B: tier default (priorityLevel medium)', {
  maxLamports: 1_000_000,
  priorityLevel: 'medium',
})
const c = await build('C: turbo (jito tip)', { jitoTipLamports: 5_000_000 })

console.log(JSON.stringify({ liveSentMicroLamports: LIVE, A: a, B: b, C: c }, null, 2))

const pass = a.cuPriceMicroLamports === LIVE
console.log('\nE2E ASSERTION — tx carries the exact CU price we sent:', pass ? 'PASS ✅' : 'FAIL ❌',
  `(sent ${LIVE}, tx has ${a.cuPriceMicroLamports})`)
