import type { Command } from "commander";
import { getClient } from "../utils/client.js";
import { runCommand } from "../utils/output.js";
import { withSpinner } from "../ui/spinner.js";
import { portfolioTable } from "../ui/table.js";

export function registerPortfolio(program: Command) {
  program
    .command("portfolio")
    .description("Show portfolio balances")
    .requiredOption("--wallet <address>", "Wallet address")
    .option("--chain <chain>", "Filter by chain")
    .action(async (opts, cmd) => {
      await runCommand(cmd, async (output) => {
        const client = getClient(cmd.optsWithGlobals());
        const balances = await withSpinner("Fetching portfolio", () =>
          client.getPortfolio(opts.wallet, opts.chain),
        );
        if (output === "json") {
          console.log(JSON.stringify({ success: true, balances }));
        } else if (balances.length === 0) {
          console.log("No balances found.");
        } else {
          console.log(portfolioTable(balances));
        }
      });
    });
}
