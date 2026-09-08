# Installation - Relay

Source: https://docs.relay.link/references/relay-kit/sdk/installation

On this page
Installation
Environment Requirements:
Configuration
(Optional) Dynamically Configure Chains:
SDK
Installation
Copy page

Setup the Relay SDK in your application

​
Installation
Install the Relay SDK and its peer dependency viem
yarn
npm
pnpm
bun
yarn add @relayprotocol/relay-sdk viem 

​
Environment Requirements:
node 18+ typescript ^5.0.4 (if using typescript)
​
Configuration
To configure the SDK we first need to create a global instance of a RelayClient:
import { createClient, convertViemChainToRelayChain, MAINNET_RELAY_API, TESTNET_RELAY_API } from '@relayprotocol/relay-sdk'
import { mainnet } from 'viem/chains'

createClient({
  baseApiUrl: MAINNET_RELAY_API,
  source: "YOUR.SOURCE",
  chains: [convertViemChainToRelayChain(mainnet)]
});

You can replace the baseApiUrl with TESTNET_RELAY_API when testing with testnets. In the example above we also pass in an array of RelayChains converted from a viem chain, the sdk exports a function (convertViemChainToRelayChain) to easily do this. Learn more about the createClient options.
Calling createClient creates a singleton instance that will be used throughout your application.
​
(Optional) Dynamically Configure Chains:
The sdk provides a utility function for fetching the supported chains dynamically and configuring the SDK. Below is an example of how you could set that up:
import type { AppProps } from "next/app";
import React, { ReactNode, FC, useState, useEffect } from "react";
import { RainbowKitProvider, getDefaultWallets } from "@rainbow-me/rainbowkit";
import { WagmiConfig, createConfig, configureChains, Chain } from "wagmi";
import { mainnet } from "viem/chains";
import { publicProvider } from "wagmi/providers/public";
import { alchemyProvider } from "wagmi/providers/alchemy";
import { configureDynamicChains } from "@relayprotocol/relay-sdk/chain-utils";
import { RainbowKitChain } from "@rainbow-me/rainbowkit/dist/components/RainbowKitProvider/RainbowKitChainContext";

const AppWrapper: FC<AppWrapperProps> = ({ children }) => {
  const [wagmiConfig, setWagmiConfig] = useState<
    ReturnType<typeof createWagmiConfig>["wagmiConfig"] | undefined
  >();
  const [chains, setChains] = useState<RainbowKitChain[]>([]);

  useEffect(() => {
    configureDynamicChains()
      .then((newChains) => {
        const { wagmiConfig, chains } = createWagmiConfig(
          newChains.map(({ viemChain }) => viemChain as Chain)
        );
        setWagmiConfig(wagmiConfig);
        setChains(chains);
      })
      .catch((e) => {
        console.error(e);
        const { wagmiConfig, chains } = createWagmiConfig([mainnet]);
        setWagmiConfig(wagmiConfig);
        setChains(chains);
      });
  }, []);

  if (!wagmiConfig) {
    return null;
  }

  return (
    <WagmiConfig config={wagmiConfig}>
      <RainbowKitProvider chains={chains}>{children}</RainbowKitProvider>
    </WagmiConfig>
  );
};

function createWagmiConfig(dynamicChains: Chain[]) {
  const { chains, publicClient } = configureChains(dynamicChains, [
    alchemyProvider({ apiKey: ALCHEMY_KEY }),
    publicProvider(),
  ]);

  const { connectors } = getDefaultWallets({
    appName: "Relay Demo",
    projectId: WALLET_CONNECT_PROJECT_ID,
    chains,
  });

  const wagmiConfig = createConfig({
    autoConnect: true,
    connectors,
    publicClient,
  });

  return {
    wagmiConfig,
    chains,
  };
}

The above example demonstrates how to setup dynamic chains in a react application. At the start of your application you would basically configure the dynamic chains in the SDK by using the configureDynamicChains method. Then with the new chains in the promise you would use the viemChain property to create the wagmi config (refer to the wagmi docs for this). Finally take the resulting chains and configure the RainbowKitProvider. Although in this example we used RainbowKit + Wagmi, you’re free to choose whatever libraries you’d like to connect a users wallet. You can call this method as often as you like to refresh the SDK’s chains.

Was this page helpful?

Yes
No
Overview
createClient
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform