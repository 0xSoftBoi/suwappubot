# useRelayChains - Relay

Source: https://docs.relay.link/references/relay-kit/hooks/useRelayChains

On this page
Parameters
Return Data
Usage
Query Function
Hooks
useRelayChains
Copy page

Fetch all relay supported chains

​
Parameters
Parameter	Description	Required
baseApiUrl	Base api url for the relay api, defaults to https://api.relay.link but can also be configured to https://api.testnets.relay.link	❌
options	Query parameters that map directly to the chains api	❌
queryOptions	Tanstack query options. Refer to the Tanstack docs.	❌
​
Return Data
The hook returns an object with the base Tanstack Query response. The data property maps to the object returned in the aforementioned chains api. You’ll also get back chains (an array of RelayChains) and viemChains (an array of viem compatible chains). You can use the viem chains in your wagmi config.
​
Usage
import { useRelayChains } from '@relayprotocol/relay-kit-hooks'

const { chains, viemChains } = useRelayChains()


​
Query Function
import { queryRelayChains } from '@relayprotocol/relay-kit-hooks'

queryRelayChains()



Was this page helpful?

Yes
No
useQuote
useRequests
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform