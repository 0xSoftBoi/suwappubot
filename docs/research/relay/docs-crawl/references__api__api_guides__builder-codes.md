# Base Builder Codes - Relay

Source: https://docs.relay.link/references/api/api_guides/builder-codes

On this page
How to add a builder code
Example
Caveats
Integration Guides
Base Builder Codes
Copy page

Attribute onchain activity by appending builder codes to your Relay transactions

Base builder codes are a way to attribute onchain activity. Each code enhances onchain transactions with offchain metadata and makes your application more discoverable. To learn more about builder codes, see the Base documentation.
​
How to add a builder code
A builder code is an ERC-8021 dataSuffix appended to the end of a deposit transaction’s calldata. The called contract ignores the trailing bytes, but indexers read them to credit your application.
Relay matches an onchain transaction to its quote by requestId. Appending bytes to arbitrary calldata changes the transaction, so the solver can no longer match it and the request stops tracking — even though the transaction succeeds onchain. To avoid this, request an explicit deposit quote: set explicitDeposit to true. The explicit flow routes funds through the Relay Depository contract that carries the order ID as an argument, so the solver tracks the deposit by that order ID rather than by exact calldata — trailing suffix bytes don’t affect it.
Builder codes only work for quotes that route through the Relay Depository contract; same-chain swaps don’t use the deposit flow and can’t carry a builder code.
​
Example
import {
  createWalletClient,
  custom,
  concatHex,
  toHex,
  stringToHex,
  size,
  type Hex,
} from "viem";
import { base } from "viem/chains";

// ERC-8021 suffix = 1-byte length + builder code (ASCII) + 1-byte version + 16-byte marker.
const ERC8021_MARKER = "0x80218021802180218021802180218021" as const; // 0x8021 repeated 8×
const ERC8021_VERSION = "0x00" as const;

function buildDataSuffix(builderCode: string): Hex {
  const codeHex = stringToHex(builderCode);
  const lenByte = toHex(size(codeHex), { size: 1 });
  return concatHex([lenByte, codeHex, ERC8021_VERSION, ERC8021_MARKER]);
}

async function fetchQuote(req: Record<string, unknown>) {
  const res = await fetch("https://api.relay.link/quote/v2", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(`Relay quote failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// Append the suffix to the deposit step only — that is the depositErc20 call the
// Depository tracks by order ID, so trailing bytes don't break requestId matching.
function applyDataSuffix(quote: any, dataSuffix: Hex) {
  return {
    ...quote,
    steps: quote.steps.map((step: any) =>
      step.id !== "deposit"
        ? step
        : {
            ...step,
            items: step.items.map((item: any) => ({
              ...item,
              data: { ...item.data, data: concatHex([item.data.data, dataSuffix]) },
            })),
          }
    ),
  };
}

const walletClient = createWalletClient({ chain: base, transport: custom(window.ethereum) });
const [account] = await walletClient.getAddresses();

// 1. Request an explicit-deposit quote (required for builder codes).
const quote = await fetchQuote({
  user: account,
  recipient: account,
  originChainId: 8453, // Base
  destinationChainId: 42161, // Arbitrum
  originCurrency: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC on Base
  destinationCurrency: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", // USDC on Arbitrum
  amount: "1000000", // 1 USDC (6 decimals)
  tradeType: "EXACT_INPUT",
  protocolVersion: "v2",
  explicitDeposit: true,
});

// 2. Append your builder code to the deposit calldata.
const dataSuffix = buildDataSuffix("YOUR_BUILDER_CODE");
const quoteWithSuffix = applyDataSuffix(quote, dataSuffix);

// 3. Execute each transaction step in order (approval first, then deposit).
for (const step of quoteWithSuffix.steps) {
  if (step.kind !== "transaction") continue;
  for (const { data: tx } of step.items) {
    await walletClient.sendTransaction({
      account,
      to: tx.to,
      data: tx.data,
      value: BigInt(tx.value ?? 0),
      chainId: tx.chainId,
    });
  }
}

See all 84 lines
​
Caveats
Builder codes require an explicit deposit: set explicitDeposit to true and protocolVersion to "v2" in your quote request.
Only quotes that route through the Relay Depository contract (depositErc20) support builder codes. Same-chain swaps do not.
Append the suffix to the deposit step only.

Was this page helpful?

Yes
No
Transaction Indexing
Smart Accounts in Relay
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform