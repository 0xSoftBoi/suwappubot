import type { Command } from "commander";
import { getClient } from "../utils/client.js";
import { withSpinner } from "../ui/spinner.js";
import { priceTable } from "../ui/table.js";

export function registerPrices(program: Command) {
  program
    .command("prices <tokens...>")
    .description("Get token prices with 24h change")
    .option("--json", "Output raw JSON")
    .action(async (tokens: string[], opts) => {
      const client = getClient();
      const prices = await withSpinner("Fetching prices", () =>
        client.getPrices(tokens.join(","))
      );
      if (opts.json) {
        console.log(JSON.stringify(prices, null, 2));
      } else {
        console.log(priceTable(prices));
      }
    });
}
