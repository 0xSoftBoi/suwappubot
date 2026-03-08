import { createClient } from "@suwappu/sdk";

const client = createClient({ apiKey: process.env.SUWAPPU_API_KEY });

// Step 1: List lending markets on Base
console.log("Morpho lending markets on Base:\n");
const markets = await client.lend.markets(8453);

// Sort by supply APY descending
const sorted = [...markets].sort((a, b) => b.supplyApy - a.supplyApy);

console.log("  Market                          Supply APY   Borrow APY   Utilization");
console.log("  ─────────────────────────────   ──────────   ──────────   ───────────");
for (const m of sorted.slice(0, 10)) {
  const pair = `${m.loanToken}/${m.collateralToken}`.padEnd(30);
  const supply = `${m.supplyApy.toFixed(2)}%`.padEnd(11);
  const borrow = `${m.borrowApy.toFixed(2)}%`.padEnd(11);
  const util = `${m.utilization.toFixed(1)}%`;
  console.log(`  ${pair}   ${supply}  ${borrow}  ${util}`);
}

// Step 2: Analyze the best yield opportunity
if (sorted.length > 0) {
  const best = sorted[0];
  console.log(`\nBest yield: ${best.loanToken}/${best.collateralToken}`);
  console.log(`  Supply APY: ${best.supplyApy.toFixed(2)}%`);
  console.log(`  Total Supply: $${(best.totalSupply / 1_000_000).toFixed(1)}M`);
  console.log(`  LLTV: ${(best.lltv * 100).toFixed(0)}%`);

  const detail = await client.lend.market(best.id);
  console.log(`  Oracle: ${detail.oracle}`);
  console.log(`  IRM: ${detail.irm}`);
  console.log(`  Created: ${detail.createdAt}`);
}
