# Installation - Relay

Source: https://docs.relay.link/references/relay-kit/hooks/installation

On this page
Installation
Tanstack Query Setup
Hooks
Hooks
Installation
Copy page

Installing and Configuring RelayKit Hooks

​
Installation
Use this lightweight React hook package to integrate Relay into your custom interface. Start by installing the required packages:
yarn
npm
pnpm
bun
yarn add react react-dom viem @tanstack/react-query @relayprotocol/relay-kit-hooks

If using typescript ensure that you’re on v5+. Refer to the package json for the latest version requirements for the peer dependencies.
​
Tanstack Query Setup
The hooks require TanStack Query to be installed and configured. Refer to the Tanstack installation instructions. Once Tanstack is configured in your React application, that’s all you need to get started.
​
Hooks
Each hook is configured separately to allow for as much flexibility as possible. All hooks come with a query function that can be used outside of a React context to fetch the data (useful when using SSR or in a context that doesn’t use React).
useQuote
useRelayChains
useRequests
useTokenList
useTokenPrice
useExecutionStatus

Was this page helpful?

Yes
No
Chain Utils
useQuote
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform