import type { Command } from "commander";
import { getClient } from "../utils/client.js";
import { withSpinner } from "../ui/spinner.js";
import { quoteTable } from "../ui/table.js";
import { confirm } from "../ui/prompt.js";
import { theme } from "../ui/colors.js";

export function registerSwap(program: Command) {
  program
    .command("swap <from> <to> <amount>")
    .description("Swap tokens (get quote → confirm → execute)")
    .option("--chain <chain>", "Chain to swap on", "ethereum")
    .option("--slippage <pct>", "Max slippage percentage")
    .option("--json", "Output raw JSON")
    .action(async (from: string, to: string, amount: string, opts) => {
      const client = getClient();
      const parsedAmount = parseFloat(amount);
      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        console.error(theme.error("Invalid amount"));
        process.exit(1);
      }

      const quote = await withSpinner(
        `Getting quote: ${parsedAmount} ${from} → ${to}`,
        () => client.getQuote(from, to, parsedAmount, opts.chain)
      );

      if (opts.json) {
        console.log(JSON.stringify(quote, null, 2));
        return;
      }

      console.log("\n" + quoteTable(quote));

      const yes = await confirm("\nExecute this swap?");
      if (!yes) {
        console.log(theme.muted("Swap cancelled."));
        return;
      }

      const result = await withSpinner("Executing swap", () =>
        client.executeSwap(quote.id)
      );

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`\n${theme.success("Swap submitted!")}`);
        console.log(`  TX: ${theme.amount(result.txHash)}`);
        console.log(`  Status: ${result.status}`);
        console.log(`  Chain: ${result.chain}`);
      }
    });
}
