import type { Command } from "commander";
import { getClient } from "../utils/client.js";
import { withSpinner } from "../ui/spinner.js";
import { portfolioTable } from "../ui/table.js";

export function registerPortfolio(program: Command) {
  program
    .command("portfolio")
    .description("Show portfolio balances")
    .option("--chain <chain>", "Filter by chain")
    .option("--json", "Output raw JSON")
    .action(async (opts) => {
      const client = getClient();
      const balances = await withSpinner("Fetching portfolio", () =>
        client.getPortfolio(opts.chain)
      );
      if (opts.json) {
        console.log(JSON.stringify(balances, null, 2));
      } else {
        if (balances.length === 0) {
          console.log("No balances found.");
          return;
        }
        console.log(portfolioTable(balances));
      }
    });
}
