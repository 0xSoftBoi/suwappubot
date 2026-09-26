import type { Command } from "commander";
import {
  checkBinaryOnPath,
  DEFAULT_ROUTER_BASE_URL,
  DEFAULT_ROUTER_MODEL,
  runChatgptBackend,
  runClaudeBackend,
  runRouter,
} from "../ai/backends.js";
import {
  appendJournalEntry,
  computeJournalDigest,
  journalPath,
  lessonsPath,
  readJournalEntries,
  readLessonsFile,
  writeLessonsTemplate,
} from "../ai/harness.js";
import { maskApiKey } from "../ai/mask.js";
import { buildSystemPromptFromDisk } from "../ai/systemPrompt.js";
import type { AiBackend, AiConfig } from "../utils/config.js";
import { readConfig, writeConfig } from "../utils/config.js";
import { CliError, runCommand } from "../utils/output.js";
import { promptSecret } from "../utils/prompt.js";

const BACKENDS: AiBackend[] = ["router", "claude", "chatgpt"];
const INSTALL_HINTS: Record<"claude" | "codex", string> = {
  claude: "Install: npm install -g @anthropic-ai/claude-code (or see claude.com/code).",
  codex: "Install: npm install -g @openai/codex (or see the Codex CLI docs).",
};

export function registerAi(program: Command) {
  const ai = program
    .command("ai")
    .description("Ask an AI assistant, backed by OpenRouter, your local Claude Code, or Codex CLI")
    .argument("[prompt...]", "Prompt to send (no quoting needed for multiple words)")
    .action(async (promptParts: string[], _opts, cmd) => {
      await runCommand(cmd, async () => {
        const config = readConfig();
        if (!config.ai) {
          throw new CliError(
            "not_configured",
            "No AI backend configured. Run `suwappu ai setup --backend router|claude|chatgpt` first.",
          );
        }
        if (!promptParts || promptParts.length === 0) {
          throw new CliError(
            "invalid_input",
            "Usage: suwappu ai <prompt...>  (also see `suwappu ai setup`, `suwappu ai journal`, `suwappu ai lessons`)",
          );
        }
        await runAsk(config.ai, promptParts.join(" "));
      });
    });

  ai.command("setup")
    .description("Configure the backend used by `suwappu ai`")
    .requiredOption("--backend <backend>", "router | claude | chatgpt")
    .option("--api-key <key>", "API key for the router backend")
    .option("--base-url <url>", "OpenAI-compatible base URL (router backend)", DEFAULT_ROUTER_BASE_URL)
    .option("--model <model>", "Model id (router backend)", DEFAULT_ROUTER_MODEL)
    .action(async (opts, cmd) => {
      await runCommand(cmd, async (output) => {
        const backend = opts.backend as string;
        if (!BACKENDS.includes(backend as AiBackend)) {
          throw new CliError("invalid_input", `--backend must be one of: ${BACKENDS.join(", ")}`);
        }

        // `--api-key` / `--base-url` also exist as global root options (for the
        // Suwappu API key, a different concept). Commander shadows same-named
        // ancestor options out of the local `opts`, so read the merged,
        // local-wins view instead — see cmd.optsWithGlobals().
        const merged = cmd.optsWithGlobals() as { apiKey?: string; baseUrl?: string };

        if (backend === "router") {
          let apiKey: string | undefined = merged.apiKey;
          if (!apiKey) apiKey = await promptSecret("Router API key: ");
          if (!apiKey) throw new CliError("invalid_input", "API key cannot be empty");

          const aiConfig: AiConfig = {
            backend: "router",
            apiKey,
            baseUrl: merged.baseUrl,
            model: opts.model,
          };
          writeConfig({ ...readConfig(), ai: aiConfig });

          if (output === "json") {
            console.log(
              JSON.stringify({
                success: true,
                backend: "router",
                api_key: maskApiKey(apiKey),
                base_url: aiConfig.baseUrl,
                model: aiConfig.model,
              }),
            );
          } else {
            console.log(`Saved router config (API key never echoed): ${maskApiKey(apiKey)}`);
            console.log(`Base URL: ${aiConfig.baseUrl}`);
            console.log(`Model: ${aiConfig.model}`);
          }
          return;
        }

        const bin = backend === "claude" ? "claude" : "codex";
        if (!checkBinaryOnPath(bin)) {
          throw new CliError(
            "missing_binary",
            `\`${bin}\` was not found on PATH. ${INSTALL_HINTS[bin]}`,
          );
        }
        writeConfig({ ...readConfig(), ai: { backend: backend as AiBackend } });

        const explanation =
          backend === "claude"
            ? "runs through your local Claude Code CLI — your Claude subscription login drives it."
            : "runs through your local Codex CLI — your ChatGPT subscription login drives it.";

        if (output === "json") {
          console.log(JSON.stringify({ success: true, backend }));
        } else {
          console.log(`Backend set to "${backend}" — ${explanation}`);
        }
      });
    });

  ai.command("journal")
    .description("Show a digest of the local run journal (~/.suwappu/harness/journal.jsonl)")
    .action(async (_opts, cmd) => {
      await runCommand(cmd, async (output) => {
        const entries = readJournalEntries();
        const digest = computeJournalDigest(entries);

        if (output === "json") {
          console.log(JSON.stringify({ success: true, path: journalPath(), ...digest }));
          return;
        }

        if (digest.total === 0) {
          console.log(`No journal entries yet at ${journalPath()}. Run \`suwappu ai <prompt>\` first.`);
          return;
        }

        console.log(`Journal: ${journalPath()}`);
        console.log(`Total runs: ${digest.total}`);
        console.log(
          `Failure rate: ${(digest.failureRate * 100).toFixed(1)}% (${digest.failures}/${digest.total})`,
        );
        console.log("By backend:");
        for (const [backend, count] of Object.entries(digest.byBackend)) {
          console.log(`  ${backend}: ${count}`);
        }
        console.log("Last 5 runs:");
        for (const entry of digest.last5) {
          const label = entry.model ? `${entry.backend}/${entry.model}` : entry.backend;
          console.log(
            `  [${entry.ts}] ${label} ${entry.ok ? "ok" : "FAIL"} ${entry.ms}ms — ${entry.prompt}`,
          );
        }
      });
    });

  ai.command("lessons")
    .description("Show the local lessons file (~/.suwappu/harness/lessons.md)")
    .option("--init", "Create a seeded template if the file doesn't exist")
    .action(async (opts, cmd) => {
      await runCommand(cmd, async (output) => {
        const existing = readLessonsFile();
        if (existing) {
          if (output === "json") {
            console.log(JSON.stringify({ success: true, path: lessonsPath(), content: existing }));
          } else {
            console.log(existing);
          }
          return;
        }

        if (opts.init) {
          writeLessonsTemplate();
          const content = readLessonsFile() ?? "";
          if (output === "json") {
            console.log(
              JSON.stringify({ success: true, path: lessonsPath(), created: true, content }),
            );
          } else {
            console.log(`Created ${lessonsPath()} with a seeded template.\n`);
            console.log(content);
          }
          return;
        }

        const help = [
          `No lessons file found at ${lessonsPath()}.`,
          "Format: a `### title` heading followed by up to 3 lines, capped at 25 lessons.",
          "Run `suwappu ai lessons --init` to create a seeded template.",
        ];
        if (output === "json") {
          console.log(
            JSON.stringify({ success: true, path: lessonsPath(), exists: false, help }),
          );
        } else {
          console.log(help.join("\n"));
        }
      });
    });
}

async function runAsk(aiConfig: AiConfig, prompt: string): Promise<void> {
  const systemPrompt = buildSystemPromptFromDisk();
  const startedAt = Date.now();
  let ok = false;
  try {
    if (aiConfig.backend === "router") {
      const text = await runRouter(systemPrompt, prompt, aiConfig);
      console.log(text);
    } else if (aiConfig.backend === "claude") {
      await runClaudeBackend(systemPrompt, prompt);
    } else {
      await runChatgptBackend(systemPrompt, prompt);
    }
    ok = true;
  } finally {
    appendJournalEntry({
      ts: new Date().toISOString(),
      backend: aiConfig.backend,
      model: aiConfig.model,
      ok,
      ms: Date.now() - startedAt,
      prompt: prompt.slice(0, 120),
    });
  }
}
