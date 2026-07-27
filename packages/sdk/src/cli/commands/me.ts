import type { Command } from "commander";
import { keyValueTable } from "../ui/table.js";
import { withSpinner } from "../ui/spinner.js";
import { getClient } from "../utils/client.js";
import { runCommand } from "../utils/output.js";

export function registerMe(program: Command) {
  program
    .command("me")
    .description("Show your agent profile")
    .action(async (_opts, cmd) => {
      await runCommand(cmd, async (output) => {
        const client = getClient(cmd.optsWithGlobals());
        const me = await withSpinner("Fetching profile", () => client.me());
        if (output === "json") {
          console.log(JSON.stringify({ success: true, agent: me }));
          return;
        }
        console.log(
          keyValueTable([
            ["ID", me.id],
            ["Name", me.name],
            ["Description", me.description ?? "-"],
            ["Rate Limit Tier", me.rateLimitTier ?? "-"],
            ["Total Requests", String(me.stats?.totalRequests ?? 0)],
            ["Total Swaps", String(me.stats?.totalSwaps ?? 0)],
            ["Created", me.createdAt ?? "-"],
            ["Last Active", me.lastActiveAt ?? "-"],
          ]),
        );
      });
    });
}
