import { Suwappu } from "../../client.js";
import { resolveApiKey, resolveBaseUrl } from "./config.js";

/**
 * Build a Suwappu client using the CLI's auth resolution order:
 *   --api-key flag > SUWAPPU_API_KEY env var > ~/.config/suwappu/config.json
 * Base URL resolves the same way via --base-url / SUWAPPU_API_URL / config file.
 * Pass `command.optsWithGlobals()` so flags set on the root program are honored
 * from any subcommand.
 */
export function getClient(globalOpts: { apiKey?: string; baseUrl?: string } = {}): Suwappu {
  return new Suwappu({
    apiKey: resolveApiKey(globalOpts.apiKey),
    baseUrl: resolveBaseUrl(globalOpts.baseUrl),
  });
}
