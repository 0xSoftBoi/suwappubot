import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { TerminalExecutionTicket, type TerminalExecutionMode, type TerminalExecutionSide } from '../../components/trade/TerminalExecutionTicket'
import { TerminalMetricCard, TerminalPage, TerminalPanel, TerminalPanelHeader, TerminalStatusPill } from '../../components/foundation/TerminalPrimitives'
import { ethToKazeQuote, ethToken, kazeToken, solToKazeQuote, solToken } from '../_fixtures/terminal'

function StoryBoard({
  mode,
  side,
  routePack,
}: {
  mode: TerminalExecutionMode
  side: TerminalExecutionSide
  routePack: 'direct' | 'bridge'
}) {
  const [ticketMode, setTicketMode] = useState<TerminalExecutionMode>(mode)
  const [ticketSide, setTicketSide] = useState<TerminalExecutionSide>(side)
  const [amount, setAmount] = useState(routePack === 'direct' ? '0.75' : '18')
  const [slippage, setSlippage] = useState(routePack === 'direct' ? 0.45 : 1.2)
  const [showTpSl, setShowTpSl] = useState(ticketMode === 'swap')
  const [tpPrice, setTpPrice] = useState('1.02')
  const [slPrice, setSlPrice] = useState('0.74')
  const [limitPrice, setLimitPrice] = useState('0.79')
  const [expiry, setExpiry] = useState('24h')
  const [totalBudget, setTotalBudget] = useState('2400')
  const [frequency, setFrequency] = useState('daily')
  const [orderCount, setOrderCount] = useState('8')

  const quote = routePack === 'direct' ? ethToKazeQuote : solToKazeQuote
  const fromToken = routePack === 'direct' ? ethToken : solToken

  return (
    <TerminalPage>
      <div className="mx-auto grid max-w-5xl gap-4">
        <TerminalPanel elevated>
          <TerminalPanelHeader
            eyebrow={<TerminalStatusPill tone="warm">execution slice</TerminalStatusPill>}
            title="Terminal execution ticket"
            description="This is the provider-free execution desk rebuilt on the terminal theme layer. It stages execution intent, route quality, and CTA state in one reusable surface."
            meta={
              <TerminalMetricCard
                label="Route"
                value={routePack === 'direct' ? 'direct' : 'bridge'}
                tone={routePack === 'direct' ? 'sky' : 'warm'}
              />
            }
          />

          <TerminalExecutionTicket
            mode={ticketMode}
            side={ticketSide}
            fromToken={fromToken}
            toToken={kazeToken}
            amount={amount}
            onAmountChange={setAmount}
            quote={quote}
            onFlip={() => setAmount((current) => (current === '0.75' ? '1.25' : '0.75'))}
            onModeChange={(nextMode) => {
              setTicketMode(nextMode)
              setShowTpSl(nextMode === 'swap')
            }}
            onSideChange={setTicketSide}
            slippage={slippage}
            slippageOptions={[
              { value: 0.1, label: '0.1%' },
              { value: 0.45, label: '0.45%' },
              { value: 1.2, label: '1.2%' },
            ]}
            onSlippageChange={setSlippage}
            showTpSl={showTpSl}
            onToggleTpSl={() => setShowTpSl((current) => !current)}
            tpPrice={tpPrice}
            slPrice={slPrice}
            onTpPriceChange={setTpPrice}
            onSlPriceChange={setSlPrice}
            limitPrice={limitPrice}
            onLimitPriceChange={setLimitPrice}
            expiry={expiry}
            expiryOptions={[
              { id: '1h', label: '1h' },
              { id: '4h', label: '4h' },
              { id: '24h', label: '24h' },
            ]}
            onExpiryChange={setExpiry}
            totalBudget={totalBudget}
            onTotalBudgetChange={setTotalBudget}
            frequency={frequency}
            frequencyOptions={[
              { id: 'hourly', label: 'Hourly' },
              { id: 'daily', label: 'Daily' },
              { id: 'weekly', label: 'Weekly' },
            ]}
            onFrequencyChange={setFrequency}
            orderCount={orderCount}
            onOrderCountChange={setOrderCount}
          />
        </TerminalPanel>
      </div>
    </TerminalPage>
  )
}

const meta = {
  title: 'Organisms/Terminal Execution Ticket',
  parameters: {
    layout: 'fullscreen',
  },
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

export const DirectSwap: Story = {
  render: () => <StoryBoard mode="swap" side="buy" routePack="direct" />,
}

export const BridgeRoute: Story = {
  render: () => <StoryBoard mode="swap" side="buy" routePack="bridge" />,
}

export const DcaPlan: Story = {
  render: () => <StoryBoard mode="dca" side="buy" routePack="direct" />,
}
