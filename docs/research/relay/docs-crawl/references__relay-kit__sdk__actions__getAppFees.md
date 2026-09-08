# getAppFees - Relay

Source: https://docs.relay.link/references/relay-kit/sdk/actions/getAppFees

On this page
Parameters
Example
Actions
getAppFees
Copy page

Retrieve app fee balances for a specific wallet

What are app fees?
​
Parameters
Property	Description	Required
wallet	The wallet address to fetch app fee balances for	✅
​
Example
import { getClient } from "@relayprotocol/relay-sdk";

const wallet = "0x..."; // Replace with your wallet address

const balances = await getClient().actions.getAppFees({
  wallet,
});



Was this page helpful?

Yes
No
execute
claimAppFees
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform