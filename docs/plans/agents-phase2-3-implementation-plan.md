# Phase 2 + 3 Implementation Plan — Payments Frontier & Verifiable Identity

Researched 2026-07-03 (implementation-grade, two research sweeps grounded in
`api-ts` source). Companion to `agent-leading-edge-roadmap.md`. Phase 1
(swap/simulate) shipped in PR #585.

**Strategy in one line:** build every Phase 2 primitive as an additive
extension of the existing `agent_credits` ledger + Base Spend Permission
machinery (no external contract dependencies — x402r/AP2/MPP shapes are
adopted, their contracts are not), and anchor Phase 3 identity on **Base**
using the canonical `0x8004…` registries + EAS predeploys we can verify.

---

## Workstream A — Payments (Phase 2)

### A1. Testnet facilitator live test — FIRST, unblocks honesty + Bazaar
No new keys needed; runnable today.
- `X402_FACILITATOR_URL=https://x402.org/facilitator` (Base Sepolia, no auth),
  `X402_FACILITATOR_ENABLED=true`; fund a test EOA via CDP faucet.
- Script in `api-ts/scripts/`: zero-credit agent → 402 challenge → `x402-fetch`
  client pays → `facilitatorVerifyAndSettle` returns `{ok, txHash}` → confirm
  tx on Base Sepolia. Adversarial leg: tampered `payTo`/`asset`/`amount` must
  be rejected by `crossCheckSignedRequirements` (FacilitatorService.ts:66-94).
- Gap found: our env shape matches the generic HTTP facilitator, NOT CDP
  mainnet's JWT auth (`@coinbase/x402`) — mainnet needs a code change plus
  **human-provisioned `CDP_API_KEY_ID`/`CDP_API_KEY_SECRET`** and a small
  real-USDC test.
- Until this passes: keep saying "code-complete, not live-tested."

### A2. Billing sessions (pre-authorize → stream → settle once)
The session primitive both x402 V2 and Tempo MPP are converging on; we build
it on infra we already run. x402 V2 only ships SIWX re-auth (CAIP-122) — not a
budget session; Tempo MPP has escrow+vouchers but unstable public specs.
- New tables: `agent_billing_sessions` (cap_credits, spent_credits, status,
  expires_at, optional `spend_permission_id` FK to recurring_subscriptions,
  settlement_tx_hash) + `agent_billing_session_events` (per-call voucher
  ledger with monotonic `cumulative_credits`).
- Endpoints: `POST /v1/agent/billing/session` (credit-backed ring-fence, or
  EIP-712 Spend Permission-backed for larger caps), `GET .../session/:token`,
  `POST .../session/:token/close` (single settle tx if permission-backed —
  Tempo's 2-tx model).
- Metering fast path: `X-Session-Token` header in `chargeAgentForCall` —
  append event row instead of per-call `UPDATE agent_credits`.
- v1 uses DB ring-fencing, no new contract (funds stay in our custody until
  settle). SIWX support is a separate, later nice-to-have (different problem:
  repeat-access auth, not budgets).

### A3. Spend mandates (signed, inspectable spend policy)
AP2-*inspired*, crypto-native, EIP-712 (matches our spendPermission.ts pattern;
agents' wallets sign typed data natively). NOT AP2-compliant — do not claim
compliance (we already fixed that mislabel once).
- `SpendMandate` typed struct: agent, operator, `allowedTools` (keccak256 of
  canonicalized tool list), maxPerCallCredits, maxPeriodCredits,
  periodSeconds, expiry, salt.
- Table `agent_spend_mandates` (plaintext allowed_tools jsonb + signature +
  period tracking mirroring recurringSubscriptions.nextChargeAt).
- Enforcement inside `chargeAgentForCall` BEFORE tier-bypass/credit logic: a
  mandate restricts what any balance/tier may spend on; it never grants funds.
- Endpoints: POST/GET/DELETE `/v1/agent/billing/mandate`.
- Off-chain enforcement is fine for v1 (we are the only relying party);
  on-chain commitment only if mandates become externally-consumed credentials
  (ties into ERC-8004 later).

### A4. Refunds (failed paid calls)
- Table `agent_charge_refunds` (charge_ref, charge_kind credits|facilitator_settle,
  reason, status, refund_tx_hash).
- Credits path: AUTO-refund on confirmed downstream failure (on-chain revert /
  dead tx) for execute-class calls only — never quote/simulate reads. Same
  handler that detects failure increments balance back.
- Facilitator-settle path: real USDC already moved → v1 is file-pending +
  ops alert + manual reversal from the fee wallet. Automating this is where
  an x402r-style escrow earns its keep — but x402r's contract address/ABI is
  not publicly verifiable yet; DO NOT take the dependency until confirmed
  (Blockscout check when app.x402r.org exposes an address).

### A5. x402 Bazaar listing (discovery)
- No registration step: CDP's facilitator indexes automatically on the first
  **mainnet settle** carrying Bazaar discovery metadata.
- Add `declareDiscoveryExtension()`-shaped metadata (input example +
  inputSchema JSON Schema + output example, `bodyType:"json"`) to
  `buildX402Challenge()` per metered endpoint. Strict schema validation —
  malformed metadata → settle rejected.
- Hard dependency: A1 mainnet leg (CDP keys + real settle). 30-day inactivity
  drops the listing — needs a heartbeat consumer eventually.

**Review gates:** A2+A3 change the metering hot path → `money-path-reviewer`
(opus) before merge. A4 credits-path auto-refund also money-path. A1
adversarial test is itself a gate.

---

## Workstream B — Identity & verifiable trust (Phase 3)

### B1. ERC-8004 identity on Base (primary chain — decided)
- Canonical registries (CREATE2 vanity, same address across chains):
  IdentityRegistry `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` (verified on
  BaseScan: ERC1967Proxy, 75k+ txns), ReputationRegistry
  `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` (verified on Base).
  ValidationRegistry address UNVERIFIED — chain-support must resolve before
  any validation work.
- ⚠️ BRC8004 on BNB is a DIFFERENT deployment (different addresses) from the
  canonical registry also on BSC — the "largest agent base on BNB" stat is
  ambiguous between them. Avoid BNB for launch; Base is our x402/EAS/USDC home
  chain anyway. Mainnet later as optional prestige registration.
- `register(agentURI)` with registration file (`type:
  ...eip-8004#registration-v1`, name, description, image, services[]) listing
  agent-card.json (A2A), /mcp (MCP), /v1/agent/openapi (REST) as services.
- Infra signer: new org-owned Turnkey wallet (reuse hot_wallets pattern) holds
  the identity NFT + signs reputation/EAS writes. `security-auditor` review
  (new org signing capability — key custody, not user funds).
- Gas: <$1 on Base (estimate live before committing).

### B2. Portable reputation for OUR registered agents (opt-in)
- Spec constraint: self-feedback is blocked, but we're a third party relative
  to our customers' agentIds — the design works as intended.
- Deployed ABI vs EIP text diverge in secondary sources for `giveFeedback`
  (int128 value + valueDecimals vs older uint8 score) — READ THE DEPLOYED ABI
  on BaseScan before wiring code.
- Schema change: nullable `erc8004AgentId`/`erc8004Chain` on `agents` (or
  metadata jsonb short-term). Opt-in: agent supplies its own ERC-8004 id at
  registration or PATCH /me. Never mint identities on customers' behalf.
- Cadence: monthly batch or every +100 total_swaps. Tags: "starred" (0-100),
  "uptime". Anti-sybil: our value is WHO attests — point our agentURI at a
  public stats endpoint so relying parties can verify we're a real
  high-volume provider. Don't market as tamper-proof (permissionless writes
  are a known weak point).

### B3. EAS-attested swap receipts on Base
- OP-Stack predeploys: EAS `0x4200...0021`, SchemaRegistry `0x4200...0020`
  (high confidence; confirm once on-chain before hardcoding).
- Schema: `bytes32 agentIdHash, string quoteId, address fromToken, address
  toToken, uint256 fromAmount, uint256 toAmount, uint32 fromChainId, uint32
  toChainId, bytes32 txHash, uint64 timestamp` (hash agent uuid, not DB id).
- ONCHAIN attestations (sub-cent to low-cents on Base): the whole value prop
  is verifiability independent of our uptime. Offchain = free but defeats it.
- SDK: `@ethereum-attestation-service/eas-sdk` + ethers, bun-compatible; wrap
  Turnkey as an ethers Signer (existing TurnkeyService pattern).
- Optional monetization: expose as paid `attest_swap_receipt` tool (composes
  with Phase 2 metering).

### B4. MCP Registry publish — BLOCKING BUG FOUND
- Runbook + DNS TXT value + keypair already exist in
  `packages/openclaw/PUBLISHING.md` / `registry-claim/NAMESPACE_CLAIM.md`.
- **Blocker:** npm `@suwappu/mcp-server@0.1.1` has
  `"mcpName": "io.github.0xSoftBoi/suwappu"` but server.json claims
  `bot.suwappu/mcp` → package-ownership validation WILL fail even after DNS
  auth. Fix (recommended): republish npm package with
  `mcpName: "bot.suwappu/mcp"`, keep the branded namespace.
- Tooling: mcp-publisher v1.0.0 had a 422-causing schema bug (registry issue
  #525) — use a current release.
- Human steps: (1) verify DNS TXT live (`dig +short TXT suwappu.bot | grep
  MCPv1`) — generated ≠ propagated; (2) republish npm with fixed mcpName;
  (3) install mcp-publisher; (4) run the 2-command publish; (5) claim listings
  on Smithery/Glama/PulseMCP after.

### B5. TEE attestation — scoped, deferred
Turnkey already gives hardware-attested key custody (Nitro enclaves + PCR
attestation) — re-attesting that is redundant. The real gap is attesting the
swap-DECISION logic (quote selection/routing), which means moving that path
to confidential compute (Phala-style TDX) — a real infra migration, correctly
"longer-term." A signed "operational attestation" doc (commit SHA + Turnkey
policy hash) is a cheap stopgap but MUST NOT be marketed as TEE-equivalent.

---

## Sequencing

1. **Now (parallel):** A1 testnet script (api-ts-dev) · B4 npm mcpName fix
   (sdk-dev) · B1 schema prep + infra signer (api-ts-dev).
2. **Next:** A2 sessions + A3 mandates (one api-ts-dev task, shared metering
   surface) → money-path-reviewer → merge. B1 register on Base + B3 EAS
   schema registration (chain-support/api-ts-dev after signer review).
3. **Then:** A4 refunds (money-path review) · B2 reputation writes (after B1 +
   ABI verification) · A5 Bazaar (after CDP keys + mainnet settle).
4. **Deferred:** x402r contract adoption (unverifiable), SIWX extension, BNB
   registration (BRC8004 ambiguity), TEE decision-path attestation.

## Human-required steps (blocking, in priority order)
1. DNS TXT verification/propagation for suwappu.bot (B4) — registrar access.
2. npm republish of @suwappu/mcp-server with corrected mcpName (B4).
3. CDP mainnet API keys + small real-USDC test funds (A1 mainnet → A5).
4. Funding the Base infra signer wallet with gas for registrations/attestations
   (B1/B2/B3) — trivial amounts, <$5 covers months.
5. Product decision: who is our refund arbiter if we later adopt escrow (A4).
