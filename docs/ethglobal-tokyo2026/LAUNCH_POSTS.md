# Launch post drafts — Agent Swap Passport (ETHGlobal Tokyo 2026)

All drafts. Post manually. Every number/claim below is backed by a real Sepolia tx or a
grep-verified file:line — see `docs/ethglobal-tokyo2026/SUBMISSION.md` for sources.

## X / Twitter (3 drafts, ≤280 chars)

**Draft 1 — the identity story**
> An AI trading agent is usually just a wallet address. We gave ours a real identity: World ID
> proves the human behind it, ENSv2 gives it a name, and a Uniswap v4 hook only lets it swap once
> that's checked. One verification, three sponsors, real Sepolia txs. Built for @ETHGlobal Tokyo.

**Draft 2 — the technical hook**
> Shipped a beforeSwap hook on Uniswap v4 that reverts unless the swapper has a verified World ID
> on file. Not a compliance mockup — deployed on Sepolia, one real swap through it, tx on-chain.
> Part of our Agent Swap Passport for ETHGlobal Tokyo. suwappu.bot/passport

**Draft 3 — the ENS angle**
> Every verified agent in our ETHGlobal Tokyo build gets a real ENSv2 subname —
> agent-id.suwappu-agents.eth — minted on-chain via PermissionedRegistry, not a display string.
> Resolve it yourself on Sepolia. suwappu.bot/passport

## Farcaster (1 post)

> Gave an AI trading agent a real identity for ETHGlobal Tokyo: World ID proves the human, ENSv2
> mints the agent a name on Sepolia, and a Uniswap v4 hook gates its swaps on that verification.
> One proof, reused across three sponsor integrations, all with real on-chain receipts.
> suwappu.bot/passport

## ETHGlobal showcase form description (2 sentences)

Agent Swap Passport binds a human's World ID verification to an AI trading agent's wallet, mints
the agent a real ENSv2 subname on Sepolia, and enforces that same verification on-chain via a
Uniswap v4 `beforeSwap` hook that reverts unverified swaps. Every step is a live Sepolia
transaction — not a mock — with exact contract/file pointers documented for judges.
