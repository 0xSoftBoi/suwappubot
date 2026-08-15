import type { Command } from "commander";
import { quoteTable } from "../ui/table.js";
import { withSpinner } from "../ui/spinner.js";
import { getClient } from "../utils/client.js";
import { runCommand } from "../utils/output.js";

export function registerQuote(program: Command) {
  program
    .command("quote")
    .description("Get a cross-chain swap quote")
    .requiredOption("--from-chain <chain>", "Source chain, e.g. base")
    .requiredOption("--to-chain <chain>", "Destination chain, e.g. arbitrum")
    .requiredOption("--from-token <token>", "Token to swap from, e.g. USDC")
    .requiredOption("--to-token <token>", "Token to swap to, e.g. ETH")
    .requiredOption("--amount <amount>", "Amount of --from-token to swap")
    .option("--from-address <address>", "Wallet address to quote for (returns executable tx data)")
    .action(async (opts, cmd) => {
      await runCommand(cmd, async (output) => {
        const client = getClient(cmd.optsWithGlobals());
        const quote = await withSpinner("Fetching quote", () =>
          client.getQuote({
            from: opts.fromToken,
            to: opts.toToken,
            fromChain: opts.fromChain,
            toChain: opts.toChain,
            amount: opts.amount,
            walletAddress: opts.fromAddress,
          }),
        );
        if (output === "json") {
          console.log(JSON.stringify({ success: true, quote }));
        } else {
          console.log(quoteTable(quote));
        }
      });
    });
}
