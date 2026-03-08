import type { Command } from "commander";
import { readConfig, writeConfig, maskKey } from "../utils/config-store.js";
import { theme } from "../ui/colors.js";

const VALID_KEYS = ["api-key", "base-url"] as const;
type ConfigKey = (typeof VALID_KEYS)[number];

export function registerConfig(program: Command) {
  const config = program.command("config").description("Manage CLI configuration");

  config
    .command("set <key> <value>")
    .description("Set a config value (api-key, base-url)")
    .action((key: string, value: string) => {
      if (!VALID_KEYS.includes(key as ConfigKey)) {
        console.error(
          theme.error(`Invalid key "${key}". Valid keys: ${VALID_KEYS.join(", ")}`)
        );
        process.exit(1);
      }
      const current = readConfig();
      if (key === "api-key") current.apiKey = value;
      if (key === "base-url") current.baseUrl = value;
      writeConfig(current);
      console.log(theme.success(`Set ${key}`));
    });

  config
    .command("show")
    .description("Show current configuration")
    .action(() => {
      const cfg = readConfig();
      const env = process.env.SUWAPPU_API_KEY;
      console.log(theme.label("Configuration:"));
      console.log(
        `  API Key (config): ${cfg.apiKey ? maskKey(cfg.apiKey) : theme.muted("not set")}`
      );
      console.log(
        `  API Key (env):    ${env ? maskKey(env) : theme.muted("not set")}`
      );
      console.log(
        `  Base URL:         ${cfg.baseUrl ?? theme.muted("default (https://api.suwappu.bot)")}`
      );
    });
}
