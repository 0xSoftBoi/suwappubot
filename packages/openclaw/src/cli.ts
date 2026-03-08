#!/usr/bin/env bun
/**
 * CLI entry point for @suwappu/openclaw
 * Usage: bunx @suwappu/openclaw <command> [args...]
 */

import { createClient } from "./index";

const client = createClient();
const [command, ...args] = process.argv.slice(2);

async function main() {
  switch (command) {
    case "get_quote": {
      const [from, to, amount, chain] = args;
      if (!from || !to || !amount || !chain) {
        console.error("Usage: get_quote <from> <to> <amount> <chain>");
        process.exit(1);
      }
      const quote = await client.getQuote(from, to, parseFloat(amount), chain);
      console.log(JSON.stringify(quote, null, 2));
      break;
    }
    case "execute_swap": {
      const [quoteId] = args;
      if (!quoteId) {
        console.error("Usage: execute_swap <quote_id>");
        process.exit(1);
      }
      const result = await client.executeSwap(quoteId);
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "get_portfolio": {
      const [chain] = args;
      const portfolio = await client.getPortfolio(chain);
      console.log(JSON.stringify(portfolio, null, 2));
      break;
    }
    case "get_prices": {
      const [token, chain] = args;
      if (!token) {
        console.error("Usage: get_prices <token> [chain]");
        process.exit(1);
      }
      const price = await client.getPrices(token, chain);
      console.log(JSON.stringify(price, null, 2));
      break;
    }
    case "list_chains": {
      const chains = await client.listChains();
      console.log(JSON.stringify(chains, null, 2));
      break;
    }
    case "list_tokens": {
      const [chain] = args;
      if (!chain) {
        console.error("Usage: list_tokens <chain>");
        process.exit(1);
      }
      const tokens = await client.listTokens(chain);
      console.log(JSON.stringify(tokens, null, 2));
      break;
    }
    default:
      console.log(`@suwappu/openclaw — Cross-chain swaps for OpenClaw agents

Commands:
  get_quote <from> <to> <amount> <chain>   Get swap quote
  execute_swap <quote_id>                   Execute a swap
  get_portfolio [chain]                     Check balances
  get_prices <token> [chain]                Token prices
  list_chains                               Supported chains
  list_tokens <chain>                       Tokens on a chain`);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
