/**
 * Shared output/error plumbing for every CLI command — modeled on the Dune
 * CLI pattern: every command supports `-o json` for machine consumption
 * (agents, scripts) alongside a human-readable default. Errors are structured
 * JSON with a stable `code` when `-o json` is set, so a caller can branch on
 * `error.code` instead of parsing free-text messages.
 */
import type { Command } from "commander";
import { SuwappuError } from "../../client.js";

export type OutputFormat = "human" | "json";

/** Thrown by CLI code (not the API) for local validation-style failures. */
export class CliError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "CliError";
    this.code = code;
  }
}

/** Maps SuwappuError HTTP statuses to stable, agent-friendly error codes. */
const STATUS_CODES: Record<number, string> = {
  400: "validation_error",
  401: "unauthorized",
  402: "payment_required",
  403: "forbidden",
  404: "not_found",
  429: "rate_limited",
  500: "server_error",
  502: "external_service_error",
};

interface ParsedApiError {
  error?: string;
  message?: string;
  fields?: Record<string, string>;
  error_guidance?: string;
}

function parseApiErrorBody(body: string): ParsedApiError | undefined {
  try {
    const parsed = JSON.parse(body);
    return typeof parsed === "object" && parsed !== null ? (parsed as ParsedApiError) : undefined;
  } catch {
    return undefined;
  }
}

/** Read the global `-o/--output` option, inherited by every subcommand. */
export function getOutputFormat(cmd: Command): OutputFormat {
  const opts = cmd.optsWithGlobals() as { output?: string };
  return opts.output === "json" ? "json" : "human";
}

/**
 * Runs a command's body, resolving `-o json` from the command tree first so
 * both the success path and the error path know how to render.
 */
export async function runCommand(
  cmd: Command,
  fn: (output: OutputFormat) => Promise<void>,
): Promise<void> {
  const output = getOutputFormat(cmd);
  try {
    await fn(output);
  } catch (err) {
    emitError(err, output);
    process.exitCode = 1;
  }
}

export function emitError(err: unknown, output: OutputFormat): void {
  let code = "unknown_error";
  let message = err instanceof Error ? err.message : String(err);
  let fields: Record<string, string> | undefined;
  let guidance: string | undefined;

  if (err instanceof CliError) {
    code = err.code;
    message = err.message;
  } else if (err instanceof SuwappuError) {
    code = STATUS_CODES[err.status] ?? `http_${err.status}`;
    const parsed = parseApiErrorBody(err.body);
    message = parsed?.message || parsed?.error || err.message;
    fields = parsed?.fields;
    guidance = parsed?.error_guidance;
  }

  if (output === "json") {
    console.log(
      JSON.stringify({
        success: false,
        error: {
          code,
          message,
          ...(fields && { fields }),
          ...(guidance && { guidance }),
        },
      }),
    );
    return;
  }

  console.error(`Error: ${message}`);
  if (guidance) console.error(guidance);
  if (fields) {
    for (const [field, detail] of Object.entries(fields)) {
      console.error(`  ${field}: ${detail}`);
    }
  }
}
