# useExecutionStatus - Relay

Source: https://docs.relay.link/references/relay-kit/hooks/useExecutionStatus

On this page
Parameters
Return Data
Usage
Query Function
Hooks
useExecutionStatus
Copy page

Fetch the execution status of a quote

​
Parameters
Parameter	Description	Required
baseApiUrl	Base api url for the relay api, defaults to https://api.relay.link but can also be configured to https://api.testnets.relay.link	❌
options	Query parameters that map directly to the execution status api	❌
queryOptions	Tanstack query options. Refer to the Tanstack docs.	❌
​
Return Data
The hook returns an object with the base Tanstack Query response. The data property maps to the object returned in the aforementioned execution status api.
​
Usage
import { useExecutionStatus } from '@relayprotocol/relay-kit-hooks'

const { data, isLoading, error } = useExecutionStatus(
  'https://api.relay.link',
  { requestId: '0x6a6cab2695f2dc4a67539d971760764edac9e52b0a2219a5fbb3faf2f04ac7c2' }
)

const { status, details, inTxHashes, txHashes, time, originChainId, destinationChainId } = data ?? {}


​
Query Function
import { queryExecutionStatus } from '@relayprotocol/relay-kit-hooks'

queryExecutionStatus()



Was this page helpful?

Yes
No
useTokenPrice
Installation
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform