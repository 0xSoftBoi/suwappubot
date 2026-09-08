# Input Validation - Relay

Source: https://docs.relay.link/references/api/api_core_concepts/input-validation

On this page
What you can verify
Guide
1. Request a quote with protocol data
2. Check the order properties
3. Recompute the order ID
4. Confirm the transaction matches the order
Validating onchain
Deposit addresses
Migrating from the signature API
Core Concepts
Input Validation
Copy page

Verify a quote locally before you send the transaction

By default, you pay for a Relay quote with a transfer that the chain does not check against the quote terms, which keeps gas cost to a minimum.
You can verify a supported quote locally before you send the transaction. This verification uses the quote data, the Relay settlement SDK, and the chain metadata from GET /chains. It does not require another API request at quote time.
With the signature API, you asked Relay for a signature over a small set of intent fields and checked that signature onchain. A signature only proves that Relay said something; it does not let you confirm that what Relay said matches the transaction you are about to send. The verification on this page inverts that:
Read the output amount, recipient, currency, and deadline from the order.
Recompute the order ID from these properties.
Confirm that the transaction commits to the recomputed order ID, and pays what the order says.
If all three checks pass and the order settles, settlement follows the order you inspected.
This method applies only to quotes that contain protocol.v2. It does not apply to deposit-address deposits. If your integration uses deposit addresses, contact Relay before you migrate from the signature API.
​
What you can verify
The recipient is who you expect, and is on your whitelist
The minimum output amount is acceptable
The input and output currencies and chains are correct
The amount you are being asked to pay matches the quoted input
The order has not expired
The deposit transaction pays Relay’s canonical depository, commits to this exact order, and transfers exactly the order’s input payment
​
Guide
​
1. Request a quote with protocol data
Pass includeProtocolData: true so the response includes the full protocol order alongside the quote.
curl -X POST https://api.relay.link/quote/v2 \
  -H 'Content-Type: application/json' \
  -H 'x-api-key: YOUR_API_KEY' \
  -d '{
    "user": "0xf3d63166F0Ca56C3c1A3508FcE03Ff0Cf3Fb691e",
    "originChainId": 1,
    "destinationChainId": 8453,
    "originCurrency": "0x0000000000000000000000000000000000000000",
    "destinationCurrency": "0x0000000000000000000000000000000000000000",
    "recipient": "0xf3d63166F0Ca56C3c1A3508FcE03Ff0Cf3Fb691e",
    "tradeType": "EXACT_INPUT",
    "amount": "100000000000000000",
    "includeProtocolData": true
  }' | jq

The response carries a protocol.v2 block:
{
  "protocol": {
    "v2": {
      "orderId": "0xd4f71fa132a005aa7fc1596fffaea5a168e06a6fc4960d0c3a6f61cc702a6904",
      "hubType": "onchain",
      "orderData": {
        "version": "v1",
        "solverChainId": "base",
        "solver": "0xf70da97812cb96acdf810712aa562db8dfa3dbef",
        "salt": "0xfd839ebcf726a1569c120b0038f705432a151a7f586aefce852bb7b5428d057b",
        "inputs": [
          {
            "payment": {
              "chainId": "ethereum",
              "currency": "0x0000000000000000000000000000000000000000",
              "amount": "100000000000000000",
              "weight": "1"
            },
            "refunds": ["..."]
          }
        ],
        "output": {
          "chainId": "base",
          "payments": [
            {
              "recipient": "0xf3d63166F0Ca56C3c1A3508FcE03Ff0Cf3Fb691e",
              "currency": "0x0000000000000000000000000000000000000000",
              "minimumAmount": "97991321030687428",
              "expectedAmount": "99991143908864722"
            }
          ],
          "calls": [],
          "deadline": 1788888266,
          "extraData": "0x000000000000000000000000b92fe925dc43a0ecde6c8b1a2709c170ec4fff4f"
        },
        "fees": []
      },
      "orderSignature": "0x...",
      "paymentDetails": {
        "chainId": "ethereum",
        "depository": "0x4cd00e387622c35bddb9b4c962c136462338bc31",
        "currency": "0x0000000000000000000000000000000000000000",
        "amount": "100000000000000000"
      }
    }
  }
}

See all 47 lines
orderData is the complete, canonical description of the order. Everything else in this guide is derived from it.
​
2. Check the order properties
Read the values you care about from orderData and compare them against your own expectations. This is the step where you decide whether the order is acceptable — the checks that follow only bind the transaction to the properties you inspect here.
What to check	Where
Recipient	output.payments[].recipient
Guaranteed output	output.payments[].minimumAmount
Output currency and chain	output.payments[].currency, output.chainId
What you pay	inputs[].payment.amount, inputs[].payment.currency
Expiry	output.deadline (unix seconds)
Compare minimumAmount, not expectedAmount. expectedAmount is the quoted estimate; minimumAmount is the floor the protocol enforces at settlement.
​
3. Recompute the order ID
The examples below assume quote is the parsed /quote/v2 response from step 1. Install the settlement SDK:
npm install @relay-protocol/settlement-sdk

getOrderId needs a map from protocol chain ID to VM type. Build it from GET /chains rather than from the quote, and cache it — it changes only when Relay adds a chain. The same response carries the canonical depository address per chain, which step 4 needs.
import type { VmType } from "@relay-protocol/settlement-sdk";

const VM_TYPES = {
  bvm: "bitcoin-vm",
  evm: "ethereum-vm",
  hypevm: "hyperliquid-vm",
  lvm: "lighter-vm",
  svm: "solana-vm",
  tonvm: "ton-vm",
  tvm: "tron-vm",
  xrpvm: "xrp-vm",
} as const;

const { chains } = await fetch("https://api.relay.link/chains").then((r) => r.json());

const CHAINS: Record<string, VmType> = {};
const DEPOSITORIES: Record<string, string> = {};

for (const chain of chains) {
  const protocolChainId = chain.protocol?.v2?.chainId;
  if (!protocolChainId) continue;

  CHAINS[protocolChainId] = VM_TYPES[chain.vmType as keyof typeof VM_TYPES];
  if (chain.protocol.v2.depository) {
    DEPOSITORIES[protocolChainId] = chain.protocol.v2.depository.toLowerCase();
  }
}

getOrderId hashes the order data into the order ID. Recomputing it locally and comparing against protocol.v2.orderId confirms that the ID Relay returned corresponds to the properties you just inspected.
import { getOrderId } from "@relay-protocol/settlement-sdk";

const { orderId, orderData } = quote.protocol.v2;

const computedOrderId = getOrderId(orderData, CHAINS);

if (computedOrderId.toLowerCase() !== orderId.toLowerCase()) {
  throw new Error("Order ID does not match the order data");
}

​
4. Confirm the transaction matches the order
The deposit transaction pays the protocol depository, passes the order ID as the deposit id, and transfers the order’s input payment. Check all three.
Select the deposit transaction using the depository address from GET /chains, not protocol.v2.depository from the quote. Using the quote’s own field to validate the quote proves nothing — a tampered response could name an attacker’s address in both places and still pass.
The order ID does not cover the currency, value, or token amount the transaction transfers, so those need checking separately — and which deposit function is correct follows from the order, not from the calldata.
import { decodeFunctionData, parseAbi } from "viem";
import { getVmTypeNativeCurrency } from "@relay-protocol/settlement-sdk";

// The wallet your app will send the deposit from — the same address you passed
// as `user` in the quote request. Read it from your own state, never from the
// quote response, for the same reason the depository is pinned above.
const expectedPayer = "WALLET_ADDRESS";

const payment = quote.protocol.v2.orderData.inputs[0].payment;

// 1. Resolve the canonical depository for the payment chain.
const depository = DEPOSITORIES[payment.chainId];
if (!depository) {
  throw new Error(`No known depository for chain ${payment.chainId}`);
}

// 2. Cross-check the quote's own claim against the canonical address.
if (quote.protocol.v2.paymentDetails.depository.toLowerCase() !== depository) {
  throw new Error("Quote names an unexpected depository");
}

// 3. Find the step that pays it.
const depositTx = quote.steps
  .flatMap((step) => step.items)
  .map((item) => item.data)
  .find((tx) => tx?.to?.toLowerCase() === depository);

if (!depositTx) {
  throw new Error("No step pays the canonical depository");
}

const { functionName, args } = decodeFunctionData({
  abi: parseAbi([
    "function depositNative(address depositor, bytes32 id)",
    "function depositErc20(address depositor, address token, uint256 amount, bytes32 id)",
  ]),
  data: depositTx.data,
});

// 4. The order ID must be the deposit id.
if ((args[args.length - 1] as string).toLowerCase() !== computedOrderId.toLowerCase()) {
  throw new Error("Deposit transaction does not commit to the verified order");
}

// 5. The depositor must be the account you expect to pay.
if ((args[0] as string).toLowerCase() !== expectedPayer.toLowerCase()) {
  throw new Error("Deposit transaction credits an unexpected depositor");
}

// 6. Decide which deposit function the ORDER calls for, then require the
// transaction to use it. Branching on functionName alone would let a native
// transfer satisfy an order whose input payment is an ERC-20.
const nativeCurrency = getVmTypeNativeCurrency(CHAINS[payment.chainId]);
const orderWantsNative = payment.currency.toLowerCase() === nativeCurrency.toLowerCase();

if (orderWantsNative !== (functionName === "depositNative")) {
  throw new Error("Deposit function does not match the order payment currency");
}

// 7. The transaction must move exactly the order's input payment.
if (orderWantsNative) {
  if (BigInt(depositTx.value) !== BigInt(payment.amount)) {
    throw new Error("Native value does not match the order payment amount");
  }
} else {
  if ((args[1] as string).toLowerCase() !== payment.currency.toLowerCase()) {
    throw new Error("Deposit token does not match the order payment currency");
  }
  if (BigInt(args[2] as bigint) !== BigInt(payment.amount)) {
    throw new Error("Deposit amount does not match the order payment amount");
  }
  if (BigInt(depositTx.value ?? 0) !== 0n) {
    throw new Error("ERC-20 deposit must not send native value");
  }
}

See all 75 lines
At this point the transaction is bound to the order you inspected in step 2. If all the checks pass and the order settles, settlement uses the recipient, minimum output amount, currency, deadline, and destination chain encoded in the verified order. Verification confirms the encoded order. It does not guarantee that the order will fill.
​
Validating onchain
If you need the check to happen inside a contract rather than in your backend, use protocol.v2.orderSignature. It is the solver’s ECDSA signature over the 32 raw bytes of the order ID, following EIP-191, and it is produced by the Relay EVM solver wallet 0xf70da97812cb96acdf810712aa562db8dfa3dbef — the same address on every chain Relay supports.
import { recoverMessageAddress, hexToBytes } from "viem";

const signer = await recoverMessageAddress({
  message: { raw: hexToBytes(computedOrderId) },
  signature: quote.protocol.v2.orderSignature,
});
// 0xf70da97812CB96acDF810712Aa562db8dfA3dbEF

The equivalent Solidity check:
bytes32 digest = keccak256(
    abi.encodePacked("\x19Ethereum Signed Message:\n32", orderId)
);
require(ECDSA.recover(digest, orderSignature) == RELAY_SOLVER, "bad signature");

The signature only attests to the order ID. It is not a substitute for steps 2 to 4 — recompute the order ID from orderData so you know which order the ID refers to, and check the transaction against it.
​
Deposit addresses
Deposit address deposits cannot yet be verified this way. The order ID checks above bind a transaction to an order; a deposit address has no calldata to bind, so verifying one requires deriving the address itself from the order properties. That derivation is not yet available to integrators.
If you rely on deposit addresses and need to validate them before sending funds, contact Relay so your use case can be factored into that work.
​
Migrating from the signature API
GET /requests/:requestId/signature and GET /requests/:requestId/signature/v2 have been removed. Calls now return 404.
The signature API returned a solver signature over a small subset of intent fields — origin and destination chain, user, currency, and (on v2) destination currency. It had several problems that the deterministic flow does not:
It never covered the fields that matter most, such as the minimum output amount, so it could not tell you the trade was priced correctly.
It required a second API call after the quote, and returned only partial data until the request reached a terminal state.
Its behavior was inconsistent across chains.
It attested to a request shape that does not map cleanly onto protocol orders.
To migrate, replace the GET /requests/:requestId/signature/v2 call with includeProtocolData: true on your existing /quote/v2 request, and follow steps 2 to 4 above. The verification happens locally, so you remove a network round trip in the process.

Was this page helpful?

Yes
No
Refunds
Trade Types
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform