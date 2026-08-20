/**
 * Dispatch for the three `suwappu ai` backends. No new runtime deps: global
 * `fetch`/`AbortController` for router, `node:child_process` for the local
 * `claude` / `codex` CLIs.
 */
import { spawn, spawnSync } from "node:child_process";
import { CliError } from "../utils/output.js";
import type { AiConfig } from "../utils/config.js";

export const DEFAULT_ROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const DEFAULT_ROUTER_MODEL = "anthropic/claude-sonnet-5";
const ROUTER_TIMEOUT_MS = 120_000;

/** Checks a CLI binary is on PATH by running `<bin> --version`. */
export function checkBinaryOnPath(bin: string): boolean {
  try {
    const result = spawnSync(bin, ["--version"], { stdio: "ignore" });
    return result.error == null && result.status === 0;
  } catch {
    return false;
  }
}

interface RouterChatCompletion {
  choices?: Array<{ message?: { content?: string } }>;
}

/** POSTs an OpenAI-compatible /chat/completions request and returns the assistant text. */
export async function runRouter(
  systemPrompt: string,
  prompt: string,
  ai: AiConfig,
): Promise<string> {
  const baseUrl = (ai.baseUrl || DEFAULT_ROUTER_BASE_URL).replace(/\/+$/, "");
  const model = ai.model || DEFAULT_ROUTER_MODEL;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ROUTER_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${ai.apiKey ?? ""}`,
      },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
      }),
      signal: controller.signal,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new CliError("router_request_failed", `Router request failed: ${message}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new CliError(
      "router_http_error",
      `Router request failed: ${res.status} ${res.statusText} — ${body.slice(0, 300)}`,
    );
  }

  const data = (await res.json()) as RouterChatCompletion;
  return data.choices?.[0]?.message?.content ?? "";
}

/** Runs a child process with inherited stdio and resolves with its exit code. */
function spawnInherit(cmd: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}

/** `claude -p "<prompt>" --append-system-prompt "<system>"`, stdio inherited. */
export async function runClaudeBackend(systemPrompt: string, prompt: string): Promise<void> {
  const code = await spawnInherit("claude", ["-p", prompt, "--append-system-prompt", systemPrompt]);
  if (code !== 0) {
    throw new CliError("backend_error", `\`claude\` exited with code ${code}`);
  }
}

/** `codex exec "<system>\n\n<prompt>"` — codex has no system-prompt flag. */
export async function runChatgptBackend(systemPrompt: string, prompt: string): Promise<void> {
  const fullPrompt = `${systemPrompt}\n\n${prompt}`;
  const code = await spawnInherit("codex", ["exec", fullPrompt]);
  if (code !== 0) {
    throw new CliError("backend_error", `\`codex\` exited with code ${code}`);
  }
}
