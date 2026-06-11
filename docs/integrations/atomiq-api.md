# Atomiq REST API contract (researched + live-verified 2026-06-11)

Base: https://mainnet.swaps-api.atomiq.exchange (full execution API, no auth; testnet4 variant exists).
Amounts: raw base-unit strings (sats=8dp). Token ids: BITCOIN-BTC, LIGHTNING-BTC, STARKNET-WBTC, STARKNET-strkBTC, STARKNET-ETH, STARKNET-STRK, STARKNET-USDC(legacy bridged!).

Endpoints:
- GET /getSupportedTokens?side=INPUT|OUTPUT ; GET /getSwapCounterTokens?token=..&side=.. ; GET /getSwapLimits?srcToken=..&dstToken=.. → {input:{min,max:ApiAmount},output:{min}}
  ApiAmount = {amount, rawAmount, decimals, symbol, chain}
- GET /parseAddress?address=.. → {address,type(BITCOIN|LIGHTNING|LNURL|STARKNET...),amount?,min?,max?}
- POST /createSwap {srcToken,dstToken,amount,amountType:"EXACT_IN"|"EXACT_OUT",dstAddress,srcAddress?,gasAmount?,paymentHash?(LN-in: sha256 hex of 32B secret),lightningInvoiceDescription?}
  → {swapId,swapType,state:{number,name},quote:{inputAmount,outputAmount,fees,expiry,outputAddress},steps,isFinished,isSuccess,isFailed,isExpired}
- GET /getSwapStatus?swapId=..[&secret=hex preimage when requiresSecretReveal][&bitcoinAddress&bitcoinPublicKey for SignPSBT] → adds currentAction,requiresSecretReveal,is* flags
- POST /submitTransaction {swapId, signedTxs:[..]} → {txHashes}
- POST /settleWithLnurl {swapId, lnurlWithdraw}
- GET /listPendingSwaps?signer=..&chainId=STARKNET ; GET /listSwaps

currentAction.type:
- SendToAddress (LN inbound): txs[0].address = BOLT11 invoice, .hyperlink = lightning: URI; server auto-detects payment
- SignPSBT (BTC on-chain inbound): sender-side PSBT signing — NOT feasible when user deposits from an external/exchange wallet (deferred)
- SignSmartChainTransaction (Starknet outbound/claim/refund): txs[].type INVOKE|DEPLOY_ACCOUNT; execute with the user's starknet account
- Wait {expectedTimeSeconds, pollTimeSeconds}

LN-in flow: generate 32B secret, paymentHash=sha256(secret) → createSwap → show invoice → poll → when requiresSecretReveal=true call getSwapStatus with &secret= → claim completes.
Out flow (Starknet→BTC/LN): createSwap (BOLT11 needs EXACT_OUT) → status returns SignSmartChainTransaction (escrow INVOKE) → sign+submitTransaction → poll to CLAIMED(3); REFUNDABLE(4) → sign refund action.
Limits (live): LN-in 100..2,000,000 sats; BTC-in 10,000..2 BTC; WBTC→LN 1..2,000,000 sats; WBTC→BTC ≥11,548 sats.
States: ToBTC: REFUNDED=-3..CREATED=0,COMMITED=1,SOFT_CLAIMED=2,CLAIMED=3,REFUNDABLE=4. LN-in: PR_CREATED=0,PR_PAID=1,CLAIM_COMMITED=2,CLAIM_CLAIMED=3 (negatives = expired/failed).
Terminal: isFinished + (isSuccess|isFailed|isExpired). No rate limits documented — exponential backoff.
