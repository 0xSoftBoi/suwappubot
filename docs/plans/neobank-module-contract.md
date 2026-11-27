# Suwappu Bank — module contract (M0 + M1 foundation)

Read this before adding a bank module. Plan: `docs/plans/neobank-execution.md`.

## (a) Sign + broadcast path (traced, reused by BankTransferService)

Webapp user, custodial Turnkey wallet, EVM (the only api-ts-native path today):
- Wallet row: `wallets` (Python-owned, `db/schema/wallets.ts`): `turnkeySubOrgId`, `address`, `chainType`, `userId`.
- `api-ts/src/routes/swap.ts:379-384` builds a Turnkey client with the user's sub-org.
- `routes/swap.ts:553-584` sign: `withSigningFallback(() => turnkey.apiClient().signTransaction({organizationId: subOrgId, signWith: address, type: 'TRANSACTION_TYPE_ETHEREUM', unsignedTransaction: JSON.stringify(eip1559Tx)}), wallet.id, user.id, tx)` from `services/FallbackSigningService.ts:92` (falls back to Python `/internal/sign-transaction`, `api/routes/internal.py:57`, which needs `wallets.id` + the owning `users.id`).
- `routes/swap.ts:596-621` broadcast: `eth_sendRawTransaction` through `fetchWithRetry`. Helper equivalents: `config/chains.ts:272` `broadcastEvmTransaction`, `:294` `getTransactionReceipt`.
- Nonce: `eth_getTransactionCount` (swap.ts:406). ERC-20 calldata style: swap.ts:463 (`0x095ea7b3`).

Agent wallet:
- Agents own a Turnkey wallet provisioned by `POST /v1/agent/wallets` (`routes/agent.ts:2776-2930`) and mirrored into Python as a user+wallet (`provisionInternalWallet`, agent.ts:2816 -> `/internal/agent/provision-wallet`, `api/routes/internal.py:269`). Ids live in `agents.metadata`: `internal_user_id`, `internal_wallet_id`, `wallet_address` (EVM) and `*_solana` variants.
- Agent swap execution does NOT sign in api-ts: `routes/agent.ts:3284-3313` POSTs `/internal/agent/execute-swap` (`api/routes/internal.py:411`); Python signs+broadcasts for EVM and Solana.
- Because the agent wallet is a normal `wallets` row, the bank signs it with the same Turnkey+fallback call as users, keyed by `wallets.id` + `wallets.userId` (= `internal_user_id`).

Solana: api-ts has no sign+broadcast route. Available primitives: `TurnkeyService.signTransactionForAgent(subOrgId, unsignedTxHex, signWith, 'solana')` (`services/TurnkeyService.ts:363`, `TRANSACTION_TYPE_SOLANA`) and `withSigningFallback(..., chainType='solana')`. Bank builds the SPL `transferChecked` legacy tx itself (`services/bank/chain.ts`), signs with those, broadcasts via `sendTransaction` on `RPC_ENDPOINTS.solana`.

**Other modules never sign.** Call `BankTransferService.transfer(...)`:

```ts
const t = yield* BankTransferService
yield* t.transfer({ owner, idempotencyKey, type: 'earn', fromAccountId, toAccountId | toExternal,
  amountMinor: '1000000', memo?, metadata? })   // -> BankTransfer row (status pending|submitted|confirmed)
```
`owner = { ownerType: 'user'|'agent'|'org'|'partner_customer', ownerId: string }` (user: `users.id`, agent: `agents.id`, as strings). Amounts are integer minor-unit strings.

## (b) Registration contract

