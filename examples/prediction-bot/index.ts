import { createClient } from "@suwappu/sdk";

const client = createClient({ apiKey: process.env.SUWAPPU_API_KEY });

// Step 1: Browse trending prediction markets
console.log("Trending prediction markets:\n");
const markets = await client.predict.markets(undefined, 10);

for (const m of markets) {
  const [yesPrice, noPrice] = m.outcomePrices;
  const yesPercent = (yesPrice * 100).toFixed(0);
  const volume = m.volume > 1_000_000
    ? `$${(m.volume / 1_000_000).toFixed(1)}M`
    : `$${(m.volume / 1_000).toFixed(0)}K`;

  console.log(`  ${m.question}`);
  console.log(`    Yes: ${yesPercent}% | Volume: ${volume} | Ends: ${m.endDate.slice(0, 10)}`);
  console.log();
}

// Step 2: Get details on the highest-volume market
if (markets.length > 0) {
  const top = markets[0];
  console.log(`\nDeep dive: "${top.question}"`);
  const detail = await client.predict.market(top.id);
  console.log(`  ${detail.description.slice(0, 200)}...`);
  console.log(`  Category: ${detail.category}`);
  console.log(`  Created: ${detail.createdAt}`);
  console.log(
    `  Resolved: ${detail.resolvedOutcome ?? "Not yet"}`
  );
}
