# Uniswap Developer Feedback — Suwappu Trust Layer (ETHGlobal Tokyo 2026)

_Required for the Uniswap prize: keep this file in the repo AND submit the
form at https://developers.uniswap.org/hackathon-feedback._

## Environment

- Toolchain: bun 1.4.2, TypeScript 5.6, viem 2.55.10, zod 4.3.6
- Integration: Trading API (`https://trade-api.gateway.uniswap.org`) via
  `src/uniswap/tradingApi.ts`; routing adapter `src/uniswap/routeAdapter.ts`;
  MCP tools `src/uniswap/mcpTools.ts`

## Findings

### 1. [ ] e.g. "Quote request validation"

- **File/line:** `src/uniswap/tradingApi.ts` — `QuoteRequest` schema
- **Issue:** [describe what surprised you: a field the docs didn't mention, a
  routeType you didn't expect for a given pair, an error shape, etc.]
- **Suggestion:** [concrete change to docs or API]

### 2. [ ] e.g. "Classic vs UniswapX dispatch"

- **File/line:** `src/uniswap/tradingApi.ts` — `getExecution`
- **Issue:** [e.g. "DUTCH_V2 quotes arrived for pairs where we expected CLASSIC;
  the routing preference flag behaved as X not Y"]
- **Suggestion:** [concrete change]

### 3. [ ] e.g. "check_approval / Permit2"

- **File/line:** `src/uniswap/routeAdapter.ts` — `ensureApproval`
- **Issue:** [describe]
- **Suggestion:** [concrete change]

## Smaller notes

- [ ] Anything minor: naming, dashboard UX, key issuance speed, error messages.

## What worked well

- [ ] e.g. "Single /quote endpoint across Classic and UniswapX made the
  route-type dispatch (our core contribution) straightforward to implement."
- [ ] e.g. "x-api-key auth, no OAuth dance — key to first quote in minutes."

## Code pointers

- Client: `src/uniswap/tradingApi.ts`
- First-class route source: `src/uniswap/routeAdapter.ts`
- MCP tools (`uniswap_quote`, `uniswap_check_approval`, `uniswap_build_execution`):
  `src/uniswap/mcpTools.ts`
