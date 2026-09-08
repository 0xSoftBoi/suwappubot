# Understanding Step Execution - Relay

Source: https://docs.relay.link/references/api/api_core_concepts/step-execution

On this page
Step Execution using the API
Signature Step
Transaction Step
Step IDs
Transaction Steps
Signature Steps
Common Step Flows
Step ID Examples
deposit
approve
send
authorize
authorize1
authorize2
Full Quote Example
Checking the fill status
SDK Reference
Core Concepts
Understanding Step Execution
Copy page

How step execution works when driving Relay directly from the API

Tip: For advanced integrations, we recommend using Relay APIs. For simpler use cases, the Relay SDK automates steps and provides helpful callbacks, reducing manual effort.
​
Step Execution using the API
When executing orders using the API directly, there are often multiple steps, like submitting a deposit transaction to the solver or signing a message. These steps differ based on the desired action and best route to execute the action. To make this simple, you can use the quote endpoint, which return the exact steps that you need to follow, including descriptions that you can display to users.
The flow looks like this:

Fetching Steps

Call the Get Quote API to start your execution.

Iterate Through Steps

Iterate through the steps and the items within a step, taking the necessary actions. Steps with no items, or an empty array of items, should be skipped. If step item data is missing then polling the api is necessary.

Executing Steps

As mentioned above each step contains an array of one or more items. These items need to be iterated and completed depending on the kind of step (signature or transaction).

Checking the fill status

After a step is signed or submitted you should check on the progress of the fill

Success!

Once all the steps are complete you can consider the action complete and notify the user.
​
Signature Step
A message that needs to be signed. Every signature comes with sign data and post data. The first action we need to take is to sign the message, keep in mind the signatureKind and use the appropriate signing method. Refer to your crypto library of choice on how to sign (viem, web3, etc).
Signing EIP191
Signing EIP712
// Creating an `EIP-191` signature involves signing a message.
// When you receive a `signatureKind: "eip191"` from the API, you will sign the value associated with the `message` property.
// In the case below, the message `Sign in to Blur...` will be signed, and later posted to the API.
// The step item also contains a `post` object detailing the endpoint to post the signed message to.
const message = {
  signatureKind: "eip191",
  message:
    "Sign in to Blur\n\nChallenge: e2483db1d9d66d2b77f47a8dfa13a15a0e7df5aee2287ade4bf313d6d4bdd0e0",
};

const eip191Message =
  "\x19Ethereum Signed Message:\n" + message.message.length + message.message;

Posting the data
After the message is signed the second action is to submit the post body to the endpoint provided in the post data. You’ll also need to provide the signature that was generated from the sign data as a query parameter. If the request is successful we can mark the step item as complete locally.
The design pattern of this API is completely generic, allowing for automatic support of new types of liquidity without needing to update the app. This data can be fed directly into an Ethereum library such as viem, making it easy to sign and submit the exact data that is needed.
​
Transaction Step
A transaction that needs to be submitted onchain. After the transaction is submitted onchain you can poll the step items check endpoint. The endpoint will return a status which when successful will return ‘success’. The step item can then be successfully marked as complete. Note that the transaction step item contains a chainId for which the transaction should be submitted on.
​
Step IDs
Each step has a unique id that identifies the type of action required. Understanding these step IDs helps you build better UX and handle each step appropriately.
​
Transaction Steps
Step ID	Description	When Used
deposit	Deposit funds to the relayer for cross-chain execution	Used for cross-chain swaps and bridges.
approve	Approve the transfer of an ERC20 token	Required before deposit or swap steps for ERC20 tokens the solver doesn’t hold.
approval	Approve token for deposit	Token approval for deposit operations.
swap	Execute a same-chain token swap	For same-chain swaps. May require an approval step first for EVM swaps.
send	Send funds to the recipient	When sending the same asset on the same chain to a different recipient.
​
Signature Steps
Step ID	Description	When Used
authorize	Sign authorization for specific operations	Used for: (1) Claiming app fees - EIP-191 signature to verify wallet ownership, (2) Hyperliquid v2 deposits - nonce-mapping signature.
authorize1	Sign to approve swap of tokens	Main flow for cross-chain permits Permit/Permit2.
authorize2	Sign to approve transfer of tokens	Same-chain swap permits.
​
Common Step Flows
Depending on the action and tokens involved, Relay chains steps together. Here are common flows you may encounter:
Flow	Description
deposit	Single step for cross-chain swaps/bridges
swap	Single step for same-chain swaps
approve → deposit	Approval needed before deposit for ERC20 tokens
approve → swap	Same-chain swap requiring approval
authorize1	Cross-chain permit-based transfer (gasless)
​
Step ID Examples
Below are detailed examples of each step type you may encounter when working with the Quote API.
​
deposit
Deposit funds to the relayer to execute the swap. Used when the Relay solver holds the destination token.
{
  "id": "deposit",
  "action": "Confirm transaction in your wallet",
  "description": "Depositing funds to the relayer to execute the swap for ETH",
  "kind": "transaction",
  "items": [
    {
      "status": "incomplete",
      "data": {
        "from": "0x03508bB71268BBA25ECaCC8F620e01866650532c",
        "to": "0xf70da97812cb96acdf810712aa562db8dfa3dbef",
        "data": "0x58109c",
        "value": "995010715204139091",
        "maxFeePerGas": "18044119466",
        "maxPriorityFeePerGas": "2060264926",
        "chainId": 1,
        "gas": 21064
      },
      "check": {
        "endpoint": "/intents/status/v3?requestId=0x341b28c6467bfbffb72ad78ec5ddf1f77b8f9c79be134223e3248a7d4fcd43b6",
        "method": "GET"
      }
    }
  ]
}

See all 25 lines
​
approve
An approval transaction to approve the transfer of an ERC20 token. Always followed by an additional step (deposit or swap).
{
  "id": "approve",
  "action": "Confirm transaction in your wallet",
  "description": "Sign an approval for USDC",
  "kind": "transaction",
  "items": [
    {
      "status": "incomplete",
      "data": {
        "from": "0x03508bB71268BBA25ECaCC8F620e01866650532c",
        "to": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
        "data": "0x095ea7b3...",
        "value": "0",
        "chainId": 8453,
        "maxFeePerGas": "5937131",
        "maxPriorityFeePerGas": "1009381"
      },
      "check": {
        "endpoint": "/intents/status/v3?requestId=0x...",
        "method": "GET"
      }
    }
  ]
}

See all 24 lines
​
send
Send funds to a recipient on the same chain.
{
  "id": "send",
  "action": "Confirm transaction in your wallet",
  "description": "Send funds to the recipient",
  "kind": "transaction",
  "items": [
    {
      "status": "incomplete",
      "data": {
        "from": "0x03508bB71268BBA25ECaCC8F620e01866650532c",
        "to": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
        "data": "0xa9059cbb00000000000000000000000036329d1ff4b31ec85280a86e7cf58fca7c005ed000000000000000000000000000000000000000000000000000000002540be400",
        "value": "0",
        "chainId": 8453,
        "maxFeePerGas": "5937131",
        "maxPriorityFeePerGas": "1009381"
      },
      "check": {
        "endpoint": "/intents/status/v3?requestId=0xec7244ebc6c9ce3a344f9eeb6c84df921b55e0c06b6cb25a49c167fbeafb7e1b",
        "method": "GET"
      }
    }
  ],
  "requestId": "0xec7244ebc6c9ce3a344f9eeb6c84df921b55e0c06b6cb25a49c167fbeafb7e1b"
}

See all 25 lines
​
authorize
Sign authorization for specific operations. This step is used in two scenarios:
Claiming App Fees: Signs an EIP-191 message to verify wallet ownership before claiming accrued app fees.
Hyperliquid Deposits: Signs a nonce-mapping signature for v2 Hyperliquid deposits.
App Fee Claim Example
{
  "id": "authorize",
  "action": "Sign authorization",
  "description": "Authorize claiming funds",
  "kind": "signature",
  "items": [
    {
      "status": "incomplete",
      "data": {
        "sign": {
          "signatureKind": "eip191",
          "message": "0xa344c6123e3da9fc3f9c81edeab0b2eb39f2ea80ba54a6e0ad00123dc180619c"
        },
        "post": {
          "endpoint": "/execute/permits",
          "method": "POST",
          "body": {
            "kind": "claim",
            "requestId": "0xa344c6123e3da9fc3f9c81edeab0b2eb39f2ea80ba54a6e0ad00123dc180619c"
          }
        }
      }
    }
  ]
}

See all 25 lines
​
authorize1
The main flow for cross-chain permits. Uses Permit2 or TransferWithAuthorization (EIP-3009).
{
  id: "authorize1",
  action: "Sign authorization",
  description: "Sign to approve swap of USDC for ETH",
  kind: "signature",
  items: [
    {
      status: "incomplete",
      data: {
        sign: {
          signatureKind: "eip712",
          types: {
            TransferWithAuthorization: [
              {
                name: "from",
                type: "address",
              },
              {
                name: "to",
                type: "address",
              },
              {
                name: "value",
                type: "uint256",
              },
              {
                name: "validAfter",
                type: "uint256",
              },
              {
                name: "validBefore",
                type: "uint256",
              },
              {
                name: "nonce",
                type: "bytes32",
              },
            ],
          },
          domain: {
            name: "USD Coin",
            version: "2",
            chainId: 8453,
            verifyingContract: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
          },
          primaryType: "TransferWithAuthorization",
          value: {
            from: "0x03508bb71268bba25ecacc8f620e01866650532c",
            to: "0xf70da97812cb96acdf810712aa562db8dfa3dbef",
            value: "1000000",
            validAfter: 0,
            validBefore: 1764948419,
            nonce:
              "0xc1333d553004054a9c9a45ceedfae13040c7f064736c29b5c7ebc1c6b11a0a71",
          },
        },
        post: {
          endpoint: "/execute/permits",
          method: "POST",
          body: {
            kind: "eip3009",
            requestId:
              "0xfadc232794fbef5794f1e28b780c3d4ffd19df3f0f42f1e3b8f873abf11e79b2",
            api: "swap",
          },
        },
      },
      check: {
        endpoint:
          "/intents/status/v3?requestId=0xfadc232794fbef5794f1e28b780c3d4ffd19df3f0f42f1e3b8f873abf11e79b2",
        method: "GET",
      },
    },
  ],
}

See all 75 lines
​
authorize2
Sign authorization for same-chain swap permits using PermitBatchWitnessTransferFrom.
{
  "id": "authorize2",
  "action": "Sign authorization",
  "description": "Sign to approve transfer of USDC",
  "kind": "signature",
  "items": [
    {
      "status": "incomplete",
      "data": {
        "sign": {
          "signatureKind": "eip712",
          "domain": {
            "name": "Permit2",
            "chainId": 8453,
            "verifyingContract": "0x000000000022D473030F116dDEE9F6B43aC78BA3"
          },
          "types": {
            "PermitBatchWitnessTransferFrom": [
              { "name": "permitted", "type": "TokenPermissions[]" },
              { "name": "spender", "type": "address" },
              { "name": "nonce", "type": "uint256" },
              { "name": "deadline", "type": "uint256" },
              { "name": "witness", "type": "RelayerWitness" }
            ],
            "TokenPermissions": [
              { "name": "token", "type": "address" },
              { "name": "amount", "type": "uint256" }
            ],
            "RelayerWitness": [
              { "name": "relayer", "type": "address" },
              { "name": "refundTo", "type": "address" },
              { "name": "nftRecipient", "type": "address" },
              { "name": "call3Values", "type": "Call3Value[]" }
            ],
            "Call3Value": [
              { "name": "target", "type": "address" },
              { "name": "allowFailure", "type": "bool" },
              { "name": "value", "type": "uint256" },
              { "name": "callData", "type": "bytes" }
            ]
          },
          "value": {
            "permitted": [
              {
                "token": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                "amount": "1000000"
              }
            ],
            "nonce": "3073764008035",
            "deadline": 1764948471,
            "spender": "0xbbbfd134e9b44bfb5123898ba36b01de7ab93d98",
            "witness": {
              "relayer": "0xf70da97812cb96acdf810712aa562db8dfa3dbef",
              "refundTo": "0x03508bb71268bba25ecacc8f620e01866650532c",
              "nftRecipient": "0x03508bb71268bba25ecacc8f620e01866650532c",
              "call3Values": [
                {
                  "target": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                  "allowFailure": false,
                  "value": "0",
                  "callData": "0x095ea7b3..."
                }
              ]
            }
          },
          "primaryType": "PermitBatchWitnessTransferFrom"
        },
        "post": {
          "endpoint": "/execute/permits",
          "method": "POST",
          "body": {
            "kind": "permit2",
            "requestId": "0x4d1756eae7d23122047cbe2f11a749ca8275983e4d8757a8b44af9d1b829df39",
            "api": "user-swap"
          }
        }
      },
      "check": {
        "endpoint": "/intents/status/v3?requestId=0x4d1756eae7d23122047cbe2f11a749ca8275983e4d8757a8b44af9d1b829df39",
        "method": "GET"
      }
    }
  ]
}

See all 84 lines
​
Full Quote Example
{
  "steps": [
    {
      "id": "deposit",
      "action": "Confirm transaction in your wallet",
      "description": "Deposit funds for executing the calls",
      "kind": "transaction",
      "items": [
        {
          "status": "incomplete",
          "data": {
            "from": "0x03508bB71268BBA25ECaCC8F620e01866650532c",
            "to": "0xf70da97812cb96acdf810712aa562db8dfa3dbef",
            "data": "0x58109c",
            "value": "995010715204139091",
            "maxFeePerGas": "18044119466",
            "maxPriorityFeePerGas": "2060264926",
            "chainId": 1,
            "gas": 21064
          },
          "check": {
            "endpoint": "/intents/status/v3?requestId=0x341b28c6467bfbffb72ad78ec5ddf1f77b8f9c79be134223e3248a7d4fcd43b6",
            "method": "GET"
          }
        }
      ]
    }
  ],
  "fees": {
    "gas": "384398515652800",
    "gasCurrency": "eth",
    "relayer": "-4989478842712964",
    "relayerGas": "521157287036",
    "relayerService": "-4990000000000000",
    "relayerCurrency": "eth"
  },
  "breakdown": {
    "value": "1000000000000000000",
    "timeEstimate": 10
  },
  "balances": {
    "userBalance": "54764083517303347",
    "requiredToSolve": "995010521157287036"
  }
}

See all 45 lines
Along with the steps you’ll see that the following objects are returned: fees, breakdown and balances. Information about fees is detailed here. breakdown pertains to time estimation for the execution, broken down by value. The balances object is in regards to the user and how much they require to solve for the execution.
​
Checking the fill status
Along with the step data there’s an optional check object. You can use this object to check if the status of the transaction is complete. The object details the method and the endpoint to request. You should poll this until the endpoint returns success.
{
  "check": {
    "endpoint": "/intents/status/v3?requestId=0x341b28c6467bfbffb72ad78ec5ddf1f77b8f9c79be134223e3248a7d4fcd43b6",
    "method": "GET"
  }
}

The check api will always return a status, to get a full list of statuses, please refer to the Get Status API Reference.
​
SDK Reference
To review the official way the SDK handles execution, please refer to the executeSteps file which implements executing steps detailed above.

Was this page helpful?

Yes
No
API keys and Rate Limits
Wallet Detection
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform