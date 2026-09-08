# createClient - Relay

Source: https://docs.relay.link/references/relay-kit/sdk/createClient

On this page
Options
SDK
createClient
Copy page

Create the global Relay client used by every SDK action

This method is used to create the Relay client globally in your application. The client can then be retrieved with the getClient method.
​
Options
Property	Description	Required
baseApiUrl	The base API url to use when making requests. You can use the MAINNET_RELAY_API or the TESTNET_RELAY_API constants exported by the package, or pass in your own proxy API url to protect your API key on the client.	✅
apiKey	A Relay API key to use when making requests. Only pass in this property when the Relay client instance is used exclusively server-side. Otherwise you’ll leak your key to the client.	❌
chains	A list of Relay Chains, by default a list of backup chains is configured	❌
source	The source to associate your onchain activity with, should map to a domain	❌
logLevel	The level at which to log, refer to the LogLevel enum exported by the package	❌
pollingInterval	How often to poll status and check apis, this value is in milliseconds	❌
maxPollingAttemptsBeforeTimeout	The source to associate your onchain activity with, should be set to a domain	❌
import {
  createClient,
  convertViemChainToRelayChain,
  MAINNET_RELAY_API,
} from "@relayprotocol/relay-sdk";
import { mainnet } from "viem/chains";

createClient({
  baseApiUrl: MAINNET_RELAY_API,
  source: "YOUR.SOURCE",
  chains: [convertViemChainToRelayChain(mainnet)],
});


Was this page helpful?

Yes
No
Installation
getQuote
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform