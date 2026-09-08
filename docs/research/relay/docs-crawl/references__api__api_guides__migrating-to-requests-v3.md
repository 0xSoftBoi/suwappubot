# Migrating to Requests v3 - Relay

Source: https://docs.relay.link/references/api/api_guides/migrating-to-requests-v3

On this page
Sunset timeline
Detecting deprecation programmatically
Response shape
What changed
Request & querying
Response fields
Field migration reference
Migration checklist
Migration Guides
Migrating to Requests v3
Copy page

What changed in GET /requests/v3 and how to upgrade from v2.

GET /requests/v3 is the latest version of the Requests API. It gives you a richer query surface with advanced filtering across status, chains, amounts, addresses, time, and more, plus a cleaner and more consistent response. This guide covers every change and how to upgrade. GET /requests/v2 remains available during a deprecation window (see the sunset timeline below) — migrate before it’s retired.
x-api-key is now required. Every v3 request authenticates against an active API key. See API Keys for details.
​
Sunset timeline
GET /requests/v2 is deprecated as of July 22, 2026. It keeps working, but migrate to GET /requests/v3 before it’s fully retired on November 24, 2026.
Date	What changes
Jul 22, 2026	v2 is deprecated; v3 is the recommended version. v2 keeps working.
Sep 1, 2026 onward	v2’s rate limit is progressively reduced each month; requests over the limit receive 429.
Nov 24, 2026	v2 is fully retired — all traffic must be on v3.
​
Detecting deprecation programmatically
Every response from GET /requests/v2 carries in-band deprecation signals so clients can surface or log the sunset timeline without hard-coding dates.
Deprecation header — RFC 8594 structured-field Date, e.g. @1784678400.
Sunset header — RFC 7231 HTTP-date, e.g. Tue, 24 Nov 2026 00:00:00 GMT.
Link header — three lines with rel="deprecation", rel="sunset", and rel="successor-version" pointing to this guide and to GET /requests/v3.
These headers are attached to every v2 response (2xx, 4xx, and 5xx) and are listed in Access-Control-Expose-Headers, so browser clients using fetch or XMLHttpRequest can read them cross-origin:
const res = await fetch("https://api.relay.link/requests/v2?...");
const sunset = res.headers.get("sunset");
const deprecation = res.headers.get("deprecation");

Successful (200) responses additionally include a top-level deprecation object:
"deprecation": {
  "message": "GET /requests/v2 is deprecated. Migrate to GET /requests/v3. Relay reduces the v2 rate limit in stages from September 1, 2026. Relay retires v2 on November 24, 2026.",
  "deprecatedAt": "2026-07-22T00:00:00Z",
  "throttledFrom": "2026-09-01T00:00:00Z",
  "sunsetAt": "2026-11-24T00:00:00Z",
  "successor": "https://api.relay.link/requests/v3",
  "migrationGuide": "https://docs.relay.link/references/api/api_guides/migrating-to-requests-v3"
}

When v2 rate-limits your traffic, 429 responses return a route-specific body that also points at v3:
{
  "message": "You reached the rate limit for GET /requests/v2. Relay reduces this limit in stages. Relay retires v2 on November 24, 2026. Migrate to GET /requests/v3.",
  "successor": "https://api.relay.link/requests/v3",
  "migrationGuide": "https://docs.relay.link/references/api/api_guides/migrating-to-requests-v3"
}

No Retry-After is emitted on 429 from GET /requests/v2. For guidance on reducing your request volume, see Handling Rate Limits.
​
Response shape
The same request shown in full for v2 and v3, plus a focused diff of what moved.
v2
v3
Difference
{
  "id": "0x0000348634...",
  "status": "success",
  "user": "0xe7a2052a...",
  "recipient": "0x07082933...",
  "depositAddress": null,
  "moonpayId": null,
  "referrer": "my-app|user-123",
  "data": {
    "slippageTolerance": "0",
    "failReason": "N/A",
    "refundFailReason": "N/A",
    "subsidizedRequest": true,
    "price": "10000000000",
    "currency": "usdc",
    "currencyObject": { "chainId": 8453, "address": "0x833589...", "symbol": "USDC", "name": "USD Coin", "decimals": 6, "metadata": { "logoURI": "https://...", "verified": true } },
    "feeCurrency": "usdc.e",
    "feeCurrencyObject": { "chainId": 137, "address": "0x2791bc...", "symbol": "USDC.e", "name": "USDCoin (bridged)", "decimals": 6, "metadata": { "logoURI": "https://...", "verified": true } },
    "appFeeCurrencyObject": { "chainId": 137, "address": "0x2791bc...", "symbol": "USDC.e", "name": "USDCoin (bridged)", "decimals": 6 },
    "fees": { "gas": "1160", "fixed": "0", "price": "1999930" },
    "feesUsd": { "gas": "0.001159", "fixed": "0.000000", "price": "1.999162" },
    "appFees": [ { "recipient": "0xdfd877...", "bps": "5", "amount": "5000000", "amountUsd": "4.997980", "amountUsdCurrent": "4.998080" } ],
    "paidAppFees": [ { "recipient": "0xdfd877...", "bps": "5", "amount": "5000000", "amountUsd": "4.997980", "amountUsdCurrent": "4.998080" } ],
    "subsidizedFee": {
      "origin": { "amount": "7001090", "address": "0x2791bc...", "chainId": 137 },
      "sponsor": { "amount": "7000949", "address": "0x833589...", "chainId": 8453 },
      "amountUsd": "6.998261",
      "amountUsdCurrent": "6.998401"
    },
    "expandedPriceImpact": {
      "quoted": { "swap": { "usd": "-1.999380" }, "execution": { "usd": "-0.001160" }, "relay": { "usd": "0.000000" }, "app": { "usd": "-4.998625" }, "sponsored": { "usd": "6.999165" } },
      "actual": { "swap": { "usd": "-1.999380" }, "execution": { "usd": "-0.001160" }, "relay": { "usd": "0.000000" }, "app": { "usd": "-4.998625" }, "sponsored": { "usd": "6.999165" } }
    },
    "feeSponsorship": {
      "quoted": {
        "selectedComponents": ["execution", "swap", "relay", "app"],
        "capHit": false,
        "components": {
          "execution": { "selected": true, "total": { "currency": { "chainId": 137, "symbol": "USDC.e", "decimals": 6 }, "amount": "1160", "amountFormatted": "0.00116", "amountUsd": "0.001160", "minimumAmount": "1160" }, "sponsored": { "currency": { "chainId": 137, "symbol": "USDC.e", "decimals": 6 }, "amount": "1160", "amountUsd": "0.001160" }, "userPays": { "currency": { "chainId": 137, "symbol": "USDC.e", "decimals": 6 }, "amount": "0", "amountUsd": "0" } },
          "swap": { "selected": true, "total": { "currency": { "chainId": 137, "symbol": "USDC.e", "decimals": 6 }, "amount": "1999380", "amountUsd": "1.999380" }, "sponsored": { "amount": "1999380", "amountUsd": "1.999380" }, "userPays": { "amount": "0", "amountUsd": "0" } },
          "relay": { "selected": true, "total": { "amount": "0", "amountUsd": "0.000000" }, "sponsored": { "amount": "0", "amountUsd": "0" }, "userPays": { "amount": "0", "amountUsd": "0" } },
          "app": { "selected": true, "total": { "amount": "5000000", "amountUsd": "4.998625" }, "sponsored": { "amount": "5000000", "amountUsd": "4.998625" }, "userPays": { "amount": "0", "amountUsd": "0" } }
        },
        "sponsoredTotal": { "currency": { "chainId": 137, "symbol": "USDC.e", "decimals": 6 }, "amount": "7001090", "amountFormatted": "7.00109", "amountUsd": "6.999165" },
        "userPaysTotal": { "currency": { "chainId": 137, "symbol": "USDC.e", "decimals": 6 }, "amount": "0", "amountUsd": "0" }
      },
      "actual": { "selectedComponents": ["execution", "swap", "relay", "app"], "capHit": false, "components": { "execution": "…", "swap": "…", "relay": "…", "app": "…" }, "sponsoredTotal": { "amount": "7001090", "amountUsd": "6.999165" }, "userPaysTotal": { "amount": "0", "amountUsd": "0" } }
    },
    "inTxs": [ { "hash": "0xcd4d70...", "fee": "139725000000000", "block": 87433122, "type": "onchain", "chainId": 137, "timestamp": 1779747672, "status": "success", "data": {}, "stateChanges": [] } ],
    "outTxs": [ { "hash": "0x1c0089...", "fee": "433800000000", "block": 46479163, "type": "onchain", "chainId": 8453, "timestamp": 1779747673, "status": "success", "data": {}, "stateChanges": [] } ],
    "usesExternalLiquidity": false,
    "timeEstimate": 4,
    "metadata": {
      "sender": "0xE7a205...",
      "recipient": "0x070829...",
      "currencyIn": { "currency": { "chainId": 137, "address": "0x2791bc...", "symbol": "USDC.e", "name": "USDCoin (bridged)", "decimals": 6, "metadata": { "logoURI": "https://...", "verified": true } }, "amount": "10000000000", "amountFormatted": "10000.0", "amountUsd": "9997.600000", "amountUsdCurrent": "9996.000000", "minimumAmount": "10000000000" },
      "currencyOut": { "currency": { "chainId": 8453, "address": "0x833589...", "symbol": "USDC", "name": "USD Coin", "decimals": 6, "metadata": { "logoURI": "https://...", "verified": true } }, "amount": "10000000000", "amountFormatted": "10000.0", "amountUsd": "9997.600000", "amountUsdCurrent": "9996.000000", "minimumAmount": "10000000000" },
      "rate": "1",
      "route": {
        "origin": { "inputCurrency": { "currency": { "chainId": 137, "symbol": "USDC.e", "decimals": 6 }, "amount": "10000000000" }, "outputCurrency": { "currency": { "chainId": 137, "symbol": "USDC.e", "decimals": 6 }, "amount": "10000000000" }, "router": "relay" },
        "destination": { "inputCurrency": { "currency": { "chainId": 8453, "symbol": "USDC", "decimals": 6 }, "amount": "10000000000" }, "outputCurrency": { "currency": { "chainId": 8453, "symbol": "USDC", "decimals": 6 }, "amount": "10000000000" }, "router": "relay" }
      }
    }
  },
  "protocol": {
    "orderId": "0x...",
    "hubType": "onchain",
    "isWithdrawable": false,
    "solver": { "address": "0x...", "protocolChainId": "8453", "chainId": 8453 },
    "deposit": { "origin": { "amount": "10000000000", "chainId": 137, "currency": "0x2791bc...", "depositor": "0xe7a205...", "depository": "0x...", "onchainId": "0x...", "transactionId": "0xcd4d70..." } },
    "settlement": { "destination": { "fills": [ { "chainId": 8453, "transactionId": "0x1c0089..." } ], "refunds": [] } }
  },
  "createdAt": "2026-05-25T22:21:11.161Z",
  "updatedAt": "2026-05-25T22:21:51.291Z"
}

See all 75 lines
The full OpenAPI schema lives at api.relay.link/documentation/json.
data.fees has changed meaning. The key fees is reused for a different shape. In v2, data.fees was raw wei (gas/fixed/price/gateway). In v3 that object is removed, and data.fees now holds the per-component USD breakdown that v2 called expandedPriceImpact. Code reading data.fees.gas will break — read data.fees.quoted / data.fees.actual instead.
​
What changed
Every individual change, grouped by request side and response side.
​
Request & querying

Authentication

Filtering, search & sorting

​
Response fields

Currencies — unified to a single object

Fees — expandedPriceImpact → data.fees, relay → platform

Fee sponsorship — single source of truth

App fees — consolidated into one object

Swap & route — metadata folds into data.route

Transaction hashes — hash → txHash

Statuses — new values

Moved, added & nulled fields

​
Field migration reference

Renamed & restructured

Removed

Added

​
Migration checklist
1

Switch the endpoint and headers

Point requests at GET /requests/v3 and send x-api-key (now required). referrer filtering is still supported, but you must now pair it with the apiKey parameter using keys owned by your integrator — cross-integrator referrer lookups are no longer possible. Set includeAuthenticatedData=true only from a trusted server context to receive authenticated fields (see the note at the end).
2

Update fee reads

Stop reading data.fees.gas / feesUsd. Read the per-component USD breakdown from data.fees.quoted / data.fees.actual, and rename the relay component to platform.
3

Repoint currency & route reads

Replace data.metadata.* reads: sender is now at the root, and currencies/rate come from data.route.{quoted,actual} (prefer actual, fall back to quoted). Read the deposited amount from route.actual.origin.inputCurrency and the received amount from route.actual.destination.outputCurrency (fall back to origin.outputCurrency for same-chain swaps). Drop currency/currencyObject string handling — read the single currency object.
4

Consolidate app fees & sponsorship

Read data.appFees.quoted / data.appFees.actual. Replace subsidizedRequest/subsidizedFee with data.feeSponsorship, and rename its relay bucket to platform.
5

Fix tx hashes, statuses & nulls

Rename inTxs[].hash / outTxs[].hash to txHash. Handle the new depositing / submitted statuses (and remove delayed). Treat failReason / refundFailReason as null rather than "N/A".
6

Adopt the new querying surface

Replace separate user/hash/id lookups with a single term search where it fits, and take advantage of the new filter/sort parameters. Pagination is unchanged — keep passing continuation back for the next page (limit max 50).
Authenticated data is only returned when you pass includeAuthenticatedData=true and authenticate with an API key tied to those requests.

Was this page helpful?

Yes
No
Webhooks
Supported Chains
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform