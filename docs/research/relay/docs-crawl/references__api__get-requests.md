# Get Requests - Relay

Source: https://docs.relay.link/references/api/get-requests

cURL

cURL

curl --request GET \
  --url 'https://api.relay.link/requests/v3?limit=20&sortBy=createdAt' \
  --header 'x-api-key: <x-api-key>'
200
{
  "requests": [
    {
      "id": "<string>",
      "status": "refund",
      "user": "<string>",
      "recipient": "<string>",
      "sender": "<string>",
      "refundTo": "<string>",
      "supersededByRequestId": "<string>",
      "depositAddress": {
        "address": "<string>",
        "type": "strict",
        "depositor": "<string>",
        "depositTxHash": "<string>",
        "recoveryAddress": "<string>"
      },
      "data": {
        "slippageTolerance": "<string>",
        "failReason": "UNKNOWN",
        "refundFailReason": "AMOUNT_TOO_LOW_TO_REFUND",
        "failedTxHash": "<string>",
        "failedTxBlockNumber": 123,
        "failedCallData": {
          "from": "<string>",
          "to": "<string>",
          "data": "<string>",
          "value": "<string>"
        },
        "usesExternalLiquidity": true,
        "timeEstimate": 123,
        "triggeredByFastFill": true,
        "inTxs": [
          {
            "txHash": "<string>",
            "fee": "<string>",
            "feeUsd": "<string>",
            "block": 123,
            "type": "<string>",
            "chainId": 123,
            "timestamp": 123,
            "status": "success",
            "data": "<unknown>",
            "stateChanges": "<unknown>"
          }
        ],
        "outTxs": [
          {
            "txHash": "<string>",
            "fee": "<string>",
            "feeUsd": "<string>",
            "block": 123,
            "type": "<string>",
            "chainId": 123,
            "timestamp": 123,
            "status": "success",
            "data": "<unknown>",
            "stateChanges": "<unknown>"
          }
        ],
        "appFees": {
          "quoted": [
            {
              "recipient": "<string>",
              "bps": "<string>",
              "amount": "<string>",
              "amountFormatted": "<string>"
            }
          ],
          "actual": [
            {
              "recipient": "<string>",
              "bps": "<string>",
              "amount": "<string>",
              "amountFormatted": "<string>",
              "amountUsd": "<string>"
            }
          ],
          "currency": {
            "chainId": 123,
            "address": "<string>",
            "symbol": "<string>",
            "name": "<string>",
            "decimals": 123,
            "metadata": {
              "logoURI": "<string>",
              "verified": true,
              "isNative": true
            }
          }
        },
        "feeSponsorship": {
          "quoted": {
            "selectedComponents": [
              "execution"
            ],
            "capHit": true,
            "components": {
              "execution": {
                "selected": true,
                "total": {
                  "amount": "<string>",
                  "amountFormatted": "<string>",
                  "amountUsd": "<string>",
                  "minimumAmount": "<string>"
                },
                "sponsored": {
                  "amount": "<string>",
                  "amountFormatted": "<string>",
                  "amountUsd": "<string>",
                  "minimumAmount": "<string>"
                },
                "userPays": {
                  "amount": "<string>",
                  "amountFormatted": "<string>",
                  "amountUsd": "<string>",
                  "minimumAmount": "<string>"
                }
              },
              "swap": {
                "selected": true,
                "total": {
                  "amount": "<string>",
                  "amountFormatted": "<string>",
                  "amountUsd": "<string>",
                  "minimumAmount": "<string>"
                },
                "sponsored": {
                  "amount": "<string>",
                  "amountFormatted": "<string>",
                  "amountUsd": "<string>",
                  "minimumAmount": "<string>"
                },
                "userPays": {
                  "amount": "<string>",
                  "amountFormatted": "<string>",
                  "amountUsd": "<string>",
                  "minimumAmount": "<string>"
                }
              },
              "platform": {
                "selected": true,
                "total": {
                  "amount": "<string>",
                  "amountFormatted": "<string>",
                  "amountUsd": "<string>",
                  "minimumAmount": "<string>"
                },
                "sponsored": {
                  "amount": "<string>",
                  "amountFormatted": "<string>",
                  "amountUsd": "<string>",
                  "minimumAmount": "<string>"
                },
                "userPays": {
                  "amount": "<string>",
                  "amountFormatted": "<string>",
                  "amountUsd": "<string>",
                  "minimumAmount": "<string>"
                }
              },
              "app": {
                "selected": true,
                "total": {
                  "amount": "<string>",
                  "amountFormatted": "<string>",
                  "amountUsd": "<string>",
                  "minimumAmount": "<string>"
                },
                "sponsored": {
                  "amount": "<string>",
                  "amountFormatted": "<string>",
                  "amountUsd": "<string>",
                  "minimumAmount": "<string>"
                },
                "userPays": {
                  "amount": "<string>",
                  "amountFormatted": "<string>",
                  "amountUsd": "<string>",
                  "minimumAmount": "<string>"
                }
              },
              "rent": {
                "selected": true,
                "total": {
                  "amount": "<string>",
                  "amountFormatted": "<string>",
                  "amountUsd": "<string>",
                  "minimumAmount": "<string>"
                },
                "sponsored": {
                  "amount": "<string>",
                  "amountFormatted": "<string>",
                  "amountUsd": "<string>",
                  "minimumAmount": "<string>"
                },
                "userPays": {
                  "amount": "<string>",
                  "amountFormatted": "<string>",
                  "amountUsd": "<string>",
                  "minimumAmount": "<string>"
                }
              }
            },
            "sponsoredTotal": {
              "amount": "<string>",
              "amountFormatted": "<string>",
              "amountUsd": "<string>",
              "minimumAmount": "<string>"
            },
            "userPaysTotal": {
              "amount": "<string>",
              "amountFormatted": "<string>",
              "amountUsd": "<string>",
              "minimumAmount": "<string>"
            },
            "maxSubsidizationAmount": "<string>",
            "subsidizationBps": 123
          },
          "actual": {
            "selectedComponents": [
              "execution"
            ],
            "capHit": true,
            "components": {
              "execution": {
                "selected": true,
                "total": {
                  "amount": "<string>",
                  "amountFormatted": "<string>",
                  "amountUsd": "<string>",
                  "minimumAmount": "<string>"
                },
                "sponsored": {
                  "amount": "<string>",
                  "amountFormatted": "<string>",
                  "amountUsd": "<string>",
                  "minimumAmount": "<string>"
                },
                "userPays": {
                  "amount": "<string>",
                  "amountFormatted": "<string>",
                  "amountUsd": "<string>",
                  "minimumAmount": "<string>"
                }
              },
              "swap": {
                "selected": true,
                "total": {
                  "amount": "<string>",
                  "amountFormatted": "<string>",
                  "amountUsd": "<string>",
                  "minimumAmount": "<string>"
                },
                "sponsored": {
                  "amount": "<string>",
                  "amountFormatted": "<string>",
                  "amountUsd": "<string>",
                  "minimumAmount": "<string>"
                },
                "userPays": {
                  "amount": "<string>",
                  "amountFormatted": "<string>",
                  "amountUsd": "<string>",
                  "minimumAmount": "<string>"
                }
              },
              "platform": {
                "selected": true,
                "total": {
                  "amount": "<string>",
                  "amountFormatted": "<string>",
                  "amountUsd": "<string>",
                  "minimumAmount": "<string>"
                },
                "sponsored": {
                  "amount": "<string>",
                  "amountFormatted": "<string>",
                  "amountUsd": "<string>",
                  "minimumAmount": "<string>"
                },
                "userPays": {
                  "amount": "<string>",
                  "amountFormatted": "<string>",
                  "amountUsd": "<string>",
                  "minimumAmount": "<string>"
                }
              },
              "app": {
                "selected": true,
                "total": {
                  "amount": "<string>",
                  "amountFormatted": "<string>",
                  "amountUsd": "<string>",
                  "minimumAmount": "<string>"
                },
                "sponsored": {
                  "amount": "<string>",
                  "amountFormatted": "<string>",
                  "amountUsd": "<string>",
                  "minimumAmount": "<string>"
                },
                "userPays": {
                  "amount": "<string>",
                  "amountFormatted": "<string>",
                  "amountUsd": "<string>",
                  "minimumAmount": "<string>"
                }
              },
              "rent": {
                "selected": true,
                "total": {
                  "amount": "<string>",
                  "amountFormatted": "<string>",
                  "amountUsd": "<string>",
                  "minimumAmount": "<string>"
                },
                "sponsored": {
                  "amount": "<string>",
                  "amountFormatted": "<string>",
                  "amountUsd": "<string>",
                  "minimumAmount": "<string>"
                },
                "userPays": {
                  "amount": "<string>",
                  "amountFormatted": "<string>",
                  "amountUsd": "<string>",
                  "minimumAmount": "<string>"
                }
              }
            },
            "sponsoredTotal": {
              "amount": "<string>",
              "amountFormatted": "<string>",
              "amountUsd": "<string>",
              "minimumAmount": "<string>"
            },
            "userPaysTotal": {
              "amount": "<string>",
              "amountFormatted": "<string>",
              "amountUsd": "<string>",
              "minimumAmount": "<string>"
            },
            "maxSubsidizationAmount": "<string>",
            "subsidizationBps": 123,
            "sponsorPayment": {
              "amount": "<string>",
              "address": "<string>",
              "chainId": 123
            }
          },
          "currency": {
            "chainId": 123,
            "address": "<string>",
            "symbol": "<string>",
            "name": "<string>",
            "decimals": 123,
            "metadata": {
              "logoURI": "<string>",
              "verified": true,
              "isNative": true
            }
          }
        },
        "fees": {
          "quoted": {
            "swap": {
              "usd": "<string>",
              "amount": "<string>",
              "amountFormatted": "<string>"
            },
            "execution": {
              "usd": "<string>",
              "amount": "<string>",
              "amountFormatted": "<string>"
            },
            "platform": {
              "usd": "<string>",
              "amount": "<string>",
              "amountFormatted": "<string>"
            },
            "app": {
              "usd": "<string>",
              "amount": "<string>",
              "amountFormatted": "<string>"
            },
            "sponsored": {
              "usd": "<string>",
              "amount": "<string>",
              "amountFormatted": "<string>"
            }
          },
          "actual": {
            "swap": {
              "usd": "<string>",
              "amount": "<string>",
              "amountFormatted": "<string>"
            },
            "execution": {
              "usd": "<string>",
              "amount": "<string>",
              "amountFormatted": "<string>"
            },
            "platform": {
              "usd": "<string>",
              "amount": "<string>",
              "amountFormatted": "<string>"
            },
            "app": {
              "usd": "<string>",
              "amount": "<string>",
              "amountFormatted": "<string>"
            },
            "sponsored": {
              "usd": "<string>",
              "amount": "<string>",
              "amountFormatted": "<string>"
            }
          },
          "currency": {
            "chainId": 123,
            "address": "<string>",
            "symbol": "<string>",
            "name": "<string>",
            "decimals": 123,
            "metadata": {
              "logoURI": "<string>",
              "verified": true,
              "isNative": true
            }
          }
        },
        "platformFee": {},
        "referrer": "<string>",
        "apiKeyName": "<string>",
        "route": {
          "includedSwapSources": [
            "<string>"
          ],
          "includedOriginSwapSources": [
            "<string>"
          ],
          "includedDestinationSwapSources": [
            "<string>"
          ],
          "quoted": {
            "origin": {
              "inputCurrency": {
                "currency": {
                  "chainId": 123,
                  "address": "<string>",
                  "symbol": "<string>",
                  "name": "<string>",
                  "decimals": 123,
                  "metadata": {
                    "logoURI": "<string>",
                    "verified": true,
                    "isNative": true
                  }
                },
                "amount": "<string>",
                "amountFormatted": "<string>",
                "amountUsd": "<string>",
                "minimumAmount": "<string>"
              },
              "outputCurrency": {
                "currency": {
                  "chainId": 123,
                  "address": "<string>",
                  "symbol": "<string>",
                  "name": "<string>",
                  "decimals": 123,
                  "metadata": {
                    "logoURI": "<string>",
                    "verified": true,
                    "isNative": true
                  }
                },
                "amount": "<string>",
                "amountFormatted": "<string>",
                "amountUsd": "<string>",
                "minimumAmount": "<string>"
              },
              "router": "<string>"
            },
            "destination": {
              "inputCurrency": {
                "currency": {
                  "chainId": 123,
                  "address": "<string>",
                  "symbol": "<string>",
                  "name": "<string>",
                  "decimals": 123,
                  "metadata": {
                    "logoURI": "<string>",
                    "verified": true,
                    "isNative": true
                  }
                },
                "amount": "<string>",
                "amountFormatted": "<string>",
                "amountUsd": "<string>",
                "minimumAmount": "<string>"
              },
              "outputCurrency": {
                "currency": {
                  "chainId": 123,
                  "address": "<string>",
                  "symbol": "<string>",
                  "name": "<string>",
                  "decimals": 123,
                  "metadata": {
                    "logoURI": "<string>",
                    "verified": true,
                    "isNative": true
                  }
                },
                "amount": "<string>",
                "amountFormatted": "<string>",
                "amountUsd": "<string>",
                "minimumAmount": "<string>"
              },
              "router": "<string>"
            }
          },
          "actual": {
            "origin": {
              "inputCurrency": {
                "currency": {
                  "chainId": 123,
                  "address": "<string>",
                  "symbol": "<string>",
                  "name": "<string>",
                  "decimals": 123,
                  "metadata": {
                    "logoURI": "<string>",
                    "verified": true,
                    "isNative": true
                  }
                },
                "amount": "<string>",
                "amountFormatted": "<string>",
                "amountUsd": "<string>",
                "minimumAmount": "<string>"
              },
              "outputCurrency": {
                "currency": {
                  "chainId": 123,
                  "address": "<string>",
                  "symbol": "<string>",
                  "name": "<string>",
                  "decimals": 123,
                  "metadata": {
                    "logoURI": "<string>",
                    "verified": true,
                    "isNative": true
                  }
                },
                "amount": "<string>",
                "amountFormatted": "<string>",
                "amountUsd": "<string>",
                "minimumAmount": "<string>"
              },
              "router": "<string>"
            },
            "destination": {
              "inputCurrency": {
                "currency": {
                  "chainId": 123,
                  "address": "<string>",
                  "symbol": "<string>",
                  "name": "<string>",
                  "decimals": 123,
                  "metadata": {
                    "logoURI": "<string>",
                    "verified": true,
                    "isNative": true
                  }
                },
                "amount": "<string>",
                "amountFormatted": "<string>",
                "amountUsd": "<string>",
                "minimumAmount": "<string>"
              },
              "outputCurrency": {
                "currency": {
                  "chainId": 123,
                  "address": "<string>",
                  "symbol": "<string>",
                  "name": "<string>",
                  "decimals": 123,
                  "metadata": {
                    "logoURI": "<string>",
                    "verified": true,
                    "isNative": true
                  }
                },
                "amount": "<string>",
                "amountFormatted": "<string>",
                "amountUsd": "<string>",
                "minimumAmount": "<string>"
              },
              "router": "<string>",
              "currencyGasTopup": {
                "currency": {
                  "chainId": 123,
                  "address": "<string>",
                  "symbol": "<string>",
                  "name": "<string>",
                  "decimals": 123,
                  "metadata": {
                    "logoURI": "<string>",
                    "verified": true,
                    "isNative": true
                  }
                },
                "amount": "<string>",
                "amountFormatted": "<string>",
                "amountUsd": "<string>",
                "minimumAmount": "<string>"
              }
            },
            "rate": "<string>"
          }
        },
        "quoteOraclePrice": {
          "rate": "<string>",
          "observedAt": "<string>",
          "inputCurrency": {
            "currency": {
              "chainId": 123,
              "address": "<string>",
              "symbol": "<string>",
              "name": "<string>",
              "decimals": 123,
              "metadata": {
                "logoURI": "<string>",
                "verified": true,
                "isNative": true
              }
            },
            "amount": "<string>",
            "amountFormatted": "<string>",
            "amountUsd": "<string>",
            "minimumAmount": "<string>"
          },
          "outputCurrency": {
            "currency": {
              "chainId": 123,
              "address": "<string>",
              "symbol": "<string>",
              "name": "<string>",
              "decimals": 123,
              "metadata": {
                "logoURI": "<string>",
                "verified": true,
                "isNative": true
              }
            },
            "amount": "<string>",
            "amountFormatted": "<string>",
            "amountUsd": "<string>",
            "minimumAmount": "<string>"
          }
        },
        "refundCurrencyData": {
          "currency": {
            "chainId": 123,
            "address": "<string>",
            "symbol": "<string>",
            "name": "<string>",
            "decimals": 123,
            "metadata": {
              "logoURI": "<string>",
              "verified": true,
              "isNative": true
            }
          },
          "amount": "<string>",
          "amountFormatted": "<string>",
          "amountUsd": "<string>",
          "minimumAmount": "<string>"
        },
        "externalMetadata": {
          "moonpayId": "<string>"
        }
      },
      "protocol": {
        "orderId": "<string>",
        "hubType": "onchain",
        "isWithdrawable": true,
        "solver": {
          "address": "<string>",
          "protocolChainId": "<string>",
          "chainId": 123
        },
        "deposit": {
          "origin": {
            "amount": "<string>",
            "chainId": 123,
            "currency": "<string>",
            "depositor": "<string>",
            "depository": "<string>",
            "onchainId": "<string>",
            "transactionId": "<string>"
          },
          "relay": {
            "amount": "<string>",
            "chainId": 123,
            "currency": "<string>",
            "hash": "<string>",
            "operation": "mint",
            "tokenMetadata": {
              "decimals": 123,
              "name": "<string>",
              "symbol": "<string>"
            }
          },
          "attestation": {
            "execution": {
              "actions": [
                "<string>"
              ],
              "idempotencyKey": "<string>"
            },
            "attestations": [
              {
                "oracleChainId": "<string>",
                "oracleContract": "<string>",
                "signerAddress": "<string>",
                "signature": "<string>"
              }
            ]
          }
        },
        "settlement": {
          "destination": {
            "fills": [
              {
                "chainId": 123,
                "transactionId": "<string>"
              }
            ],
            "refunds": [
              {
                "chainId": 123,
                "transactionId": "<string>"
              }
            ]
          },
          "relay": {
            "amount": "<string>",
            "chainId": 123,
            "currency": "<string>",
            "hash": "<string>",
            "operation": "transfer",
            "solver": "<string>",
            "tokenMetadata": {
              "decimals": 123,
              "name": "<string>",
              "symbol": "<string>"
            }
          },
          "attestation": {
            "execution": {
              "actions": [
                "<string>"
              ],
              "idempotencyKey": "<string>"
            },
            "attestations": [
              {
                "oracleChainId": "<string>",
                "oracleContract": "<string>",
                "signerAddress": "<string>",
                "signature": "<string>"
              }
            ]
          }
        }
      },
      "requestType": "<string>",
      "features": [
        "gasless_execution"
      ],
      "createdAt": "<string>",
      "updatedAt": "<string>"
    }
  ],
  "continuation": "<string>",
  "total": 123
}
API Reference
Get Requests

This API returns all the cross-chain transactions.

Copy page
GET
https://api.relay.link
https://api.testnets.relay.link
/
requests
/
v3
Try it
Headers
​
x-api-key
stringrequired

API key for authentication.

Query Parameters
​
limit
numberdefault:20

Maximum number of requests to return per page.

Required range: 1 <= x <= 50
​
continuation
string

Pagination cursor returned by a previous response. Pass it back to fetch the next page.

​
includeTotal
booleandefault:false

When true, also compute and return the total count of requests matching these filters (ignores limit/continuation). Adds latency — omit unless the total is needed.

​
user
string

Filter requests by wallet address — matches requests where this address is the sender or the deposit-address depositor.

​
term
string

Broad term search across request ID, wallet, deposit address, and all transaction hashes (deposit, fill, refund, failed, and chain entry transaction IDs). Use id, depositTxHash, fillTxHash, or refundTxHash for targeted single-field lookups.

​
id
string

Filter by requestId — the Relay-level intent identifier returned by the quote API.

​
orderId
string

Filter by protocol-level orderId.

​
depositTxHash
string

Filter by deposit transaction hash.

​
fillTxHash
string

Filter by fill transaction hash.

​
refundTxHash
string

Filter by refund transaction hash.

​
originChainId
number

Filter requests where this is the origin chain.

​
destinationChainId
number

Filter requests where this is the destination chain.

​
chainId
number

Get all requests for a single chain in either direction. Overridden by originChainId / destinationChainId.

​
privateChainsToInclude
string

Comma-separated list of private chain UUIDs to include in results.

​
depositAddress
string

Filter requests associated with this deposit address.

​
recipient
string

Filter requests where this address is the recipient.

​
status
enum<string>

Filter requests by status.

Available options: success, failure, refund, pending, depositing 
​
failReason
enum<string>

Filter requests by failure reason. Only returns requests that failed with this specific reason.

Available options: UNKNOWN, SLIPPAGE, AMOUNT_TOO_LOW_TO_REFUND, DEPOSIT_ADDRESS_MISMATCH, DEPOSIT_CHAIN_MISMATCH, INCORRECT_DEPOSIT_CURRENCY, DOUBLE_SPEND, SOLVER_CAPACITY_EXCEEDED, SOLVER_BALANCE_TOO_LOW, DEPOSITED_AMOUNT_TOO_LOW_TO_FILL, NEGATIVE_NEW_AMOUNT_AFTER_FEES, NO_QUOTES, MISSING_REVERT_DATA, REVERSE_SWAP_FAILED, GENERATE_SWAP_FAILED, TOO_LITTLE_RECEIVED, EXECUTION_REVERTED, NEW_CALLDATA_INCLUDES_HIGHER_RENT_FEE, TRANSACTION_REVERTED, TRANSACTION_TOO_LARGE, ORIGIN_CURRENCY_MISMATCH, NO_INTERNAL_SWAP_ROUTES_FOUND, SWAP_USES_TOO_MUCH_GAS, INSUFFICIENT_FUNDS_FOR_RENT, SPONSOR_BALANCE_TOO_LOW, ORDER_EXPIRED, ORDER_IS_CANCELLED, TRANSFER_FROM_FAILED, TRANSFER_FAILED, SIGNATURE_EXPIRED, INVALID_SIGNATURE, INSUFFICIENT_NATIVE_TOKENS_SUPPLIED, TRANSFER_AMOUNT_EXCEEDS_ALLOWANCE, TRANSFER_AMOUNT_EXCEEDS_BALANCE, INVALID_SENDER, ACCOUNT_ABSTRACTION_INVALID_NONCE, ACCOUNT_ABSTRACTION_SIGNATURE_ERROR, SEAPORT_INEXACT_FRACTION, TOKEN_NOT_TRANSFERABLE, ZERO_SELL_AMOUNT, MINT_NOT_ACTIVE, ERC_1155_TOO_MANY_REQUESTED, INCORRECT_PAYMENT, INVALID_GAS_PRICE, FLUID_DEX_ERROR, ORDER_ALREADY_FILLED, SEAPORT_INVALID_FULFILLER, INVALID_SIGNER, MINT_QUANTITY_EXCEEDS_MAX_PER_WALLET, MINT_QUANTITY_EXCEEDS_MAX_SUPPLY, JUPITER_INVALID_TOKEN_ACCOUNT, INVALID_NONCE, ACCOUNT_ABSTRACTION_GAS_LIMIT, CONTRACT_PAUSED, SWAP_IMPACT_TOO_HIGH, INSUFFICIENT_POOL_LIQUIDITY, TTL_EXPIRED, DEPOSIT_CONFIRMATION_TIMEOUT, ORPHANED_DEPOSIT_REFUND, GASLESS_PERMIT_BALANCE_TOO_LOW, MANUAL_ADMIN_REFUND, QUOTED_GAS_LIMIT_EXCEEDED, DESTINATION_TOKEN_TRANSFER_REJECTED, DEPOSIT_REORGED, BLOCKED_WALLET, PROTOCOL_DEADLINE_EXPIRED, TRANSACTION_NOT_INCLUDED, TRANSACTION_SUBMISSION_FAILED, N/A 
​
refundFailReason
enum<string>

Filter requests by refund failure reason.

Available options: AMOUNT_TOO_LOW_TO_REFUND, NEGATIVE_NEW_AMOUNT_AFTER_FEES, SWAP_CURRENCY_NOT_ON_ORIGIN, REFUND_RECIPIENT_IS_VASP, MANUAL_REFUND_REQUIRED 
​
apiKey
string

Filter requests by API key. Accepts a single value or a comma-separated list (e.g. key1,key2) — results include requests matching any of the supplied keys.

​
requestType
string

Filter requests by requestType (case-insensitive). Supported values: Bridge, Crosschain Swap, Same-chain Swap, Send, Wrap, Unwrap, Call.

​
referrer
string

Filter requests by the exact referrer value supplied at quote time. Must be combined with the apiKey parameter, and every supplied key must belong to the authenticating integrator — referrer filtering only exposes your own requests.

Minimum string length: 1
​
currencyInChainId
number

Filter by origin currency chain ID.

​
currencyOutChainId
number

Filter by destination currency chain ID.

​
currencyInAddress
string

Filter by origin currency contract address.

​
currencyOutAddress
string

Filter by destination currency contract address.

​
currencyInSymbol
string

Filter by origin currency symbol (e.g. USDC). Case-insensitive; matches across all chains.

​
currencyOutSymbol
string

Filter by destination currency symbol (e.g. USDC). Case-insensitive; matches across all chains.

​
sortBy
enum<string>default:createdAt

Field to sort by.

Available options: createdAt, updatedAt, amountUsd 
​
sortDirection
enum<string>

Sort direction (default: desc for time fields, asc for amountUsd).

Available options: asc, desc 
​
startTimestamp
number

Filter requests with createdAt ≥ this Unix timestamp (seconds). Applied to updatedAt instead when sortBy=updatedAt.

​
endTimestamp
number

Filter requests with createdAt ≤ this Unix timestamp (seconds). Applied to updatedAt instead when sortBy=updatedAt.

​
startBlock
number

Filter by chain entry block number (inclusive lower bound). When originChainId is also set, scoped to origin-chain entries only.

​
endBlock
number

Filter by chain entry block number (inclusive upper bound). When originChainId is also set, scoped to origin-chain entries only.

​
amountUsdMin
number

Filter requests with currencyIn.amountUsd ≥ this value.

​
amountUsdMax
number

Filter requests with currencyIn.amountUsd ≤ this value.

​
appFeesAmountUsdMin
number

Filter requests with total app fees USD ≥ this value.

​
appFeesAmountUsdMax
number

Filter requests with total app fees USD ≤ this value.

​
fillTimeMin
number

Filter requests with fill time ≥ this value (seconds).

​
fillTimeMax
number

Filter requests with fill time ≤ this value (seconds).

​
features
string

Comma-separated feature flags to filter by. Requests must have at least one of the specified features. Supported values: gasless_execution, gasless_swap, fast_fill, gas_top_up, fixed_rate, app_fees, deposit_address.

​
includeAuthenticatedData
boolean

When true, include fields available only to the authenticating integrator for their own requests.

​
includeChildRequests
boolean

Only effective when id is also provided. When true, returns the parent request AND any child requests. When false or omitted, only the exact request_id match is returned.

​
filters
string

JSON-encoded array of filter-group objects. Fields within each group are AND'd; groups are OR'd. Prefix a key with 'not:' to negate it (must_not). Values can be a scalar or an array (OR semantics within the field). Example: [{"depositAddress":"0xabc","originChainId":8453},{"depositAddress":"0x123","originChainId":1}]. Negation example: [{"not:status":"failure"}]. Array value example: [{"not:status":["failure","refund"]}]. A value of null is a null-check ("is empty"/"is not empty") instead of an equality test, for any key. Null-check example: [{"depositAddress":null}] (is empty / does not exist), [{"not:depositAddress":null}] (is not empty / exists). null cannot be combined with real values in an array. Using a referrer key (or not:referrer) in any group requires the top-level apiKey parameter with keys owned by the authenticating integrator, which scopes the entire result set to your own requests.

Response
200 - application/json

Default Response

​
requests
object[]

Show child attributes

​
continuation
string
​
total
number

Total count of requests matching the given filters. Only present when includeTotal was true.

Was this page helpful?

Yes
No
Get Status
Utilities
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform