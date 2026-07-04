import type { Command } from "commander";
import { keyValueTable } from "../ui/table.js";
import { withSpinner } from "../ui/spinner.js";
import { getClient } from "../utils/client.js";
import { formatUsd } from "../utils/format.js";
import { runCommand } from "../utils/output.js";

export function registerBilling(program: Command) {
  program
    .command("billing")
    .description("Show credit balance, tier, and pay-per-call metering status")
    .action(async (_opts, cmd) => {
      await runCommand(cmd, async (output) => {
        const client = getClient(cmd.optsWithGlobals());
        const billing = await withSpinner("Fetching billing", () => client.getBilling());
        if (output === "json") {
          console.log(JSON.stringify({ success: true, billing }));
          return;
        }
        console.log(
          keyValueTable([
            ["Tier", billing.tier],
            ["Metering Enabled", String(billing.meteringEnabled)],
            ["Metered", String(billing.isMetered)],
            ["Credit Balance", String(billing.credits.balance)],
            ["Lifetime Purchased", String(billing.credits.lifetimePurchased)],
            ["Lifetime Used", String(billing.credits.lifetimeUsed)],
            ["Credit USD Value", formatUsd(billing.creditUsdValue)],
          ]),
        );
        console.log(
          billing.isMetered
            ? `\nTop up: ${billing.topup.endpoint} — ${billing.topup.note}`
            : "\nThis tier bypasses metering — API calls are unmetered.",
        );
      });
    });
}
