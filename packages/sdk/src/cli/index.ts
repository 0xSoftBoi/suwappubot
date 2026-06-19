#!/usr/bin/env node
import { Command } from "commander";
import { registerPrices } from "./commands/prices.js";
import { registerPortfolio } from "./commands/portfolio.js";

const program = new Command();

program
  .name("suwappu")
  .description("Suwappu CLI — cross-chain DEX queries from your terminal")
  .version("0.1.0");

registerPrices(program);
registerPortfolio(program);

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
