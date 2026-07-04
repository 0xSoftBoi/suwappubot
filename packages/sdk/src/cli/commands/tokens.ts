import type { Command } from "commander";
import { tokenTable } from "../ui/table.js";
import { withSpinner } from "../ui/spinner.js";
import { getClient } from "../utils/client.js";
import { runCommand } from "../utils/output.js";

export function registerTokens(program: Command) {
  program
    .command("tokens")
    .description("List tokens available on a chain")
    .requiredOption("--chain <chain>", "Chain key, e.g. base, solana")
    .option("--search <query>", "Filter tokens by symbol substring")
    .action(async (opts, cmd) => {
      await runCommand(cmd, async (output) => {
        const client = getClient(cmd.optsWithGlobals());
        const tokens = await withSpinner("Fetching tokens", () =>
          client.listTokens(opts.chain, opts.search),
        );
        if (output === "json") {
          console.log(JSON.stringify({ success: true, chain: opts.chain, tokens }));
        } else if (tokens.length === 0) {
          console.log("No tokens found.");
        } else {
          console.log(tokenTable(tokens));
        }
      });
    });
}
