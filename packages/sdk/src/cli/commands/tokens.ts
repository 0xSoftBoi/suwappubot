import type { Command } from "commander";
import { getClient } from "../utils/client.js";
import { withSpinner } from "../ui/spinner.js";
import { tokenTable } from "../ui/table.js";

export function registerTokens(program: Command) {
  program
    .command("tokens <chain>")
    .description("List tokens on a chain")
    .option("--json", "Output raw JSON")
    .action(async (chain: string, opts) => {
      const client = getClient();
      const tokens = await withSpinner(`Fetching tokens for ${chain}`, () =>
        client.listTokens(chain)
      );
      if (opts.json) {
        console.log(JSON.stringify(tokens, null, 2));
      } else {
        console.log(tokenTable(tokens));
      }
    });
}
