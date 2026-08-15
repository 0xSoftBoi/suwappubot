import type { Meta, StoryObj } from '@storybook/react'
import { QuoteComparison } from '../../components/swap/QuoteComparison'
import { SummerBreezeStoryFrame, SummerBreezeSurface } from '../_components/SummerBreezeStoryFrame'
import { ethToUsdcQuote, solToUsdcQuote } from '../_fixtures/terminal'

function SummerBreezeQuoteBoard() {
  return (
    <SummerBreezeStoryFrame
      eyebrow="Terminal molecule"
      title="Quote detail cards for execution review"
      description="These cards sit under the swap inputs and explain route quality. Keeping them in Storybook makes it easier to rebalance density, warning colors, and route copy."
      metricLabel="Routes"
      metricValue="2 mocked quotes"
    >
      <div className="grid gap-4 xl:grid-cols-2">
        <SummerBreezeSurface
          title="Low-impact route"
          description="An ETH to USDC quote with clean execution and a short settlement window."
          meta="0.38% impact"
        >
          <QuoteComparison quote={ethToUsdcQuote} />
        </SummerBreezeSurface>
        <SummerBreezeSurface
          title="Cross-chain route"
          description="A higher-impact path that shows how the card handles longer duration and stronger warnings."
          meta="1.74% impact"
        >
          <QuoteComparison quote={solToUsdcQuote} />
        </SummerBreezeSurface>
      </div>
    </SummerBreezeStoryFrame>
  )
}

const meta = {
  title: 'Molecules/Quote Comparison',
  component: QuoteComparison,
  tags: ['autodocs'],
  args: {
    quote: ethToUsdcQuote,
  },
  render: (args) => (
    <div className="max-w-md">
      <QuoteComparison {...args} />
    </div>
  ),
} satisfies Meta<typeof QuoteComparison>

export default meta

type Story = StoryObj<typeof meta>

export const CleanRoute: Story = {}

export const CrossChain: Story = {
  args: {
    quote: solToUsdcQuote,
  },
}

export const SummerBreeze: Story = {
  render: () => <SummerBreezeQuoteBoard />,
}
