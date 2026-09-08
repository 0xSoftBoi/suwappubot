# Hyperliquid Support - Relay

Source: https://docs.relay.link/references/api/api_guides/hyperliquid-support

On this page
API Access
Hyperliquid-Specific API Parameters
Supported Currencies
Currency Addresses
Withdrawals from Hyperliquid
Getting Hyperliquid Balances
Example Quote Request
Step 1: Authorize (Nonce-Mapping Signature)
Step 2: Deposit (Hyperliquid Transaction)
Constructing the Signature Data
Signing the Message
Submitting to Hyperliquid
Chain Support Guides
Hyperliquid Support
Copy page

How to deposit and withdraw from Hyperliquid to any Relay chain

Relay supports depositing and withdrawing Hyperliquid (Hypercore) perpsUSDC from any supported chain. To try it today, use the Relay App. Relay also provides complete support for HyperEVM, which can be accessed using the standard quote flow with chainId=999. This document details how to integrate Hyperliquid deposits and withdrawals into your application.
​
API Access
Hyperliquid can be accessed using the standard Relay API flow. To get started, review the execution steps documentation. When you’re ready to execute swaps, refer to the Get Quote API endpoint.
​
Hyperliquid-Specific API Parameters
Action	Parameter	Input	Description
Deposit to Hyperliquid	toChainId	1337	Hyperliquid Chain ID
	recipient		Hyperliquid Address
Withdraw from Hyperliquid	protocolVersion	v2	Required for withdrawals
	fromChainId	1337	Hyperliquid Chain ID
These parameters are specific to Hyperliquid interactions. All other standard API parameters remain required. Note that protocolVersion: v2 is mandatory for withdrawals.
​
Supported Currencies
Relay supports the following Hyperliquid currencies:
Perps USDC: Treated with a custom address 0x00000000000000000000000000000000
Spot USDC: Address 0x6d1e7cde53ba9467b783cb7c530ce054
Other Spot currencies: Including USDe, USDH, and other tokens returned by the Hyperliquid RPC
For a complete and up-to-date list of supported currencies, check the Chains API response for Hyperliquid (chainId: 1337).
​
Currency Addresses
Perps USDC is treated in a custom way with its address being 0x00000000000000000000000000000000
For any other Spot currency the address is the tokenId value returned by the Hyperliquid RPC
curl -X POST https://api.hyperliquid.xyz/info -H 'Content-Type: application/json' -d '{"type": "spotMeta"}' | jq '.tokens[]'

For currencies on HIP-3 DEXs (non-Spot and non-Perps), append the hex-encoded DEX name to the corresponding Spot currency address. For example, USDC on the xyz DEX is represented as 0x6d1e7cde53ba9467b783cb7c530ce05478797a, where 0x6d1e7cde53ba9467b783cb7c530ce054 is the Spot USDC address and 78797a is the hex representation of “xyz”.
​
Withdrawals from Hyperliquid
Hyperliquid withdrawals use a two-step signature flow. The v2 implementation leverages the unique nonce associated with every Hyperliquid transfer to map deposits to request IDs. This requires two signatures:
Authorize: Sign a nonce-mapping message that associates a specific nonce with a request ID
Deposit: Sign and submit the Hyperliquid transfer transaction using the same nonce
The deposit transaction must use the exact same nonce from the authorization signature. If the nonces don’t match, Relay cannot associate the transfer with the request ID.
​
Getting Hyperliquid Balances
Use the Hyperliquid info API to query balances. Pass clearinghouseState as the type parameter, then read the withdrawable property, which returns a USD value in human-readable format.
​
Example Quote Request
Request
Response
curl 'https://api.relay.link/quote/v2' \
  -H 'content-type: application/json' \
  -d '{
    "user": "0xf3d63166f0ca56c3c1a3508fce03ff0cf3fb691e",
    "originChainId": 1337,
    "destinationChainId": 10,
    "originCurrency": "0x00000000000000000000000000000000",
    "destinationCurrency": "0x0000000000000000000000000000000000000000",
    "recipient": "0xf3d63166f0ca56c3c1a3508fce03ff0cf3fb691e",
    "tradeType": "EXACT_INPUT",
    "amount": "1000000000",
    "refundTo": "0xf3d63166f0ca56c3c1a3508fce03ff0cf3fb691e",
    "protocolVersion": "v2"
  }'

The response includes two steps that must be executed in order.
​
Step 1: Authorize (Nonce-Mapping Signature)
The first step (id: authorize) requires signing an EIP-712 message that maps the nonce to the request ID. This signature can be executed on any EVM chain.
Chain ID Override Recommended: The signatureChainId and domain.chainId fields are used for EIP-712 signature authorization only — they do not affect fund routing. The destinationChainId in your quote request determines where funds are delivered. The API returns Ethereum mainnet (chainId: 1) by default. We recommend overriding both item.data.sign.domain.chainId and item.data.post.body.signatureChainId to match the user’s active chain ID (Base, Optimism, etc.) for wallet and signature correctness.
Example authorize step response:
Authorize Step
{
  "id": "authorize",
  "action": "Sign nonce-mapping for the deposit",
  "description": "Sign the message that maps the deposit to the order",
  "kind": "signature",
  "items": [
    {
      "status": "incomplete",
      "data": {
        "sign": {
          "signatureKind": "eip712",
          "domain": {
            "name": "RelayNonceMapping",
            "version": "2",
            "chainId": 1,
            "verifyingContract": "0x0000000000000000000000000000000000000000"
          },
          "types": {
            "NonceMapping": [
              { "name": "chainId", "type": "string" },
              { "name": "wallet", "type": "address" },
              { "name": "depositor", "type": "address" },
              { "name": "id", "type": "bytes32" },
              { "name": "nonce", "type": "uint256" }
            ]
          },
          "value": {
            "chainId": "hyperliquid",
            "wallet": "0xf3d63166f0ca56c3c1a3508fce03ff0cf3fb691e",
            "depositor": "0xf3d63166f0ca56c3c1a3508fce03ff0cf3fb691e",
            "nonce": 1765463670254,
            "id": "0x7b3e352d6bb600f7d937250968dc9b9c7deaf34b3787fb2312fc7374603f1667"
          },
          "primaryType": "NonceMapping"
        },
        "post": {
          "endpoint": "/authorize",
          "method": "POST",
          "body": {
            "type": "nonce-mapping",
            "walletChainId": 1337,
            "wallet": "0xf3d63166f0ca56c3c1a3508fce03ff0cf3fb691e",
            "depositor": "0xf3d63166f0ca56c3c1a3508fce03ff0cf3fb691e",
            "nonce": 1765463670254,
            "id": "0x7b3e352d6bb600f7d937250968dc9b9c7deaf34b3787fb2312fc7374603f1667",
            "signatureChainId": 1
          }
        }
      }
    }
  ],
  "requestId": "0x33d530353522088c2a4016a7eeb2185b8f5926ab230eff44d4495746a43a6f87"
}

See all 53 lines
After the message is signed the second action is to submit the post body to the endpoint provided in the post data. You’ll also need to provide the signature that was generated from the sign data as a query parameter.
​
Step 2: Deposit (Hyperliquid Transaction)
The second step (id: deposit) requires signing and submitting the actual Hyperliquid transfer. The API response includes eip712Types and eip712PrimaryType to simplify constructing the signature data.
Example deposit step response:
Deposit Step
{
  "id": "deposit",
  "action": "Confirm transaction in your wallet",
  "description": "Depositing funds to the relayer to execute the swap for ETH",
  "kind": "transaction",
  "items": [
    {
      "status": "incomplete",
      "data": {
        "action": {
          "type": "sendAsset",
          "parameters": {
            "hyperliquidChain": "Mainnet",
            "destination": "0x865eb9baa5492cef598adf7afb1038654fcb7081",
            "sourceDex": "",
            "destinationDex": "",
            "token": "USDC:0x6d1e7cde53ba9467b783cb7c530ce054",
            "amount": "10.000000",
            "fromSubAccount": "",
            "nonce": 1765463670254
          }
        },
        "nonce": 1765463670254,
        "eip712Types": {
          "HyperliquidTransaction:SendAsset": [
            { "name": "hyperliquidChain", "type": "string" },
            { "name": "destination", "type": "string" },
            { "name": "sourceDex", "type": "string" },
            { "name": "destinationDex", "type": "string" },
            { "name": "token", "type": "string" },
            { "name": "amount", "type": "string" },
            { "name": "fromSubAccount", "type": "string" },
            { "name": "nonce", "type": "uint64" }
          ]
        },
        "eip712PrimaryType": "HyperliquidTransaction:SendAsset"
      },
      "check": {
        "endpoint": "/intents/status?requestId=0x33d530353522088c2a4016a7eeb2185b8f5926ab230eff44d4495746a43a6f87",
        "method": "GET"
      }
    }
  ],
  "requestId": "0x33d530353522088c2a4016a7eeb2185b8f5926ab230eff44d4495746a43a6f87"
}

See all 45 lines
​
Constructing the Signature Data
To sign the deposit step, you need to convert it into EIP-712 signature data. Extract the necessary fields from the step response and construct the signature object:
// Extract data from the deposit step
const stepItem = step.items[0];
const action = stepItem.data.action;
const eip712Types = stepItem.data.eip712Types;
const eip712PrimaryType = stepItem.data.eip712PrimaryType;

// The chain ID of the connected wallet
const chainId = 1; // Example: Ethereum mainnet

// Construct the EIP-712 signature data
const signatureData = {
  domain: {
    name: "HyperliquidSignTransaction",
    version: "1",
    chainId: chainId,
    verifyingContract: "0x0000000000000000000000000000000000000000",
  },
  types: {
    ...eip712Types,
    EIP712Domain: [
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" },
    ],
  },
  primaryType: eip712PrimaryType,
  value: {
    ...action.parameters,
    type: action.type,
    signatureChainId: `0x${chainId.toString(16)}`,
  },
};

Key fields explained:
domain: Static except for chainId, which should match the connected wallet’s active chain
types: Combines the API-provided eip712Types with the standard EIP712Domain
primaryType: Use the eip712PrimaryType from the API response
message: Spread the action parameters and add type and signatureChainId
signatureChainId: Hex representation of the active chain ID
​
Signing the Message
Use your wallet client to sign the EIP-712 typed data:
import { useWalletClient } from "wagmi";

const { data: walletClient } = useWalletClient();

const signature = await walletClient.signTypedData({
  account: walletClient.account,
  domain: signatureData.domain,
  types: signatureData.types,
  primaryType: signatureData.primaryType,
  message: signatureData.value,
});

​
Submitting to Hyperliquid
After signing, submit the transaction to Hyperliquid’s exchange API:
import { parseSignature } from "viem";
import axios from "axios";

const { r, s, v } = parseSignature(signature);

const action = signatureData.value;
const nonce = stepItem.data.nonce;

// Submit to Hyperliquid
const response = await axios.post("https://api.hyperliquid.xyz/exchange", {
  signature: {
    r,
    s,
    v: Number(v ?? 0n),
  },
  nonce,
  action,
});

if (response.status !== 200 || response.data?.status !== "ok") {
  throw new Error("Failed to submit transaction to Hyperliquid");
}

Important considerations:
Parse the signature into its component parts (r, s, v)
Ensure v is a Number, not a BigInt
The action data must exactly match what was signed
A successful response returns status 200 with data.status: "ok"
For a complete implementation example, refer to our publicly available SDK.

Was this page helpful?

Yes
No
Bitcoin Support
Lighter Support
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform