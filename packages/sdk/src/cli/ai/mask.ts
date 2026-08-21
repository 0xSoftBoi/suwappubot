/**
 * Return a non-secret status marker for API-key display.
 *
 * Do not preserve a prefix, suffix, length, or any other key-derived material:
 * CLI output can be captured in logs and CI artifacts, so even partial-key
 * fingerprints are unnecessary exposure.
 */
export function maskApiKey(key: string): string {
  return key ? "[configured]" : "[not configured]";
}
