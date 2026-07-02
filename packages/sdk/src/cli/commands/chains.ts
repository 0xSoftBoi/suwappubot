import type { Command } from "commander";
import { chainTable } from "../ui/table.js";
import { withSpinner } from "../ui/spinner.js";
import { getClient } from "../utils/client.js";
import { runCommand } from "../utils/output.js";

export function registerChains(program: Command) {
  program
    .command("chains")
    .description("List supported chains")
    .action(async (_opts, cmd) => {
      await runCommand(cmd, async (output) => {
        const client = getClient(cmd.optsWithGlobals());
        const chains = await withSpinner("Fetching chains", () => client.listChains());
        if (output === "json") {
          console.log(JSON.stringify({ success: true, chains }));
        } else {
          console.log(chainTable(chains));
        }
      });
    });
}
