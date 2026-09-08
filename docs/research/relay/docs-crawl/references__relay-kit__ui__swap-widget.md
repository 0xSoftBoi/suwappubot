# SwapWidget - Relay

Source: https://docs.relay.link/references/relay-kit/ui/swap-widget

On this page
Parameters
Usage
Slippage Configuration
Parameters
Usage
UI
SwapWidget
Copy page

Swap Cross-Chain Instantly

​
Parameters
Parameter	Description	Required
supportedWalletVMs	A required array of VMs that the swap widget should support. If a VM is selected that’s not listed it will fall back to the (deposit address)[https://support.relay.link/en/articles/10269920-how-do-deposit-addresses-work] ux. When setting this array make sure that the VMs are connectible by your wallet connection provider (dynamic, rainbow, privy, etc).	✅
fromToken	The token to swap from. If provided, setFromToken must also be provided.	❌
setFromToken	A function to update the from token. Required when fromToken is provided.	❌ (✅ if fromToken is provided)
toToken	The token to swap to. If provided, setToToken must also be provided.	❌
setToToken	A function to update the to token. Required when toToken is provided.	❌ (✅ if toToken is provided)
lockFromToken	Disables selecting a from token in the ui. A fromToken is required in order for this setting to be applied.	❌
lockToToken	Disables selecting a to token in the ui. A toToken is required in order for this setting to be applied.	❌
onFromTokenChange	A callback triggered when the user changes the from token	❌
onToTokenChange	A callback triggered when the user changes the to token	❌
lockChainId	If set, locks the chain selection to the specified chain ID. Requires default tokens to be configured for this to work properly.	❌
wallet	An AdaptedWallet object representing the user’s wallet. While this is not required as it’s automatically pulled from wagmi for EVM chains, it’s recommended to always provide this if possible.	❌
multiWalletSupportEnabled	A boolean indicating whether multi-wallet (evm/svm) support is enabled.	❌
linkedWallets	An array of LinkedWallet objects when multi-wallet support is enabled.	❌ (✅ if multiWalletSupportEnabled is true)
onSetPrimaryWallet	A callback function to set the primary wallet when multi-wallet support is enabled.	❌ (✅ if multiWalletSupportEnabled is true)
onLinkNewWallet	A callback function to link a new wallet when multi-wallet support is enabled.	❌ (✅ if multiWalletSupportEnabled is true)
defaultToAddress	A wallet address to send the proceeds to.	❌
defaultAmount	The default amount to swap, the amount is in the from token currency.	❌
defaultTradeType	This can either be EXACT_INPUT or EXACT_OUTPUT, each of these refers to prefilling the output amount or the input amount and having the quote return the other side.	❌
slippageTolerance	Slippage tolerance for the swap, if not specified then the slippage tolerance is automatically calculated to avoid front-running. This value is in basis points (1/100th of a percent), e.g. 50 for 0.5% slippage.	❌
disableInputAutoFocus	Prevents the input field from automatically focusing when the widget loads.	❌
popularChainIds	An array of chain IDs to override the ‘Popular chains’ list in the token selector.	❌
disablePasteWalletAddressOption	Disables the ability to paste wallet addresses in the multi-wallet dropdown.	❌
singleChainMode	When true, restricts swaps to occur only within the same chain. Works in conjunction with lockChainId.	❌
onConnectWallet	A callback to connect the user’s wallet. The widget can be used to fetch quotes for unauthenticated sessions but executing the quote requires an authenticated session.	✅
onAnalyticEvent	A callback which sends useful events to pipe into your existing analytics integration.	❌
onSwapValidating	A callback that returns the quote object along with executable steps while validating the swap	❌
onSwapSuccess	A callback that returns the quote object along with executable steps when the swap is complete	❌
onSwapError	A callback that returns any errors that occur during the swap process.	❌
​
Usage
import { adaptViemWallet } from '@relayprotocol/relay-sdk'
import { SwapWidget } from '@relayprotocol/relay-kit-ui'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { useState } from 'react'
import { useWalletClient } from 'wagmi'

export default function MyComponent() {
  const { openConnectModal } = useConnectModal()
  const [fromToken, setFromToken] = useState({
    chainId: 8453,
    address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    decimals: 6,
    name: 'USDC',
    symbol: 'USDC',
    logoURI: 'https://ethereum-optimism.github.io/data/USDC/logo.png'
  })
  const [toToken, setToToken] = useState({
    chainId: 10,
    address: '0x7f5c764cbc14f9669b88837ca1490cca17c31607',
    decimals: 6,
    name: 'USDC',
    symbol: 'USDC',
    logoURI: 'https://ethereum-optimism.github.io/data/USDC/logo.png'
  })

  const walletClient = useWalletClient()

  return (
    <SwapWidget
      wallet={adaptViemWallet(walletClient)}
      fromToken={fromToken}
      setFromToken={setFromToken}
      toToken={toToken}
      setToToken={setToToken}
      defaultAmount={'5'}
      supportedWalletVMs={['evm']}
      onConnectWallet={openConnectModal}
      onAnalyticEvent={(eventName, data) => {
        console.log('Analytic Event', eventName, data)
      }}
    />
  )
}


See all 44 lines
​
Slippage Configuration
The SlippageToleranceConfig component provides a user interface for configuring slippage tolerance in basis points. This component handles all the complexity of managing slippage values including debouncing, input validation, and conversion between percentage and basis points.
​
Parameters
Parameter	Description	Required
setSlippageTolerance	Callback function to update the slippage tolerance value	✅
onAnalyticEvent	Optional callback for analytics events	❌
​
Usage
import { SwapWidget, SlippageToleranceConfig } from '@relayprotocol/relay-kit-ui'
import { useState } from 'react'

export default function SwapPage() {
  const [slippageTolerance, setSlippageTolerance] = useState<string | undefined>(undefined)

  return (
    <div>
      <SlippageToleranceConfig
        setSlippageTolerance={setSlippageTolerance}
        onAnalyticEvent={(eventName, data) => {
          console.log('Analytic Event', eventName, data)
       }}
      />
      <SwapWidget
        slippageTolerance={slippageTolerance}
        // ... other SwapWidget props
      />
    </div>
  )
}


Was this page helpful?

Yes
No
RelayKitProvider
Theming
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform