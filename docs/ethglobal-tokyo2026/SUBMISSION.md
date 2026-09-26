# Suwappu Agent Swap Passport — ETHGlobal Tokyo 2026 submission

## Pitch

AI trading agents today have no identity a human, an exchange, or another agent can trust — they're
just a wallet address. Agent Swap Passport gives an agent a real, checkable identity: a human proves
they're a real person with World ID, that binds to the agent's wallet, the agent gets a human-readable
name (`<agent>.suwappu-agents.eth`) that resolves on-chain, and a live Uniswap v4 pool only lets the
agent swap once that identity check has passed. One verification, reused across three separate pieces
of infrastructure — proof of personhood, a name, and a gated trade — instead of three disconnected
demos. Everything below is a real Sepolia transaction, not a mock.

## 90-second demo script (matches the live page)

1. Open **[suwappu.bot/passport](https://suwappu.bot/passport)**.
2. Click through the World ID step. On the recorded run this returned `already_verified` (the shared
   staging simulator identity had already been consumed by an earlier verification) — the page still
   resolves to the result card, which is the intended fallback behavior, not a failure.
3. The result card shows the agent identity: **`f4c68576.suwappu-agents.eth`**.
4. Open **Technical Details** on the card: it links the three on-chain receipts —
   - ENS subname registration: [`0x0787…dee233`](https://sepolia.etherscan.io/tx/0x0787f570c9e8f2f730523be1cdad32e7d58cc467c988cf60426c69a315dee233)
   - Uniswap v4 hook deploy: [`0x32c9…4bb3b89`](https://sepolia.etherscan.io/tx/0x32c9bc9f20f44b858640c01f1eb8211410c38b554ae68161bfb5541234bb3b89)
   - World-ID-gated swap through the hook: [`0x4491…774f4d32`](https://sepolia.etherscan.io/tx/0x4491020f77ab779e233f132b0e3d5c7a6821e827df2d4dae34efe306774f4d32)
5. Point out the hook address [`0xc72ab4dF…6c080`](https://sepolia.etherscan.io/address/0xc72ab4dFd3d6B2C1b3af51816EA8331599e6c080)
   and the ENS subregistry [`0xd617a791…4bd062`](https://sepolia.etherscan.io/address/0xd617a7918b89c7bac8f85c53e327d034914bd062)
   on Sepolia Etherscan — both verifiable independent of Suwappu's own UI.

**Scope note:** Intercepta was explored in earlier build phases (`api-ts/src/hackathon/tokyo2026/intercepta/`)
but was **not demoed and is out of scope for this submission** — no live API key was provisioned, so we
are not claiming that track.

---

## World ID / IDKit

> Bounty requirements (ethglobal.com/events/tokyo2026/prizes): "Integrate IDKit in a functioning
> application... verify the result on the server" (IDKit, $5k); "Demonstrate the complete journey:
> identity request, user completion, validated result" + a denied path (World ID for Agents, $5k).

**What we built:** a server-verified World ID gate in front of the agent link/claim flow. The proof
is verified against World's real staging API — `POST https://developer.world.org/api/v4/verify/{rp_id}`
— never trusted from the client.

- Route surface: `POST /hackathon/world-id/start`, `POST /hackathon/world-id/verify`
  (`api-ts/src/routes/hackathon.ts:55`, `:104`).
- Server-side proof verification: `api-ts/src/hackathon/tokyo2026/world-id/guardianGate.ts`.
- Production agent flow (non-hackathon route) also accepts `world_id_proof` on
  `POST /v1/agent/link/code`: `api-ts/src/routes/agent.ts:4422` (proof extraction), with the
  denied path returning `world_id_verification_failed`: `api-ts/src/routes/agent.ts:4489`.
- Denied/cancelled path proven live: a second proof for an already-used identity was rejected with
  409 "proof already used (replay rejected)" (`docs/demo-readiness.md`, "Passport CLAIM proven on
  prod" entry, 2026-09-26 19:13 UTC) — this is the required "protected action doesn't occur" case.
- The live run in this submission returned `already_verified` for the same reason: nullifiers are
  single-use per action, and the shared staging simulator identity had already verified once.

**How to verify it yourself in 2 minutes:**
1. `curl https://api.suwappu.bot/hackathon/status` → confirms the trust layer and World ID provider
   are live (`{"trustLayer":true,"providers":{"worldId":true,...}}`).
2. Open the page, run the flow, and read the result card — no source access needed.
3. Read `api-ts/src/hackathon/tokyo2026/world-id/guardianGate.ts` to see the server-side verification
   call directly.

**Limitation:** the staging verification token issued by World's developer portal expires
**2026-09-27 17:14 UTC** — after that, re-running the flow needs a fresh token
(`WORLD_STAGING_VERIFICATION_TOKEN` on the api-ts production service).

---

## ENSv2

> Bounty requirements (ethglobal.com/events/tokyo2026/prizes): built on ENSv2 (Sepolia); "ENSv2
> features should be central to the product, not a cosmetic add-on"; live link + open-source code.

**What we built:** every verified agent gets a real ENSv2 subname minted under a dedicated
`suwappu-agents.eth` subregistry — not a database field that looks like a name, an actual on-chain
`PermissionedRegistry.register()` call.

- Minting client: `api-ts/src/lib/ensSubname.ts:70` (`register()` ABI/call), subregistry
  addressing at `api-ts/src/hackathon/tokyo2026/ensv2/addresses.ts`.
- Wired into the agent claim path: `api-ts/src/routes/agent.ts:23` (import),
  `api-ts/src/routes/agent.ts:4569` (mint call), exposed on `GET /v1/agent/me` as `ens_name`
  (`api-ts/src/routes/agent.ts:640`).
- Subregistry (dedicated to `suwappu-agents.eth`, not the shared root registry) deployed on Sepolia:
  [`0xd617a7918b89c7bac8f85c53e327d034914bd062`](https://sepolia.etherscan.io/address/0xd617a7918b89c7bac8f85c53e327d034914bd062).
- Live-minted subname for this run: **`f4c68576.suwappu-agents.eth`**, registration tx
  [`0x0787f570c9e8f2f730523be1cdad32e7d58cc467c988cf60426c69a315dee233`](https://sepolia.etherscan.io/tx/0x0787f570c9e8f2f730523be1cdad32e7d58cc467c988cf60426c69a315dee233).

**How to verify it yourself in 2 minutes:**
1. Open the ENS registration tx link above on Sepolia Etherscan — confirmed, `status: success`,
   `method: register` against the subregistry address.
2. Read `api-ts/src/lib/ensSubname.ts:70` for the exact `register()` call shape used.
3. Run the demo page — the resulting name resolves in the UI, not fabricated copy.

**Limitation:** minting fires at World-ID-verified link-code time, not at final Telegram-bot claim
completion (`agents.ownerUserId` is set by the separate Python bot `/claim` handler, outside api-ts) —
documented as a scope approximation in `docs/plans/ethglobal-tokyo2026-agent-passport.md` (Phase 3,
point 2).

---

## Uniswap v4 hook

> Bounty requirements (ethglobal.com/events/tokyo2026/prizes): public GitHub repo with open-source
> code and a `FEEDBACK.md`; completed Uniswap Developer Feedback Form linking it; README points to
> exact contracts/lines.

**What we built:** a `beforeSwap` v4 hook that only lets a swap through if the swapper's address has
a recorded World ID verification — the same identity check used by the passport flow, now enforced
on-chain at the pool level.

- Hook contract: `contracts-hackathon/uniswap-hook/src/WorldIdGateHook.sol:22` (`contract
  WorldIdGateHook is IHooks`), the gate itself at `:62` (`function beforeSwap(...)`), the allowlist
  storage at `:29` (`mapping(address => bool) public isWorldIdVerified`).
- Deployed to Sepolia via CREATE2:
  [`0xc72ab4dFd3d6B2C1b3af51816EA8331599e6c080`](https://sepolia.etherscan.io/address/0xc72ab4dFd3d6B2C1b3af51816EA8331599e6c080),
  deploy tx [`0x32c9bc9f20f44b858640c01f1eb8211410c38b554ae68161bfb5541234bb3b89`](https://sepolia.etherscan.io/tx/0x32c9bc9f20f44b858640c01f1eb8211410c38b554ae68161bfb5541234bb3b89).
- One real swap executed through the gated hook:
  [`0x4491020f77ab779e233f132b0e3d5c7a6821e827df2d4dae34efe306774f4d32`](https://sepolia.etherscan.io/tx/0x4491020f77ab779e233f132b0e3d5c7a6821e827df2d4dae34efe306774f4d32),
  status success.
- `docs/submissions/uniswap-feedback.md` — Developer Feedback Form content per the bounty requirement.

**How to verify it yourself in 2 minutes:**
1. Open the swap tx above on Sepolia Etherscan — internal calls show `beforeSwap` executing on the
   hook address before the pool moves funds.
2. Read `WorldIdGateHook.sol:62-70` — the revert path (`SwapperNotVerified`) is the enforcement.
3. `docs/submissions/uniswap-feedback.md` has the completed feedback content; the actual Developer
   Feedback Form submission is a manual step outside this repo — see limitation below.

**Limitation:** we have not independently re-confirmed, inside this doc pass, that the Uniswap
Developer Feedback Form was actually submitted through Uniswap's own form UI (only that the content
exists in-repo at `docs/submissions/uniswap-feedback.md`). Confirm the form submission itself before
the judging deadline.

---

## Known limitations (submission-wide)

- **Staging World ID token expires 2026-09-27 17:14 UTC.** Anyone re-running the flow after that
  needs a fresh `WORLD_STAGING_VERIFICATION_TOKEN` set on the api-ts production service.
- **Nullifiers are single-use per action.** A given real-world identity can only complete
  `agent-swap-passport-verify` once; a second attempt correctly shows `already_verified` /
  gets rejected, as it did in this recorded run — this is the intended replay defense, not a bug.
- **Intercepta is out of scope.** Code exists in the repo (`api-ts/src/hackathon/tokyo2026/intercepta/`)
  but was never live-tested with a real API key, and is not part of this submission's claimed tracks.
- **Public RPC quota pressure** has been observed on prod for unrelated chains (see
  `docs/demo-readiness.md`, blocker B3) — does not affect the Sepolia txs cited above, which are
  already confirmed on-chain, but a live re-run during judging could hit rate limits on shared
  public RPCs.
- **1inch/Aqua work exists in the repo** (`contracts-hackathon/aqua-app/`, `aqua-swapvm/`) but is not
  part of this submission's claimed tracks per this document's scope (World ID, ENSv2, Uniswap only).

## Source of every number in this document

- Tx hashes, contract addresses, subregistry address: user-provided live E2E result (2026-09-26
  19:24 UTC run) and `docs/plans/ethglobal-tokyo2026-agent-passport.md` Phase 3/5.
- File:line pointers: verified with `grep -n` against `origin/main` at the time of writing
  (see individual line numbers above).
- Bounty requirement quotes: fetched from ethglobal.com/events/tokyo2026/prizes on 2026-09-26.
- Token expiry, RPC blocker, replay behavior: `docs/demo-readiness.md`.
