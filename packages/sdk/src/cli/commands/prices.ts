import type { Command } from "commander";
import { getClient } from "../utils/client.js";
import { runCommand } from "../utils/output.js";
import { withSpinner } from "../ui/spinner.js";
import { priceTable } from "../ui/table.js";

export function registerPrices(program: Command) {
  program
    .command("prices <tokens...>")
    .description("Get token prices with 24h change")
    .action(async (tokens: string[], _opts, cmd) => {
      await runCommand(cmd, async (output) => {
        const client = getClient(cmd.optsWithGlobals());
        const prices = await withSpinner("Fetching prices", () =>
          client.getPrices(tokens.join(",")),
        );
        if (output === "json") {
          console.log(JSON.stringify({ success: true, prices }));
        } else {
          console.log(priceTable(prices));
        }
      });
    });
}
