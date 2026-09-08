# Troubleshooting - Relay

Source: https://docs.relay.link/references/relay-kit/ui/troubleshooting

On this page
WagmiProviderNotFoundError: useConfig must be used within WagmiProvider
No QueryClient set, use QueryClientProvider to set one
The UI looks unstyled
Incompatibility
No wallet found
UI
Troubleshooting
Copy page

Having trouble? Start here

​
WagmiProviderNotFoundError: useConfig must be used within WagmiProvider
This issue is usually the result of multiple wagmi versions, make sure you only have 1 version of wagmi installed. You may also want to delete and reinstall your node modules and clear all caches.
​
No QueryClient set, use QueryClientProvider to set one
If you’ve set the QueryClientProvider with a QueryClient it could be that you have multiple versions of tanstack/react-query installed. Make sure to double check and reduce this to just a single version of the package. You may also want to delete and reinstall your node modules and clear all caches.
​
The UI looks unstyled
Make sure you’ve imported the ui package styles:
import '@relayprotocol/relay-kit-ui/styles.css'

If the issue persists make sure there’s no reset css or other css file overriding the styles provided by the package.
​
Incompatibility
If you see an error message that looks like this:
The types of 'utils.adaptViemWallet' are incompatible between these types

It could be that multiple versions of peer dependencies are installed. Review your package lock file for duplicate dependencies.
​
No wallet found
If you see an error message that looks like this:
Missing a valid wallet

or
Missing a wallet

It could be that you’re not providing a valid wallet to the SwapWidget or that you’re app is not wrapped in a WagmiProvider. Make sure to provide a wallet to the SwapWidget or double check that your SwapWidget is wrapped by a WagmiProvider. It could also mean that you have two versions of wagmi/viem installed. Make sure that you only have 1 version of wagmi/viem installed as multiple versions can cause issues.

Was this page helpful?

Yes
No
Theming
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform