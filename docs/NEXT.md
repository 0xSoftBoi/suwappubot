# Next-session prompts

Follow-up work queued from the 2026-06-10 terminal-auth debugging session. Each
line is a ready-to-paste prompt. Context: the connect button + every authed
terminal endpoint were broken by silent config drift (Turnkey unconfigured, JWT
secret ephemeral/mismatched) plus code bugs; all fixed in PRs #396, #399, #402,
#403 + Railway env. The recurring lesson: **config drift degraded quietly instead
of failing loudly, and nothing tests authed terminal flows.**

## High-leverage (catch this class of bug automatically)

1. **Auth/config self-check.**
   > Add an `/auth/selftest` endpoint to python-api that mints a token via
   > `create_jwt_token` and immediately verifies it through the terminal's
   > `_decode_terminal_auth_token`, and checks `wallet_provider` is fully
   > configured. Return 500 if either fails. Add it to the `/ship` boot-verify
   > and a scheduled health cron.

2. **Terminal E2E in CI.**
   > Wire the terminal Playwright E2E + `terminal/scripts/browserbase-terminal-feature-sweep.mjs`
   > into CI (or a scheduled cloud agent) so authed-endpoint and wallet-creation
   > regressions are caught automatically. Terminal E2E currently isn't in CI.

3. **Test accounts + cleanup.**
   > Set up a dedicated test Telegram account + test passkey for QA so we stop
   > minting junk users on my real account, and prune the junk users (ids ~7-9)
   > and test tracked-wallet/SOL-wallet entries created on 2026-06-10.

## Audit / verify

4. **Sweep the rest of the authed surface.**
   > Audit every authed terminal endpoint (history, positions, alerts, DCA,
   > copy-trading, perps, predict) + the api-ts <-> python-api token flows for the
   > same JWT-secret/contract mismatch we fixed in #403 — bearer-probe each for 200.

5. **`/qa-terminal` skill.**
   > Build a `/qa-terminal` skill that drives the live terminal via Browserbase
   > (sign in, hit each authed endpoint, run the feature sweep) and reports a
   > pass/fail table — wrap the harness we used ad-hoc. See memory
   > `browserbase-qa-harness`.

6. **Dangling branches.**
   > Review `feat/swap-fee-collection-agent-metering` (x402 commit) and
   > `perf/event-loop-pooling-indexes` — runtime-verify and merge or close.

## Robustness / cleanup

7. **Passkey residentKey robustness.**
   > Add the residentKey fix to the terminal passkey flow (`residentKey:'required'`
   > breaks authenticators without discoverable-credential support — the secondary
   > finding we didn't ship), and verify via Browserbase.

8. **Hooks + black pin.**
   > Add settings/pre-commit hooks: block `git add -A`, warn when not on a fresh
   > branch off main, and parse-check staged Python. Pin black to CI's version so
   > local doesn't reformat clean files. See memory `local-black-and-branch-hygiene`.

9. **On-chain verification via Blockscout MCP.**
   > Use Blockscout MCP to verify the Turnkey wallets created on 2026-06-10 are real
   > on-chain (EVM `0xc4bfA45D063aD8bAc390ab62658Ab8FC0670B623`), and add an on-chain
   > sanity check to wallet provisioning.

10. **Wallet-provider fallback (decide custody policy first).**
    > Make `WalletService.create_wallet` fall back to a local wallet when
    > `wallet_provider=turnkey` but Turnkey is unreachable/misconfigured (it
    > currently routes on the flag alone and hard-fails) — decide custody policy
    > with me before implementing.
