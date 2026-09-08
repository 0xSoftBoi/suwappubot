# Chain Utils - Relay

Source: https://docs.relay.link/references/relay-kit/sdk/chain-utils

On this page
Overview
Installation
Functions
configureViemChain
configureDynamicChains
SDK
Chain Utils
Copy page

Utility functions for configuring chains in the Relay SDK

​
Overview
The /chain-utils subpath export contains utilities for dynamically configuring chains in your application. These functions were moved to a separate entry point to enable better tree-shaking and reduce the default SDK bundle size.
​
Installation
The chain utilities are included in the main SDK package. Simply import from the /chain-utils subpath:
import { 
  configureViemChain, 
  configureDynamicChains
} from '@relayprotocol/relay-sdk/chain-utils'

​
Functions
​
configureViemChain
Configures a single viem chain for use with the Relay SDK.
import { configureViemChain } from '@relayprotocol/relay-sdk/chain-utils'
import { arbitrum } from 'viem/chains'

const relayChain = configureViemChain(arbitrum)

Parameter	Type	Description
chain	Chain	A viem chain object to configure for Relay
Returns: A configured Relay chain object ready to use with the SDK.
​
configureDynamicChains
Fetches supported chains from the Relay API and configures them dynamically in the SDK. This is useful for applications that want to support all available chains without hardcoding them.
import { configureDynamicChains } from '@relayprotocol/relay-sdk/chain-utils'

const chains = await configureDynamicChains()
// Returns an array of configured chains with viemChain properties

Returns: Promise<RelayChain[]> - An array of Relay chain objects, each containing a viemChain property for use with wagmi/viem.

Was this page helpful?

Yes
No
Typescript API Typings
Installation
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform