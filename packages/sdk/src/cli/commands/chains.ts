import type { Command } from "commander";
import { getClient } from "../utils/client.js";
import { withSpinner } from "../ui/spinner.js";
import { chainTable } from "../ui/table.js";

export function registerChains(program: Command) {
  program
    .command("chains")
    .description("List supported chains")
    .option("--json", "Output raw JSON")
    .action(async (opts) => {
      const client = getClient();
      const chains = await withSpinner("Fetching chains", () =>
        client.listChains()
      );
      if (opts.json) {
        console.log(JSON.stringify(chains, null, 2));
      } else {
        console.log(chainTable(chains));
      }
    });
}
