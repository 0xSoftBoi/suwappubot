# useRequests - Relay

Source: https://docs.relay.link/references/relay-kit/hooks/useRequests

On this page
Parameters
Return Data
Usage
Query Function
Hooks
useRequests
Copy page

Fetch cross-chain Relay transactions

useRequests and queryRequests read from GET /requests/v3, which requires a Relay API key sent via the x-api-key header. Because these hooks run in the browser, never ship your API key to the client — point baseApiUrl at a server-side proxy that injects x-api-key.
​
Parameters
Parameter	Description	Required
baseApiUrl	Base API URL for the Relay API. /requests/v3 requires an x-api-key, so point this at a server-side proxy that injects the key rather than at https://api.relay.link directly.	❌
options	Query parameters that map directly to the requests api	❌
queryOptions	Tanstack query options. Refer to the Tanstack docs.	❌
​
Return Data
The hook returns an object with the base Tanstack Query response. The data property maps to the object returned in the aforementioned requests api.
​
Usage
import { useRequests } from '@relayprotocol/relay-kit-hooks'

const { data: transactions } = useRequests()


​
Query Function
import { queryRequests } from '@relayprotocol/relay-kit-hooks'

queryRequests()



Was this page helpful?

Yes
No
useRelayChains
useTokenList
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform