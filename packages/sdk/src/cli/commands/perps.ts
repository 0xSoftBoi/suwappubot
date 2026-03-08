import type { Command } from "commander";
import { getClient } from "../utils/client.js";
import { withSpinner } from "../ui/spinner.js";
import { perpMarketTable, perpPositionTable } from "../ui/table.js";

export function registerPerps(program: Command) {
  const perps = program
    .command("perps")
    .description("Perpetual futures (Hyperliquid)");

  perps
    .command("markets")
    .description("List perpetual markets")
    .option("--json", "Output raw JSON")
    .action(async (opts) => {
      const client = getClient();
      const markets = await withSpinner("Fetching perp markets", () =>
        client.perps.markets()
      );
      if (opts.json) {
        console.log(JSON.stringify(markets, null, 2));
      } else {
        console.log(perpMarketTable(markets));
      }
    });

  perps
    .command("positions <address>")
    .description("Show positions with PnL")
    .option("--json", "Output raw JSON")
    .action(async (address: string, opts) => {
      const client = getClient();
      const positions = await withSpinner("Fetching positions", () =>
        client.perps.positions(address)
      );
      if (opts.json) {
        console.log(JSON.stringify(positions, null, 2));
      } else {
        if (positions.length === 0) {
          console.log("No open positions.");
          return;
        }
        console.log(perpPositionTable(positions));
      }
    });
}
