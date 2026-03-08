import { Command } from "commander";
import { registerChains } from "./commands/chains.js";
import { registerTokens } from "./commands/tokens.js";
import { registerPrices } from "./commands/prices.js";
import { registerPortfolio } from "./commands/portfolio.js";
import { registerPerps } from "./commands/perps.js";
import { registerSwap } from "./commands/swap.js";
import { registerConfig } from "./commands/config.js";

export function createProgram(): Command {
  const program = new Command()
    .name("suwappu")
    .description("Cross-chain DEX CLI — swaps, portfolio, prices & perps")
    .version("0.3.0");

  registerChains(program);
  registerTokens(program);
  registerPrices(program);
  registerPortfolio(program);
  registerPerps(program);
  registerSwap(program);
  registerConfig(program);

  return program;
}
