import chalk from 'chalk';

/**
 * Terminal display helpers.
 * Keeps output consistent across all commands.
 */

export function heading(text: string): void {
  console.log(chalk.bold.cyan(`\n${text}\n`));
}

function writeJson(stream: NodeJS.WriteStream, value: unknown): void {
  stream.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function muted(text: string): string {
  return chalk.gray(text);
}

export function accent(text: string): string {
  return chalk.cyan(text);
}

export function highlight(text: string): string {
  return chalk.bold(text);
}

export function linkText(text: string): string {
  return chalk.underline.cyan(text);
}

export function commandText(text: string): string {
  return chalk.bold.cyan(text);
}

export function info(label: string, value: string): void {
  console.log(`  ${chalk.gray(label + ':')} ${value}`);
}

export function success(text: string): void {
  console.log(chalk.green(`✔ ${text}`));
}

export function warn(text: string): void {
  console.log(chalk.yellow(`⚠ ${text}`));
}

export function error(text: string): void {
  console.error(chalk.red(`✖ ${text}`));
}

/**
 * Structured error output aligned with JSON-RPC / MCP conventions.
 *
 * Format:
 *   { "success": false, "error": { "code": <number>, "message": <string>, "data": { ... } } }
 *
 * Error codes follow JSON-RPC reserved range convention:
 *   -32602  Invalid params (bad --tx spec, missing required fields)
 *   -32001  Insufficient balance
 *   -32002  Account not ready (not initialized, not deployed)
 *   -32003  Sponsorship failed
 *   -32004  Build / estimation failed
 *   -32005  Sign / send failed
 *   -32006  Execution reverted (UserOp included but reverted on-chain)
 *   -32000  Unknown / internal error
 */
export interface TxErrorPayload {
  code: number;
  message: string;
  data?: Record<string, unknown>;
}

export function outputStderrJson(value: unknown): void {
  writeJson(process.stderr, value);
}

export function txError(payload: TxErrorPayload): void {
  const output = {
    success: false,
    error: {
      code: payload.code,
      message: payload.message,
      ...(payload.data && Object.keys(payload.data).length > 0 ? { data: payload.data } : {}),
    },
  };
  outputStderrJson(output);
}

export function table(
  rows: Record<string, string>[],
  columns: { key: string; label: string; width?: number }[],
): void {
  // Header
  const header = columns.map((c) => c.label.padEnd(c.width ?? 20)).join('  ');
  console.log(chalk.bold(header));
  console.log(chalk.gray('─'.repeat(header.length)));

  // Rows
  for (const row of rows) {
    const line = columns.map((c) => (row[c.key] ?? '').padEnd(c.width ?? 20)).join('  ');
    console.log(line);
  }
}

export function address(addr: string): string {
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 8)}...${addr.slice(-6)}`;
}

/**
 * Mask API keys in URLs before outputting.
 *
 * Handles two common patterns:
 *   1. Path-based keys (Alchemy): `/v2/<key>` → `/v2/***`
 *   2. Query-param keys (Pimlico): `?apikey=<key>` → `?apikey=***`
 *
 * Also catches generic patterns: `api_key`, `key`, `token`, `secret` in query params.
 */
export function maskApiKeys(url: string): string {
  let masked = url;
  // Alchemy-style: key is the LAST path segment after /v<n>/ (e.g. /v2/<key>)
  // Only matches when the segment after /v<n>/ is the final path component (possibly followed by ? or #)
  masked = masked.replace(/(\/v\d+\/)[^/?#]+(\?|#|$)/gi, '$1***$2');
  // Query-param keys: apikey, api_key, key, token, secret
  masked = masked.replace(/([?&](?:apikey|api_key|key|token|secret))=[^&#]+/gi, '$1=***');
  return masked;
}

/**
 * Sanitize an error message by masking any embedded URLs that may contain API keys.
 *
 * Useful for catching viem/SDK errors that include the RPC endpoint in their message.
 */
export function sanitizeErrorMessage(message: string): string {
  // Match http(s) URLs and mask any API keys in them
  return message.replace(/https?:\/\/[^\s"']+/gi, (match) => maskApiKeys(match));
}

export function printCallout(
  title: string,
  lines: string[],
  tone: 'info' | 'warning' | 'success' = 'info',
  stream: 'stdout' | 'stderr' = 'stderr',
): void {
  const color = tone === 'warning' ? chalk.yellow : tone === 'success' ? chalk.green : chalk.cyan;
  const writer = stream === 'stdout' ? console.log : console.error;

  writer('');
  writer(color.bold(title));
  for (const line of lines) {
    writer(`  ${line}`);
  }
  writer('');
}

// ─── Structured JSON Output (MCP / JSON-RPC convention) ─────────

/**
 * Output a structured success result.
 *
 * Format: { "success": true, "result": { ... } }
 *
 * All commands MUST use this for their success output so that
 * callers (MCP, scripts, OpenClaw) can parse results uniformly.
 */
export function outputResult(result: Record<string, unknown>): void {
  writeJson(process.stdout, { success: true, result });
}

/**
 * Output a structured error and set non-zero exit code.
 *
 * Format: { "success": false, "error": { "code": <number>, "message": <string>, "data"?: { ... } } }
 *
 * Error codes follow JSON-RPC convention (see TxErrorPayload jsdoc above).
 */
export function outputError(code: number, message: string, data?: Record<string, unknown>): never {
  txError({ code, message: sanitizeErrorMessage(message), data });
  process.exit(1);
}
