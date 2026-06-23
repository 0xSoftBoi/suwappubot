# Ledger hardware wallet (terminal)

Non-custodial Ledger support in the **terminal** (`terminal/`). The Ledger device
holds the keys and signs every SIWE challenge and swap itself — Suwappu never sees a
private key. It reuses the existing external-wallet build/record swap path (the same
one MetaMask uses), so no server signing changes were needed.

## How it works

- Integration tier: **Connect Kit** (Ledger's official dApp connector), wrapped as a
  custom wagmi v2 connector in `terminal/src/lib/ledgerConnectKit.ts` and surfaced in
  the RainbowKit modal via `terminal/src/lib/wagmi.ts`.
- At connect time Connect Kit prefers the **Ledger browser Extension** (if installed)
  and otherwise opens **Ledger Live** (desktop or mobile, paired over WalletConnect).
- The Connect Kit SDK is loaded at runtime from Ledger's CDN by
  `@ledgerhq/connect-kit-loader` — it is not bundled.
- On sign-in the session is tagged `wallet_provider = "ledger"` (a keyless variant of
  `external`); the bot/api treat it exactly like any other non-custodial wallet.

> Direct in-page USB/WebHID signing is **not** this integration — that is Ledger's
> Device Management Kit (a separate, larger build). Connect Kit brokers through the
> Extension or Ledger Live.

## Required config: `VITE_WC_PROJECT_ID`

A **real WalletConnect project id** is required — it is the fallback transport Connect
Kit uses to reach Ledger Live. The `'demo'` fallback in `wagmi.ts` **cannot** complete
a Ledger pairing.

- Get a project id from <https://cloud.reown.com> (formerly WalletConnect Cloud).
- It is a **Vite build arg**, baked at image build (see `docs/deployment/railway.md`):
  set `VITE_WC_PROJECT_ID` in the terminal service's build args / env on Railway.
- Local dev: add `VITE_WC_PROJECT_ID=<id>` to `terminal/.env.local`.

## Manual end-to-end test (needs a physical Ledger)

Code is type-checked + builds, but signing is only proven with a device. Checklist:

1. **Prereqs:** `VITE_WC_PROJECT_ID` set; Ledger unlocked with the **Ethereum app**
   open; "blind signing"/"contract data" enabled on the device (required for swap
   calldata). Optionally install the Ledger browser Extension for the USB-direct path.
2. **Connect:** open the terminal → Connect Wallet → pick **Ledger**. Confirm the
   Extension prompt (or the Ledger Live pairing) resolves and an address appears.
3. **Auth (SIWE):** click **Sign in** → the button shows "Confirm on your Ledger…" →
   approve the message on the device. Session should authenticate.
4. **Verify tag:** `GET /auth/me` returns `walletProvider: "ledger"`; the new wallet
   row has `wallet_provider = "ledger"`, `encrypted_private_key = NULL`.
5. **Swap (small / testnet first):** run a swap. Approve the approval tx (if any) and
   the swap tx **on the device**. Confirm the tx broadcasts and `/webapp/swap/record`
   logs it to history.
6. **Resume:** reload the page — the session should restore as a hardware wallet
   (`isHardwareWallet` true) without re-auth.

If a step is blocked, report "code-complete, not functionally verified — needs X"
rather than calling it live.

## Files

| File | Role |
|------|------|
| `terminal/src/lib/ledgerConnectKit.ts` | Connect Kit → wagmi v2 connector + RainbowKit wallet |
| `terminal/src/lib/wagmi.ts` | Registers Ledger in the connect modal |
| `terminal/src/lib/walletProvider.ts` | Pure provider-tag helpers (unit tested) |
| `terminal/src/contexts/AuthContext.tsx` | Tags `ledger`, exposes `isHardwareWallet` |
| `terminal/src/lib/api.ts` | Passes the provider tag to verify |
| `api/main.py` (`/auth/turnkey/verify`) | Validates + stores the provider tag |
| `bot/utils/wallet_provider.py` | `normalize_wallet_provider` (unit tested) |
