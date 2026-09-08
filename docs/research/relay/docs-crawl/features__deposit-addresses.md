# Deposit Addresses - Relay

Source: https://docs.relay.link/features/deposit-addresses

On this page
How It Works
Key Parameters
Address Reuse
Open vs Strict Deposit Addresses
Open Deposit Addresses
Strict Deposit Addresses
Comparison
Example Request and Response
Open Deposit Address
Strict Deposit Address
Quote Regeneration
Open-Ended Addresses
Same Token, Different Amount
Different Token (Solver Currency)
Different Chain (Same VM)
Different Chain (Different VM)
Strict Addresses
Refund Behavior
Refund Flows
refundTo Configuration
recoveryAddress
Recommended Setup
Tracking Transactions
Querying by Deposit Address
Handling Quote Regeneration
Request-Level Status
Reindexing Stuck Deposits
Caveats
Gas Overhead
Supported Currencies
Chain-Specific Notes
Other Limitations
Features
Deposit Addresses
Copy page

Bridge assets by sending funds to a deposit address — no wallet connection or signing required.

Deposit addresses let users bridge or swap tokens by simply sending funds to an address — no wallet connection or signing required. This works for both cross-chain bridges and same-chain swaps. The integrator requests a quote with useDepositAddress: true, receives a deposit address, and the user transfers funds there. Relay detects the deposit and fills on the destination chain.
This makes deposit addresses ideal for CEX withdrawals, fiat onramps, and headless systems where the sender can’t sign transactions. The user just sends to an address — same UX as a normal transfer.
​
How It Works
Quote — Integrator requests a quote with useDepositAddress: true. The response includes a depositAddress and requestId.
User Deposit — User sends funds to the deposit address (wallet transfer or exchange withdrawal).
Detect + Sweep — Relay detects the deposit onchain and sweeps funds to the depository contract. For open-ended addresses, the amount, currency, and chain are validated and the quote may be regenerated if different from the original. For strict addresses, the deposit is validated against the original order.
Fill — Relay fills on the destination chain from pre-positioned liquidity. Funds are delivered to the recipient address.
​
Key Parameters
Parameter	Type	Details
useDepositAddress	boolean	Set to true to receive a deposit address instead of transaction calldata.
user	address	The recipient wallet on the destination chain. Can be any valid address, including the zero address.
recipient	address	The address that receives funds on the destination chain.
refundTo	address	Address to send refunds if the transfer fails. Required for strict deposit addresses and for routes that include a destination-side swap. Set to the origin chain’s native-currency address (EVM 0x0000000000000000000000000000000000000000, Bitcoin bc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqmql8k8, Solana 11111111111111111111111111111111) to opt into automatic refunds to the original depositor — supported on EVM chains, Bitcoin, and Solana. Omitting this on open addresses disables automatic refund. See Refund Behavior.
recoveryAddress	address	Optional origin-chain EOA controlled by the integrator. Used as a recovery address when Relay cannot safely auto-refund to the original depositor. This is additive to refundTo; existing refundTo behavior is preserved unless recoveryAddress is supplied. See recoveryAddress.
tradeType	string	EXACT_INPUT or EXPECTED_OUTPUT for open deposit addresses. EXACT_OUTPUT is supported only with a strict deposit address (strict: true); an open-ended EXACT_OUTPUT request is rejected.
amount	string	The quoted amount in the origin token’s smallest unit. Open-ended addresses support variable deposit amounts. Strict addresses should be treated as exact-payment instructions.
strict	boolean	Set to true for a strict deposit address tied to a specific order. Omit or set to false for an open deposit address.
​
Address Reuse
Open deposit addresses can be reused for the same route (same origin currency, origin chain, destination currency, and destination chain). Each new deposit triggers a fresh quote and fill.
Strict addresses should not be presented as reusable. They are bound to the original order and intended for single-use payment instructions.
​
Open vs Strict Deposit Addresses
Relay supports two deposit address modes that differ in how flexible they are when handling deposits.
​
Open Deposit Addresses
Open-ended deposit addresses are the flexible mode for supported routes. They can handle variable deposit amounts, and on some supported chain families they can also adapt to a different supported input token or a deposit on a different chain within the same VM. Adapting to a different token or a wrong chain is not always automatic — recovery may require manual reindexing before the deposit is recognized.
refundTo is recommended. Omitting refundTo disables automatic refund — there is no internal fallback.
Best for: general-purpose integrations where you want tolerance for user variability.
​
Strict Deposit Addresses
Strict deposit addresses are bound to the original order and should be treated as predictable payment instructions. They are not flexible intake points.
refundTo is required. The request will fail without it.
Set strict: true in your /quote/v2 request.
Best for: integrations that need predictable behavior and explicit refund handling (e.g., payment processors).
​
Comparison
Behavior	Open	Strict
Accepted currencies	Flexible — may adapt to a different supported token depending on chain family	Only the currency specified in the original quote
Wrong token (solver currency)	Requote and fill on some chain families (not universal); relay.link/withdraw is the fallback if the auto-flow doesn’t complete	Recoverable via relay.link/withdraw
Wrong token (non-solver)	Not supported and not currently recoverable	Not supported and not currently recoverable
Wrong chain (same VM)	Supported, but may require manual reindexing before the deposit is recognized; some chain families refund instead	Not supported — no automatic wrong-chain recovery
Wrong chain (different VM)	Not supported	Not supported
Amount mismatch	Usually requotes for actual amount; too-small deposits may refund	Underpayments refund; exact payments fill; overpayments depend on trade type — EXACT_INPUT fills the full deposited amount with no refund of the excess, EXACT_OUTPUT fills the quoted amount and refunds the excess
refundTo	Recommended (omitting disables automatic refund)	Required
Address reuse	Yes, same route	No — bound to original order
​
Example Request and Response
​
Open Deposit Address
Bridging 0.01 ETH from Base to Optimism using an open deposit address:
Request
Response
curl -X POST \
  'https://api.relay.link/quote/v2' \
  -H 'Content-Type: application/json' \
  -d '{
	"user": "0xF0AE622e463fa757Cf72243569E18Be7Df1996cd",
	"originChainId": 8453,
	"originCurrency": "0x0000000000000000000000000000000000000000",
	"destinationChainId": 10,
	"destinationCurrency": "0x0000000000000000000000000000000000000000",
	"tradeType": "EXACT_INPUT",
	"recipient": "0xF0AE622e463fa757Cf72243569E18Be7Df1996cd",
	"amount": "100000000000000000",
	"useDepositAddress": true,
	"refundTo": "0xF0AE622e463fa757Cf72243569E18Be7Df1996cd"
}'

​
Strict Deposit Address
Same route, but using a strict deposit address. Note the addition of strict: true and the required refundTo:
Request
Response
curl -X POST \
  'https://api.relay.link/quote/v2' \
  -H 'Content-Type: application/json' \
  -d '{
	"user": "0xF0AE622e463fa757Cf72243569E18Be7Df1996cd",
	"originChainId": 8453,
	"originCurrency": "0x0000000000000000000000000000000000000000",
	"destinationChainId": 10,
	"destinationCurrency": "0x0000000000000000000000000000000000000000",
	"tradeType": "EXACT_INPUT",
	"recipient": "0xF0AE622e463fa757Cf72243569E18Be7Df1996cd",
	"amount": "100000000000000000",
	"useDepositAddress": true,
	"strict": true,
	"refundTo": "0xF0AE622e463fa757Cf72243569E18Be7Df1996cd"
}'

Key differences in the strict request:
strict is set to true
refundTo is required — the request fails without it
The deposit address is bound to this specific order and is not reusable
​
Quote Regeneration
When funds arrive at a deposit address, Relay evaluates what was sent versus what was originally quoted. How mismatches are handled depends on the deposit address mode.
​
Open-Ended Addresses
​
Same Token, Different Amount
Exact match — The original quote is reused and the fill proceeds directly.
More than quoted — A new quote is generated for the larger amount, and the fill proceeds.
Less than quoted — If the smaller amount still covers fees and the minimum fill, a new quote is generated and the fill proceeds. If not, the deposit is refunded to the refundTo address (if set).
​
Different Token (Solver Currency)
On some chain families, if the user sends a different token that is a solver currency, Relay can regenerate the quote using the actual currency deposited and fill the order. This is not universal across all chains — some chain families will fail or refund on token mismatch. If a different supported token was sent and nothing happens immediately, use the reindex endpoint as a fallback.
​
Different Chain (Same VM)
Open and custodial deposit addresses exist at the same address across chains within a VM family (e.g. all EVM chains), so a deposit can land on a chain other than the one quoted. This is supported but not always automatic: Relay’s background monitor watches the chain the address was registered on, so a wrong-chain deposit may not be recognized until it is reindexed.
If a wrong-chain deposit isn’t picked up within a few minutes, trigger detection manually with the Deposit Address Reindex endpoint, setting targetChainId to the chain the funds actually landed on. Once detected, Relay sweeps the funds and proceeds with a fresh quote and fill.
Behavior varies by chain family — some families refund a wrong-chain deposit instead of re-routing it. Strict addresses have no wrong-chain recovery (see Strict Addresses).
​
Different Chain (Different VM)
This is not possible — deposit address formats differ across VM types (e.g., EVM vs Solana vs Bitcoin), so a user cannot accidentally send to the wrong VM.
​
Strict Addresses
Strict addresses are bound to the original order. The handling is narrower:
Exact amount — The fill proceeds using the original order.
Underpayment — The deposit fails and is refunded to refundTo. The fill does not proceed.
Overpayment (EXACT_INPUT) — The full deposited amount is filled. The excess is not refunded — the fill scales up to cover everything that was deposited.
Overpayment (EXACT_OUTPUT) — The fill proceeds for the originally quoted amount and the excess is returned to refundTo as a separate refund leg. The fill itself is never scaled up.
Wrong token or wrong chain — Not supported. Strict addresses do not have automatic wrong-token or wrong-chain recovery paths.
Open-ended mismatches often create a new requestId. Always track transactions by deposit address, not by requestId. See Tracking Transactions.
​
Refund Behavior
What happens when a deposit can’t be processed depends on the token type and the refundTo configuration.
​
Refund Flows
There are two distinct refund scenarios:
Correct currency, fill failed (e.g., slippage, network issues) — If refundTo is set, the deposit is automatically refunded to that address, minus the cost of gas. No additional fees are taken.
Wrong currency (non-solver token) — Not supported and not currently recoverable.
If a wrong solver currency was sent and the deposit didn’t auto-resolve, users can recover it at relay.link/withdraw.
A same-VM wrong-chain deposit to an open or custodial address is recoverable but may not re-route or refund on its own. Trigger reindexing with targetChainId set to the chain the funds landed on. Strict addresses have no automatic wrong-chain recovery.
​
refundTo Configuration
refundTo value	Behavior
User’s address	Refund directly to the user
App-controlled address	Refund to integrator’s address — your support team handles returning funds to the user
Origin chain’s native-currency address (EVM 0x0000000000000000000000000000000000000000, Bitcoin bc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqmql8k8, Solana 11111111111111111111111111111111)	Auto-refund to the original depositor — the address that sent funds to the deposit address. Supported on EVM chains, Bitcoin, and Solana origins; rejected on other VMs. Relay makes a best effort to detect known CEX sender addresses — if the depositor is detected as a CEX address, Relay aborts auto-refund and requires manual refund / recovery instead.
Not set (open)	Automatic refund is disabled — no internal fallback
Not set (strict)	Not allowed — refundTo is required for strict deposit addresses
If users may send from a centralized exchange, do not set refundTo as the user’s address — neither an explicit user address you don’t control nor the native-currency-address auto-refund opt-in — the sender address will be the exchange’s hot wallet, not the user’s. Use an app-controlled address instead so your support team can handle the last mile. If you still want depositor auto-detection for self-custodied senders, pair the auto-refund opt-in with a recoveryAddress as the fallback.
When auto-refund to the original depositor is triggered, the request’s outTxs will contain two refund transactions. The first transaction is the solver-to-depositor transfer that actually returns funds to the depositor — this is the one to track from your integration. The second is an internal protocol-settlement transaction that does not move user funds and can be ignored by integrators.
​
recoveryAddress
recoveryAddress is for cases where Relay cannot auto-refund. It should be an integrator-controlled EOA on the origin chain.
Use recoveryAddress when an integrator wants to use Relay’s depositor detection, but also needs a fallback recovery path if the detected depositor cannot safely receive an automatic refund. This is most relevant for deposits from custodial sources like centralized exchanges, unsupported currency deposits, or blocked depositor addresses.
When recoveryAddress is supplied:
Relay still attempts to auto-refund where possible.
If Relay cannot auto-refund, the integrator can recover funds using recoveryAddress.
Existing refundTo behavior remains unchanged for flows that do not supply recoveryAddress.
recoveryAddress never receives refunds — it is only used to withdraw funds from the depository contract in the case that we cannot fill or refund.
Constraints:
Requires useDepositAddress: true — the request is rejected otherwise.
Must be a valid address on the origin chain and cannot be the origin chain’s native-currency address.
Strict deposit addresses still require refundTo even when recoveryAddress is set.
​
Recommended Setup
Open deposit addresses: Set refundTo to the user’s address for automatic refunds.
Strict deposit addresses: Always set refundTo. If the sender is unknown (e.g., CEX withdrawal), use an app-controlled address so your support team can manage refunds.
Auto-refund to depositor: When users deposit from wallets they control, you can pass refundTo as the origin chain’s native-currency address (EVM 0x0000000000000000000000000000000000000000, Bitcoin bc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqmql8k8, Solana 11111111111111111111111111111111) to refund to the original depositor automatically. The first of the two resulting outTxs is the transfer to the depositor — track that one for refund delivery. Avoid this when deposits may originate from a centralized exchange, or pair it with a recoveryAddress so funds Relay cannot safely auto-refund remain recoverable.
​
Tracking Transactions
​
Querying by Deposit Address
The most reliable way to track deposit address transactions is to poll the Get Requests API using the depositAddress query parameter:
Request
Response
curl -X GET "https://api.relay.link/requests/v2?depositAddress=<DEPOSIT_ADDRESS>&sortBy=updatedAt&sortDirection=desc&limit=20"

​
Handling Quote Regeneration
When a quote is regenerated (different amount, token, or chain), a new requestId may be generated. Use includeChildRequests=true to find all related requests, including regenerated ones:
curl -X GET "https://api.relay.link/requests/v2?depositAddress=<DEPOSIT_ADDRESS>&includeChildRequests=true"

When a regeneration happens, the original request stays under its original requestId and public status while the actual sweep and fill move under the regenerated request. To follow the handoff directly, read the top-level supersededByRequestId on the original request in GET /requests/v3 (or data.supersededByRequestId on the legacy GET /requests/v2) — it returns the regenerated requestId that now owns the fill lifecycle.
curl -X GET "https://api.relay.link/requests/v3?id=<ORIGINAL_REQUEST_ID>" -H "x-api-key: YOUR_API_KEY"

{
  "requests": [
    {
      "id": "<ORIGINAL_REQUEST_ID>",
      "status": "pending",
      "supersededByRequestId": "<REGENERATED_REQUEST_ID>"
    }
  ]
}

Use supersededByRequestId when you have the original requestId and want a direct pointer to the request that owns the fill. Use includeChildRequests=true when you want every related request in one response.
​
Request-Level Status
Once you have a requestId, you can use Get Status for detailed status polling. To avoid polling, you can also configure a webhook — webhook payloads include a depositAddress object for deposit address requests.
Request
Response
curl -X GET "https://api.relay.link/intents/status/v3?requestId=<REQUEST_ID>"

​
Reindexing Stuck Deposits
Relay’s background monitor only checks the originally quoted input token. If a user sent a different supported (solver) token, the monitor may not detect it automatically. Use the Deposit Address Reindex endpoint to trigger on-demand re-detection — it checks every solver-depositable currency on the chain and queues a sweep for any non-zero balances.
curl -X POST 'https://api.relay.link/transactions/deposit-address/reindex' \
  -H 'Content-Type: application/json' \
  -d '{
    "chainId": 8453,
    "depositAddress": "0x1ba74e01d46372008260ec971f77eb6032b938a4"
  }'

chainId is the chain the deposit address was originally registered on. Pass targetChainId to run the reindex on a different chain — useful when funds were sent to the right address but on the wrong chain (e.g. the address was registered for Arbitrum but funds landed on Ethereum). This is the chain being reindexed, not the destination chain of the original quote.
Pass currency to scope the reindex to a single currency address instead of iterating every depositable currency. Any currency registered with Relay on the target chain is accepted — including currencies outside the standard solver-depositable list (e.g. a HyperCore-registered token when the deposit address was created for HyperEVM).
curl -X POST 'https://api.relay.link/transactions/deposit-address/reindex' \
  -H 'Content-Type: application/json' \
  -d '{
    "chainId": 42161,
    "depositAddress": "0x1ba74e01d46372008260ec971f77eb6032b938a4",
    "targetChainId": 1,
    "currency": "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"
  }'

The deposit transaction hash cannot be used to look up the status of a deposit address bridge. Always use the deposit address itself or the requestId to track status.
​
Caveats
​
Gas Overhead
Deposit addresses add gas overhead compared to direct calldata execution because Relay must sweep funds from the deposit address:
Method	Token Type	Gas Overhead
Receiver	Native tokens (ETH, MATIC, etc.)	~33,000 gas
Protocol	ERC-20 tokens	~70,000 gas
For very small amounts, the gas overhead may make deposit addresses less cost-effective than direct calldata execution.
​
Supported Currencies
Only tokens listed as solver currencies for a given chain can be processed by deposit addresses. The input token must be a solver-depositable currency for the requested route. The destination token can differ and be completed through a destination-side swap — in that case, refundTo is required.
Relay treats certain tokens as equivalent within currency groups (e.g., ETH and WETH) — depositing any token in a group triggers the same fill behavior.
The table below is loaded live from the chains API. Each chain’s solverCurrencies array is the authoritative source for which tokens are supported.
Chain	Solver Currencies

Ethereum	ETH, USDC, USDT, WETH, ANIME, APE, AUSD, DAI, mUSD, PLUME, PYUSD, SIPHER, SYND, USDe, USDG
Base	ETH, USDC, USDT, WETH, cbBTC, DEGEN, SOL, SYND
Arbitrum	ETH, USDC, USDT, WETH, ANIME, APE
Optimism	ETH, USDC, USDT, WETH
BNB	USDC, USDT, BNB, SOMI, USDe
Polygon	USDC, USDT, pUSD, USDC.e
Solana	USDC, USDT, CASH, PENGU, PYUSD, SOL, USDG
Bitcoin	BTC
Abstract	ETH, USDC, PENGU
Animechain	USDC, ANIME
ApeChain	APE
Avalanche	USDC, GUN, USDe
B3	ETH, USDC
Berachain	USDC, WETH
Blast	ETH, WETH
BOB	ETH
Boba Network	ETH
Celo	USDC
Cronos	USDC, CRO, USDC.e
Doma	ETH, USDC.e
Eclipse	ETH
Ethereal	USDe
Flow EVM	USDC, FLOW
Gensyn	ETH, USDC
Gnosis	USDC, xDAI
Gunz	GUN
HyperEVM	USDC, HYPE, USD₮0, USDe
Hyperliquid	USDC, USDe
Ink	ETH, USDC, USDT0
Katana	ETH, USDC, USDT
Lighter	ETH (Spot), USDC (Perp)
Linea	ETH, USDC, mUSD
Lisk	ETH
Manta Pacific	ETH
Mantle	USDC
MegaETH	ETH, USDT, USDm
Metis	WETH
Mode	ETH
Monad	USDC, MON, mUSD
Morph	ETH
Mythos	ETH, USDC.e
Plasma	USD₮0, XPL
Plume	USDC, WETH, PLUME, pUSD
Robinhood Chain	ETH, USDG
Ronin	USDC, RON
Scroll	ETH
Shape	ETH
Somnia	SOMI
Soneium	ETH, USDC.e
Sonic	USDC
Stable	USDT0
Superseed	ETH
Tempo	USDC, PathUSD, USDT0
TON	GRAM
Tron	USDT, TRX
Unichain	ETH, USDC
World Chain	ETH, USDC
XRP	XRP
Zircuit	ETH
zkSync Era	ETH
Zora	ETH, USDzC
Non-solver tokens and NFTs sent to deposit addresses are not recoverable through normal processes. Always verify the token is a solver currency before depositing.
​
Chain-Specific Notes
Bitcoin — Standard deposits are processed after 1 block confirmation. High-value deposits (above the per-currency threshold) wait for 2 block confirmations to reduce reorg risk. Deposits are detected via mempool monitoring but only acted on after the applicable confirmation count.
Solana — Supports SPL tokens through the protocol deposit method. Native SOL and SPL tokens like USDC are solver currencies on Solana.
Hyperliquid — Uses bridged USDC (USDC.e) with different decimal precision than native USDC on other chains. Be aware of decimal mismatches when computing amounts.
​
Other Limitations
Calldata execution on destination is not allowed.

Was this page helpful?

Yes
No
Fee Sponsorship
Gas Top-Up
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform