import { Suwappu } from "../../client.js";

/**
 * Build a Suwappu client from the environment.
 * Reads SUWAPPU_API_KEY and (optionally) SUWAPPU_API_URL.
 */
export function getClient(): Suwappu {
  return new Suwappu({
    apiKey: process.env.SUWAPPU_API_KEY,
    baseUrl: process.env.SUWAPPU_API_URL,
  });
}
