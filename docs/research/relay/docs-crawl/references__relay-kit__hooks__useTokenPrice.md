# useTokenPrice - Relay

Source: https://docs.relay.link/references/relay-kit/hooks/useTokenPrice

On this page
Parameters
Return Data
Usage
Query Function
Hooks
useTokenPrice
Copy page

Fetch the USD price for a token on a specific chain.

​
Parameters
Parameter	Description	Required
baseApiUrl	Base api url for the relay api, defaults to https://api.relay.link but can also be configured to https://api.testnets.relay.link	❌
options	Query parameters that map directly to the prices API.	✅
queryOptions	Tanstack query options. Refer to the Tanstack docs.	❌
​
Return Data
The hook returns an object with the base Tanstack Query response. The data property maps to the object returned in the aforementioned prices API.
​
Usage
import { useTokenPrice } from "@relayprotocol/relay-kit-hooks";
import { useRelayClient } from "@relayprotocol/relay-kit-ui";
import { zeroAddress } from "viem";

const {
	data: ethPriceResponse,
	isLoading,
	error,
} = useTokenPrice(
	{
		address: zeroAddress, // Native currency (ETH)
		chainId: 8453, // Base chain ID
	},
	{
		// Optional query options
		refetchInterval: 60000, // Refresh every minute
	}
);

if (isLoading) {
	console.log("Loading ETH price...");
} else if (error) {
	console.error("Error fetching ETH price:", error);
} else {
	console.log("ETH Price on Base:", ethPriceResponse?.price); // Access the price from the data object
}

​
Query Function
import { queryTokenPrice } from "@relayprotocol/relay-kit-hooks";
import { zeroAddress } from "viem";

// Example: Fetch price for ETH on Base (chain 8453)
queryTokenPrice(
	"https://api.relay.link", // Or use baseApiUrl from useRelayClient()
	{
		address: zeroAddress,
		chainId: 8453,
	}
)
	.then((priceData) => {
		console.log("ETH Price on Base:", priceData);
	})
	.catch((error) => {
		console.error("Failed to fetch ETH price:", error);
	});


Was this page helpful?

Yes
No
useTokenList
useExecutionStatus
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform