import { createClient } from "@suwappu/sdk";

const client = createClient({ apiKey: process.env.SUWAPPU_API_KEY });

// Step 1: List available perp markets
console.log("Available perpetual markets:");
const markets = await client.perps.markets();
for (const m of markets) {
  console.log(
    `  ${m.name} — $${m.markPrice.toLocaleString()} | Max ${m.maxLeverage}x | Funding: ${(m.fundingRate * 100).toFixed(4)}%`
  );
}

// Step 2: Get a quote for a leveraged ETH long
console.log("\nQuoting 1 ETH long at 5x leverage...");
const quote = await client.perps.quote("ETH-USD", "long", 1, 5);
console.log(`  Entry Price:       $${quote.entryPrice.toLocaleString()}`);
console.log(`  Margin Required:   $${quote.margin.toFixed(2)}`);
console.log(`  Liquidation Price: $${quote.liquidationPrice.toFixed(2)}`);
console.log(`  Fee:               $${quote.fee.toFixed(2)}`);

// Step 3: Check existing positions
console.log("\nOpen positions:");
const address = process.env.HL_ADDRESS;
if (address) {
  const positions = await client.perps.positions(address);
  if (positions.length === 0) {
    console.log("  No open positions");
  }
  for (const p of positions) {
    const pnlSign = p.unrealizedPnl >= 0 ? "+" : "";
    console.log(
      `  ${p.market} ${p.side.toUpperCase()} ${p.size} @ $${p.entryPrice} | PnL: ${pnlSign}$${p.unrealizedPnl.toFixed(2)}`
    );
  }
} else {
  console.log("  Set HL_ADDRESS env var to check positions");
}
