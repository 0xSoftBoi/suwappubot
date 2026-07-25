#!/usr/bin/env node
import { Command } from "commander";
import { registerAuth } from "./commands/auth.js";
import { registerBilling } from "./commands/billing.js";
import { registerChains } from "./commands/chains.js";
import { registerMe } from "./commands/me.js";
import { registerPortfolio } from "./commands/portfolio.js";
import { registerPrices } from "./commands/prices.js";
import { registerQuote } from "./commands/quote.js";
import { registerRegister } from "./commands/register.js";
import { registerSwap } from "./commands/swap.js";
import { registerSwapStatus } from "./commands/swapStatus.js";
import { registerTokens } from "./commands/tokens.js";

const program = new Command();

program
  .name("suwappu")
  .description(
    "Suwappu CLI — cross-chain DEX quotes, swaps, and agent account management from your terminal",
  )
  .version("0.2.0")
  .option("-o, --output <format>", "Output format: human or json", "human")
  .option("--api-key <key>", "Suwappu API key (overrides SUWAPPU_API_KEY and saved config)")
  .option("--base-url <url>", "Override the API base URL (overrides SUWAPPU_API_URL)");

registerAuth(program);
registerRegister(program);
registerMe(program);
registerBilling(program);
registerChains(program);
registerTokens(program);
registerPrices(program);
registerPortfolio(program);
registerQuote(program);
registerSwap(program);
registerSwapStatus(program);

program.parseAsync(process.argv).catch((err) => {
  const opts = program.opts<{ output?: string }>();
  const message = err instanceof Error ? err.message : String(err);
  if (opts.output === "json") {
    console.log(JSON.stringify({ success: false, error: { code: "cli_error", message } }));
  } else {
    console.error(message);
  }
  process.exit(1);
});
