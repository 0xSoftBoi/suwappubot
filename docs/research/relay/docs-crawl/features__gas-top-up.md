# Gas Top-Up - Relay

Source: https://docs.relay.link/features/gas-top-up

On this page
Enabling Gas Top-Up
Checking Gas Top-Up Support
Features
Gas Top-Up
Copy page

Include destination-chain native gas in bridged fills so recipients can transact immediately.

Gas top-up automatically includes a small amount of the destination chain’s native gas token (e.g., ETH) with the bridged tokens. This ensures recipients have gas to interact with their received tokens immediately.
​
Enabling Gas Top-Up
To enable gas top-up in your quote request:
Set topupGas to true
Optionally specify the gas amount using topupGasAmount
​
Checking Gas Top-Up Support
A chain supports gas top-up when all of the following are true:
EVM chain only - The chain’s vmType must be "evm"
Non-native currency - You cannot top up gas when bridging the chain’s native token (e.g., ETH on Ethereum)
Bridging enabled - Either:
tokenSupport is "All", OR
currency.supportsBridging is true
You can verify support by checking the Gas Top Up Supported column in Supported Tokens & Routes or by querying the Chains API.

Was this page helpful?

Yes
No
Deposit Addresses
Gasless Execution
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform