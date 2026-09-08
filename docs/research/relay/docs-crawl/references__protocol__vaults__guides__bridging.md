# Bridging - Relay

Source: https://docs.relay.link/references/protocol/vaults/guides/bridging

On this page
Identifying the vault and origin
Performing the deposit
Using the Hyperlane explorer
Guides
Bridging
Copy page

In this guide, we will learn how to successfully bridge funds from an origin to a vault.

​
Identifying the vault and origin
The first step is to identify the vault you want to bridge to. This is based on the currency and chain on which you want to receive the funds. You can chose to hardcode trusted vault addresses (like the ones deployed by the Relay team), or use our Backend API to query the vaults available on a specific chain and currency.
Once you have identified the vault, you need to identify the origin on which you want to perform your deposit. There again, you can use our Backend API to query the origins available for a specific vault. You can filter these origins by their chain and currency. Please note that a vault may have “different” currencies than the ones you deposit. This is for example the case for deposits of native tokens (Ethereum) who are in fact going to a wrapped token (WETH) vault.
Once you have identified the origin, you should check a few things:
that the vault has enough liquidity to handle your deposit (you can query the vault’s balance on the Backend API) comparing its outstandingDebt and totalAssets values.
that the origin’s specific outstandingDebt is sufficient to handle your deposit. This is the maximum amount of funds that can be bridged from that origin at any given time. You can query this value on the Backend API. You can use the vault’s authorizedOrigins field to check the origins available for a specific vault (it also returns the bridgeFee and cooldown that are useful).
​
Performing the deposit
Finally, it is time to perform the deposit. In order to perform a deposit, you need to first query the getFee method on the bridge contract in order to get the fee that will be charged for the deposit itself. These are the fees collected by Hyperlane to send the message to the vault. You will need to specify the amount, recipient and poolGas parameters (a default of 300,000 gas should be sufficient for most cases). Once you have the fee, you will need to call the bridge method on the origin contract, passing the amount, recipient, poolGas and an extra data parameters. You MUST also pass a value matching the result of the getFee call from above. The data parameter is optional and can be used to pass extra information to the underlying bridge proxy (see BridgeProxy) and could be 0x0 in most cases.
The recipient address will receive the funds on the vault chain as soon as the message has been processed by Hyperlane (and the cool down period has been respected). The recipient address can be the same as the one you used to deposit, or a different one. This is useful if you want to bridge funds to a different address than the one you used to deposit.
​
Using the Hyperlane explorer
Messages are passed between the origin and the vault using Hyperlane. You can use the Hyperlane Explorer to track the messages sent from the origin to the vault. This can be useful to check if your message has been sent and is being processed by the vault. For this, check the messageId parameter of the DispatchId event emitted by Mailbox contract on the origin chain. Here is an example for this transaction on the Zora chain.

Was this page helpful?

Yes
No
Backend
Interacting
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform