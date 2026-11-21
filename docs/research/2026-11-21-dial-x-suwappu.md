# Dial × Suwappu: a phone network for humans and AI agents (2026-11-21)

## The idea

**Every AI agent gets a phone number, a wallet with rules, and its human on speed dial.**

- **Dial** already provides the *identity and communication* layer:
  - end-to-end encrypted messaging and P2P calls;
  - `+0` numbers that humans *and* agents hold, rooted in a BIP-39 wallet;
  - signed route manifests and a self-hostable operator;
  - iOS (TestFlight), Android and macOS apps;
  - headless `dial-agent`, `dial-webhook`, `dial-autonomous-agent` (local models, memory, heartbeat);
  - `@dial/supervisor`, an MCP server through which Claude Code, Cursor or Codex can **ask its human a question on their phone** and read the reply.
- **Suwappu** already provides the *money* layer:
  - a 25-provider router;
  - a fail-closed policy engine with spend reservation;
  - single-use step-up approvals;
  - hash-chained audit and sealed receipts;
  - x402/MPP payments, hosted MCP and a TEE verifier;
  - a Rust MPC signer, and post-quantum settlement research (Suwappu-Labs).

Built separately, each is one more product in a crowded category: encrypted messenger, agent
notification tool, agent spend control. Together they become something nobody has. It is a
**network where agents are first-class participants**: they can be reached, they can ask
permission, they can pay and be paid, and every action leaves a receipt.

## Why combining them fixes distribution

Our problem is distribution, not product (see `2026-11-20-strategy-review.md`). Messaging is
the one category with a **built-in viral loop**, and Dial's agent design already contains it:

1. A developer adds `@dial/supervisor` to Claude Code ("text me when you need a decision").
2. Pairing requires **the human to hold a Dial number**, so they install the app.
3. That human is now on an encrypted network where they can message other people and other
   agents.
4. **(Proposed, not built.)** When their agent needs to spend money ("buy this API credit", "pay
   this invoice", "swap to USDC"), it would ask over Dial, and Suwappu's policy and approval engine
   would decide, execute and post the receipt into the chat. Today MCP only prepares unsigned
   transactions and pre-filled links.

Every agent that is installed brings its human onto the network. Every human can bring more
agents and more humans. No standalone spend-control startup or messenger has this loop.

**Timely opening:** HumanLayer, the pioneer of "agent asks a human" for coding agents, was
acquired by Factory on 2026-11-04. Its hosted product shuts down no earlier than ~2026-12-04,
and its users are **coding-agent users**, exactly `@dial/supervisor`'s audience. That gives a
two-week window with a concrete migration audience.

## The product, in three layers

| Layer | Pitch | Built in | Status |
|---|---|---|---|
| **Reach** | "Your agent can text and call you, privately." | Dial: supervisor MCP, dial-agent, webhook, apps | Shipped on testnet, iOS on TestFlight; **nothing published to npm** |
| **Permission** | "Agents ask before they spend; you tap yes or no." | Suwappu: PolicyService, ApprovalService; Dial `ask` as the channel | Both halves exist; the bridge does not |
| **Money + proof** | "Agents pay and get paid under your rules, with receipts." | Suwappu: router, x402, seal/audit receipts, MPC signer later | Code exists, 0 real fills |

## Where it goes

- **Year 1:** the default way AI agents reach their humans (coding agents first), and the
  default way they ask permission to spend.
- **Year 2:** agents get numbers and wallets for each other. Agent-to-agent messaging plus x402
  payment over Dial, with policy and receipts as the trust layer between strangers.
- **Year 3:** a private, post-quantum-secure network for human and agent communication and
  commerce, operator-neutral and self-hostable. The open alternative to platform-owned agent
  ecosystems.

## The next 14 days

1. **Publish** `@dial/supervisor` (plus `dial-agent` binaries) and `@suwappu/mcp-server` 0.6.0.
   Today neither Dial package is on npm, so nobody can install anything.
2. **Launch "text your coding agent's questions to your phone, end-to-end encrypted"** with a
   60-second video, to HN, r/ClaudeAI, r/cursor and the Claude Code and MCP communities.
   Include an explicit HumanLayer migration guide.
3. **Build the bridge (MONEY-PATH, needs money-path-reviewer).** Suwappu's ApprovalService
   gains a Dial notifier, so a `require_approval` verdict becomes a Dial `ask` and the reply
   resolves the approval. Demo: "Claude wants to spend $12 on API credits → approve on
   Dial → receipt in the chat".
4. **Measure only:** supervisor installs, paired humans (Dial app installs), weekly asks
   answered, approvals executed.

## Gates

| When | Proof | If missed |
|---|---|---|
| Day 14 | Packages published; launch done; 100 supervisor installs | Fix onboarding friction before anything else |
| Day 30 | 300 paired humans; 1,000 asks answered per week; first approved spend via Dial | Rethink the pitch, keep the product |
| Day 90 | 2,000 paired humans; 50 agents spending under policy; first paying team | Narrow to the supervisor and drop money, or sell the bridge as infrastructure |

## What has to be true (risks)

- **Focus.** This means one company, not three. Dial, Suwappu and magic-cabinet currently
  split one founder's attention.
- **Mobile is in progress.** iOS is on TestFlight and M7 (reliable calls) is open. Messaging
  plus `ask` is enough for the supervisor wedge; calls can wait.
- **Testnet.** `+008` numbers are testnet and invite-gated. Launch needs open sign-up.
- **App store and policy review** for an encrypted messenger with payments. Keep money
  non-custodial (sign_url / wallet signing) at first.
- **Unverified:** that developers want phone-based approval over Slack or Telegram. The day-30
  gate tests that.
