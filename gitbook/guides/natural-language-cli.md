# Natural Language Trade CLI

This guide builds an interactive REPL where you type plain English commands like "swap 0.5 ETH to USDC on base" or "show my portfolio" and get formatted responses. It demonstrates the A2A (Agent-to-Agent) protocol's natural language communication.

## What the CLI Does

1. Loads your API key from environment variables
2. Starts an interactive REPL with a `suwappu> ` prompt
3. Sends your natural language input to Suwappu via A2A `message/send`
4. Parses the task response — if `completed`, pretty-prints artifacts
5. If `working` or `submitted`, polls with `tasks/get` and shows a spinner
6. Supports Ctrl+C to cancel running tasks via `tasks/cancel`
7. Keeps a local task history accessible with the `history` command

## Python Version

```python
#!/usr/bin/env python3
"""
Suwappu Natural Language Trade CLI — Python
Interactive REPL for communicating with Suwappu via the A2A protocol.
"""

import os
import sys
import json
import time
import signal
import requests

A2A_URL = "https://api.suwappu.bot/a2a"

# Spinner frames for polling animation
SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

# Track state
request_id = 0
task_history = []
current_task_id = None


def next_id():
    """Generate incrementing JSON-RPC request IDs."""
    global request_id
    request_id += 1
    return request_id


def a2a_request(headers, method, params):
    """Send a JSON-RPC 2.0 request to the A2A endpoint."""
    payload = {
        "jsonrpc": "2.0",
        "id": next_id(),
        "method": method,
        "params": params,
    }
    response = requests.post(A2A_URL, headers=headers, json=payload)
    response.raise_for_status()
    data = response.json()

    if "error" in data:
        raise Exception(f"A2A error {data['error']['code']}: {data['error']['message']}")

    return data["result"]


def send_message(headers, text):
    """Send a natural language message via message/send."""
    return a2a_request(headers, "message/send", {
        "message": {
            "role": "user",
            "parts": [{"type": "text", "text": text}],
        }
    })


def get_task(headers, task_id):
    """Poll a task by ID via tasks/get."""
    return a2a_request(headers, "tasks/get", {"taskId": task_id})


def cancel_task(headers, task_id):
    """Cancel a running task via tasks/cancel."""
    return a2a_request(headers, "tasks/cancel", {"taskId": task_id})


def format_artifacts(artifacts):
    """Pretty-print task artifacts."""
    output = []
    for artifact in artifacts:
        for part in artifact.get("parts", []):
            if part["type"] == "text":
                output.append(part["text"])
            elif part["type"] == "data":
                output.append(json.dumps(part["data"], indent=2))
    return "\n".join(output)


def poll_task(headers, task_id):
    """Poll a task until it reaches a terminal state, showing a spinner."""
    global current_task_id
    current_task_id = task_id
    frame = 0

    try:
        while True:
            result = get_task(headers, task_id)
            task = result["task"]
            state = task["status"]["state"]

            if state == "completed":
                # Clear spinner line
                sys.stdout.write("\r" + " " * 40 + "\r")
                if task.get("artifacts"):
                    print(format_artifacts(task["artifacts"]))
                else:
                    print(task["status"].get("message", "Done."))
                return task

            elif state in ("failed", "canceled"):
                sys.stdout.write("\r" + " " * 40 + "\r")
                message = task["status"].get("message", state.capitalize())
                print(f"Task {state}: {message}")
                return task

            # Show spinner
            sys.stdout.write(f"\r  {SPINNER[frame % len(SPINNER)]} Processing...")
            sys.stdout.flush()
            frame += 1
            time.sleep(1)

    finally:
        current_task_id = None


def handle_response(headers, result):
    """Handle a message/send response — print immediately or poll."""
    task = result["task"]
    state = task["status"]["state"]
    task_id = task["id"]

    # Save to history
    task_history.append({
        "id": task_id,
        "state": state,
        "timestamp": task["status"].get("timestamp", ""),
    })

    if state == "completed":
        if task.get("artifacts"):
            print(format_artifacts(task["artifacts"]))
        else:
            print(task["status"].get("message", "Done."))
    elif state in ("submitted", "working"):
        poll_task(headers, task_id)
    elif state == "failed":
        message = task["status"].get("message", "Unknown error")
        print(f"Failed: {message}")
    else:
        print(f"Unexpected state: {state}")


def print_history():
    """Print local task history."""
    if not task_history:
        print("No task history yet.")
        return

    print(f"\n  {'#':<4} {'Task ID':<40} {'State':<12} {'Time'}")
    print(f"  {'-' * 70}")
    for i, entry in enumerate(task_history, 1):
        print(f"  {i:<4} {entry['id']:<40} {entry['state']:<12} {entry['timestamp']}")
    print()


def print_help():
    """Print help text."""
    print("""
  Suwappu Natural Language CLI
  ────────────────────────────
  Type any natural language command. Examples:

    swap 0.5 ETH to USDC on base
    price of ETH
    prices for ETH, BTC, SOL
    show my portfolio on ethereum
    list supported chains
    quote 100 USDC to WBTC

  Special commands:
    help      Show this help message
    history   Show task history
    quit      Exit the CLI

  Press Ctrl+C during a running task to cancel it.
""")


def setup_signal_handler(headers):
    """Set up Ctrl+C handler to cancel running tasks."""
    def handler(sig, frame):
        global current_task_id
        if current_task_id:
            sys.stdout.write("\r" + " " * 40 + "\r")
            print("Canceling task...")
            try:
                cancel_task(headers, current_task_id)
                print("Task canceled.")
            except Exception as e:
                print(f"Cancel failed: {e}")
            current_task_id = None
        else:
            print("\nGoodbye!")
            sys.exit(0)

    signal.signal(signal.SIGINT, handler)


def main():
    api_key = os.environ.get("SUWAPPU_API_KEY")
    if not api_key:
        print("Error: Set SUWAPPU_API_KEY environment variable.")
        print("  export SUWAPPU_API_KEY=suwappu_sk_your_api_key")
        sys.exit(1)

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    setup_signal_handler(headers)
    print_help()

    while True:
        try:
            user_input = input("suwappu> ").strip()
        except EOFError:
            print("\nGoodbye!")
            break

        if not user_input:
            continue

        # Handle special commands
        lower = user_input.lower()
        if lower == "quit" or lower == "exit":
            print("Goodbye!")
            break
        elif lower == "help":
            print_help()
            continue
        elif lower == "history":
            print_history()
            continue

        # Send to A2A
        try:
            result = send_message(headers, user_input)
            handle_response(headers, result)
        except requests.exceptions.HTTPError as e:
            if e.response.status_code == 429:
                print("Rate limited. Wait a moment and try again.")
            else:
                print(f"HTTP error: {e}")
        except Exception as e:
            print(f"Error: {e}")

        print()  # Blank line between responses


if __name__ == "__main__":
    main()
```

### Running the Python Version

```bash
# Install dependencies
pip install requests

# Set your API key
export SUWAPPU_API_KEY=suwappu_sk_your_api_key

# Start the CLI
python natural_language_cli.py
```

Example session:

```
suwappu> price of ETH
ETH: $3,500.42 (+2.5% 24h)

suwappu> swap 0.5 ETH to USDC on base
Quote ready: 0.5 ETH -> 1,247.50 USDC on Base
{
  "quote_id": "q_abc123",
  "from_token": "ETH",
  "to_token": "USDC",
  "from_amount": "0.5",
  "to_amount": "1247.50",
  "chain": "base"
}

suwappu> list supported chains
Suwappu supports: ethereum, base, arbitrum, optimism, polygon, bsc, solana

suwappu> history

  #    Task ID                                  State        Time
  ----------------------------------------------------------------------
  1    a1b2c3d4-e5f6-7890-abcd-ef1234567890     completed    2026-03-08T12:00:00Z
  2    b2c3d4e5-f6a7-8901-bcde-f12345678901     completed    2026-03-08T12:00:05Z
  3    c3d4e5f6-a7b8-9012-cdef-123456789012     completed    2026-03-08T12:00:10Z

suwappu> quit
Goodbye!
```

---

## TypeScript Version

```typescript
#!/usr/bin/env npx tsx
/**
 * Suwappu Natural Language Trade CLI — TypeScript
 * Interactive REPL for communicating with Suwappu via the A2A protocol.
 */

import * as readline from "readline";

const A2A_URL = "https://api.suwappu.bot/a2a";
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

let requestId = 0;
const taskHistory: Array<{ id: string; state: string; timestamp: string }> = [];
let currentTaskId: string | null = null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function nextId(): number {
  return ++requestId;
}

async function a2aRequest(apiKey: string, method: string, params: Record<string, unknown>) {
  const response = await fetch(A2A_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: nextId(),
      method,
      params,
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(`A2A error ${data.error.code}: ${data.error.message}`);
  }
  return data.result;
}

async function sendMessage(apiKey: string, text: string) {
  return a2aRequest(apiKey, "message/send", {
    message: {
      role: "user",
      parts: [{ type: "text", text }],
    },
  });
}

async function getTask(apiKey: string, taskId: string) {
  return a2aRequest(apiKey, "tasks/get", { taskId });
}

async function cancelTask(apiKey: string, taskId: string) {
  return a2aRequest(apiKey, "tasks/cancel", { taskId });
}

function formatArtifacts(artifacts: Array<{ parts: Array<{ type: string; text?: string; data?: unknown }> }>): string {
  const output: string[] = [];
  for (const artifact of artifacts) {
    for (const part of artifact.parts ?? []) {
      if (part.type === "text" && part.text) {
        output.push(part.text);
      } else if (part.type === "data" && part.data) {
        output.push(JSON.stringify(part.data, null, 2));
      }
    }
  }
  return output.join("\n");
}

async function pollTask(apiKey: string, taskId: string) {
  currentTaskId = taskId;
  let frame = 0;

  try {
    while (true) {
      const result = await getTask(apiKey, taskId);
      const task = result.task;
      const state = task.status.state;

      if (state === "completed") {
        process.stdout.write("\r" + " ".repeat(40) + "\r");
        if (task.artifacts?.length) {
          console.log(formatArtifacts(task.artifacts));
        } else {
          console.log(task.status.message ?? "Done.");
        }
        return task;
      }

      if (state === "failed" || state === "canceled") {
        process.stdout.write("\r" + " ".repeat(40) + "\r");
        console.log(`Task ${state}: ${task.status.message ?? state}`);
        return task;
      }

      process.stdout.write(`\r  ${SPINNER[frame % SPINNER.length]} Processing...`);
      frame++;
      await sleep(1000);
    }
  } finally {
    currentTaskId = null;
  }
}

function handleResponse(apiKey: string, result: { task: any }) {
  const task = result.task;
  const state = task.status.state;

  taskHistory.push({
    id: task.id,
    state,
    timestamp: task.status.timestamp ?? "",
  });

  if (state === "completed") {
    if (task.artifacts?.length) {
      console.log(formatArtifacts(task.artifacts));
    } else {
      console.log(task.status.message ?? "Done.");
    }
    return Promise.resolve();
  }

  if (state === "submitted" || state === "working") {
    return pollTask(apiKey, task.id);
  }

  if (state === "failed") {
    console.log(`Failed: ${task.status.message ?? "Unknown error"}`);
  } else {
    console.log(`Unexpected state: ${state}`);
  }

  return Promise.resolve();
}

function printHistory() {
  if (taskHistory.length === 0) {
    console.log("No task history yet.");
    return;
  }

  console.log(`\n  ${"#".padEnd(4)} ${"Task ID".padEnd(40)} ${"State".padEnd(12)} Time`);
  console.log(`  ${"-".repeat(70)}`);
  taskHistory.forEach((entry, i) => {
    console.log(
      `  ${String(i + 1).padEnd(4)} ${entry.id.padEnd(40)} ${entry.state.padEnd(12)} ${entry.timestamp}`
    );
  });
  console.log();
}

function printHelp() {
  console.log(`
  Suwappu Natural Language CLI
  ────────────────────────────
  Type any natural language command. Examples:

    swap 0.5 ETH to USDC on base
    price of ETH
    prices for ETH, BTC, SOL
    show my portfolio on ethereum
    list supported chains
    quote 100 USDC to WBTC

  Special commands:
    help      Show this help message
    history   Show task history
    quit      Exit the CLI

  Press Ctrl+C during a running task to cancel it.
