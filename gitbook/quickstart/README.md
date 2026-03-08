# Quick Start

Get up and running with the Suwappu Agent API in minutes. No SDK installation required — all you need is `curl` or any HTTP client.

## Prerequisites

- **An HTTP client**: `curl`, Postman, or any programming language with HTTP support
- **No account needed to start**: The registration endpoint is public, so you can create an API key with a single request

## What You'll Learn

1. **[Your First Swap](first-swap.md)** — A step-by-step walkthrough of the core flow: register for an API key, get a quote, execute a swap, and check the transaction status. Includes full `curl` commands and realistic JSON responses.

2. **[SDK Examples](sdk-examples.md)** — Complete, runnable scripts in Bash (curl), Python, and TypeScript that perform the entire register-to-swap flow. Copy, paste, and run.

## The Core Flow

Every interaction with the Suwappu Agent API follows four steps:

```
Register --> Get Quote --> Execute Swap --> Check Status
```

- **Register** returns an API key you use for all authenticated requests.
- **Get Quote** returns a time-limited quote with exchange rate details.
- **Execute Swap** submits the quoted swap for on-chain execution.
- **Check Status** polls the transaction until it completes.

## Base URL

```
https://api.suwappu.bot/v1/agent
```

## Next Steps

Start with [Your First Swap](first-swap.md) to see the API in action.
