# Neobank provider API reference (researched Nov 2026)

Anything marked UNVERIFIED must be confirmed against live docs / onchain before a
code path depends on it. Never guess an address: read `decimals()`/`symbol()` onchain.

## Bridge (ramps, virtual accounts) — https://apidocs.bridge.xyz
- Base `https://api.bridge.xyz/v0`, header `Api-Key: <key>`. Sandbox base URL UNVERIFIED (keys are per-developer).
- `Idempotency-Key: <uuid>` REQUIRED on every POST (reuse on retry); do not send on GET/PUT/PATCH/DELETE.
- Customers: `POST/GET /customers`, `GET/PUT/DELETE /customers/{id}`. KYC: `GET/POST /kyc_links` (+ status by id; body fields UNVERIFIED).
- Virtual accounts: `POST /customers/{id}/virtual_accounts`
  - source currency: usd, eur, mxn, brl, cop, gbp
  - destination `{currency, payment_rail, address | bridge_wallet_id}`; currency usdb|usdc|usdt|pyusd|eurc; rails base, ethereum, polygon, arbitrum, solana, tron, tempo…
  - optional `developer_fee_percent`, `travel_rule_data`
  - response `source_deposit_instructions`: ACH/FedNow/wire (account+routing), SEPA (IBAN+BIC), SPEI (CLABE), PIX (`br_code`), GBP (sort code), COP (Bre-B key)
- Transfers: `POST /transfers` body `on_behalf_of, source, destination, amount?, client_reference_id, developer_fee, dry_run, features, return_instructions, travel_rule_data`
  - source/destination: `payment_rail, currency` + `external_account_id | bridge_wallet_id | to_address | from_address`
  - source rails: ach, ach_push, ach_same_day, wire, fednow, faster_payments, pix, sepa, spei, swift, co_bank_transfer, bre_b, bridge_wallet, crypto chains
  - destination rails: ach, wire, fednow, sepa, spei, swift, co_bank_transfer, bre_b, crypto chains. **PIX is NOT a documented destination** (deposit only).
  - states: awaiting_funds, in_review, funds_received, payment_submitted, payment_processed, canceled, undeliverable, returned, refund_in_flight, refund_failed, refunded
  - 403 = AML rejection; 409 `resource_state_conflict` = transient, retry same key
- Liquidation addresses: `/customers/{id}/liquidation_addresses` (+ `/drains`). External accounts: CRUD + verify (paths UNVERIFIED). Exchange rate GET path UNVERIFIED.
- Cards: `/customers/{id}/card_accounts` is **DEPRECATED → use Stripe Issuing**.
- Branded stablecoin: USDB (closed loop) / "Open USD"; **no issuance endpoints in the public reference**.
- Webhooks: header `X-Webhook-Signature: t=<ms>,v0=<base64>`; RSA PKCS#1 v1.5 + SHA-256 with a per-endpoint PUBLIC KEY over SHA-256 of `"{t}.{rawBody}"`; reject > ~10 min old.

## Cards
- Stripe Issuing is the supported path (use Stripe docs / Stripe MCP for exact shapes; real-time `issuing_authorization.request` webhook drives the rule engine).
- Rain: docs gated. UNVERIFIED: `https://api-dev.raincards.xyz/v1`, `Api-Key`, `POST /issuing/applications/user`, `/issuing/users/{userId}/cards`.

## Local rails
- Due: `https://api.due.network/v1`, Bearer key + `Due-Account-Id`. `POST /transfers/quote {source:{rail,currency,amount},destination:{…}}` → `token, fxRate, fxMarkup, expiresAt`; `POST /transfers {quote,sender,recipient,memo}` → `awaiting_funds` (expires 2h); `POST /transfers/{id}/transfer_intent` → EIP-712 signables. PIX/SPEI destination UNVERIFIED.
- Conduit, Bitso Business: no reachable public docs (UNVERIFIED). Mexico payouts available today via Bridge `spei` destination.

## Morpho
- Morpho Blue `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb` (Ethereum + Base).
- Vaults are ERC-4626: `approve` → `deposit(assets, receiver)`; `withdraw(assets, receiver, owner)` / `redeem(shares, receiver, owner)`.
- Blue: `MarketParams{loanToken, collateralToken, oracle, irm, lltv(1e18)}`; `supplyCollateral(mp, assets, onBehalf, data)`, `borrow(mp, assets, shares, onBehalf, receiver)`, `repay(mp, assets, shares, onBehalf, data)`, `withdrawCollateral(mp, assets, onBehalf, receiver)`. Pass assets OR shares (other = 0).
- API: GraphQL `https://api.morpho.org/graphql`; REST `GET /v1/vaults-v2/{chainId}:{addr}/state`, `/apy-averages?lookback=seven_days`, `GET /v0/vaults-v1/users/{addr}/positions`. APY excludes rewards.
- Repo already has `api-ts/src/services/MorphoService.ts` — reuse first.

## x402 v2
- Headers (base64 JSON): `PAYMENT-REQUIRED` (402), `PAYMENT-SIGNATURE` (retry), `PAYMENT-RESPONSE`. v1 names were `X-PAYMENT`/`X-PAYMENT-RESPONSE`.
- PaymentRequired `{x402Version:2, resource, accepts:[{scheme, network(CAIP-2), amount, asset, payTo, maxTimeoutSeconds, extra}]}`; `exact` extra = token EIP-712 `name`,`version`.
- Payload `{x402Version, accepted, payload:{signature, authorization:{from,to,value,validAfter,validBefore,nonce(32b)}}}` (EIP-3009).
- Facilitator `POST /verify` → `{isValid,payer,invalidReason}`, `POST /settle` → `{success,payer,transaction,network}`. CDP paths `/v2/x402/verify|settle` (host UNVERIFIED).
- Repo already has `api-ts/src/middleware/x402Payment.ts` — reuse first.

## Stealth addresses
- ERC-5564 announcer `0x55649E01B5Df198D18D95b5cc5051630cfD45564`: `announce(schemeId, stealthAddress, ephemeralPubKey, metadata)`, `metadata[0]` = view tag.
- ERC-6538 registry `0x6538E6bf4B0eBd30A8Ea093027Ac2422ce5d6538`: `registerKeys(schemeId, stealthMetaAddress)`, `stealthMetaAddressOf(address, schemeId)`.
- Scheme 1: ephemeral r; secret = r·P_view; s_h = keccak(secret); view tag = first byte; stealth pub = P_spend + s_h·G; recipient priv = p_spend + s_h. Implement with `@noble/secp256k1`/viem.

## Tempo
- Mainnet chain 4217 `https://rpc.tempo.xyz`; testnet Moderato 42431 `https://rpc.moderato.tempo.xyz`.
- No native gas token: fees in a USD TIP-20 (`feeToken` per tx or account default), 6 decimals. pathUSD `0x20c0000000000000000000000000000000000000`.
- `transferWithMemo` (bytes32 memo). Repo already has `bot/services/tempo_tip20.py`, `tempo_dex_api.py`.

## Tokens (Circle-sourced unless noted)
| Token | Chain | Address |
|---|---|---|
| USDC | Ethereum | 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 |
| USDC | Base | 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 |
| USDC | Arbitrum | 0xaf88d065e77c8cC2239327C5EDb3A432268e5831 |
| USDC | Polygon | 0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359 |
| USDC | Solana | EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v |
| EURC | Ethereum | 0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c |
| EURC | Base | 0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42 |
| USDT | Ethereum | 0xdac17f958d2ee523a2206206994597c13d831ec7 (secondary sources) |

UNVERIFIED — confirm onchain before use: USDT Arbitrum, BRZ (Polygon `0x4ed141110f6eeeaba9a1df36d8c26f684d2475dc`, 18 dec on EVM), XSGD, MXNB.
