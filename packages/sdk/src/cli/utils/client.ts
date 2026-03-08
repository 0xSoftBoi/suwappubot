import { createClient, type SuwappuClient } from "@suwappu/openclaw";
import { readConfig } from "./config-store.js";

export interface ClientOptions {
  apiKey?: string;
  baseUrl?: string;
}

export function getClient(opts?: ClientOptions): SuwappuClient {
  const config = readConfig();
  return createClient({
    apiKey: opts?.apiKey ?? process.env.SUWAPPU_API_KEY ?? config.apiKey,
    baseUrl: opts?.baseUrl ?? config.baseUrl,
  });
}
