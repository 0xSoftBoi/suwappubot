import { useState } from 'react'
import type { ReactNode } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { AddWalletForm } from '../../components/tracker/AddWalletForm'
import { CreateAlertForm } from '../../components/alerts/CreateAlertForm'
import { AlertCard } from '../../components/alerts/AlertCard'
import { WatchlistItem } from '../../components/watchlist/WatchlistItem'
import { PersimmonMark } from '../../components/brand/PersimmonLogo'
import { SlippageControl } from '../../components/swap/SlippageControl'
import { TierBadge } from '../../components/points/TierBadge'
import { TrustScoreBadge } from '../../components/discover/TrustScoreBadge'
import type { Alert } from '../../types/api'
import type { WatchlistToken } from '../../hooks/useWatchlist'
import type { TokenPriceData } from '../../hooks/useWatchlistPrices'

type WalletSeed = {
  address: string
  label?: string
}

const walletSeeds: WalletSeed[] = [
  { address: '0x3b6d7d2f8f6f3a9f2b4f7a1b3c6d8e9f1a2b3c4d', label: 'Treasury lane' },
  { address: 'So11111111111111111111111111111111111111112', label: 'Solana float' },
]

const watchlistRows: Array<{ token: WatchlistToken; priceData: TokenPriceData }> = [
  {
    token: {
      symbol: 'ETH',
      name: 'Ethereum',
      address: '0x0000000000000000000000000000000000000001',
      chain: 'ethereum',
    },
    priceData: {
      price: 3488.11,
      change24h: 2.41,
      loading: false,
    },
  },
  {
    token: {
      symbol: 'SOL',
      name: 'Solana',
      address: 'So11111111111111111111111111111111111111112',
      chain: 'solana',
    },
    priceData: {
      price: 182.34,
      change24h: -1.18,
      loading: false,
    },
  },
  {
    token: {
      symbol: 'JUP',
      name: 'Jupiter',
      address: 'JUP111111111111111111111111111111111111111',
      chain: 'solana',
    },
    priceData: {
      price: null,
      change24h: null,
      loading: true,
    },
  },
]

const alertSeeds: Alert[] = [
  {
    id: 'alert-eth-1',
    tokenSymbol: 'ETH',
    tokenAddress: '0x0000000000000000000000000000000000000000',
    chain: 'ethereum',
    alertType: 'price_above',
    targetValue: 4200,
    currentPrice: 3985.22,
    status: 'active',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'alert-sol-2',
    tokenSymbol: 'SOL',
    tokenAddress: 'So11111111111111111111111111111111111111112',
    chain: 'solana',
    alertType: 'volume_spike',
    targetValue: 2500000,
    currentPrice: 182.5,
    status: 'triggered',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'alert-btc-3',
    tokenSymbol: 'BTC',
    tokenAddress: '0x0000000000000000000000000000000000000002',
    chain: 'base',
    alertType: 'price_below',
    targetValue: 64000,
    currentPrice: 66240,
    status: 'inactive',
    createdAt: new Date().toISOString(),
  },
]

