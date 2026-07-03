import type { Command } from "commander";
import { keyValueTable } from "../ui/table.js";
import { withSpinner } from "../ui/spinner.js";
import { getClient } from "../utils/client.js";
import { runCommand } from "../utils/output.js";

export function registerSwapStatus(program: Command) {
  program
    .command("swap-status <swapId>")
    .description("Check the status of a managed (server-executed) swap")
    .action(async (swapId: string, _opts, cmd) => {
      await runCommand(cmd, async (output) => {
        const client = getClient(cmd.optsWithGlobals());
        const status = await withSpinner("Fetching swap status", () =>
          client.getSwapStatus(swapId),
        );
        if (output === "json") {
          console.log(JSON.stringify({ success: true, swap: status }));
          return;
        }
        const rows: Array<[string, string]> = [
          ["Swap ID", String(status.swapId)],
          ["Status", status.status],
          ["Tx Hash", status.txHash ?? "-"],
          ["From", `${status.fromAmount} ${status.fromToken} (${status.fromChain})`],
          ["To", `${status.toAmount} ${status.toToken} (${status.toChain})`],
          ["Created", status.createdAt],
          ["Completed", status.completedAt ?? "-"],
        ];
        if (status.errorMessage) rows.push(["Error", status.errorMessage]);
        console.log(keyValueTable(rows));
      });
    });
}
