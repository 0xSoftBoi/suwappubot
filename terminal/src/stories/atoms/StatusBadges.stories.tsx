import type { Meta, StoryObj } from '@storybook/react'
import type { ReactNode } from 'react'
import { TierBadge } from '../../components/points/TierBadge'
import { TrustScoreBadge } from '../../components/discover/TrustScoreBadge'

function BreezeShell({ children }: { children: ReactNode }) {
  return (
    <div
      className="relative overflow-hidden rounded-[36px] border border-[#E8D8B8] bg-[#FFFDF8] p-6 shadow-[0_28px_90px_rgba(58,39,28,0.08)]"
      style={{
        backgroundImage:
          'radial-gradient(circle at 18% 12%, rgba(247, 214, 145, 0.35), transparent 18%), radial-gradient(circle at 88% 20%, rgba(239, 199, 152, 0.18), transparent 20%), linear-gradient(180deg, #FFFEFB 0%, #FFF7EC 100%)',
      }}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#E9D2A5] to-transparent" />
      <div className="pointer-events-none absolute -left-8 top-10 h-24 w-24 rounded-full bg-[radial-gradient(circle,rgba(240,201,145,0.28),transparent_68%)] blur-2xl" />
      <div className="pointer-events-none absolute -right-10 bottom-6 h-28 w-28 rounded-full bg-[radial-gradient(circle,rgba(217,177,115,0.18),transparent_68%)] blur-2xl" />
      {children}
    </div>
  )
}

function BadgeGallery() {
  const tiers = [
    ['Bronze', 1200],
    ['Silver', 4800],
    ['Gold', 12000],
    ['Platinum', 28000],
    ['Diamond', 64000],
  ] as const

  const trustStates = [
    { score: 92, level: 'safe' as const },
    { score: 64, level: 'caution' as const },
    { score: 28, level: 'danger' as const },
  ]

  return (
    <BreezeShell>
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <div className="inline-flex rounded-full border border-[#E8D8B8] bg-white/90 px-3 py-1 text-[10px] uppercase tracking-[0.36em] text-[#A0814F]">
            Summer breeze
          </div>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-[#312117]">
            Badges with calmer white-space and softer gold tone
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#7F6A54]">
            A brighter editorial stage for rank, trust, and compact state chips.
          </p>
        </div>
        <div className="hidden rounded-2xl border border-[#E8D8B8] bg-white/80 px-3 py-2 text-right font-mono text-xs text-[#8E775D] md:block">
          <div className="uppercase tracking-[0.3em]">States</div>
          <div className="mt-1 text-base font-semibold text-[#3A281D]">8</div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-[28px] border border-[#E7DCC8] bg-white/95 p-4 shadow-[0_10px_30px_rgba(58,39,28,0.05)]">
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-[#342419]">Tier badges</h2>
            <p className="mt-1 text-xs leading-5 text-[#85705A]">
              Larger rank signifiers for profile and reward states.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
            {tiers.map(([tier, points]) => (
              <TierBadge key={tier} tier={tier} points={points} />
            ))}
          </div>
        </section>

        <section className="rounded-[28px] border border-[#E7DCC8] bg-white/95 p-4 shadow-[0_10px_30px_rgba(58,39,28,0.05)]">
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-[#342419]">Compact states</h2>
            <p className="mt-1 text-xs leading-5 text-[#85705A]">
              Dense label patterns for tables, rows, and trust indicators.
            </p>
          </div>
          <div className="mb-4 flex flex-wrap gap-2">
            {tiers.map(([tier, points]) => (
              <TierBadge key={`${tier}-compact`} tier={tier} points={points} compact />
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {trustStates.map((state) => (
              <TrustScoreBadge
                key={`${state.level}-${state.score}`}
                score={state.score}
                level={state.level}
              />
            ))}
          </div>
        </section>
      </div>
    </BreezeShell>
  )
}

const meta = {
  title: 'Atoms/Status Badges',
  tags: ['autodocs'],
  render: () => <BadgeGallery />,
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

export const AllStates: Story = {}

export const SummerBreeze: Story = {}
