# Agent Swap Passport — demo walkthrough script

Purpose: a scripted, minute-by-minute path for recording the submission demo video.
Every step below has already been executed for real (not staged) — this script just
re-tells that story in order, with exact commands/links so a recording can either
replay them live or cut to the existing on-chain evidence.

Total runtime target: ~4-5 minutes.

## 0. Cold open (15s)

Say: "This is Agent Swap Passport — one identity that follows an AI trading agent
across World ID, ENS, Uniswap, and 1inch." Show the four-track summary at the top of
`docs/submissions/ethglobal-tokyo2026-agent-swap-passport.md`.

## 1. World ID: verify the human behind the agent (60s)

1. Show the agent registration call:
   `POST /v1/agent/register` → returns an API key (already have `hackathon-demo-agent`,
   id `f4c68576-67dc-4d52-8147-172fe48dc2dd`).
2. Show the World ID Simulator flow: open `http://localhost:8899/.world_id_test_page.html`,
   click "Verify with World ID", show the QR, cut to the simulator screenshot
   (`/tmp/pw-test/sim_result.png` if still present, else re-run the flow live) approving
   the credential.
3. Cut to the terminal: `POST /v1/agent/link/code` with the resulting proof →
   `{"success":true,"world_id_verified":true}`.
4. Say: "That's a real cryptographic proof, verified live against World's own API —
   not test data."

## 2. ENS: anchor the identity on-chain (45s)

1. Show `GET /v1/agent/me` → `"ens_name": "f4c68576.suwappu-agents.eth"`.
2. Cut to Blockscout: tx `0x0787f570c9e8f2f730523be1cdad32e7d58cc467c988cf60426c69a315dee233`
   on Sepolia, `register` call, status `ok`.
3. Say: "That subname is minted the moment World ID verification succeeds — one
   identity, anchored on ENS."

## 3. Uniswap v4: the same identity gates a real swap (60s)

1. Show `contracts-hackathon/uniswap-hook/src/WorldIdGateHook.sol` — the `beforeSwap`
   check.
2. Cut to Blockscout: hook contract `0xc72ab4dFd3d6B2C1b3af51816EA8331599e6c080`.
3. Cut to the swap tx:
   `0x4491020f77ab779e233f132b0e3d5c7a6821e827df2d4dae34efe306774f4d32`, status success.
4. Say: "Same wallet, same World ID verification, now gating a real Uniswap v4 pool."

## 4. 1inch Aqua: the same identity, a second DeFi primitive (60s)

1. Show `contracts-hackathon/aqua-app/src/WorldIdGatedXYCSwap.sol` — the
   `TakerNotWorldIdVerified` check, built directly on Aqua's own `XYCSwap` example.
2. Cut to Blockscout: Aqua registry `0xE323d20Cf10686d0a61b4A1aE971F0491e43ea96`, app
   `0xaE0F41531CD3B1f9239E12f2c3Ee0Ad643399863`.
3. Cut to the swap tx:
   `0x68b324e28d9897f96e77ee9ddb2e12c021ab2df6a7b1722811d32c7e5bb15254`, status success,
   real constant-product output.
4. Say: "One identity. Three sponsor integrations. All real transactions, not mocks."

## 5. Close (20s)

Say: "Agent Swap Passport — a portable identity for AI agents, verified once with
World ID, and enforced everywhere: ENS, Uniswap, and 1inch." Show the repo README one
more time.

## Recording checklist

- [ ] Screen recording tool ready (QuickTime/OBS)
- [ ] `http://localhost:8899/.world_id_test_page.html` reachable (relaunch the local
      Postgres + api-ts dev server per `docs/plans/ethglobal-tokyo2026-agent-passport.md`
      "Live end-to-end verification" section if the environment was torn down)
- [ ] Blockscout tabs pre-loaded for all 5 tx hashes above (faster cuts than live nav)
- [ ] `docs/submissions/ethglobal-tokyo2026-agent-swap-passport.md` open for the cold
      open/close shots

This is a script, not a recording — actually producing the video/audio is a manual
step outside what I can do from this session (no camera/mic/screen-capture access).
