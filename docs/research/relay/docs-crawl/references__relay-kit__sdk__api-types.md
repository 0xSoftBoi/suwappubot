# Typescript API Typings - Relay

Source: https://docs.relay.link/references/relay-kit/sdk/api-types

SDK
Typescript API Typings
Copy page

Typescript API Typings Typescript Types that facilitate API interaction

The Relay SDK comes with built in API types to facilitate interacting with Relay APIs. The API types are useful for parsing API responses and determining what parameters an api accepts. Note that the types are exposed as part of the Relay SDK package, leaving where and how you use it up to you. There’s no requirement for React, or anything else, except for Typescript. Below we’ll dig into some examples:
import { paths } from '@relayprotocol/relay-sdk'

const parameters: paths['/execute/call']['post']['requestBody']['content']['application/json'] = {
  ...
}

With the Typescript types imported you can easily discover what query parameters an API might allow or what response an API will return.

Was this page helpful?

Yes
No
Adapters
Chain Utils
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform