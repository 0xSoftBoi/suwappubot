import type { Command } from "commander";
import { theme } from "../ui/colors.js";
import { keyValueTable } from "../ui/table.js";
import { getClient } from "../utils/client.js";
import { configPath, readConfig, writeConfig } from "../utils/config.js";
import { CliError, runCommand } from "../utils/output.js";
import { promptSecret } from "../utils/prompt.js";

function maskKey(key: string): string {
  if (key.length <= 8) return "*".repeat(key.length);
  return `${key.slice(0, 10)}...${key.slice(-4)}`;
}

export function registerAuth(program: Command) {
  const auth = program
    .command("auth")
    .description("Interactively save your Suwappu API key to ~/.config/suwappu/config.json");

  // `suwappu auth` (no subcommand) — interactive save.
  auth.action(async (_opts, cmd) => {
    await runCommand(cmd, async (output) => {
      const apiKey = await promptSecret("Suwappu API key: ");
      if (!apiKey) {
        throw new CliError("invalid_input", "API key cannot be empty");
      }
      writeConfig({ ...readConfig(), apiKey });
      if (output === "json") {
        console.log(JSON.stringify({ success: true, config_path: configPath() }));
      } else {
        console.log(`Saved to ${configPath()} (mode 0600).`);
      }
    });
  });

  auth
    .command("status")
    .description("Show the resolved API key (masked) and verify it against the API")
    .action(async (_opts, cmd) => {
      await runCommand(cmd, async (output) => {
        const globals = cmd.optsWithGlobals() as { apiKey?: string; baseUrl?: string };
        const config = readConfig();

        const source = globals.apiKey
          ? "--api-key flag"
          : process.env.SUWAPPU_API_KEY
            ? "SUWAPPU_API_KEY env var"
            : config.apiKey
              ? "config file"
              : "none";
        const resolvedKey = globals.apiKey || process.env.SUWAPPU_API_KEY || config.apiKey;

        if (!resolvedKey) {
          if (output === "json") {
            console.log(JSON.stringify({ success: true, authenticated: false, source: "none" }));
          } else {
            console.log("Not authenticated. Run `suwappu auth` or set SUWAPPU_API_KEY.");
          }
          return;
        }

        const client = getClient(globals);
        let verified = false;
        let agentName: string | null = null;
        try {
          const me = await client.me();
          verified = true;
          agentName = me.name;
        } catch {
          verified = false;
        }

        if (output === "json") {
          console.log(
            JSON.stringify({
              success: true,
              authenticated: verified,
              source,
              api_key: maskKey(resolvedKey),
              agent_name: agentName,
            }),
          );
        } else {
          const rows: Array<[string, string]> = [
            ["API Key", maskKey(resolvedKey)],
            ["Source", source],
            ["Verified", verified ? theme.gain("yes") : theme.loss("no (GET /v1/agent/me failed)")],
          ];
          if (agentName) rows.push(["Agent", agentName]);
          console.log(keyValueTable(rows));
        }
      });
    });
}