`);
}

async function main() {
  const apiKey = process.env.SUWAPPU_API_KEY;
  if (!apiKey) {
    console.error("Error: Set SUWAPPU_API_KEY environment variable.");
    process.exit(1);
  }

  // Handle Ctrl+C for task cancellation
  process.on("SIGINT", async () => {
    if (currentTaskId) {
      process.stdout.write("\r" + " ".repeat(40) + "\r");
      console.log("Canceling task...");
      try {
        await cancelTask(apiKey, currentTaskId);
        console.log("Task canceled.");
      } catch (e) {
        console.error(`Cancel failed: ${e}`);
      }
      currentTaskId = null;
    } else {
      console.log("\nGoodbye!");
      process.exit(0);
    }
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "suwappu> ",
  });

  printHelp();
  rl.prompt();

  rl.on("line", async (line) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }

    const lower = input.toLowerCase();
    if (lower === "quit" || lower === "exit") {
      console.log("Goodbye!");
      rl.close();
      process.exit(0);
    }
    if (lower === "help") {
      printHelp();
      rl.prompt();
      return;
    }
    if (lower === "history") {
      printHistory();
      rl.prompt();
      return;
    }

    try {
      const result = await sendMessage(apiKey, input);
      await handleResponse(apiKey, result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("429")) {
        console.log("Rate limited. Wait a moment and try again.");
      } else {
        console.error(`Error: ${message}`);
      }
    }

    console.log();
    rl.prompt();
  });

  rl.on("close", () => {
    console.log("\nGoodbye!");
    process.exit(0);
  });
}

main().catch(console.error);
```

