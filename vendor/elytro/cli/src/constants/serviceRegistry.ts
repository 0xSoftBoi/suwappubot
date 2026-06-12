/** Base URL for the Elytro service registry API. */
export const DEFAULT_SERVICE_REGISTRY_API =
  'https://raw.githubusercontent.com/Elytro-eth/cli-x402-registry/main/';
/** Resolved service registry API base URL (overridable via env). */
export const SERVICE_REGISTRY_API =
  process.env.ELYTRO_SERVICE_REGISTRY_API ?? DEFAULT_SERVICE_REGISTRY_API;
