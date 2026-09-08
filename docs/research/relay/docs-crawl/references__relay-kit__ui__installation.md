# Installation - Relay

Source: https://docs.relay.link/references/relay-kit/ui/installation

On this page
Installation
Tanstack Query Setup
Configuration
Styling
Configuring Chains Dynamically
Review
UI
Installation
Copy page

Installing and Configuring RelayKit UI

​
Installation
Use this React ui package to smoothly embed a fully featured Relay powered interface into your application. Start by installing the required packages:
yarn
npm
pnpm
bun
yarn add viem wagmi @tanstack/react-query @relayprotocol/relay-kit-ui 

If using typescript ensure that you’re on v5+. Refer to the package json for the latest version requirements for the peer dependencies.
​
Tanstack Query Setup
The hooks require TanStack Query to be installed and configured. Refer to the Tanstack installation instructions.
​
Configuration
Once all dependencies are installed you can now configure and wrap your application with the RelayKitProvider. You’ll need to also wrap your application with the QueryClientProvider and the WagmiProvider. Note the order in the snippet below.
import { RelayKitProvider } from '@relayprotocol/relay-kit-ui'
import { convertViemChainToRelayChain } from '@relayprotocol/relay-sdk'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, createConfig, WagmiProvider } from '@wagmi/core'
import { mainnet } from '@wagmi/core/chains'
import { MAINNET_RELAY_API, TESTNET_RELAY_API } from '@relayprotocol/relay-sdk'
import '@relayprotocol/relay-kit-ui/styles.css'

const queryClient = new QueryClient()

const chains = [convertViemChainToRelayChain(mainnet)]

const wagmiConfig = createConfig({
  appName: 'Relay Demo',
  chains: [mainnet],
  transports: {
    [mainnet.id]: http(),
  }
})

const App = () => {
  return (
    <QueryClientProvider client={queryClient}>
		<RelayKitProvider options={{
			appName: 'Relay Demo',
			appFees: [
			  {
				recipient: '0x0000000000000000000000000000000000000000',
				fee: '100' // 1%
			  }
			],
			codexConfig: {
				apiKey: "YOUR_CODEX_KEY",
			},
			chains,
			baseApiUrl: MAINNET_RELAY_API
		  }}>
        <WagmiProvider config={wagmiConfig}>
          <YourApp />
        </WagmiProvider>
      </RelayKitProvider>
    </QueryClientProvider>
  )
}

The widgets read transaction history from GET /requests/v3, which requires a Relay API key. Set baseApiUrl to a server-side proxy that injects x-api-key — do not pass the key from the browser. When baseApiUrl points directly at the Relay API, RelayKitProvider logs a client-side warning.
If you’re using the convertViemChainToRelayChain you’ll need to install and import the @relayprotocol/relay-sdk to use this function.
​
Styling
Make sure to import the styles.css globally otherwise the components will be unstyled:
import '@relayprotocol/relay-kit-ui/styles.css'

​
Configuring Chains Dynamically
While you can easily supply chains that your application supports, you may want to fetch the supported Relay chains dynamically and configure them in your application. This can be done by using the useRelayChains hook.
import { useRelayChains } from '@relayprotocol/relay-kit-hooks'
import { RelayKitProvider } from '@relayprotocol/relay-kit-ui'
import { convertViemChainToRelayChain } from '@relayprotocol/relay-sdk'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, createConfig, WagmiProvider } from '@wagmi/core'
import { mainnet } from '@wagmi/core/chains'
import { MAINNET_RELAY_API, TESTNET_RELAY_API } from '@relayprotocol/relay-sdk'

const queryClient = new QueryClient()

const App = () => {
  const [wagmiConfig, setWagmiConfig] = useState<
    ReturnType<typeof createConfig> | undefined
  >()
  const { chains, viemChains } = useRelayChains(MAINNET_RELAY_API)

  useEffect(() => {
    if (!wagmiConfig && chains && viemChains) {
      setWagmiConfig(
        createConfig({
          appName: 'Relay Demo',
          chains: (viemChains && viemChains.length === 0
            ? [mainnet]
            : viemChains) as [Chain, ...Chain[]],
          transports: {
            [mainnet.id]: http(),
          }
        })
      )
    }
  }, [chains])

  //Prevent loading the page until wagmi config is set, you can set a temporary config to swap out later to unblock the ui
  if (!wagmiConfig) {
    return null
  }

  return (
    <QueryClientProvider client={queryClient}>
      <RelayKitProvider options={{
		  codexConfig: {
			apiKey: "YOUR_CODEX_KEY",
		  },
          chains,
          baseApiUrl: MAINNET_RELAY_API
        }}>
        <WagmiProvider config={wagmiConfig}>
          <YourApp />
        </WagmiProvider>
      </RelayKitProvider>
    </QueryClientProvider>
  )
}

Learn more about the RelayKitProvider options.
​
Review
Let’s review with a checklist to make sure we got everything in:
Install the required dependencies
Configure Tanstack Query and Wagmi
Configure RelayKitProvider with chains and options
Import the styles.css file to style our ui components

Was this page helpful?

Yes
No
useExecutionStatus
RelayKitProvider
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform