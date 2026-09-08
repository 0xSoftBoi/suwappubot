# Programmatic Withdrawals - Relay

Source: https://docs.relay.link/references/protocol/guides/withdrawals

On this page
Overview
Supported Chains and Signers
Withdrawal Flow
Step 1: Check Eligibility
Step 2: Attest the Deposit
Step 3: Prepare
Step 4: Sign the Digest
Step 5: Execute
Step 6: Poll for Status
Step 7: Broadcast the Transaction
Caveats
Guides
Programmatic Withdrawals
Copy page

Reclaim depository funds programmatically using the public withdrawal endpoints

​
Overview
Sometimes a deposit can’t be filled: it was flagged by screening, sent in the wrong currency or on the wrong chain, or the order failed after the deposit landed. Those funds sit in the Depository until the original depositor reclaims them. relay.link/withdraw is a thin frontend over three public API endpoints, and your app can drive the same flow directly.
This is useful if you want to handle recovery inside your own app instead of sending users to the self-serve UI, or run it programmatically on a server. It works especially well when you control the depositing wallet and can complete the signing flow yourself.
These endpoints power the Relay withdrawal UI. They are stable enough to build against, but they are not yet a versioned API surface, so request and response shapes may change without a deprecation cycle.
There is no API key. Authorization is cryptographic: only the wallet that made the deposit (the owner) can produce a valid signature, so anyone can call these endpoints but only the depositor can move funds. The base URL is https://api.relay.link.
Endpoint	Purpose
POST /withdrawals/attest-deposit	Claim a stuck or flagged deposit so its balance becomes withdrawable
POST /withdrawals/request	Prepare a withdrawal (no signature), then execute it (with signature)
GET /withdrawals/status	Poll the withdrawal job to completion
​
Supported Chains and Signers
User-triggered withdrawals are supported on EVM chains, Hyperliquid, Solana, Tron, and TON. Bitcoin and Lighter withdrawals are rejected with a 400. Recovering those funds currently goes through support.
The owner must be the exact depositor address, and it must be able to sign an arbitrary message with its own key. Smart contract wallets, exchange-custodied addresses, and other signers that can’t produce a raw message signature can’t complete this flow, since there is no contract-signature (ERC-1271) path today. If the depositor key is inaccessible, contact support.
​
Withdrawal Flow
​
Step 1: Check Eligibility
Look up the request with the requests API:
curl "https://api.relay.link/requests/v3?id={requestId}"

To enumerate candidates for a wallet instead of checking a single request, query GET /requests/v3?user={wallet}&status=failure and filter on the protocol object.
In each returned request, the protocol object tells you what you need:
protocol.isWithdrawable — true means the deposit is recoverable via this flow
protocol.deposit.origin.depositor — the wallet that must sign (the owner below)
protocol.deposit.origin — also carries the deposit’s chainId, currency, amount, and transactionId for the next steps
​
Step 2: Attest the Deposit
If the deposit hasn’t been claimed onto the protocol hub yet, attest it:
curl -X POST "https://api.relay.link/withdrawals/attest-deposit" \
  -H "Content-Type: application/json" \
  -d '{ "chainId": 8453, "transactionId": "0xDEPOSIT_TX_HASH" }'

Note that chainId here is the numeric Relay chain id of the deposit chain. This is the one exception in the flow — every other chainId is a protocol slug (see the next step). A successful attestation returns { "success": true }.
The call is idempotent and safe to retry. A 503 (for example “Transaction not yet finalized” or “Recovery in progress”) means wait and retry. A 400 is terminal for that transaction.
​
Step 3: Prepare
Call the request endpoint without a signature to get signing parameters:
curl -X POST "https://api.relay.link/withdrawals/request" \
  -H "Content-Type: application/json" \
  -d '{
    "chainId": "base",
    "currency": "0x0000000000000000000000000000000000000000",
    "amount": "211891421",
    "ownerChainId": "base",
    "owner": "0xDEPOSITOR_ADDRESS",
    "recipient": "0xRECIPIENT_ADDRESS"
  }'

chainId / ownerChainId — protocol chain slugs (base, bnb, solana), not numeric ids. Read them from chains[].protocol.v2.chainId in the chains API.
currency — the token address on the withdrawal chain, or the zero address for the native token
amount — raw base units as an integer string
recipient — where the funds go. May differ from owner.
The response looks like { "nonce": "0x…", "amount": "211891421", "additionalData": { … } }. Use the returned amount in every following step — it’s validated against the available hub balance, and requesting more than is available returns a 400. additionalData may be absent; when present, pass it through untouched.
The nonce is deterministic per one-minute window for a given (chain, owner, currency, recipient) tuple and expires quickly, so prepare, sign, and execute in one sitting. If the job later reports expired, restart from this step.
​
Step 4: Sign the Digest
Build a SHA-256 digest over the stable-stringified request and sign it with the owner wallet:
import stringify from "json-stable-stringify";
import { sha256, toHex } from "viem";

const digest = sha256(
  toHex(
    stringify({
      operation: "withdrawal",
      chainId,        // protocol slug, as sent in the prepare step
      currency,
      amount,         // the amount RETURNED by prepare
      ownerChainId,
      owner,
      recipient,
      nonce,          // returned by prepare
      additionalData, // exactly as returned by prepare; omit if absent
    })!
  )
).slice(2); // hex digest, no 0x prefix

The digest includes operation: "withdrawal", the nonce, and additionalData exactly as prepare returned them. Key order doesn’t matter (json-stable-stringify sorts keys), but changing any value — including signing your original amount instead of the returned one — produces an invalid signature.
Sign the digest with the owner key and submit the signature as 0x-prefixed hex:
Chain family	How to sign
EVM / Hyperliquid	personal_sign over the raw digest bytes — walletClient.signMessage({ message: { raw: '0x' + digest } })
Solana	signMessage(digest) (the digest as a UTF-8 string), then hex-encode the ed25519 signature
Tron	tronWeb.trx.signMessageV2(digest)
TON	TonConnect signData({ type: "text", text: digest }), then hex-encode the signature
On TON, the wallet’s signData response also includes a timestamp and domain. Submit them in the execute call as additionalData["ton-vm"] = { timestamp, domain }. They are needed for verification but are not part of the signed digest above.
​
Step 5: Execute
Repeat the same call with the nonce, additionalData, and signature added:
curl -X POST "https://api.relay.link/withdrawals/request" \
  -H "Content-Type: application/json" \
  -d '{
    "chainId": "base",
    "currency": "0x0000000000000000000000000000000000000000",
    "amount": "211891421",
    "ownerChainId": "base",
    "owner": "0xDEPOSITOR_ADDRESS",
    "recipient": "0xRECIPIENT_ADDRESS",
    "nonce": "0xNONCE_FROM_PREPARE",
    "additionalData": {},
    "signature": "0xOWNER_SIGNATURE"
  }'

Success returns { "jobId": "…", "status": "processing" }. Only one withdrawal per (chain, owner, currency) balance can be in flight at a time — a second request returns a 409 with code WITHDRAWAL_IN_PROGRESS and the existingJobId to poll instead.
​
Step 6: Poll for Status
curl "https://api.relay.link/withdrawals/status?id={jobId}"

Status	What to do
processing, initiating, attesting	Keep polling (~5s; back off to ~15s on a 429)
ready	The response includes a transaction — broadcast it from the owner wallet (next step), then keep polling
executed	Done — the funds are with the recipient
expired	The nonce or job expired and the funds returned to the hub balance. Restart from the prepare step.
failed	See reason, then restart from the prepare step
Status entries are retained for 24 hours. An unknown or evicted id reports processing, so don’t poll ids older than a day expecting a terminal state.
​
Step 7: Broadcast the Transaction
ready is not done. On TON the solver broadcasts for you and the status moves to executed on its own, but on every other supported chain, ready hands you a transaction object that the owner wallet must sign and broadcast on-chain, paying its own gas. Depending on the chain this is an EVM transaction request, Solana instructions, or a Tron TriggerSmartContract payload.
A job stuck at ready because the transaction was never broadcast is the most common integration mistake. After broadcasting, keep polling until the status reaches executed. If the owner is on a different VM than the withdrawal chain, the returned transaction is built for the recipient to broadcast instead.
​
Caveats
chainId is a protocol slug (base, not 8453) everywhere except attest-deposit, which takes the numeric id.
Sign and execute with the amount that prepare returned, not your original input.
ready is not done — broadcast the returned transaction and keep polling.
Move quickly between prepare, sign, and execute. The nonce is short-lived; on expired, re-prepare.
One withdrawal at a time per (chain, owner, currency). A second in-flight request returns a 409 with the existing jobId, and the balance unlocks when the job reaches a terminal state.
Building with an AI assistant? Use the Copy page button at the top of this page to hand it to your agent, or see Integrating using AI to connect the Relay docs MCP server and llms.txt.

Was this page helpful?

Yes
No
For Apps
Third-Party Oracle
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform