import type { Command } from "commander";
import { keyValueTable } from "../ui/table.js";
import { withSpinner } from "../ui/spinner.js";
import { getClient } from "../utils/client.js";
import { readConfig, writeConfig } from "../utils/config.js";
import { runCommand } from "../utils/output.js";

export function registerRegister(program: Command) {
  program
    .command("register")
    .description("Self-serve register a new agent and print its API key (shown once)")
    .requiredOption("--name <name>", "Agent name (alphanumeric, underscores, hyphens; 3-50 chars)")
    .option("--description <description>", "Agent description")
    .option("--save", "Save the returned API key to ~/.config/suwappu/config.json")
    .action(async (opts, cmd) => {
      await runCommand(cmd, async (output) => {
        const client = getClient(cmd.optsWithGlobals());
        const result = await withSpinner("Registering agent", () =>
          client.register({ name: opts.name, description: opts.description }),
        );

        if (opts.save) {
          writeConfig({ ...readConfig(), apiKey: result.apiKey });
        }

        if (output === "json") {
          console.log(JSON.stringify({ success: true, agent: result, saved: Boolean(opts.save) }));
          return;
        }

        console.log(
          keyValueTable([
            ["Agent ID", result.id],
            ["Name", result.name],
            ["API Key", result.apiKey],
            ["Created", result.createdAt],
          ]),
        );
        console.log("\nSAVE THIS API KEY NOW — it cannot be retrieved later.");
        console.log(
          opts.save
            ? "Saved to ~/.config/suwappu/config.json"
            : "Run `suwappu auth` to save it, or pass --save next time.",
        );
      });
    });
}
