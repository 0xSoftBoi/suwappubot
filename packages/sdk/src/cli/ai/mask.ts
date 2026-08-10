/**
 * Mask an API key for display, e.g. `sk-or-v1-abc123` -> `sk-or-...c123`.
 * Never echo the real key back to the terminal.
 */
export function maskApiKey(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "*".repeat(key.length);

  // Preserve a short recognizable prefix up to (and including) the first
  // dash, e.g. "sk-", "sk-or-v1-" — falls back to the first 3 chars for
  // keys with no dash-delimited prefix.
  const dashIndex = key.indexOf("-");
  const prefix = dashIndex > 0 && dashIndex <= 9 ? key.slice(0, dashIndex + 1) : key.slice(0, 3);
  return `${prefix}...${key.slice(-4)}`;
}
