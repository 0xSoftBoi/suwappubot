import { createClient } from "@suwappu/sdk";

const client = createClient({ apiKey: process.env.SUWAPPU_API_KEY });

// Step 1: Discover chains
const chains = await client.listChains();
console.log(`Connected to ${chains.length} chains`);
for (const chain of chains.slice(0, 5)) {
  console.log(`  ${chain.name} (${chain.chainId}) — ${chain.status}`);
}

// Step 2: Get a swap quote
console.log("\nGetting quote: 1 ETH → USDC on Arbitrum...");
const quote = await client.getQuote("ETH", "USDC", 1.0, "arbitrum");
console.log(`  ${quote.fromAmount} ETH → ${quote.toAmount} USDC`);
console.log(`  Route: ${quote.route}`);
console.log(`  Gas: $${quote.gas} | Fee: $${quote.fee}`);
console.log(`  Quote ID: ${quote.id}`);

// Step 3: Execute the swap
console.log("\nExecuting swap...");
const tx = await client.executeSwap(quote.id);
console.log(`  Status: ${tx.status}`);
console.log(`  TX Hash: ${tx.txHash}`);

// Step 4: Verify portfolio
console.log("\nChecking portfolio...");
const balances = await client.getPortfolio("arbitrum");
for (const b of balances) {
  console.log(`  ${b.token}: ${b.balance} ($${b.usdValue})`);
}
