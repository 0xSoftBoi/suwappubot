#!/usr/bin/env node
import { parseCommands } from "./llm.js";
import { execCommand, execCommands } from "./executor.js";
import type { CommandResult } from "./executor.js";

const VERSION = "0.2.1";

const HELP = `\
Usage: elytro-wrapper [options] "<natural language input>"

Options:
  -h, --help     Show this help message
  -v, --version  Print version number
  --skill        Print the agent skill description for elytro-wrapper

Examples:
  elytro-wrapper "check my balance"
  elytro-wrapper "switch to Arbitrum"
  elytro-wrapper "send 0.01 ETH to 0xRecipient"
`;

const SKILL = `\
# elytro-wrapper

## Description
elytro-wrapper is a natural-language frontend for the Elytro Ethereum smart-account CLI.
It accepts a plain-English instruction, translates it into the correct \`elytro\` CLI
command(s) using a local 0.6B LLM running entirely on the user's machine, executes them,
and returns structured JSON results. No remote API calls are made.

## When to use
Use elytro-wrapper whenever the user wants to interact with their Elytro smart-account wallet:
- Checking balances or token holdings
- Listing, creating, activating, or switching accounts across chains
- Sending transactions or simulating them
- Swapping tokens (cross-chain included)
- Managing security settings (2FA, email, spending limits)
- Viewing or managing delegations
- Checking or managing recovery contacts and backup
- Querying OTPs, services, chain info, or config

Do NOT use elytro-wrapper for:
- General blockchain queries unrelated to the user's Elytro wallet
- Anything that requires browser interaction or a UI

## Usage
\`\`\`
elytro-wrapper "<natural language instruction>"
\`\`\`

## Output format
Always returns a JSON array printed to stdout. Each element represents one executed command:
\`\`\`json
[
  {
    "cmd": "elytro query balance",
    "succ": true,
    "stdout": "{ \\"success\\": true, \\"result\\": { ... } }",
    "stderr": ""
  }
]
\`\`\`

| Field    | Type    | Description                              |
|----------|---------|------------------------------------------|
| cmd      | string  | The full CLI command that was run        |
| succ     | boolean | true when exit code was 0               |
| stdout   | string  | Raw stdout from the command              |
| stderr   | string  | Raw stderr from the command              |

## Error cases
| Situation                          | cmd           | succ  |
|------------------------------------|---------------|-------|
| Input cannot be mapped to command  | __UNKNOWN__   | false |
| Command not in allowlist           | original cmd  | false |
| Command execution fails            | original cmd  | false |

## Input examples
\`\`\`
elytro-wrapper "check my balance"
elytro-wrapper "show all accounts"
elytro-wrapper "switch to Arbitrum"
elytro-wrapper "send 0.01 ETH to 0xRecipient"
elytro-wrapper "swap 1 ETH for USDC"
elytro-wrapper "check security status"
elytro-wrapper "list delegations"
elytro-wrapper "export recovery backup"
\`\`\`

## Notes
- Multi-step operations (tx send, swap) are handled automatically: simulate/quote always runs first.
- Account context (chain, address) is resolved automatically from the user's wallet state.
- The local LLM loads on first call (~1-2 s cold start on CPU).
`;

const UNKNOWN_RESULT: CommandResult[] = [
  {
    cmd: "__UNKNOWN__",
    succ: false,
    stdout: "",
    stderr: "Cannot map input to a valid elytro command.",
  },
];

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Handle flags before any LLM/exec work
  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    process.stdout.write(HELP);
    process.exit(0);
  }
  if (args.includes("-v") || args.includes("--version")) {
    process.stdout.write(VERSION + "\n");
    process.exit(0);
  }
  if (args.includes("--skill")) {
    process.stdout.write(SKILL);
    process.exit(0);
  }

  const userInput = args.join(" ").trim();

  // 1a. Pre-fetch account list so the LLM can resolve chain/alias references.
  // Keep only alias/address/chain to minimise token usage.
  let accountContext: string | undefined;
  try {
    const prefetch = await execCommand("elytro account list");
    if (prefetch.succ && prefetch.stdout.trim()) {
      const raw = JSON.parse(prefetch.stdout.trim()) as {
        result?: { accounts?: Array<Record<string, unknown>> };
      };
      const slim = (raw?.result?.accounts ?? []).map(
        (a: Record<string, unknown>) => ({
          alias: a.alias,
          address: a.address,
          chain: a.chain,
        })
      );
      accountContext = JSON.stringify({ accounts: slim });
    }
  } catch {
    // Non-fatal: proceed without account context
  }

  // 1b. Translate natural language → command list via local LLM
  let cmds: string[] = [];
  try {
    cmds = await parseCommands(userInput, accountContext);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stdout.write(
      JSON.stringify([
        { cmd: "", succ: false, stdout: "", stderr: `LLM error: ${msg}` },
      ]) + "\n"
    );
    process.exit(1);
  }

  // 2. Handle __UNKNOWN__ sentinel
  if (cmds.length === 0 || cmds.every((c) => c === "__UNKNOWN__")) {
    process.stdout.write(JSON.stringify(UNKNOWN_RESULT, null, 2) + "\n");
    // Force exit to avoid Metal GPU cleanup crash on macOS
    process.exit(1);
  }

  // 3. Execute commands sequentially and collect results
  const results = await execCommands(cmds);

  // 4. Print fixed-format JSON to stdout
  process.stdout.write(JSON.stringify(results, null, 2) + "\n");

  // Force exit to avoid a Metal GPU cleanup crash in llama.cpp on macOS
  // (GGML_ASSERT in ggml_metal_device_free during static destructor teardown).
  process.exit(0);
}

main().catch((err: unknown) => {
  process.stderr.write(String(err) + "\n");
  process.exit(1);
});