### Running the TypeScript Version

```bash
# Install tsx for running TypeScript directly
npm install -g tsx

# Set your API key
export SUWAPPU_API_KEY=suwappu_sk_your_api_key

# Start the CLI
npx tsx natural_language_cli.ts
```

---

## Customization Tips

### Add Wallet Context

To automatically include your wallet address in portfolio queries, prepend it to every message:

```python
WALLET = os.environ.get("WALLET_ADDRESS", "")

def send_with_context(headers, text):
    if WALLET and "portfolio" in text.lower():
        text = f"{text} for {WALLET}"
    return send_message(headers, text)
```

### Persistent History

Save task history to a JSON file so it persists across sessions:

```python
import json
from pathlib import Path

HISTORY_FILE = Path.home() / ".suwappu_history.json"

def load_history():
    if HISTORY_FILE.exists():
        return json.loads(HISTORY_FILE.read_text())
    return []

def save_history(history):
    HISTORY_FILE.write_text(json.dumps(history, indent=2))
```

### Colored Output

Add color codes for different response types:

```python
GREEN = "\033[92m"
YELLOW = "\033[93m"
RED = "\033[91m"
RESET = "\033[0m"

def format_state(state):
    colors = {"completed": GREEN, "working": YELLOW, "failed": RED}
    color = colors.get(state, RESET)
    return f"{color}{state}{RESET}"
```

### Pipe-Friendly Mode

Detect non-interactive input for scripting:

```python
import sys

if not sys.stdin.isatty():
    # Non-interactive: read all lines, process each, exit
    for line in sys.stdin:
        result = send_message(headers, line.strip())
        handle_response(headers, result)
else:
    # Interactive REPL
    ...
```
