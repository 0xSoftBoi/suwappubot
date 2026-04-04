import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { AddWalletForm } from '../../components/tracker/AddWalletForm'

type WalletSeed = {
  address: string
  label?: string
}

function SummerBreezeWalletBoard({ initialWallets }: { initialWallets: WalletSeed[] }) {
  const [trackedWallets, setTrackedWallets] = useState<WalletSeed[]>(initialWallets)

  return (
    <div className="relative overflow-hidden rounded-[36px] border border-[#E8DEC9] bg-[#FFFDF8] p-6 shadow-[0_24px_80px_rgba(67,43,28,0.08)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_10%_10%,rgba(244,218,162,0.28),transparent_24%),radial-gradient(circle_at_90%_15%,rgba(255,194,143,0.18),transparent_22%),linear-gradient(180deg,#FFFEFB_0%,#FFF8ED_100%)]" />
      <div className="relative mb-5 max-w-2xl">
        <p className="text-[11px] uppercase tracking-[0.36em] text-[#AE9161]">Summer breeze molecule</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-[#2D211A]">
          Track wallets in a brighter study
        </h2>
        <p className="mt-2 text-sm leading-6 text-[#7A6653]">
          Add addresses, keep labels close, and inspect the evolving list on a calm white surface.
        </p>
      </div>

      <div className="relative grid gap-4 lg:grid-cols-[1fr_320px]">
        <section className="rounded-[28px] border border-[#E7DCC8] bg-white/96 p-4 shadow-[0_10px_30px_rgba(67,43,28,0.05)]">
          <AddWalletForm
            onAdd={(address, label) => {
              setTrackedWallets((current) => [...current, { address, label }])
            }}
          />
        </section>
        <section className="rounded-[28px] border border-[#E7DCC8] bg-[#FFF9F0] p-4 shadow-[0_10px_30px_rgba(67,43,28,0.04)]">
          <div className="mb-3">
            <h3 className="text-sm font-semibold text-[#302219]">Tracked wallets</h3>
            <p className="mt-1 text-xs leading-5 text-[#826C57]">
              A quiet list for addresses, labels, and quick review.
            </p>
          </div>
          {trackedWallets.length > 0 ? (
            <ul className="grid gap-2">
              {trackedWallets.map((wallet) => (
                <li
                  key={`${wallet.address}-${wallet.label ?? ''}`}
                  className="rounded-2xl border border-[#E6DAC6] bg-white/95 p-3"
                >
                  <div className="font-mono text-xs text-[#2F221B]">{wallet.address}</div>
                  {wallet.label ? (
                    <div className="mt-1 text-[11px] text-[#8B775F]">{wallet.label}</div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs leading-5 text-[#8B775F]">
              Add an EVM or Solana address to inspect form output and validation.
            </p>
          )}
        </section>
      </div>
    </div>
  )
}

const meta = {
  title: 'Molecules/Add Wallet Form',
  tags: ['autodocs'],
  args: {
    initialWallets: [] as WalletSeed[],
  },
  render: ({ initialWallets }) => <SummerBreezeWalletBoard initialWallets={initialWallets} />,
} satisfies Meta<{ initialWallets: WalletSeed[] }>

export default meta

type Story = StoryObj<typeof meta>

export const Idle: Story = {}

export const Seeded: Story = {
  args: {
    initialWallets: [
      { address: '0x3b6d7d2f8f6f3a9f2b4f7a1b3c6d8e9f1a2b3c4d', label: 'Vault' },
      { address: 'So11111111111111111111111111111111111111112', label: 'Solana float' },
    ],
  },
}
