import type { Meta, StoryObj } from '@storybook/react'
import { AnimatedNumber } from '../../components/swap/AnimatedNumber'

const meta = {
  title: 'Swap/AnimatedNumber',
  component: AnimatedNumber,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
  argTypes: {
    value: { control: { type: 'range', min: 0, max: 10000, step: 0.01 } },
    format: {
      control: 'select',
      options: ['currency', 'percent', 'token', 'compact'],
    },
    size: {
      control: 'radio',
      options: ['sm', 'md', 'lg'],
    },
    colorChange: { control: 'boolean' },
    prefix: { control: 'text' },
    suffix: { control: 'text' },
    decimals: { control: { type: 'number', min: 0, max: 10 } },
  },
} satisfies Meta<typeof AnimatedNumber>

export default meta
type Story = StoryObj<typeof meta>

export const Currency: Story = {
  args: {
    value: 1234.56,
    format: 'currency',
    prefix: '$',
    size: 'md',
  },
  argTypes: {
    value: { control: { type: 'range', min: 0, max: 10000, step: 0.01 } },
  },
}

export const Percent: Story = {
  args: {
    value: 12.5,
    format: 'percent',
    suffix: '%',
    size: 'md',
  },
  argTypes: {
    value: { control: { type: 'range', min: -100, max: 100, step: 0.1 } },
  },
}

export const TokenAmount: Story = {
  args: {
    value: 1.234567,
    format: 'token',
    suffix: ' ETH',
    size: 'md',
  },
  argTypes: {
    value: { control: { type: 'range', min: 0, max: 100, step: 0.000001 } },
  },
}

export const CompactNumber: Story = {
  args: {
    value: 1200000,
    format: 'compact',
    prefix: '$',
    size: 'md',
  },
  argTypes: {
    value: { control: { type: 'range', min: 0, max: 5000000000, step: 100000 } },
  },
}

export const ColorChange: Story = {
  args: {
    value: 1500,
    format: 'currency',
    prefix: '$',
    colorChange: true,
    size: 'lg',
  },
  argTypes: {
    value: { control: { type: 'range', min: 0, max: 10000, step: 0.01 } },
  },
}

export const AllSizes: Story = {
  args: {} as any,
  render: () => (
    <div className="flex flex-col gap-4">
      {(['sm', 'md', 'lg'] as const).map((size) => (
        <div key={size} className="flex items-center gap-3">
          <span className="text-xs text-suwappu-text-secondary w-8">{size}</span>
          <AnimatedNumber value={1234.56} format="currency" prefix="$" size={size} />
        </div>
      ))}
    </div>
  ),
}

export const Loading: Story = {
  args: {
    value: 0,
    format: 'currency',
    prefix: '$',
    size: 'md',
  },
}

export const NegativeValue: Story = {
  args: {
    value: -523.18,
    format: 'currency',
    prefix: '-$',
    colorChange: true,
    size: 'lg',
  },
  argTypes: {
    value: { control: { type: 'range', min: -10000, max: 0, step: 0.01 } },
  },
}
