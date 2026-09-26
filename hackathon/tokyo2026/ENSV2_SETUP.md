# ENSv2 Setup Runbook — `<agent>.suwappu.eth` on Sepolia

All contract ABIs and addresses in this runbook were verified 2026-09-25
against the canonical ENSv2 contracts at
`ensdomains/contracts-v2 @ sepolia-deployment-2026-09-15`
(auto-generated deployment table `contracts/docs/addresses/sepolia.md`).
The 2026-07-31 deployment is archived — do not use its addresses.

## Prerequisites

- Sepolia ETH in the owner key (gas).
- `SEPOLIA_RPC_URL` — your Sepolia RPC endpoint.
- `ENSV2_OWNER_PRIVATE_KEY` — testnet-only owner key. This key registers
  `suwappu.eth` and owns the agent names; it is the resolver admin.
- `AGENT_KEY` — the agent's operational key (the key that signs swap
  intents). It gets text-record rights for metadata keys ONLY.
- Canonical addresses: `src/ensv2/addresses.ts` (`ENSV2_SEPOLIA`).

## Step 0 — Register `suwappu.eth` (owner only, once)

The ETHRegistrar (`0xabe76f6c8dfced81aa5a2bb8034202a7136b94ca`) uses
commit → wait → register. Payment is in MockUSDC
(`0x16f95d91dba7da3aca778ec053df0ff6c6a8aa8e`).

Registration **automatically grants the owner** on the .eth registry:
`ROLE_SET_SUBREGISTRY`, `ROLE_SET_RESOLVER` (each with its admin), and
`ROLE_CAN_TRANSFER_ADMIN`. Verified in `ETHRegistrar.sol`
(`REGISTRATION_ROLE_BITMAP`).

1. Deploy a `PermissionedRegistry` to serve as suwappu.eth's child registry
   (constructor: `constructor(ILabelStore labelStore, address rootAccount,
   uint256 roleBitmap)`; rootAccount = owner, roleBitmap = full admin bits).
   Record its address as `SUWAPPU_REGISTRY`.
2. `registerParentName()`: approves MockUSDC for `base + premium` (from
   `getRegisterPrice("suwappu", duration, mockUSDC)`), then `commit(commitment)`.
3. Wait out `MIN_COMMITMENT_AGE` (read it from the registrar).
4. `finishParentRegistration()` with the same `secret`, `subregistry`
   (`SUWAPPU_REGISTRY`), duration, and MockUSDC. This mints the .eth token
   to the owner with the role bitmap above.

## Step 1 — Deploy the agent's resolver proxy (owner only, per agent)

`deployAgentResolver()`:
- Builds `initialize(grants, calls)` calldata where `calls` atomically writes
  the initial policy records. `grants = [{ account: owner, roleBitmap:
  adminRoleBitmap }]`; `adminRoleBitmap` should be the admin-of bits the
  owner needs, e.g. `adminOf(RESOLVER_ROLES.SET_TEXT)`.
- Calls `VerifiableFactory.deployProxy(permissionedResolverImpl, salt, data)`
  (`0x9e726eb570beb6bceb495ab8cda7df517d4e841c`).
- Record the returned proxy address as `AGENT_RESOLVER`.

The proxy holds `suwappu.policy` (JSON: `{ maxTxUsd,
requireApprovalAboveUsd, allowedChains, version }`) plus harmless metadata.

## Step 2 — Create `<agent>.suwappu.eth` (owner only, per agent)

`registerAgentSubname()` calls on `SUWAPPU_REGISTRY`:

```
register(string label, address owner, address registry, address resolver,
         uint256 roleBitmap, uint64 expiry) → uint256
```

- `label` = agent label (e.g. `"clanker"`)
- `owner` = owner address
- `registry` = `address(0)` — the agent name is a leaf; its own subregistry is
  never consulted during resolution (VERIFY LIVE on first setup)
- `resolver` = `AGENT_RESOLVER`
- `roleBitmap` = `0` (owner keeps control via registry roles, not token roles)
- `expiry` = now + 1 year

## Step 3 — Authorize the agent key for metadata ONLY (owner only, per agent)

`authorizeAgentKeys()` batches all grants into **one** transaction via the
resolver's `multicall(bytes[])`. One tx instead of one per key — saves ~21k
base gas per key plus the round-trips. Not folded into `initialize()` calls:
those run with `msg.sender` = the factory, which holds no admin roles.

Each batched call is:

```
grantSetterRoles(bytes setter, address account) → bool
```

with `setter = setText(dnsEncode("<agent>.suwappu.eth"), key, "")` (the
contract decodes the setter to the key-scoped resource; the value is
irrelevant), `account = AGENT_KEY`, for each key in `AGENT_WRITABLE_KEYS`
(`avatar`, `description`, `agent-version`).

**Total per-agent setup: 3 transactions** (deploy → register → authorize-batch).
Use `estimateAgentSetupGas()` to quote the exact cost before funding.

**The policy key is never authorized.** `assertAgentKeysSafe()` rejects any
`suwappu.*` key at the client layer; onchain, the key-scoped resource
`uint256(keccak256(bytes(key)))` plus `onlyRoles` makes
`setText(name, "suwappu.policy", …)` from the agent key revert. The agent can
update its avatar but cannot raise its own spending cap. **This is the demo's
security story.** (Per-agent isolation holds because each agent owns its own
resolver proxy — grants are key-scoped within that resolver.)

## Step 4 — Verify

1. `findAgentResolver()`: `ethRegistry.getSubregistry("suwappu")` →
   `SUWAPPU_REGISTRY`; `SUWAPPU_REGISTRY.getResolver("<agent>")` → `AGENT_RESOLVER`.
2. `resolvePolicy()`: `UniversalResolverV2.resolve(dnsName,
   text(node, "suwappu.policy"))` returns the policy JSON.
3. Negative test: from `AGENT_KEY`, `setText(name, "suwappu.policy", …)` must
   revert. From `AGENT_KEY`, `setText(name, "avatar", …)` must succeed.
4. Run the quote gate: a quote above `maxTxUsd` must `BLOCKED`; the demo
   scenario scripts cover the gate logic against fixtures.

## Live-verification notes

- Public entrypoint `0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe` is the shared
  deterministic proxy. For fresh v2 names, `resolvePolicy()` uses the
  direct `UniversalResolverV2` (`0x5d25c1d6acbb71b7a28aa7899618a3412a8303e3`)
  first, falling back to the public proxy. (`0x6d80F2172CFdEc5730fE683860C33d26fC42e6F1`
  is the fresh deployment's ManagedUniversalResolverProxy.)
- `suwappu.eth` availability: check `ethRegistrar.isAvailable("suwappu")`
  before step 0. If taken, use another parent label and update
  `AGENT_WRITABLE_KEYS` / demo names accordingly.
