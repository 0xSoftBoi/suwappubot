import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import { mainnet, arbitrum, optimism, polygon, base, avalanche, bsc } from 'wagmi/chains'

export const config = getDefaultConfig({
  appName: 'Suwappu Terminal',
  projectId: import.meta.env.VITE_WC_PROJECT_ID || 'demo',
  chains: [mainnet, arbitrum, optimism, polygon, base, avalanche, bsc],
  ssr: false,
})
