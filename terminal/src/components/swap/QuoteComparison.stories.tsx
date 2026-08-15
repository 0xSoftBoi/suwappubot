import type { Meta, StoryObj } from "@storybook/react-vite";
import { QuoteComparison } from "./QuoteComparison";
import type { SwapQuote } from "../../types/api";

const baseQuote: SwapQuote = {
  id: "q-1",
  fromToken: {
    symbol: "WETH",
    name: "Wrapped Ether",
    address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    chain: "ethereum",
    decimals: 18,
  },
  toToken: {
    symbol: "USDC",
    name: "USD Coin",
    address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    chain: "ethereum",
    decimals: 6,
  },
  fromAmount: "10",
  toAmount: "18809.375976",
  fromAmountUsd: 18831.5,
  toAmountUsd: 18809.37,
  exchangeRate: 1880.9376,
  priceImpact: 0.04,
  estimatedGas: "0.081",
  gasUsd: 0.081,
  route: "propamm_titan",
  expiresAt: new Date(0).toISOString(),
  minReceived: "18715.329",
  slippage: 0.5,
  estimatedDuration: 15,
} as SwapQuote;

const meta = {
  title: "Swap/QuoteComparison",
  component: QuoteComparison,
  parameters: { layout: "centered" },
} satisfies Meta<typeof QuoteComparison>;

export default meta;
type Story = StoryObj<typeof meta>;

/** PropAMM wins with a measurable edge — label + savings row both visible. */
export const PropAmmWinsWithSavings: Story = {
  args: {
    quote: {
      ...baseQuote,
      priceImprovementUsd: 4.72,
      runnerUpProvider: "kyberswap",
    } as SwapQuote,
  },
};

/** No runner-up raced: the savings row must disappear entirely. */
export const NoSavingsRow: Story = {
  args: {
    quote: {
      ...baseQuote,
      route: "kyberswap",
      priceImprovementUsd: null,
      runnerUpProvider: null,
    } as SwapQuote,
  },
};

/** Sub-cent edge is suppressed — "$0.00 saved" would read as broken. */
export const SubCentEdgeSuppressed: Story = {
  args: {
    quote: {
      ...baseQuote,
      priceImprovementUsd: 0.004,
      runnerUpProvider: "lifi",
    } as SwapQuote,
  },
};

/** Unknown venue id falls back to the raw string rather than blanking. */
export const UnknownVenueFallback: Story = {
  args: {
    quote: {
      ...baseQuote,
      route: "some_new_venue",
      priceImprovementUsd: 12.5,
      runnerUpProvider: "0x_crosschain",
    } as SwapQuote,
  },
};
