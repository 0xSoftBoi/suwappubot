import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { CreateAlertForm } from '../../components/alerts/CreateAlertForm'

type Submission = {
  tokenSymbol: string
  alertType: string
  targetValue: number
}

function SummerBreezeAlertBoard({
  isLoading,
  initialSubmission,
}: {
  isLoading: boolean
  initialSubmission: Submission | null
}) {
  const [lastSubmission, setLastSubmission] = useState<Submission | null>(initialSubmission)

  return (
    <div className="relative overflow-hidden rounded-[36px] border border-[#E8DEC9] bg-[#FFFDF8] p-6 shadow-[0_24px_80px_rgba(67,43,28,0.08)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_8%_12%,rgba(244,218,162,0.28),transparent_22%),radial-gradient(circle_at_94%_16%,rgba(255,195,140,0.18),transparent_20%),linear-gradient(180deg,#FFFDFB_0%,#FFF8EE_100%)]" />
      <div className="relative mb-5 max-w-2xl">
        <p className="text-[11px] uppercase tracking-[0.36em] text-[#AE9161]">Summer breeze molecule</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-[#2D211A]">
          Create alert states with a softer surface
        </h2>
        <p className="mt-2 text-sm leading-6 text-[#7A6653]">
          Keep the form readable while exposing submission feedback and loading behavior.
        </p>
      </div>

      <div className="relative grid gap-4 lg:grid-cols-[1fr_280px]">
        <section className="rounded-[28px] border border-[#E7DCC8] bg-white/96 p-4 shadow-[0_10px_30px_rgba(67,43,28,0.05)]">
          <CreateAlertForm isLoading={isLoading} onSubmit={setLastSubmission} />
        </section>
        <section className="rounded-[28px] border border-[#E7DCC8] bg-[#FFF9F0] p-4 shadow-[0_10px_30px_rgba(67,43,28,0.04)]">
          <h3 className="mb-2 text-sm font-semibold text-[#302219]">Submission state</h3>
          {lastSubmission ? (
            <pre className="overflow-auto rounded-2xl border border-[#E6DAC6] bg-white/95 p-3 text-xs text-[#3A2B22]">
              {JSON.stringify(lastSubmission, null, 2)}
            </pre>
          ) : (
            <p className="text-xs leading-5 text-[#8B775F]">
              Submit the form to inspect the captured state.
            </p>
          )}
        </section>
      </div>
    </div>
  )
}

const meta = {
  title: 'Molecules/Create Alert Form',
  tags: ['autodocs'],
  args: {
    isLoading: false,
    initialSubmission: null as Submission | null,
  },
  render: ({ isLoading, initialSubmission }) => (
    <SummerBreezeAlertBoard isLoading={isLoading} initialSubmission={initialSubmission} />
  ),
} satisfies Meta<{ isLoading: boolean; initialSubmission: Submission | null }>

export default meta

type Story = StoryObj<typeof meta>

export const Idle: Story = {}

export const Loading: Story = {
  args: {
    isLoading: true,
  },
}

export const RecentSubmission: Story = {
  args: {
    initialSubmission: {
      tokenSymbol: 'ETH',
      alertType: 'price_above',
      targetValue: 4200,
    },
  },
}
