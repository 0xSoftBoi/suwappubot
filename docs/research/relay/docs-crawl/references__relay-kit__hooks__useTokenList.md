# useTokenList - Relay

Source: https://docs.relay.link/references/relay-kit/hooks/useTokenList

On this page
Parameters
Return Data
Usage
Query Function
Hooks
useTokenList
Copy page

Curated token searching

​
Parameters
Parameter	Description	Required
baseApiUrl	Base api url for the relay api, defaults to https://api.relay.link but can also be configured to https://api.testnets.relay.link	❌
options	Query parameters that map directly to the currencies api	❌
queryOptions	Tanstack query options. Refer to the Tanstack docs.	❌
​
Return Data
The hook returns an object with the base Tanstack Query response. The data property maps to the object returned in the aforementioned currencies api.
​
Usage
import { useTokenList } from '@relayprotocol/relay-kit-hooks'

const { data: suggestedTokens } = useTokenList(
  "https://api.relay.link", 
  { 
    limit: 20,
    term: "usdc"
  }
)

​
Query Function
import { queryTokenList } from '@relayprotocol/relay-kit-hooks'

queryTokenList(
  "https://api.relay.link", 
  { 
    limit: 20,
    term: "usdc"
  }
)



Was this page helpful?

Yes
No
useRequests
useTokenPrice
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform