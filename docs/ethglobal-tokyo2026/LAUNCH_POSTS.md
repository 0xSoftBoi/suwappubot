# Launch post drafts — Agent Swap Passport (ETHGlobal Tokyo 2026)

All drafts. Post manually. Every number/claim below is backed by a real Sepolia tx or a
grep-verified file:line — see `docs/ethglobal-tokyo2026/SUBMISSION.md` for sources.

## X / Twitter (3 drafts, ≤280 chars)

**Draft 1 — the identity story**
> An AI trading agent is usually just a wallet address. We made ours prove it: try to swap unverified
> and a Uniswap v4 hook reverts, zero gas. Scan World ID, the server mints an ENSv2 name and flips
> the hook. Swap again — it executes. Same wallet, blocked then unblocked, on Sepolia. @ETHGlobal Tokyo

**Draft 2 — the technical hook**
> Shipped a beforeSwap hook on Uniswap v4 that reverts unless the swapper has a verified World ID
> on file. Watched one wallet get blocked, verified, and swap through the same hook — three real
> Sepolia txs, one run. Part of our Agent Swap Passport for ETHGlobal Tokyo. suwappu.bot/passport

**Draft 3 — the ENS angle**
> Every verified wallet in our ETHGlobal Tokyo build gets a real ENSv2 subname —
> 0x62cd26f0.suwappu-agents.eth — minted on-chain via PermissionedRegistry and resolving to the
> wallet (we had to ship our own resolver to make that true). Check it yourself on Sepolia.
> suwappu.bot/passport

## Farcaster (1 post)

> Gave an AI trading agent's wallet a real identity for ETHGlobal Tokyo: unverified, a Uniswap v4
> hook reverts its swap at zero gas. Scan World ID, the server mints an ENSv2 subname and allowlists
> the wallet on the hook. Swap again — it executes. One human, one passport, three real Sepolia
> transactions in one run. suwappu.bot/passport

## ETHGlobal showcase form description (2 sentences)

Agent Swap Passport gates a wallet's swaps behind a Uniswap v4 `beforeSwap` hook that reverts
unverified swappers; scanning World ID mints the wallet a real ENSv2 subname on Sepolia and
allowlists it on the hook, so the same wallet that was blocked can now swap through the same pool.
Every step — the block, the mint, the allowlist, the executed swap — is a live Sepolia transaction
from one recorded run, not a mock, with exact contract/file pointers documented for judges.