Routes — create `api-ts/src/routes/bank/<module>.ts`:
```ts
import type { BankRouteApp, BankRouteDeps } from './index'
export function register(app: BankRouteApp, deps: BankRouteDeps) {
  app.get('/earn/vaults', async (c) => {
    const owner = await deps.resolveOwner(c)      // { ownerType, ownerId } | throws HTTPException 401/403
    return deps.run(c, Effect.gen(function* () {
      const svc = yield* BankEarnService
      return yield* svc.listVaults(owner)           // must return an object: run() wraps it as {success:true,...}
    }))                                              // run() maps BankError/AppError -> JSON response
  })
}
```
ONE line in `routes/bank/index.ts`: add `import { register as earn } from './earn'` and `earn,` in the `modules` array. (Both audiences get the endpoints; `/webapp/bank/*` and `/v1/agent/bank/*`.)

Services — create `api-ts/src/services/bank/BankEarnService.ts`:
```ts
export class BankEarnService extends Context.Tag('BankEarnService')<BankEarnService, {
  readonly listVaults: (o: BankOwner) => Effect.Effect<Vault[], BankError, DrizzleService | BankLedgerService>
}>() {}
export const BankEarnServiceLive = Layer.succeed(BankEarnService, { listVaults: (o) => Effect.gen(function* () { /* real code */ }) })
```
ONE line in `services/bank/index.ts`: import it and add `BankEarnServiceLive,` to the `Layer.mergeAll` in `BankLayer`. `BankLayer` is merged into `MainLayer` once (done).

Schema/tables: new file `db/schema/bank<Module>.ts` + one `export *` line in `db/schema/index.ts`; Python DDL file `database/bank_ddl/<module>.py` (auto-discovered, exports `statements(is_sqlite: bool) -> list[str]`, all `IF NOT EXISTS`); Drizzle migration with your pre-assigned number: 0027 M2/M3, 0028 M4/M5, 0029 M6, 0030 M7/M8, 0031 M9, 0032 M10-13 (`api-ts/drizzle/00NN_bank_<module>.sql`, idempotent SQL, plus an entry in `drizzle/meta/_journal.json`, `when` > previous). `drizzle.config.ts` already filters `bank_*`.

Ledger rules: `BankLedgerService.post({transferId, entries})` — debits == credits per asset, accounts locked in id order, non-system accounts cannot go negative. Balance = credits - debits. System accounts (`owner_type='system'`): `clearing` (in flight), `external` (outside world), `fx` (conversion), created lazily by `ensureSystemAccount`. Transfer lifecycle: submit posts debit A / credit clearing; confirm posts clearing -> B (internal) or clearing -> external; failure posts the reversal clearing -> A.

## (c) Tables in prod
api-ts `start.sh` runs `drizzle-kit migrate` in production (committed SQL in `api-ts/drizzle/`, journal `_journal.json`); Python `_ensure_schema()` (`database/db.py`) calls `database/bank_ddl.ensure_bank_tables`. Both are `CREATE TABLE IF NOT EXISTS`, so whichever side boots first wins (ADR 0003). Core: `drizzle/0026_bank_core.sql` + `database/bank_ddl/core.py`.

## Other primitives
- Low-level EVM send (approvals, protocol calls) from a bank account's wallet: `BankTransferService.sendEvm({account, to, data, valueHex?, gas?, onSigned?})` (locks per-wallet nonce, signs, persists-hash-before-broadcast via `onSigned`, classifies accepted/rejected/ambiguous). `failTransfer(id, reason)` releases a reservation only if no tx hash was ever persisted.
- Transfer `type` is free-form per module ('earn', 'card', ...); module-specific data goes in `metadata`. The reconciler (`confirmPending`, every `BANK_RECONCILE_SECONDS`, default 30, 0 disables) settles `internal|onchain|agent|fx` transfers generically; modules needing custom settlement should add a branch in `settle()` keyed on `type`.
- Per-account limits: `bank_accounts.metadata.limits = { perTxMinor, dailyMinor }`.
- Custody wallets: `BankLedgerService.resolveCustodyWallet(owner, 'evm'|'solana')` supports user + agent; org/partner owners must pass an explicit `wallet` to `openAccount` (M9/M11).
