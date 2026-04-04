import { useState } from 'react'
import type { ReactNode } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { SlippageControl } from '../../components/swap/SlippageControl'

function SummerBreezeFrame({
  children,
  value,
}: {
  children: ReactNode
  value: number
}) {
  return (
    <div
      className="relative overflow-hidden rounded-[36px] border border-[#E9DDC5] bg-[#FFFCF7] p-6 shadow-[0_24px_80px_rgba(58,39,28,0.08)]"
      style={{
        backgroundImage:
          'radial-gradient(circle at 20% 12%, rgba(248, 216, 147, 0.36), transparent 18%), radial-gradient(circle at 88% 22%, rgba(244, 197, 137, 0.22), transparent 20%), linear-gradient(180deg, #FFFDF9 0%, #FFF8EE 100%)',
      }}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#E9D2A5] to-transparent" />
      <div className="pointer-events-none absolute -right-12 top-10 h-36 w-36 rounded-full bg-[radial-gradient(circle,rgba(248,216,147,0.35),transparent_68%)] blur-2xl" />
      <div className="pointer-events-none absolute -left-10 bottom-4 h-28 w-28 rounded-full bg-[radial-gradient(circle,rgba(219,180,116,0.18),transparent_68%)] blur-2xl" />

      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <div className="inline-flex rounded-full border border-[#E8D8B8] bg-white/90 px-3 py-1 text-[10px] uppercase tracking-[0.36em] text-[#A0814F]">
            Summer breeze
          </div>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-[#312117]">
            Execution tolerance in a bright white study
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-[#7F6A54]">
            Inspect slippage states on a lighter surface with soft gold edges and calm contrast.
          </p>
        </div>
        <div className="hidden rounded-2xl border border-[#E8D8B8] bg-white/80 px-3 py-2 text-right font-mono text-xs text-[#8E775D] md:block">
          <div className="uppercase tracking-[0.3em]">Current</div>
          <div className="mt-1 text-base font-semibold text-[#3A281D]">{value.toFixed(2)}%</div>
        </div>
      </div>

      <div className="rounded-[28px] border border-[#E7DCC8] bg-white/95 p-4 shadow-[0_10px_30px_rgba(58,39,28,0.05)]">
        {children}
      </div>
    </div>
  )
}

function SlippagePlayground({ initialValue }: { initialValue: number }) {
  const [value, setValue] = useState(initialValue)

  return (
    <SummerBreezeFrame value={value}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[#342419]">Execution tolerance</h3>
          <p className="mt-1 text-xs leading-5 text-[#85705A]">
            A compact control with presets, custom entry, and softer summer-breeze contrast.
          </p>
        </div>
        <div className="rounded-full border border-[#E8D8B8] bg-[#FFF8EC] px-3 py-1 font-mono text-xs text-[#8E775D]">
          {value.toFixed(2)}%
        </div>
      </div>
      <SlippageControl value={value} onChange={setValue} />
    </SummerBreezeFrame>
  )
}

const meta = {
  title: 'Atoms/Slippage Control',
  tags: ['autodocs'],
  args: {
    initialValue: 0.5,
  },
  argTypes: {
    initialValue: {
      control: { type: 'number', min: 0, max: 5, step: 0.1 },
    },
  },
  render: ({ initialValue }) => <SlippagePlayground initialValue={initialValue} />,
} satisfies Meta<{ initialValue: number }>

export default meta

type Story = StoryObj<typeof meta>

export const Interactive: Story = {}

export const HighTolerance: Story = {
  args: {
    initialValue: 3,
  },
}

export const Precision: Story = {
  args: {
    initialValue: 0.1,
  },
}

export const SummerBreeze: Story = {
  args: {
    initialValue: 0.5,
  },
}
