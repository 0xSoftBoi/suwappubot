import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { SlippageControl, type SwapSettings, type SlippageControlProps } from '../../components/swap/SlippageControl'

function SlippageControlWrapper(props: Omit<SlippageControlProps, 'settings' | 'onChange'> & { initialSettings?: Partial<SwapSettings> }) {
  const { initialSettings, ...rest } = props
  const [settings, setSettings] = useState<SwapSettings>({
    slippage: 0.5,
    slippageMode: 'custom',
    mevProtection: true,
    gasPriority: 'normal',
    deadline: 20,
    ...initialSettings,
  })
  return <SlippageControl settings={settings} onChange={setSettings} {...rest} />
}

const meta: Meta = {
  title: 'Swap/SlippageControl',
  component: SlippageControl,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj

export const Default: Story = {
  args: {} as any,
  render: () => (
    <div className="max-w-md">
      <SlippageControlWrapper />
    </div>
  ),
}

export const Expanded: Story = {
  args: {} as any,
  render: () => (
    <div className="max-w-md">
      <SlippageControlWrapper defaultExpanded />
    </div>
  ),
}

export const HighSlippageWarning: Story = {
  args: {} as any,
  render: () => (
    <div className="max-w-md">
      <SlippageControlWrapper defaultExpanded initialSettings={{ slippage: 5 }} />
    </div>
  ),
}

export const ExtremeSlippageWarning: Story = {
  args: {} as any,
  render: () => (
    <div className="max-w-md">
      <SlippageControlWrapper defaultExpanded initialSettings={{ slippage: 15 }} />
    </div>
  ),
}

export const MevOff: Story = {
  args: {} as any,
  render: () => (
    <div className="max-w-md">
      <SlippageControlWrapper defaultExpanded initialSettings={{ mevProtection: false }} />
    </div>
  ),
}

export const SolanaChain: Story = {
  args: {} as any,
  render: () => (
    <div className="max-w-md">
      <SlippageControlWrapper defaultExpanded chainType="solana" />
    </div>
  ),
}

export const AutoSlippage: Story = {
  args: {} as any,
  render: () => (
    <div className="max-w-md">
      <SlippageControlWrapper defaultExpanded initialSettings={{ slippageMode: 'auto' }} />
    </div>
  ),
}

export const Mobile: Story = {
  args: {} as any,
  render: () => (
    <div className="max-w-[360px]">
      <SlippageControlWrapper defaultExpanded />
    </div>
  ),
}

export const AllGasPriorities: Story = {
  args: {} as any,
  render: () => (
    <div className="grid grid-cols-3 gap-4 max-w-3xl">
      <div>
        <p className="text-xs font-semibold mb-2 text-center">Slow (~30s)</p>
        <SlippageControlWrapper defaultExpanded initialSettings={{ gasPriority: 'slow' }} />
      </div>
      <div>
        <p className="text-xs font-semibold mb-2 text-center">Normal (~15s)</p>
        <SlippageControlWrapper defaultExpanded initialSettings={{ gasPriority: 'normal' }} />
      </div>
      <div>
        <p className="text-xs font-semibold mb-2 text-center">Fast (~5s)</p>
        <SlippageControlWrapper defaultExpanded initialSettings={{ gasPriority: 'fast' }} />
      </div>
    </div>
  ),
}

export const StablecoinSwap: Story = {
  args: {} as any,
  render: () => (
    <div className="max-w-md">
      <p className="text-xs text-gray-500 mb-2">USDC → USDT — tight slippage, no MEV needed</p>
      <SlippageControlWrapper
        defaultExpanded
        initialSettings={{
          slippage: 0.1,
          slippageMode: 'custom',
          mevProtection: false,
          gasPriority: 'normal',
          deadline: 20,
        }}
      />
    </div>
  ),
}

export const VolatileToken: Story = {
  args: {} as any,
  render: () => (
    <div className="max-w-md">
      <p className="text-xs text-gray-500 mb-2">ETH → PEPE — high slippage for volatile meme token</p>
      <SlippageControlWrapper
        defaultExpanded
        initialSettings={{
          slippage: 3,
          slippageMode: 'custom',
          mevProtection: true,
          gasPriority: 'fast',
          deadline: 10,
        }}
      />
    </div>
  ),
}

export const CrossChainSettings: Story = {
  args: {} as any,
  render: () => (
    <div className="max-w-md">
      <p className="text-xs text-gray-500 mb-2">ETH (Ethereum) → MATIC (Polygon) — cross-chain bridge swap</p>
      <SlippageControlWrapper
        defaultExpanded
        initialSettings={{
          slippage: 1,
          slippageMode: 'custom',
          mevProtection: true,
          gasPriority: 'normal',
          deadline: 30,
        }}
      />
    </div>
  ),
}

export const DeadlineOptions: Story = {
  args: {} as any,
  render: () => (
    <div className="grid grid-cols-3 gap-4 max-w-3xl">
      <div>
        <p className="text-xs font-semibold mb-2 text-center">10 min deadline</p>
        <SlippageControlWrapper defaultExpanded initialSettings={{ deadline: 10 }} />
      </div>
      <div>
        <p className="text-xs font-semibold mb-2 text-center">20 min deadline</p>
        <SlippageControlWrapper defaultExpanded initialSettings={{ deadline: 20 }} />
      </div>
      <div>
        <p className="text-xs font-semibold mb-2 text-center">30 min deadline</p>
        <SlippageControlWrapper defaultExpanded initialSettings={{ deadline: 30 }} />
      </div>
    </div>
  ),
}

export const CustomSlippage: Story = {
  args: {} as any,
  render: () => (
    <div className="max-w-md">
      <p className="text-xs text-gray-500 mb-2">ARB → GMX — custom 0.75% slippage for DeFi token</p>
      <SlippageControlWrapper
        defaultExpanded
        initialSettings={{
          slippage: 0.75,
          slippageMode: 'custom',
          mevProtection: true,
          gasPriority: 'normal',
          deadline: 20,
        }}
      />
    </div>
  ),
}

export const EVMvsNonEVM: Story = {
  args: {} as any,
  render: () => (
    <div className="grid grid-cols-2 gap-6 max-w-3xl">
      <div>
        <p className="text-xs font-semibold mb-2 text-center">Ethereum (EVM) — all sections</p>
        <SlippageControlWrapper
          defaultExpanded
          chainType="evm"
          initialSettings={{
            slippage: 0.5,
            slippageMode: 'custom',
            mevProtection: true,
            gasPriority: 'normal',
            deadline: 20,
          }}
        />
      </div>
      <div>
        <p className="text-xs font-semibold mb-2 text-center">Solana — no gas/MEV sections</p>
        <SlippageControlWrapper
          defaultExpanded
          chainType="solana"
          initialSettings={{
            slippage: 0.5,
            slippageMode: 'custom',
            mevProtection: true,
            gasPriority: 'normal',
            deadline: 20,
          }}
        />
      </div>
    </div>
  ),
}

export const DangerZone: Story = {
  args: {} as any,
  render: () => (
    <div className="max-w-md">
      <p className="text-xs text-gray-500 mb-2">Worst possible settings — 15% slippage, no MEV, slow gas</p>
      <SlippageControlWrapper
        defaultExpanded
        initialSettings={{
          slippage: 15,
          slippageMode: 'custom',
          mevProtection: false,
          gasPriority: 'slow',
          deadline: 30,
        }}
      />
    </div>
  ),
}
