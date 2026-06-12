# Elytro CLI

A command-line interface for ERC-4337 smart account wallets. Built for power users and AI agents managing smart accounts across multiple chains.

## Installation

```bash
npm install -g @elytro/cli
# or
bun add -g @elytro/cli
# or
pnpm add -g @elytro/cli
```

## Quick Start

```bash
# Initialize wallet (creates vault + EOA)
elytro init

# Create a smart account on OP Sepolia
elytro account create --chain 11155420 --email user@example.com --daily-limit 100

# Send a transaction
elytro tx send --tx "to:0xRecipient,value:0.1"

# Check balance
elytro query balance
```

## Key Features

- **Multi-account management** — Create multiple smart accounts per chain with user-friendly aliases
- **Zero-interaction security** — vault key stored in the system keychain when available; otherwise Elytro falls back to `~/.elytro/.vault-key` with restricted permissions
- **Flexible transaction building** — Single transfers, batch operations, contract calls via unified `--tx` syntax
- **Transaction simulation** — Preview gas, paymaster sponsorship, and balance impact before sending
- **Cross-chain support** — Manage accounts across Ethereum, Optimism, Arbitrum, Polygon, Base, and testnets
- **SecurityHook (2FA)** — Install on-chain 2FA with email OTP and daily spending limits
- **Deferred OTP** — Commands that require OTP exit immediately after sending the code; complete later with `elytro otp submit <id> <code>`
- **Self-updating** — `elytro update` detects your package manager and upgrades in place
- **x402 payments** — Pay HTTP 402 endpoints directly from your smart account via ERC-7710 delegations or EIP-3009 authorizations (see [docs/x402.md](docs/x402.md))

## Supported Chains

| Chain            | Chain ID |
| ---------------- | -------- |
| Ethereum         | 1        |
| Optimism         | 10       |
| Polygon          | 137      |
| Arbitrum One     | 42161    |
| Base             | 8453     |
| Sepolia          | 11155111 |
| Optimism Sepolia | 11155420 |

Public RPC and bundler endpoints are used by default. Provide your own Alchemy/Pimlico keys for higher rate limits.

## Architecture

| Component          | Purpose                                          |
| ------------------ | ------------------------------------------------ |
| **SecretProvider** | Vault key management (Keychain / env var)        |
| **KeyringService** | EOA encryption + decryption (AES-GCM)            |
| **AccountService** | Smart account lifecycle (CREATE2, multi-account) |
| **SdkService**     | `@elytro/sdk` wrapper (UserOp building)          |
| **FileStore**      | Persistent state (`~/.elytro/`)                  |

## Security Model

- **No plaintext keys on disk** — vault key stored in system keychain or injected at runtime
- **AES-GCM encryption** — all private keys encrypted with vault key before storage
- **Permission-guarded fallback** — when the OS keychain is unavailable, Elytro stores the vault key in `~/.elytro/.vault-key` with owner-only permissions
- **Memory cleanup** — all key buffers zeroed after use

## Configuration

| Variable             | Purpose                       | Required              |
| -------------------- | ----------------------------- | --------------------- |
| `ELYTRO_ALCHEMY_KEY` | Alchemy RPC endpoint          | Optional (rate limit) |
| `ELYTRO_PIMLICO_KEY` | Bundler + paymaster           | Optional (rate limit) |
| `ELYTRO_ENV`         | `development` or `production` | Optional              |

Persist API keys:

```bash
elytro config set alchemy-key <key>
elytro config set pimlico-key <key>
```

## Commands

```bash
# Account Management
elytro account create --chain <chainId> [--alias name] [--email addr] [--daily-limit amount]
elytro account list [alias|address]
elytro account info [alias|address]
elytro account switch [alias|address]
elytro account activate [alias|address]   # Deploy to chain

# Transactions
elytro tx send --tx "to:0xAddr,value:0.1" [--tx ...]
elytro tx build --tx "to:0xAddr,data:0xab..."
elytro tx simulate --tx "to:0xAddr,value:0.1"

# x402 Payments
elytro delegation list|add|show|remove
elytro request [--dry-run] <url> [--method POST --json '{"foo":"bar"}']

See [docs/x402.md](docs/x402.md) for the full workflow (delegation setup, dry runs, settlement output).

# Queries
elytro query balance [account] [--token erc20Addr]
elytro query tokens [account]
elytro query tx <hash>
elytro query chain
elytro query address <address>

# Security (2FA + spending limits)
elytro security status
elytro security 2fa install [--capability 1|2|3]
elytro security 2fa uninstall
elytro security 2fa uninstall --force           # Start safety-delay countdown
elytro security 2fa uninstall --force --execute # Execute after delay
elytro security email bind <email>
elytro security email change <email>
elytro security spending-limit [amount]         # View or set daily USD limit

# OTP (deferred verification)
elytro otp submit <id> <code>   # Complete a pending OTP verification
elytro otp cancel [id]          # Cancel pending OTP(s)
elytro otp list                 # List pending OTPs for current account

# Updates
elytro update              # Check and upgrade to latest
elytro update check        # Check without installing

# Config
elytro config set <key> <value>
elytro config get <key>
elytro config list
```

## Deferred OTP Flow

When a command requires OTP verification (e.g. `security email bind`, `tx send` with 2FA), the CLI sends the OTP to your email and exits immediately instead of blocking for input. To complete the action:

1. Check your email for the 6-digit code.
2. Run `elytro otp submit <id> <code>`, where `<id>` is printed in the command output (e.g. `elytro otp submit abc123 654321`).

The `<id>` is returned in the JSON output as `otpPending.id` and in the stderr hint. Use `elytro otp list` to see all pending OTPs for the current account, or `elytro otp cancel [id]` to cancel.

## Development

```bash
bun install
bun dev <command>      # Run from source
bun run build          # Build to dist/
bun run test           # Smoke tests
```
