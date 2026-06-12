---
name: elytro
description: >
  Elytro smart-account wallet CLI for agents: multi-chain ERC-4337, 2FA email OTP, spending limits,
  social recovery. Simulate before send, get user approval on risky steps, and explain outcomes in a
  fixed, user-friendly format (no raw JSON unless asked). Deferred OTP completed with otp submit.
  Use for: accounts, transfers, contract calls, email/security setup, guardian recovery. Requires Node 18 or newer.
metadata:
  openclaw:
    version: 0.8.9
    product-homepage: https://elytro.com
    requires:
      bins:
        - elytro
      node: '>=18.0.0'
    emoji: '🔐'
    homepage: https://github.com/Elytro-eth/skills
    os: ['macos', 'windows', 'linux']
    install:
      - id: npm
        kind: npm
        package: '@elytro/cli'
        bins: ['elytro']
        label: 'Install Elytro CLI (npm)'
---

# Elytro CLI -- Agent Skill

**Install:** `npm install -g @elytro/cli` (Node >= 18)

**Command reference and consent list:** [references/commands.md](references/commands.md)

All CLI commands return structured JSON. On error, read `error.message` and `error.data.hint` for what went wrong, and `error.data.suggestion` for what to do next. For payment failures, also check `error.data.facilitatorResponse` for the raw upstream reply. Follow those fields rather than guessing.

---

## Quick start

```bash
elytro init
elytro account create --chain 11155420 --alias agent-primary
elytro account activate agent-primary
```

Recommended security setup after activation. **Order matters.** `security 2fa install` must run first, because it deploys the on chain 2FA hook that `email bind` and `spending-limit` both write into. Without the hook installed, the later commands will either noop locally or succeed off chain while leaving the account completely unprotected on chain. Never skip step 1, and never reorder these.

```bash
# 1. Install the on chain 2FA hook. Required first. On chain write, needs user approval.
elytro security 2fa install

# 2. Bind the email that will receive OTP codes. Will typically return otpPending; complete it.
elytro security email bind user@example.com

# 3. Set the step up threshold (USD). Above this amount, writes require OTP.
elytro security spending-limit 100

# 4. Confirm the hook is installed, the email is bound, and the limit is set.
elytro security status
```

If `security status` after step 4 shows the hook as not installed, stop and rerun `security 2fa install` before doing anything else. Any "security" change made without the hook in place is a false positive and the account is still wide open.

## Supported chains

| Chain            | ID       | Type    | Native token |
| ---------------- | -------- | ------- | ------------ |
| Ethereum         | 1        | mainnet | ETH          |
| Optimism         | 10       | mainnet | ETH          |
| Polygon          | 137      | mainnet | MATIC        |
| Arbitrum One     | 42161    | mainnet | ETH          |
| Base             | 8453     | mainnet | ETH          |
| Sepolia          | 11155111 | testnet | ETH          |
| Optimism Sepolia | 11155420 | testnet | ETH          |

Token list (`elytro token`) covers mainnet chains only. When the user asks to create an account or switch chains, use the chain ID from this table.

## Daily use

```bash
elytro query chain
elytro query balance
```

Always simulate before sending, with the same account and `--tx` arguments:

```bash
elytro tx simulate agent-primary --tx "to:0xRecipient,value:0.1"
# show the preview to the user, wait for explicit approval
elytro tx send agent-primary --tx "to:0xRecipient,value:0.1"
```

For batch calls, repeat `--tx` in the same order for both `simulate` and `send`.

## Step up verification and spending limit

`spending_limit` is a step up threshold, not a hard cap. When a write exceeds it, the backend does not reject the transaction. It pauses the transaction and asks for an email OTP, and then lets it through once the code is submitted. This is the intended path, not an error.

Concretely: submit `tx send` (or `swap send`, `request`, etc.) normally. If the response contains an `otpPending` object, that is the step up challenge. Route it through the OTP flow below. The original write completes after `otp submit`.

Do not preflight the tx amount against `spending_limit` yourself and refuse. The backend decides whether step up is needed, not the agent, and a stale local check will either block legitimate writes or skip verification that should have happened.

Do not propose raising `spending_limit` as a way to avoid an OTP prompt. The OTP is the feature. Only touch `security spending-limit` when the user explicitly asks to change their ongoing daily policy, for example "raise my daily limit to 500 for today".

Background on what these features mean and why they exist, including social recovery: [references/concepts.md](references/concepts.md).

## OTP flow

Some commands pause for email verification and return an `otpPending` object. This happens both for security changes (binding email, changing spending limit) and for ordinary writes that exceed the step up threshold. Treat all of these the same way.

Only the user should provide the code. The agent runs `elytro otp submit <id> <6-digit-code>` on their behalf -- do not ask the user to run CLI commands for OTP. Use `elytro otp list` to see pending verifications.

## x402 payments (beta)

> Beta feature. Ask user's permission before proceeding with any paid request.

### Service discovery

Browse verified x402-compatible services before making paid requests:

```bash
elytro services                   # list all available services
elytro services <id>              # show endpoints, pricing, and example commands
```

When the user asks "what paid APIs are available" or wants to find a service, start here. The detail view includes ready-to-use `elytro request` examples per endpoint.

### Paid request workflow

1. **Discover** (if the user doesn't already have a URL): `elytro services` to browse, `elytro services <id>` for endpoint details.
2. **Check readiness**: `elytro account info` to confirm the account is **deployed**. EIP-3009 payments require on-chain bytecode for ERC-1271 signature verification. If not deployed, run `account activate` first.
3. **Preview**: `elytro request --dry-run <url>` to show the price. Always do this before paying.
4. **Set up delegation** (only if dry-run shows ERC-7710): check `delegation list` for a match. If none, guide user through `delegation add` with the server-provided parameters.
5. **Pay** (after explicit user approval): `elytro request <url> [--method POST --json '...']`.
6. **Handle failure**: if the result is `payment_failed`, read `error.data.facilitatorResponse` for the raw facilitator reply and `error.data.suggestion` for the recommended next command. Common diagnostic sequence: `account info` then `query balance --token <asset>`, then retry with `--verbose` for full request/response trace. For delegation-specific errors ("expired"), use `delegation renew` or `delegation sync --prune`.

EIP-3009 (USDC) requires no delegation setup; Elytro auto-signs. However, the smart account **must be deployed** (not just counterfactual) because USDC v2.2 calls `isValidSignature` (ERC-1271) on the account contract when `ecrecover` does not match `from`.

### Delegation lifecycle

```bash
# Store
elytro delegation add \
  --manager 0xDelegationManager --token 0xUSDC \
  --payee 0xMerchant --amount 1000000 \
  --permission 0xabc123... \
  --verify          # optional: simulate on-chain before storing

# Verify
elytro delegation verify <id>
elytro delegation sync --prune          # batch verify, remove expired

# Renew
elytro delegation renew <id> --expires-at 2026-04-01T00:00:00Z --permission 0xnew... --remove-old

# Revoke
elytro delegation revoke <id> --calldata 0x...   # on-chain + local
elytro delegation remove <id>                     # local only
```

Other management: `delegation list`, `delegation show <id>`.

Full workflow and troubleshooting: [docs/x402.md](docs/x402.md)

## Token lookup

Look up token addresses before using them in swap or transfer commands. Never guess a token address.

```bash
elytro token                           # all tokens on the current account's chain
elytro token --search usdc             # search by symbol or name
elytro token --chain 8453              # tokens on a specific chain
```

## Swap / Bridge

Swap or bridge tokens across chains via LiFi. Always look up the token address with `elytro token` first, then quote, then send after user approval.

```bash
# Same-chain swap (from-chain defaults to account chain, to-chain defaults to from-chain)
elytro swap quote --from-token 0x0000000000000000000000000000000000000000 \
  --to-token 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
  --amount 100000000000000

# Cross-chain bridge (specify --to-chain for a different destination)
elytro swap quote --to-chain 8453 \
  --from-token 0x0000000000000000000000000000000000000000 \
  --to-token 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
  --amount 100000000000000

# Execute (requires user approval, re-quotes internally)
elytro swap send --to-chain 8453 \
  --from-token 0x0000000000000000000000000000000000000000 \
  --to-token 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
  --amount 100000000000000
```

Token list source: [Uniswap default-token-list](https://github.com/Uniswap/default-token-list). Covers mainnet chains (1, 10, 137, 42161, 8453). `--from-chain` defaults to the current account's chain. `--to-chain` defaults to `--from-chain` (same-chain swap). Use `0x0000000000000000000000000000000000000000` for native ETH. Amounts are in atomic units (wei). The `--slippage` option takes a percent value (e.g. `0.5` for 0.5%). `swap send` always fetches a fresh quote internally to avoid stale pricing.

## Social recovery

Social recovery lets users designate guardians who can collectively restore wallet access. The CLI handles guardian management, backup, and recovery initiation. Guardian signing and on-chain execution happen in the external Recovery App at `https://recovery.elytro.com/`.

Before helping a user set up or initiate recovery, read the social recovery section of [references/concepts.md](references/concepts.md) for the full lifecycle (signature collection, countdown window, cancellation) and the phases reported by `recovery status`.

```bash
# Set guardians (on-chain transaction, requires user approval)
elytro recovery contacts set 0xAlice,0xBob,0xCarol --threshold 2
# Options: --label "0xAlice=Alice,0xBob=Bob"  --privacy  --sponsor

# Query / clear guardians
elytro recovery contacts list
elytro recovery contacts clear

# Backup and restore guardian info offline
elytro recovery backup export --output guardians.json
elytro recovery backup import guardians.json

# Initiate recovery (--chain is required)
elytro recovery initiate 0xWalletToRecover --chain 11155420
# Returns a recoveryUrl -- tell the user to share it with guardians

# Check recovery progress
elytro recovery status
```

When `recovery initiate` succeeds, present the `recoveryUrl` prominently and tell the user to share it with their guardians so they can approve in the Recovery App.

---

## Approval-required commands

Get explicit user confirmation before running any command listed under "Agent: user approval before running" in [references/commands.md](references/commands.md). This includes all money movement, security changes, recovery writes, delegation revocation, and OTP submission.

---

## How to explain results

Do not show raw JSON unless the user asks. Translate CLI output faithfully: preserve exact identifiers (alias, address, chain, tx hash, userOp hash, OTP id), include all warnings, and copy any next-step commands exactly. Never claim a transaction is confirmed unless the CLI says so.

Use these output shapes:

**Success:** `Done: <what changed>.` Optionally: `Next: <most useful next step>.`

**Query/status:** `Status: <plain-language summary>.` Then one short line with the most relevant facts.

**Transaction preview:**
`Preview: <transaction type>.`
`Cost: <estimated cost>. Sponsored: <yes/no>.`
`Warnings: <every warning, or "none">.`
`Please confirm if you want me to send it.`

**Transaction sent:** `Done: transaction confirmed for <account>.` with `Tx: <hash>` and `Explorer: <url>` if present. If only submitted (not confirmed): use `UserOp: <hash>` instead.

**OTP pending:**
`Action needed: email verification is required to continue.`
`Code sent to: <maskedEmail>.`
`Please send me the 6-digit code and I'll complete it for you.`

**Error:** `Couldn't complete: <reason from error.message>.` `Try: <hint from error.data.hint or error.data.suggestion>.`

**Payment failed:** `Payment failed: <reason from error.message>.` `Facilitator said: <error.data.facilitatorResponse summary>.` `Next step: <error.data.suggestion>.`

**Lists:** `Found <n> item(s).` Then one short line per item with the most relevant fields.

---

## Common commands

```bash
elytro account list
elytro account info agent-primary
elytro account switch agent-primary
elytro query tx <hash>
elytro security status
elytro recovery contacts list
elytro recovery status
elytro config show
elytro update check
```
