# Get Quote - Relay

Source: https://docs.relay.link/references/api/get-quote

cURL

cURL

curl --request POST \
  --url https://api.relay.link/quote \
  --header 'Content-Type: application/json' \
  --data '
{
  "user": "0x03508bb71268bba25ecacc8f620e01866650532c",
  "originChainId": 8453,
  "destinationChainId": 10,
  "originCurrency": "0x0000000000000000000000000000000000000000",
  "destinationCurrency": "0x0000000000000000000000000000000000000000",
  "amount": "1000000000000000000",
  "tradeType": "EXACT_INPUT"
}
'
200
400
401
429
500
{
  "requestId": "<string>",
  "steps": [
    {
      "id": "deposit",
      "action": "Confirm transaction in your wallet",
      "description": "Depositing funds to the relayer to execute the swap for USDC",
      "kind": "transaction",
      "requestId": "0x92b99e6e1ee1deeb9531b5ad7f87091b3d71254b3176de9e8b5f6c6d0bd3a331",
      "items": [
        {
          "status": "incomplete",
          "data": {
            "from": "0x0CccD55A5Ac261Ea29136831eeaA93bfE07f5Db6",
            "to": "0xf70da97812cb96acdf810712aa562db8dfa3dbef",
            "data": "0x00fad611",
            "value": "1000000000000000000",
            "maxFeePerGas": "12205661344",
            "maxPriorityFeePerGas": "2037863396",
            "chainId": 1
          },
          "check": {
            "endpoint": "/intents/status?requestId=0x92b99e6e1ee1deeb9531b5ad7f87091b3d71254b3176de9e8b5f6c6d0bd3a331",
            "method": "GET"
          }
        }
      ]
    }
  ],
  "fees": {
    "gas": {
      "currency": {
        "chainId": 8453,
        "address": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
        "symbol": "USDC",
        "name": "USD Coin",
        "decimals": 6,
        "metadata": {
          "logoURI": "https://ethereum-optimism.github.io/data/USDC/logo.png",
          "verified": false,
          "isNative": false
        }
      },
      "amount": "30754920",
      "amountFormatted": "30.75492",
      "amountUsd": "30.901612",
      "minimumAmount": "30454920"
    },
    "relayer": {
      "currency": {
        "chainId": 8453,
        "address": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
        "symbol": "USDC",
        "name": "USD Coin",
        "decimals": 6,
        "metadata": {
          "logoURI": "https://ethereum-optimism.github.io/data/USDC/logo.png",
          "verified": false,
          "isNative": false
        }
      },
      "amount": "30754920",
      "amountFormatted": "30.75492",
      "amountUsd": "30.901612",
      "minimumAmount": "30454920"
    },
    "relayerGas": {
      "currency": {
        "chainId": 8453,
        "address": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
        "symbol": "USDC",
        "name": "USD Coin",
        "decimals": 6,
        "metadata": {
          "logoURI": "https://ethereum-optimism.github.io/data/USDC/logo.png",
          "verified": false,
          "isNative": false
        }
      },
      "amount": "30754920",
      "amountFormatted": "30.75492",
      "amountUsd": "30.901612",
      "minimumAmount": "30454920"
    },
    "relayerService": {
      "currency": {
        "chainId": 8453,
        "address": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
        "symbol": "USDC",
        "name": "USD Coin",
        "decimals": 6,
        "metadata": {
          "logoURI": "https://ethereum-optimism.github.io/data/USDC/logo.png",
          "verified": false,
          "isNative": false
        }
      },
      "amount": "30754920",
      "amountFormatted": "30.75492",
      "amountUsd": "30.901612",
      "minimumAmount": "30454920"
    },
    "app": {
      "currency": {
        "chainId": 8453,
        "address": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
        "symbol": "USDC",
        "name": "USD Coin",
        "decimals": 6,
        "metadata": {
          "logoURI": "https://ethereum-optimism.github.io/data/USDC/logo.png",
          "verified": false,
          "isNative": false
        }
      },
      "amount": "30754920",
      "amountFormatted": "30.75492",
      "amountUsd": "30.901612",
      "minimumAmount": "30454920"
    },
    "subsidized": {
      "currency": {
        "chainId": 8453,
        "address": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
        "symbol": "USDC",
        "name": "USD Coin",
        "decimals": 6,
        "metadata": {
          "logoURI": "https://ethereum-optimism.github.io/data/USDC/logo.png",
          "verified": false,
          "isNative": false
        }
      },
      "amount": "30754920",
      "amountFormatted": "30.75492",
      "amountUsd": "30.901612",
      "minimumAmount": "30454920"
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
            "currency": {
              "chainId": 8453,
              "address": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
              "symbol": "USDC",
              "name": "USD Coin",
              "decimals": 6,
              "metadata": {
                "logoURI": "https://ethereum-optimism.github.io/data/USDC/logo.png",
                "verified": false,
                "isNative": false
              }
            },
            "amount": "30754920",
            "amountFormatted": "30.75492",
            "amountUsd": "30.901612",
            "minimumAmount": "30454920"
          },
          "sponsored": {
            "currency": {
              "chainId": 8453,
              "address": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
              "symbol": "USDC",
              "name": "USD Coin",
              "decimals": 6,
              "metadata": {
                "logoURI": "https://ethereum-optimism.github.io/data/USDC/logo.png",
                "verified": false,
                "isNative": false
              }
            },
            "amount": "30754920",
            "amountFormatted": "30.75492",
            "amountUsd": "30.901612",
            "minimumAmount": "30454920"
          },
          "userPays": {
            "currency": {
              "chainId": 8453,
              "address": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
              "symbol": "USDC",
              "name": "USD Coin",
              "decimals": 6,
              "metadata": {
                "logoURI": "https://ethereum-optimism.github.io/data/USDC/logo.png",
                "verified": false,
                "isNative": false
              }
            },
            "amount": "30754920",
            "amountFormatted": "30.75492",
            "amountUsd": "30.901612",
            "minimumAmount": "30454920"
          }
        },
        "swap": {
          "selected": true,
          "total": {
            "currency": {
              "chainId": 8453,
              "address": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
              "symbol": "USDC",
              "name": "USD Coin",
              "decimals": 6,
              "metadata": {
                "logoURI": "https://ethereum-optimism.github.io/data/USDC/logo.png",
                "verified": false,
                "isNative": false
              }
            },
            "amount": "30754920",
            "amountFormatted": "30.75492",
            "amountUsd": "30.901612",
            "minimumAmount": "30454920"
          },
          "sponsored": {
            "currency": {
              "chainId": 8453,
              "address": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
              "symbol": "USDC",
              "name": "USD Coin",
              "decimals": 6,
              "metadata": {
                "logoURI": "https://ethereum-optimism.github.io/data/USDC/logo.png",
                "verified": false,
                "isNative": false
              }
            },
            "amount": "30754920",
            "amountFormatted": "30.75492",
            "amountUsd": "30.901612",
            "minimumAmount": "30454920"
          },
          "userPays": {
            "currency": {
              "chainId": 8453,
              "address": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
              "symbol": "USDC",
              "name": "USD Coin",
              "decimals": 6,
              "metadata": {
                "logoURI": "https://ethereum-optimism.github.io/data/USDC/logo.png",
                "verified": false,
                "isNative": false
              }
            },
            "amount": "30754920",
            "amountFormatted": "30.75492",
            "amountUsd": "30.901612",
            "minimumAmount": "30454920"
          }
        },
        "relay": {
          "selected": true,
          "total": {
            "currency": {
              "chainId": 8453,
              "address": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
              "symbol": "USDC",
              "name": "USD Coin",
              "decimals": 6,
              "metadata": {
                "logoURI": "https://ethereum-optimism.github.io/data/USDC/logo.png",
                "verified": false,
                "isNative": false
              }
            },
            "amount": "30754920",
            "amountFormatted": "30.75492",
            "amountUsd": "30.901612",
            "minimumAmount": "30454920"
          },
          "sponsored": {
            "currency": {
              "chainId": 8453,
              "address": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
              "symbol": "USDC",
              "name": "USD Coin",
              "decimals": 6,
              "metadata": {
                "logoURI": "https://ethereum-optimism.github.io/data/USDC/logo.png",
                "verified": false,
                "isNative": false
              }
            },
            "amount": "30754920",
            "amountFormatted": "30.75492",
            "amountUsd": "30.901612",
            "minimumAmount": "30454920"
          },
          "userPays": {
            "currency": {
              "chainId": 8453,
              "address": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
              "symbol": "USDC",
              "name": "USD Coin",
              "decimals": 6,
              "metadata": {
                "logoURI": "https://ethereum-optimism.github.io/data/USDC/logo.png",
                "verified": false,
                "isNative": false
              }
            },
            "amount": "30754920",
            "amountFormatted": "30.75492",
            "amountUsd": "30.901612",
            "minimumAmount": "30454920"
          }
        },
        "app": {
          "selected": true,
          "total": {
            "currency": {
              "chainId": 8453,
              "address": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
              "symbol": "USDC",
              "name": "USD Coin",
              "decimals": 6,
              "metadata": {
                "logoURI": "https://ethereum-optimism.github.io/data/USDC/logo.png",
                "verified": false,
                "isNative": false
              }
            },
            "amount": "30754920",
            "amountFormatted": "30.75492",
            "amountUsd": "30.901612",
            "minimumAmount": "30454920"
          },
          "sponsored": {
            "currency": {
              "chainId": 8453,
              "address": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
              "symbol": "USDC",
              "name": "USD Coin",
              "decimals": 6,
              "metadata": {
                "logoURI": "https://ethereum-optimism.github.io/data/USDC/logo.png",
                "verified": false,
                "isNative": false
              }
            },
            "amount": "30754920",
            "amountFormatted": "30.75492",
            "amountUsd": "30.901612",
            "minimumAmount": "30454920"
          },
          "userPays": {
            "currency": {
              "chainId": 8453,
              "address": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
              "symbol": "USDC",
              "name": "USD Coin",
              "decimals": 6,
              "metadata": {
                "logoURI": "https://ethereum-optimism.github.io/data/USDC/logo.png",
                "verified": false,
                "isNative": false
              }
            },
            "amount": "30754920",
            "amountFormatted": "30.75492",
            "amountUsd": "30.901612",
            "minimumAmount": "30454920"
          }
        },
        "rent": {
          "selected": true,
          "total": {
            "currency": {
              "chainId": 8453,
              "address": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
              "symbol": "USDC",
              "name": "USD Coin",
              "decimals": 6,
              "metadata": {
                "logoURI": "https://ethereum-optimism.github.io/data/USDC/logo.png",
                "verified": false,
                "isNative": false
              }
            },
            "amount": "30754920",
            "amountFormatted": "30.75492",
            "amountUsd": "30.901612",
            "minimumAmount": "30454920"
          },
          "sponsored": {
            "currency": {
              "chainId": 8453,
              "address": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
              "symbol": "USDC",
              "name": "USD Coin",
              "decimals": 6,
              "metadata": {
                "logoURI": "https://ethereum-optimism.github.io/data/USDC/logo.png",
                "verified": false,
                "isNative": false
              }
            },
            "amount": "30754920",
            "amountFormatted": "30.75492",
            "amountUsd": "30.901612",
            "minimumAmount": "30454920"
          },
          "userPays": {
            "currency": {
              "chainId": 8453,
              "address": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
              "symbol": "USDC",
              "name": "USD Coin",
              "decimals": 6,
              "metadata": {
                "logoURI": "https://ethereum-optimism.github.io/data/USDC/logo.png",
                "verified": false,
                "isNative": false
              }
            },
            "amount": "30754920",
            "amountFormatted": "30.75492",
            "amountUsd": "30.901612",
            "minimumAmount": "30454920"
          }
        }
      },
      "sponsoredTotal": {
        "currency": {
          "chainId": 8453,
          "address": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
          "symbol": "USDC",
          "name": "USD Coin",
          "decimals": 6,
          "metadata": {
            "logoURI": "https://ethereum-optimism.github.io/data/USDC/logo.png",
            "verified": false,
            "isNative": false
          }
        },
        "amount": "30754920",
        "amountFormatted": "30.75492",
        "amountUsd": "30.901612",
        "minimumAmount": "30454920"
      },
      "userPaysTotal": {
        "currency": {
          "chainId": 8453,
          "address": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
          "symbol": "USDC",
          "name": "USD Coin",
          "decimals": 6,
          "metadata": {
            "logoURI": "https://ethereum-optimism.github.io/data/USDC/logo.png",
            "verified": false,
            "isNative": false
          }
        },
        "amount": "30754920",
        "amountFormatted": "30.75492",
        "amountUsd": "30.901612",
        "minimumAmount": "30454920"
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
            "currency": {
              "chainId": 8453,
              "address": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
              "symbol": "USDC",
              "name": "USD Coin",
              "decimals": 6,
              "metadata": {
                "logoURI": "https://ethereum-optimism.github.io/data/USDC/logo.png",
                "verified": false,
                "isNative": false
              }
            },
            "amount": "30754920",
            "amountFormatted": "30.75492",
            "amountUsd": "30.901612",
            "minimumAmount": "30454920"
          },
          "sponsored": {
            "currency": {
              "chainId": 8453,
              "address": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
              "symbol": "USDC",
              "name": "USD Coin",
              "decimals": 6,
              "metadata": {
                "logoURI": "https://ethereum-optimism.github.io/data/USDC/logo.png",
                "verified": false,
                "isNative": false
              }
            },
            "amount": "30754920",
            "amountFormatted": "30.75492",
            "amountUsd": "30.901612",
            "minimumAmount": "30454920"
          },
          "userPays": {
            "currency": {
              "chainId": 8453,
              "address": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
              "symbol": "USDC",
              "name": "USD Coin",
              "decimals": 6,
              "metadata": {
                "logoURI": "https://ethereum-optimism.github.io/data/USDC/logo.png",
                "verified": false,
                "isNative": false
              }
            },
            "amount": "30754920",
            "amountFormatted": "30.75492",
            "amountUsd": "30.901612",
            "minimumAmount": "30454920"
          }
        },
        "swap": {
          "selected": true,
          "total": {
            "currency": {
              "chainId": 8453,
              "address": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
              "symbol": "USDC",
              "name": "USD Coin",
              "decimals": 6,
              "metadata": {
                "logoURI": "https://ethereum-optimism.github.io/data/USDC/logo.png",
                "verified": false,
                "isNative": false
              }
            },
            "amount": "30754920",
            "amountFormatted": "30.75492",
            "amountUsd": "30.901612",
            "minimumAmount": "30454920"
          },
          "sponsored": {
            "currency": {
              "chainId": 8453,
              "address": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
              "symbol": "USDC",
              "name": "USD Coin",
              "decimals": 6,
              "metadata": {
                "logoURI": "https://ethereum-optimism.github.io/data/USDC/logo.png",
                "verified": false,
                "isNative": false
              }
            },
            "amount": "30754920",
            "amountFormatted": "30.75492",
            "amountUsd": "30.901612",
            "minimumAmount": "30454920"
          },
          "userPays": {
            "currency": {
              "chainId": 8453,
              "address": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
              "symbol": "USDC",
              "name": "USD Coin",
              "decimals": 6,
              "metadata": {
                "logoURI": "https://ethereum-optimism.github.io/data/USDC/logo.png",
                "verified": false,
                "isNative": false
              }
            },
            "amount": "30754920",
            "amountFormatted": "30.75492",
            "amountUsd": "30.901612",
            "minimumAmount": "30454920"
          }
        },
        "relay": {
          "selected": true,
          "total": {
            "currency": {
              "chainId": 8453,
              "address": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
              "symbol": "USDC",
              "name": "USD Coin",
              "decimals": 6,
              "metadata": {
                "logoURI": "https://ethereum-optimism.github.io/data/USDC/logo.png",
                "verified": false,
                "isNative": false
              }
            },
            "amount": "30754920",
            "amountFormatted": "30.75492",
            "amountUsd": "30.901612",
            "minimumAmount": "30454920"
          },
          "sponsored": {
            "currency": {
              "chainId": 8453,
              "address": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
              "symbol": "USDC",
              "name": "USD Coin",
              "decimals": 6,
              "metadata": {
                "logoURI": "https://ethereum-optimism.github.io/data/USDC/logo.png",
                "verified": false,
                "isNative": false
              }
            },
            "amount": "30754920",
            "amountFormatted": "30.75492",
            "amountUsd": "30.901612",
            "minimumAmount": "30454920"
          },
          "userPays": {
            "currency": {
              "chainId": 8453,
              "address": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
              "symbol": "USDC",
              "name": "USD Coin",
              "decimals": 6,
              "metadata": {
                "logoURI": "https://ethereum-optimism.github.io/data/USDC/logo.png",
                "verified": false,
                "isNative": false
              }
            },
            "amount": "30754920",
            "amountFormatted": "30.75492",
            "amountUsd": "30.901612",
            "minimumAmount": "30454920"
          }
        },
        "app": {
          "selected": true,
          "total": {
            "currency": {
              "chainId": 8453,
              "address": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
              "symbol": "USDC",
              "name": "USD Coin",
              "decimals": 6,
              "metadata": {
                "logoURI": "https://ethereum-optimism.github.io/data/USDC/logo.png",
                "verified": false,
                "isNative": false
              }
            },
            "amount": "30754920",
            "amountFormatted": "30.75492",
            "amountUsd": "30.901612",
            "minimumAmount": "30454920"
          },
          "sponsored": {
            "currency": {
              "chainId": 8453,
              "address": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
              "symbol": "USDC",
              "name": "USD Coin",
              "decimals": 6,
              "metadata": {
                "logoURI": "https://ethereum-optimism.github.io/data/USDC/logo.png",
                "verified": false,
                "isNative": false
              }
            },
            "amount": "30754920",
            "amountFormatted": "30.75492",
            "amountUsd": "30.901612",
            "minimumAmount": "30454920"
          },
          "userPays": {
            "currency": {
              "chainId": 8453,
              "address": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
              "symbol": "USDC",
              "name": "USD Coin",
              "decimals": 6,
              "metadata": {
                "logoURI": "https://ethereum-optimism.github.io/data/USDC/logo.png",
                "verified": false,
                "isNative": false
              }
            },
            "amount": "30754920",
            "amountFormatted": "30.75492",
            "amountUsd": "30.901612",
            "minimumAmount": "30454920"
          }
        },
        "rent": {
          "selected": true,
          "total": {
            "currency": {
              "chainId": 8453,
              "address": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
              "symbol": "USDC",
              "name": "USD Coin",
              "decimals": 6,
              "metadata": {
                "logoURI": "https://ethereum-optimism.github.io/data/USDC/logo.png",
                "verified": false,
                "isNative": false
              }
            },
            "amount": "30754920",
            "amountFormatted": "30.75492",
            "amountUsd": "30.901612",
            "minimumAmount": "30454920"
          },
          "sponsored": {
            "currency": {
              "chainId": 8453,
              "address": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
              "symbol": "USDC",
              "name": "USD Coin",
              "decimals": 6,
              "metadata": {
                "logoURI": "https://ethereum-optimism.github.io/data/USDC/logo.png",
                "verified": false,
                "isNative": false
              }
            },
            "amount": "30754920",
            "amountFormatted": "30.75492",
            "amountUsd": "30.901612",
            "minimumAmount": "30454920"
          },
          "userPays": {
            "currency": {
              "chainId": 8453,
              "address": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
              "symbol": "USDC",
              "name": "USD Coin",
              "decimals": 6,
              "metadata": {
                "logoURI": "https://ethereum-optimism.github.io/data/USDC/logo.png",
                "verified": false,
                "isNative": false
              }
            },
            "amount": "30754920",
            "amountFormatted": "30.75492",
            "amountUsd": "30.901612",
            "minimumAmount": "30454920"
          }
        }
      },
      "sponsoredTotal": {
        "currency": {
          "chainId": 8453,
          "address": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
          "symbol": "USDC",
          "name": "USD Coin",
          "decimals": 6,
          "metadata": {
            "logoURI": "https://ethereum-optimism.github.io/data/USDC/logo.png",
            "verified": false,
            "isNative": false
          }
        },
        "amount": "30754920",
        "amountFormatted": "30.75492",
        "amountUsd": "30.901612",
        "minimumAmount": "30454920"
      },
      "userPaysTotal": {
        "currency": {
          "chainId": 8453,
          "address": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
          "symbol": "USDC",
          "name": "USD Coin",
          "decimals": 6,
          "metadata": {
            "logoURI": "https://ethereum-optimism.github.io/data/USDC/logo.png",
            "verified": false,
            "isNative": false
          }
        },
        "amount": "30754920",
        "amountFormatted": "30.75492",
        "amountUsd": "30.901612",
        "minimumAmount": "30454920"
      },
      "maxSubsidizationAmount": "<string>",
      "subsidizationBps": 123,
      "sponsorPayment": {
        "amount": "<string>",
        "address": "<string>",
        "chainId": 123
      }
    }
  },
  "details": {
    "operation": "<string>",
    "sender": "<string>",
    "recipient": "<string>",
    "currencyIn": {
      "currency": {
        "chainId": 8453,
        "address": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
        "symbol": "USDC",
        "name": "USD Coin",
        "decimals": 6,
        "metadata": {
          "logoURI": "https://ethereum-optimism.github.io/data/USDC/logo.png",
          "verified": false,
          "isNative": false
        }
      },
      "amount": "30754920",
      "amountFormatted": "30.75492",
      "amountUsd": "30.901612",
      "minimumAmount": "30454920"
    },
    "currencyOut": {
      "currency": {
        "chainId": 8453,
        "address": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
        "symbol": "USDC",
        "name": "USD Coin",
        "decimals": 6,
        "metadata": {
          "logoURI": "https://ethereum-optimism.github.io/data/USDC/logo.png",
          "verified": false,
          "isNative": false
        }
      },
      "amount": "30754920",
      "amountFormatted": "30.75492",
      "amountUsd": "30.901612",
      "minimumAmount": "30454920"
    },
    "refundCurrency": {
      "currency": {
        "chainId": 8453,
        "address": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
        "symbol": "USDC",
        "name": "USD Coin",
        "decimals": 6,
        "metadata": {
          "logoURI": "https://ethereum-optimism.github.io/data/USDC/logo.png",
          "verified": false,
          "isNative": false
        }
      },
      "amount": "30754920",
      "amountFormatted": "30.75492",
      "amountUsd": "30.901612",
      "minimumAmount": "30454920"
    },
    "currencyGasTopup": {
      "currency": {
        "chainId": 8453,
        "address": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
        "symbol": "USDC",
        "name": "USD Coin",
        "decimals": 6,
        "metadata": {
          "logoURI": "https://ethereum-optimism.github.io/data/USDC/logo.png",
          "verified": false,
          "isNative": false
        }
      },
      "amount": "30754920",
      "amountFormatted": "30.75492",
      "amountUsd": "30.901612",
      "minimumAmount": "30454920"
    },
    "totalImpact": {
      "usd": "<string>",
      "percent": "<string>"
    },
    "swapImpact": {
      "usd": "<string>",
      "percent": "<string>"
    },
    "expandedPriceImpact": {
      "swap": {
        "usd": "<string>"
      },
      "execution": {
        "usd": "<string>"
      },
      "relay": {
        "usd": "<string>"
      },
      "app": {
        "usd": "<string>"
      },
      "sponsored": {
        "usd": "<string>"
      }
    },
    "rate": "<string>",
    "slippageTolerance": {
      "total": "<string>",
      "origin": {
        "usd": "<string>",
        "value": "<string>",
        "percent": "<string>"
      },
      "destination": {
        "usd": "<string>",
        "value": "<string>",
        "percent": "<string>"
      }
    },
    "timeEstimate": 123,
    "userBalance": "<string>",
    "fallbackType": "<string>",
    "isFixedRate": true,
    "fixedRateFee": {
      "usd": "<string>"
    },
    "route": {
      "origin": {
        "inputCurrency": {
          "currency": {
            "chainId": 8453,
            "address": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
            "symbol": "USDC",
            "name": "USD Coin",
            "decimals": 6,
            "metadata": {
              "logoURI": "https://ethereum-optimism.github.io/data/USDC/logo.png",
              "verified": false,
              "isNative": false
            }
          },
          "amount": "30754920",
          "amountFormatted": "30.75492",
          "amountUsd": "30.901612",
          "minimumAmount": "30454920"
        },
        "outputCurrency": {
          "currency": {
            "chainId": 8453,
            "address": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
            "symbol": "USDC",
            "name": "USD Coin",
            "decimals": 6,
            "metadata": {
              "logoURI": "https://ethereum-optimism.github.io/data/USDC/logo.png",
              "verified": false,
              "isNative": false
            }
          },
          "amount": "30754920",
          "amountFormatted": "30.75492",
          "amountUsd": "30.901612",
          "minimumAmount": "30454920"
        },
        "router": "<string>",
        "includedSwapSources": [
          "<string>"
        ]
      },
      "destination": {
        "inputCurrency": {
          "currency": {
            "chainId": 8453,
            "address": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
            "symbol": "USDC",
            "name": "USD Coin",
            "decimals": 6,
            "metadata": {
              "logoURI": "https://ethereum-optimism.github.io/data/USDC/logo.png",
              "verified": false,
              "isNative": false
            }
          },
          "amount": "30754920",
          "amountFormatted": "30.75492",
          "amountUsd": "30.901612",
          "minimumAmount": "30454920"
        },
        "outputCurrency": {
          "currency": {
            "chainId": 8453,
            "address": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
            "symbol": "USDC",
            "name": "USD Coin",
            "decimals": 6,
            "metadata": {
              "logoURI": "https://ethereum-optimism.github.io/data/USDC/logo.png",
              "verified": false,
              "isNative": false
            }
          },
          "amount": "30754920",
          "amountFormatted": "30.75492",
          "amountUsd": "30.901612",
          "minimumAmount": "30454920"
        },
        "router": "<string>",
        "includedSwapSources": [
          "<string>"
        ]
      }
    }
  },
  "protocol": {
    "v2": {
      "orderId": "<string>",
      "hubType": "onchain",
      "orderData": "<unknown>",
      "orderSignature": "<string>",
      "paymentDetails": {
        "chainId": "<string>",
        "depository": "<string>",
        "currency": "<string>",
        "amount": "<string>"
      }
    }
  }
}
Deprecated
Get Quote
deprecated

This API returns an executable quote for swapping, bridging and calling

Copy page
POST
https://api.relay.link
https://api.testnets.relay.link
/
quote
Try it
Headers
​
x-api-key
string

Optional API key for authentication and higher rate limits.

Body
application/json
​
user
stringdefault:0x03508bb71268bba25ecacc8f620e01866650532crequired

Address that is depositing funds on the origin chain and submitting transactions or signatures

​
originChainId
numberdefault:8453required
​
destinationChainId
numberdefault:10required
​
originCurrency
stringdefault:0x0000000000000000000000000000000000000000required
​
destinationCurrency
stringdefault:0x0000000000000000000000000000000000000000required
​
amount
stringdefault:1000000000000000000required

Amount to swap as the base amount (can be switched to exact input/output using the dedicated flag), denoted in the smallest unit of the specified currency (e.g., wei for ETH)

Pattern: ^[0-9]+$
​
tradeType
enum<string>default:EXACT_INPUTrequired

Whether to use the amount as the output or the input for the basis of the swap

Available options: EXACT_INPUT, EXACT_OUTPUT, EXPECTED_OUTPUT 
​
recipient
string

Address that is receiving the funds on the destination chain, if not specified then this will default to the user address

​
txs
object[]

Show child attributes

​
txsGasLimit
number

Total gas limit for the destination chain call transactions

​
authorizationList
object[]

Authorization list for EIP-7702 transactions to be executed on destination chain

Show child attributes

​
additionalData
object

Additional data needed for specific routes

Show child attributes

​
referrer
string
​
referrerAddress
string
Pattern: ^0x[a-fA-F0-9]{40}$
​
refundTo
string

Address to send the refund to in the case of failure, if not specified then the recipient address or user address is used

​
recoveryAddress
string

Origin-chain address used for deposit-address fund recovery. Requires useDepositAddress=true.

​
refundOnOrigin
booleandeprecated

Always refund on the origin chain in case of any issues

​
topupGas
boolean

If set, the destination fill will include a gas topup to the recipient (only supported for EVM chains if the requested currency is not the gas currency on the destination chain)

​
topupGasAmount
string

The destination gas topup amount in USD decimal format, e.g 100000 = $1. topupGas is required to be enabled. Defaults to 2000000 ($2)

​
enableTrueExactOutput
booleandefault:false

Enabling will send any swap surplus when doing exact output operations to the solver EOA, otherwise it will be swept to the recipient

​
explicitDeposit
booleandefault:true

Enable this to avoid direct transfers to the depository (only relevant for EVM and v2 protocol flow)

​
useExternalLiquidity
boolean

Enable this to use canonical+ bridging, trading speed for more liquidity

​
useFallbacks
boolean

Enable this for specific fallback routes

​
usePermit
boolean

Enable this to use permit (eip3009) when bridging, only works on supported currency such as usdc

​
permitExpiry
number

How long the permit remains valid, in seconds. Defaults to 10 minutes.

​
includeProtocolData
boolean

Return protocol data for on-chain intent validation. This includes protocol.v2.orderSignature and may increase quote latency.

​
useDepositAddress
boolean

Use a deposit address when calldata cannot be sent with the origin transaction. In /quote/v2, creation follows the requested trade type.

​
strict
boolean

Deprecated and ignored by /quote/v2. Deprecated quote endpoints retain their existing strict behavior.

​
slippageTolerance
string

Slippage tolerance for the swap, if not specified then the slippage tolerance is automatically calculated to avoid front-running. This value is in basis points (1/100th of a percent), e.g. 50 for 0.5% slippage. Must be 0–10000 bps.

Pattern: ^([0-9]{1,4}|10000)$
​
latePaymentSlippageTolerance
string

Slippage tolerance for destination gas in the event that the deposit occurs after the order deadline, and more gas is required for the solver to execute the destination transaction. Must be 0–10000 bps.

Pattern: ^([0-9]{1,4}|10000)$
​
appFees
object[]

Show child attributes

​
gasLimitForDepositSpecifiedTxs
number

If the request involves specifying transactions to be executed during the deposit transaction, an explicit gas limit must be set when requesting the quote

​
forceSolverExecution
boolean

Force executing swap requests via the solver (by default, same-chain swap requests are self-executed)

​
subsidizeFees
boolean

If the sponsor should pay for the fees associated with the request. Includes gas topup amounts.

​
sponsoredFeeComponents
enum<string>[]

The fee components to sponsor for swap execution kinds. Requires subsidizeFees=true. Defaults to execution, swap, relay, and app when omitted; rent remains user-paid unless explicitly selected.

Minimum array length: 1
Available options: execution, swap, relay, app, rent 
​
maxSubsidizationAmount
string

The max subsidization amount in USDC decimal format, e.g 1000000 = $1. subsidizeFees must be enabled. The sponsor will cover fees up to this cap and the user pays any remainder.

​
subsidizationBps
integer

The share of each sponsored fee component the sponsor covers, in bps, e.g 10000 = 100% and 2500 = 25%. subsidizeFees must be enabled. Defaults to full coverage when omitted; the user pays the remainder. Applied before maxSubsidizationAmount, which still caps the sponsor's total.

Required range: 0 <= x <= 10000
​
subsidizeRent
booleandeprecated

Deprecated compatibility alias that adds "rent" to sponsoredFeeComponents.

​
includedSwapSources
string[]

Swap sources to include for swap routing.

​
excludedSwapSources
string[]

Swap sources to exclude for swap routing.

​
includedOriginSwapSources
string[]

Swap sources to include for swap routing on origin.

​
includedDestinationSwapSources
string[]

Swap sources to include for swap routing on destination.

​
originGasOverhead
number

The gas overhead for the origin chain, this is used to calculate the gas fee for the origin chain when the solver is executing a gasless transaction on the origin chain

​
depositFeePayer
string

The payer to be set for deposit transactions on solana. This account must have enough for fees and rent.

​
maxRouteLength
number

Maximum number of hops to use in solana swap routing. Can reduce transaction size.

​
useSharedAccounts
boolean

Prevents certain ATA creation instructions in solana routing

​
includeComputeUnitLimit
boolean

Whether to include compute unit limit instruction for solana origin requests.

​
overridePriceImpact
boolean

Whether to ignore price impact errors.

​
disableSwapProviderPreference
boolean

Whether to disable preferred swap provider selection.

​
disableOriginSwaps
boolean

Whether to disable origin swaps.

​
indicativeQuote
boolean

Whether to return an inexecutable quote meant to be used as a preview.

​
fixedRate
string

The rate to charge for fixed spread quotes.

​
ttl
number

Time-to-live for the quote, in seconds, measured from when the quote was generated. If the request is not filled within this window it is refunded instead of filled.

Response
200
application/json

Default Response

​
requestId
string

A unique identifier for the quote

​
steps
object[]

An array of steps detailing what needs to be done to bridge, steps includes multiple items of the same kind (signature, transaction, etc)

Show child attributes

Example:
[
  {
    "id": "deposit",
    "action": "Confirm transaction in your wallet",
    "description": "Depositing funds to the relayer to execute the swap for USDC",
    "kind": "transaction",
    "requestId": "0x92b99e6e1ee1deeb9531b5ad7f87091b3d71254b3176de9e8b5f6c6d0bd3a331",
    "items": [
      {
        "status": "incomplete",
        "data": {
          "from": "0x0CccD55A5Ac261Ea29136831eeaA93bfE07f5Db6",
          "to": "0xf70da97812cb96acdf810712aa562db8dfa3dbef",
          "data": "0x00fad611",
          "value": "1000000000000000000",
          "maxFeePerGas": "12205661344",
          "maxPriorityFeePerGas": "2037863396",
          "chainId": 1
        },
        "check": {
          "endpoint": "/intents/status?requestId=0x92b99e6e1ee1deeb9531b5ad7f87091b3d71254b3176de9e8b5f6c6d0bd3a331",
          "method": "GET"
        }
      }
    ]
  }
]
​
fees
object

Show child attributes

​
feeSponsorship
object

Granular fee sponsorship details derived from the solver's internal sponsorship resolution.

Show child attributes

​
details
object

A summary of the swap and what the user should expect to happen given an input

Show child attributes

​
protocol
object

Protocol information for the quote

Show child attributes

Was this page helpful?

Yes
No
Get Currencies
Intent Status
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform