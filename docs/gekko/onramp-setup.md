# Onramp setup ("Add money with a card")

## Status

**Inert by default.** `mobile/src/lib/onramp.ts` only builds a Coinbase Onramp
URL if `EXPO_PUBLIC_ONRAMP_APP_ID` is set at build time. If it's absent,
`isOnrampConfigured()` returns false, `buildOnrampUrl()` returns `null`, and
every call site (`AddMoneyButton`, used on Receive, Earn, and Money) renders
nothing — no disabled button, no dead link. Nothing else in the app depends
on this being configured. Until a human does the steps below, this feature
does not exist from a user's perspective.

## What a human must do

1. **Create/use a Coinbase Developer Platform (CDP) project.**
   - Sign in at https://portal.cdp.coinbase.com with the Suwappu Coinbase
     business account (not a personal account — Onramp is tied to a
     verified CDP project for compliance/fee-tier purposes).
   - Under **Onramp & Offramp**, create (or reuse) a project and copy its
     **Project ID** (this is the `appId` query param the hosted widget
     needs — it is *not* an API secret, but treat it as a build config
     value, not something to hardcode in source).

2. **Enable the 0%-fee USDC program** (if not already) in the CDP dashboard
   for that project, per the research this feature is based on — this is a
   dashboard toggle/application on Coinbase's side, not something the app
   controls.

3. **Configure allowed origins / redirect, if CDP requires it for your
   project type.** The current implementation uses the plain hosted
   `https://pay.coinbase.com/buy/select-asset` redirect flow (no
   `redirectUrl` param is sent), so the user finishes in their browser and
   manually returns to the app (the app store button, or switching apps).
   If CDP's dashboard requires allow-listing an origin/bundle id for the
   project to serve the widget at all, add Suwappu's iOS bundle id there.
   No custom URL scheme handling was added on the app side — there is
   nothing to register in `app.json` for this to work today.

4. **Set the env var:**
   - **Expo build** (mobile/EAS): set `EXPO_PUBLIC_ONRAMP_APP_ID=<Project ID>`
     as an EAS secret / build-time env var, same mechanism as
     `EXPO_PUBLIC_API_URL` (see `mobile/src/lib/config.ts`). This is inlined
     at bundle time — changing it requires a new build, not just a restart.
   - There is nothing to set in Railway for this — Onramp is a client-side
     hosted redirect; api-ts/python-api are not in this URL's path at all
     today. (If a future iteration adds Coinbase's signed session-token flow
     instead of the plain `appId` flow, that would need a server-side
     secret and *would* move into Railway env — out of scope here.)

5. **Verify with a small real purchase**, not just a boot check:
   - Build with `EXPO_PUBLIC_ONRAMP_APP_ID` set, confirm the "Add money with
     a card" button now appears on Receive/Earn/Money empty states.
   - Tap it, complete Coinbase's own KYC/card flow with a small real amount
     (e.g. $2–5) using a real debit card.
   - Switch back to the Suwappu app and confirm the balance updates without
     a manual pull-to-refresh (the app invalidates snapshot/wallets/earn
     queries the next time it returns to the foreground after the button
     was tapped — see `mobile/src/hooks/use-onramp.ts`). Coinbase's own
     settlement can take longer than the button's inline foreground refresh,
     so also check that a manual pull a few minutes later shows the funds.
   - Confirm the destination address in the transaction matches the user's
     actual Gecko wallet address (from `GET /v1/mobile/wallets`), not a
     placeholder.

## How the URL is built

`buildOnrampUrl(address)` in `mobile/src/lib/onramp.ts`:

```
https://pay.coinbase.com/buy/select-asset
  ?appId=<EXPO_PUBLIC_ONRAMP_APP_ID>
  &addresses={"<user's own EVM wallet address>":["base"]}
  &assets=["USDC"]
  &defaultAsset=USDC
  &defaultNetwork=base
```

- The destination address is read from the existing `useWallets` hook
  (`pickPrimaryEvmWallet`, shared with the Receive screen) — never typed by
  the client or hardcoded.
- Asset/network are fixed to USDC/Base — the only balance the rest of the
  app (Send, Earn, Receive) understands.
- No preset fiat amount is sent — the app never suggests or promises a
  specific dollar amount, rate, or return, per the Guideline 3.1.5 framing
  ("buy dollars to spend and save", not investing).
- Opened via `Linking.openURL` (`react-native`, already a dependency) —
  `expo-web-browser` is **not** in `mobile/package.json`, so it was not
  added, per the no-new-native-dependency constraint.

## Analytics

`funding_method_shown` / `funding_method_chosen` fire with
`method: 'card_onramp'` (the button) or `method: 'address_qr'` (existing
Receive copy/share), using the event shapes already defined in
`mobile/src/lib/analytics.ts`. No address, amount, or other PII is included
— `redactProps` also strips these defensively even if a call site tried.