function StoryShell({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <div className="relative overflow-hidden rounded-[40px] border border-[#e8dec9] bg-[#fffdf8] p-6 shadow-[0_24px_80px_rgba(67,43,28,0.08)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_8%_10%,rgba(244,218,162,0.28),transparent_18%),radial-gradient(circle_at_92%_16%,rgba(154,218,228,0.22),transparent_18%),linear-gradient(180deg,#fffefb_0%,#fff8ed_42%,#edf8fb_100%)]" />
      <div className="pointer-events-none absolute right-[-24px] top-[-18px] opacity-20">
        <PersimmonMark
          size={120}
          palette="butter"
          variant="orchard"
          shell="coin"
          frame="none"
          cutoutMode="none"
          leafCount={4}
          withGlow={false}
          leftGlyph="USDC"
          rightGlyph="CircleYEN"
        />
      </div>
      <div className="relative mb-6 max-w-3xl">
        <div className="inline-flex rounded-full border border-[#e8d8b8] bg-white/90 px-3 py-1 text-[10px] uppercase tracking-[0.34em] text-[#a0814f]">
          {eyebrow}
        </div>
        <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-[#2d211a]">
          {title}
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[#7a6653]">{description}</p>
      </div>
      <div className="relative">{children}</div>
    </div>
  )
}

function SurfaceCard({
  title,
  meta,
  children,
}: {
  title: string
  meta?: string
  children: ReactNode
}) {
  return (
    <section className="rounded-[30px] border border-[#e7dcc8] bg-white/96 p-4 shadow-[0_10px_30px_rgba(67,43,28,0.05)]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-[#302219]">{title}</h3>
        {meta ? (
          <span className="rounded-full border border-[#ece0cb] bg-[#fff9f0] px-2.5 py-1 text-[10px] uppercase tracking-[0.22em] text-[#8b775f]">
            {meta}
          </span>
        ) : null}
      </div>
      {children}
    </section>
  )
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[#ece0cb] bg-[#fff9f0] px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.2em] text-[#8b775f]">{label}</div>
      <div className="mt-1 text-sm font-semibold text-[#2f221b]">{value}</div>
    </div>
  )
}

function TrackingGardenBoard() {
  const [wallets, setWallets] = useState(walletSeeds)

  return (
    <StoryShell
      eyebrow="Organism"
      title="Tracking garden"
      description="The wallet entry form and the watchlist rail now live as one operating surface, with a calm summer-breeze hierarchy."
    >
      <div className="grid gap-4 xl:grid-cols-[1.1fr_1.4fr]">
        <SurfaceCard title="Wallet intake" meta={`${wallets.length} tracked`}>
          <AddWalletForm
            onAdd={(address, label) => {
              setWallets((current) => [...current, { address, label }])
            }}
          />
          <div className="mt-4 grid gap-2">
            {wallets.map((wallet) => (
              <div
                key={`${wallet.address}-${wallet.label ?? ''}`}
                className="rounded-2xl border border-[#ece0cb] bg-[#fffdf9] p-3"
              >
                <div className="font-mono text-xs text-[#2f221b]">{wallet.address}</div>
                {wallet.label ? (
                  <div className="mt-1 text-[11px] text-[#8b775f]">{wallet.label}</div>
                ) : null}
              </div>
            ))}
          </div>
        </SurfaceCard>

        <SurfaceCard title="Watchlist rail" meta="3 market reads">
          <div className="grid gap-2 rounded-[24px] border border-[#f0e3d0] bg-[#fffdfb] p-2">
            {watchlistRows.map((row) => (
              <div
                key={row.token.address}
                className="rounded-2xl border border-[#f0e3d0] bg-white/98 px-1"
              >
                <WatchlistItem
                  token={row.token}
                  priceData={row.priceData}
                  onRemove={() => undefined}
                  onClick={() => undefined}
                />
              </div>
            ))}
          </div>
        </SurfaceCard>
      </div>
    </StoryShell>
  )
}

function AlertAtelierBoard() {
  const [alerts, setAlerts] = useState(alertSeeds)

  return (
    <StoryShell
      eyebrow="Organism"
      title="Alert atelier"
      description="Creation and review now sit in the same organism, with live submissions dropping straight into the active board."
    >
      <div className="grid gap-4 xl:grid-cols-[1.05fr_1.35fr]">
        <SurfaceCard title="Create alert" meta="Price and volume">
          <CreateAlertForm
            isLoading={false}
            onSubmit={(submission) => {
              setAlerts((current) => [
                {
                  id: `alert-${submission.tokenSymbol.toLowerCase()}-${current.length + 1}`,
                  tokenSymbol: submission.tokenSymbol,
                  tokenAddress: `draft-${submission.tokenSymbol.toLowerCase()}`,
                  chain: 'ethereum',
                  alertType: submission.alertType,
                  targetValue: submission.targetValue,
                  currentPrice: undefined,
                  status: 'active',
                  createdAt: new Date().toISOString(),
                },
                ...current,
              ])
            }}
          />
        </SurfaceCard>

        <SurfaceCard title="Alert stack" meta={`${alerts.length} states`}>
          <div className="grid gap-3">
            {alerts.map((alert) => (
              <AlertCard
                key={alert.id}
                alert={alert}
                onDelete={(id) => {
                  setAlerts((current) => current.filter((entry) => entry.id !== id))
                }}
              />
            ))}
          </div>
        </SurfaceCard>
      </div>
    </StoryShell>
  )
}

function OperatorBoard() {
  const [wallets, setWallets] = useState(walletSeeds)
  const [alerts, setAlerts] = useState(alertSeeds)

  return (
    <StoryShell
      eyebrow="Organism"
      title="Operator board"
      description="This is the first real organism pass: wallets, watchlist, and alerts arranged as one editorial operating page instead of isolated molecules."
    >
      <div className="grid gap-4 xl:grid-cols-[0.95fr_1.15fr_1.15fr]">
        <SurfaceCard title="Wallet lane" meta={`${wallets.length} tracked`}>
          <AddWalletForm
            onAdd={(address, label) => {
              setWallets((current) => [...current, { address, label }])
            }}
          />
          <div className="mt-4 grid gap-2">
            {wallets.map((wallet) => (
              <div
                key={`${wallet.address}-${wallet.label ?? ''}`}
                className="rounded-2xl border border-[#ece0cb] bg-[#fffdf9] p-3"
              >
                <div className="font-mono text-xs text-[#2f221b]">{wallet.address}</div>
                {wallet.label ? (
                  <div className="mt-1 text-[11px] text-[#8b775f]">{wallet.label}</div>
                ) : null}
              </div>
            ))}
          </div>
        </SurfaceCard>

        <SurfaceCard title="Watchlist pulse" meta="Live scan">
          <div className="grid gap-2 rounded-[24px] border border-[#f0e3d0] bg-[#fffdfb] p-2">
            {watchlistRows.map((row) => (
              <div
                key={row.token.address}
                className="rounded-2xl border border-[#f0e3d0] bg-white/98 px-1"
              >
                <WatchlistItem
                  token={row.token}
                  priceData={row.priceData}
                  onRemove={() => undefined}
                  onClick={() => undefined}
                />
              </div>
            ))}
          </div>
        </SurfaceCard>

        <SurfaceCard title="Alert flow" meta={`${alerts.length} queued`}>
          <CreateAlertForm
            isLoading={false}
            onSubmit={(submission) => {
              setAlerts((current) => [
                {
                  id: `alert-${submission.tokenSymbol.toLowerCase()}-${current.length + 1}`,
                  tokenSymbol: submission.tokenSymbol,
                  tokenAddress: `draft-${submission.tokenSymbol.toLowerCase()}`,
                  chain: 'ethereum',
                  alertType: submission.alertType,
                  targetValue: submission.targetValue,
                  currentPrice: undefined,
                  status: 'active',
                  createdAt: new Date().toISOString(),
                },
                ...current,
              ])
            }}
          />
          <div className="mt-4 grid gap-3">
            {alerts.slice(0, 3).map((alert) => (
              <AlertCard
                key={alert.id}
                alert={alert}
                onDelete={(id) => {
                  setAlerts((current) => current.filter((entry) => entry.id !== id))
                }}
              />
            ))}
          </div>
        </SurfaceCard>
      </div>
    </StoryShell>
  )
}

function ExecutionCabanaBoard() {
  const [slippage, setSlippage] = useState(0.5)

  return (
    <StoryShell
      eyebrow="Organism"
      title="Execution cabana"
      description="This organism leans into execution: risk tuning, trust readouts, and the active market rail all in one calmer summer-breeze board."
    >
      <div className="grid gap-4 xl:grid-cols-[1.05fr_1.25fr]">
        <SurfaceCard title="Swap tuning" meta="Execution">
          <div className="grid gap-4">
            <div className="rounded-[24px] border border-[#ece0cb] bg-[#fffdf9] p-4">
              <SlippageControl value={slippage} onChange={setSlippage} />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <MetricPill label="Tolerance" value={`${slippage.toFixed(2)}%`} />
              <MetricPill label="Route" value="Circle USDC" />
              <MetricPill label="Venue" value="Tokyo hours" />
            </div>
            <div className="flex flex-wrap gap-2">
              <TierBadge tier="Gold" points={12000} compact />
              <TierBadge tier="Diamond" points={64000} compact />
              <TrustScoreBadge score={92} level="safe" />
              <TrustScoreBadge score={64} level="caution" />
            </div>
          </div>
        </SurfaceCard>

        <SurfaceCard title="Market rail" meta="3 active reads">
          <div className="grid gap-2 rounded-[24px] border border-[#f0e3d0] bg-[#fffdfb] p-2">
            {watchlistRows.map((row) => (
              <div
                key={row.token.address}
                className="rounded-2xl border border-[#f0e3d0] bg-white/98 px-1"
              >
                <WatchlistItem
                  token={row.token}
                  priceData={row.priceData}
                  onRemove={() => undefined}
                  onClick={() => undefined}
                />
              </div>
            ))}
          </div>
        </SurfaceCard>
      </div>
    </StoryShell>
  )
}

function SignalConservatoryBoard() {
  const [alerts, setAlerts] = useState(alertSeeds)

  return (
    <StoryShell
      eyebrow="Organism"
      title="Signal conservatory"
      description="A brighter signal page that mixes summary badges, alert creation, active rules, and price rails in one editorial frame."
    >
      <div className="grid gap-4 xl:grid-cols-[1.1fr_1.25fr]">
        <div className="grid gap-4">
          <SurfaceCard title="Signal profile" meta="Health">
            <div className="grid gap-3 sm:grid-cols-3">
              <MetricPill label="Coverage" value="9 chains" />
              <MetricPill label="Pairs" value="27 live" />
              <MetricPill label="Cadence" value="5 min" />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <TierBadge tier="Platinum" points={28000} compact />
              <TrustScoreBadge score={92} level="safe" />
              <TrustScoreBadge score={71} level="caution" />
              <TrustScoreBadge score={28} level="danger" />
            </div>
          </SurfaceCard>

          <SurfaceCard title="Create alert" meta="Trigger design">
            <CreateAlertForm
              isLoading={false}
              onSubmit={(submission) => {
                setAlerts((current) => [
                  {
                    id: `alert-${submission.tokenSymbol.toLowerCase()}-${current.length + 1}`,
                    tokenSymbol: submission.tokenSymbol,
                    tokenAddress: `draft-${submission.tokenSymbol.toLowerCase()}`,
                    chain: 'ethereum',
                    alertType: submission.alertType,
                    targetValue: submission.targetValue,
                    currentPrice: undefined,
                    status: 'active',
                    createdAt: new Date().toISOString(),
                  },
                  ...current,
                ])
              }}
            />
          </SurfaceCard>
        </div>

        <SurfaceCard title="Signal stack" meta={`${alerts.length} rules`}>
          <div className="grid gap-3">
            {alerts.slice(0, 2).map((alert) => (
              <AlertCard
                key={alert.id}
                alert={alert}
                onDelete={(id) => {
                  setAlerts((current) => current.filter((entry) => entry.id !== id))
                }}
              />
            ))}
          </div>
          <div className="mt-4 grid gap-2 rounded-[24px] border border-[#f0e3d0] bg-[#fffdfb] p-2">
            {watchlistRows.slice(0, 2).map((row) => (
              <div
                key={row.token.address}
                className="rounded-2xl border border-[#f0e3d0] bg-white/98 px-1"
              >
                <WatchlistItem
                  token={row.token}
                  priceData={row.priceData}
                  onRemove={() => undefined}
                  onClick={() => undefined}
                />
              </div>
            ))}
          </div>
        </SurfaceCard>
      </div>
    </StoryShell>
  )
}

function MorningBriefBoard() {
  const [slippage, setSlippage] = useState(1)

  return (
    <StoryShell
      eyebrow="Organism"
      title="Morning brief"
      description="A denser operator snapshot for the start of the day: wallet intake, market read, trust and slippage all compressed into one page organism."
    >
      <div className="grid gap-4 xl:grid-cols-[0.95fr_1.1fr_0.95fr]">
        <SurfaceCard title="Wallet intake" meta="Quick add">
          <AddWalletForm onAdd={() => undefined} />
          <div className="mt-4 grid gap-2">
            {walletSeeds.map((wallet) => (
              <div
                key={`${wallet.address}-${wallet.label ?? ''}`}
                className="rounded-2xl border border-[#ece0cb] bg-[#fffdf9] p-3"
              >
                <div className="font-mono text-xs text-[#2f221b]">{wallet.address}</div>
                {wallet.label ? (
                  <div className="mt-1 text-[11px] text-[#8b775f]">{wallet.label}</div>
                ) : null}
              </div>
            ))}
          </div>
        </SurfaceCard>

        <SurfaceCard title="Pulse rail" meta="Watchlist">
          <div className="grid gap-2 rounded-[24px] border border-[#f0e3d0] bg-[#fffdfb] p-2">
            {watchlistRows.map((row) => (
              <div
                key={row.token.address}
                className="rounded-2xl border border-[#f0e3d0] bg-white/98 px-1"
              >
                <WatchlistItem
                  token={row.token}
                  priceData={row.priceData}
                  onRemove={() => undefined}
                  onClick={() => undefined}
                />
              </div>
            ))}
          </div>
        </SurfaceCard>

        <SurfaceCard title="Readiness" meta="Risk">
          <div className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <MetricPill label="Window" value="Asia open" />
              <MetricPill label="Mode" value="Agent ready" />
            </div>
            <div className="rounded-[24px] border border-[#ece0cb] bg-[#fffdf9] p-4">
              <SlippageControl value={slippage} onChange={setSlippage} />
            </div>
            <div className="flex flex-wrap gap-2">
              <TierBadge tier="Gold" points={12000} compact />
              <TrustScoreBadge score={92} level="safe" />
              <TrustScoreBadge score={64} level="caution" />
            </div>
            <div className="grid gap-3">
              {alertSeeds.slice(0, 2).map((alert) => (
                <AlertCard key={alert.id} alert={alert} onDelete={() => undefined} />
              ))}
            </div>
          </div>
        </SurfaceCard>
      </div>
    </StoryShell>
  )
}

const meta = {
  title: 'Organisms/Summer Breeze Workspaces',
  tags: ['autodocs'],
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

export const TrackingGarden: Story = {
  render: () => <TrackingGardenBoard />,
}

export const AlertAtelier: Story = {
  render: () => <AlertAtelierBoard />,
}

export const OperatorBoardStory: Story = {
  name: 'Operator Board',
  render: () => <OperatorBoard />,
}

export const ExecutionCabana: Story = {
  render: () => <ExecutionCabanaBoard />,
}

export const SignalConservatory: Story = {
  render: () => <SignalConservatoryBoard />,
}

export const MorningBrief: Story = {
  render: () => <MorningBriefBoard />,
}
