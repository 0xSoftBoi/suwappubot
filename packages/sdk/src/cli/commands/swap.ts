import type { Command } from "commander";
import { withSpinner } from "../ui/spinner.js";
import { getClient } from "../utils/client.js";
import { runCommand } from "../utils/output.js";

export function registerSwap(program: Command) {
  program
    .command("swap")
    .description(
      "Build an unsigned swap transaction (quote + prepare). This CLI never signs or " +
        "broadcasts — sign the returned transaction with your own wallet and submit it yourself.",
    )
    .requiredOption("--from-chain <chain>", "Source chain, e.g. base")
    .requiredOption("--to-chain <chain>", "Destination chain, e.g. arbitrum")
    .requiredOption("--from-token <token>", "Token to swap from, e.g. USDC")
    .requiredOption("--to-token <token>", "Token to swap to, e.g. ETH")
    .requiredOption("--amount <amount>", "Amount of --from-token to swap")
    .requiredOption("--from-address <address>", "Your managed wallet address (swap sender)")
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

        const swap = await withSpinner("Preparing unsigned transaction", () =>
          client.prepareSwap({ quoteId: quote.id, walletAddress: opts.fromAddress }),
        );

        if (output === "json") {
          console.log(JSON.stringify({ success: true, swap }));
          return;
        }

        console.log(
          "Unsigned transaction ready. This CLI never signs or broadcasts — sign it with your own wallet.\n",
        );
        console.log(JSON.stringify(swap, null, 2));
      });
    });
}
