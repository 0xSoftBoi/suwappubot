# CLAUDE.md

This file guides Claude Code when working in this repository.

## What this is

Gekko is an Expo/React Native (TypeScript) mobile app — a neobank front-end talking to the Suwappu backend over HTTP. It has no on-device swap execution or key-signing path; it is a read/act client against a hosted API.

## Cross-repo contract

The API this app calls lives in a **different repository**: `0xSoftBoi/suwappubot`, endpoints under `api/routes/mobile.py`, surfaced at `/v1/mobile/*` (plus `/webapp/swaps` for activity). This repo has no visibility into that server code. Any change to request/response shapes, new fields, or new endpoints needs a coordinated change on both sides — do not assume a field exists here just because it would be convenient; verify against the other repo or ask before shipping a client change that depends on an unreleased server change.

Client-side contract surface lives in `src/lib/endpoints.ts` (networking), `src/lib/auth.ts` (SecureStore JWT), `src/types/api.ts` (response shapes), and `src/hooks/use-gecko.ts` (server-state hooks).

## Build tools

- Use `bun`, never `npm` or `npx`.
- Run `bun run check` (wraps `tsc --noEmit` with the project's tsconfig) — never invoke bare `tsc`.
- Tests: `bun test src`.
- `@suwappu/design-tokens` is vendored at `packages/design-tokens` and resolved as a local bun workspace (`file:./packages/design-tokens`). Do not point it back at an external path.

## Product conventions (easy to regress — check every UI change against these)

- **No crypto jargon in the UI.** Dollars, not token symbols. "Savings," never protocol/product names. No chain or network names in primary UI copy (the app settles in USDC on Base internally; users never see that).
- **Every error says what happened AND what to do next.** Never a bare error code or raw server message.
- **Every empty state carries an action.** No dead-end screens with just an illustration and no next step.
- **Money formatting**: always `$1,234.56` — thousands separator, two decimals, dollar sign. No raw numeric display of balances or amounts.
- **App Store Guideline 3.1.5 framing**: money is described as *earning interest*, never as an *investment*, a *yield product*, or anything implying a guaranteed rate of return. This is a legal/App Review constraint, not just tone — get it wrong and the app is rejected or worse.
- **Analytics privacy**: bucket amounts before logging (never exact figures tied to a user). Never log wallet addresses, transaction hashes, ENS names, or any raw typed text (search queries, ask-the-assistant input, etc.). See `src/lib/analytics-privacy.ts` and `src/lib/analytics.ts`.

## Release status

Fresh installs stop at a disconnected state until native sign-in ships — this is intentional, not a bug. This build is not App Store review-ready: native authentication, reviewer test credentials, in-app account deletion, and App Store privacy labels are outstanding gates. If Telegram OIDC is used for sign-in, Guideline 4.8 requires an equivalent privacy-preserving alternative (e.g. Sign in with Apple) unless an enumerated exception applies — don't ship Telegram-only auth.

## Working style

- Do not add native dependencies without discussing the prebuild/EAS impact first — this app is meant to keep building without a native rebuild where possible.
- Preserve existing product scope and copy; this is a packaging-focused repo, not a redesign target, unless a task explicitly asks for behavior changes.
