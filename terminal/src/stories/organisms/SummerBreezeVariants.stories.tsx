import { useState } from "react";
import type { ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { AddWalletForm } from "../../components/tracker/AddWalletForm";
import { CreateAlertForm } from "../../components/alerts/CreateAlertForm";
import { AlertCard } from "../../components/alerts/AlertCard";
import { WatchlistItem } from "../../components/watchlist/WatchlistItem";
import { SuggestedCommands } from "../../components/copilot/SuggestedCommands";
import { ChatMessage } from "../../components/copilot/ChatMessage";
import { SlippageControl } from "../../components/swap/SlippageControl";
import { QuoteCard } from "../../components/copilot/QuoteCard";
import {
  PersimmonMark,
  SakuraBloomMotif,
} from "../../components/brand/PersimmonLogo";
import type { Alert } from "../../types/api";
import type { WatchlistToken } from "../../hooks/useWatchlist";
import type { TokenPriceData } from "../../hooks/useWatchlistPrices";

function joinClasses(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

type WalletSeed = {
  address: string;
  label?: string;
};

const walletSeeds: WalletSeed[] = [
  {
    address: "0x3b6d7d2f8f6f3a9f2b4f7a1b3c6d8e9f1a2b3c4d",
    label: "Treasury lane",
  },
  {
    address: "So11111111111111111111111111111111111111112",
    label: "Solana float",
  },
];

const watchlistRows: Array<{
  token: WatchlistToken;
  priceData: TokenPriceData;
}> = [
  {
    token: {
      symbol: "ETH",
      name: "Ethereum",
      address: "0x0000000000000000000000000000000000000001",
      chain: "ethereum",
    },
    priceData: {
      price: 3488.11,
      change24h: 2.41,
      loading: false,
    },
  },
  {
    token: {
      symbol: "SOL",
      name: "Solana",
      address: "So11111111111111111111111111111111111111112",
      chain: "solana",
    },
    priceData: {
      price: 182.34,
      change24h: -1.18,
      loading: false,
    },
  },
  {
    token: {
      symbol: "JUP",
      name: "Jupiter",
      address: "JUP111111111111111111111111111111111111111",
      chain: "solana",
    },
    priceData: {
      price: null,
      change24h: null,
      loading: true,
    },
  },
];

const alertSeeds: Alert[] = [
  {
    id: "alert-eth-1",
    tokenSymbol: "ETH",
    tokenAddress: "0x0000000000000000000000000000000000000000",
    chain: "ethereum",
    alertType: "price_above",
    targetValue: 4200,
    currentPrice: 3985.22,
    status: "active",
    createdAt: new Date().toISOString(),
  },
  {
    id: "alert-sol-2",
    tokenSymbol: "SOL",
    tokenAddress: "So11111111111111111111111111111111111111112",
    chain: "solana",
    alertType: "volume_spike",
    targetValue: 2500000,
    currentPrice: 182.5,
    status: "triggered",
    createdAt: new Date().toISOString(),
  },
];

function MetaPill({ children }: { children: ReactNode }) {
  return (
    <span className="terminal-theme-pill terminal-theme-caption border border-terminal-border bg-terminal-bg-secondary px-2.5 py-1 text-[9px] uppercase text-terminal-text-muted">
      {children}
    </span>
  );
}

function ContentInset({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={joinClasses(
        "terminal-theme-inset p-[var(--terminal-space-inset)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

function ContentCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={joinClasses(
        "terminal-theme-card p-[var(--terminal-space-card)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

function SummerBreezeShell({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="terminal-theme-panel terminal-theme-panel-elevated p-[var(--terminal-space-page)]">
      <div className="terminal-theme-heading mb-3 text-sm font-semibold text-terminal-text">
        {eyebrow}
      </div>
      <div
        className="relative overflow-hidden rounded-[18px] border"
        style={{
          minHeight: 860,
          borderColor: "#d7e6ef",
          background:
            "linear-gradient(180deg, #fdfcf8 0%, #fffefb 18%, #f7fcff 18%, #d9f1f3 52%, #bde0e6 100%)",
        }}
      >
        <div className="absolute inset-y-5 left-5 w-[86px] rounded-[12px] border border-white/84 bg-white/88 shadow-[0_16px_40px_rgba(88,142,162,0.12)] md:inset-y-8 md:left-8 md:w-[132px] md:rounded-[14px]" />
        <div className="absolute left-[16px] top-[30px] md:left-[24px] md:top-[40px]">
          <div className="rounded-full border border-[#bfe6ef] bg-white/82 px-2.5 py-1 text-[9px] uppercase tracking-[0.28em] text-[#57a9bc] md:px-3 md:text-[10px]">
            summer breeze
          </div>
        </div>
        <div className="absolute inset-y-[76px] left-[20px] flex items-center md:inset-y-[90px] md:left-[34px]">
          <div
            className="text-[52px] font-semibold leading-none tracking-[-0.05em] text-[#16b8d1] md:text-[74px]"
            style={{
              fontFamily:
                "'Hiragino Sans', 'Yu Gothic', 'Noto Sans JP', sans-serif",
              writingMode: "vertical-rl",
              textOrientation: "mixed",
            }}
          >
            すわっぷ
          </div>
        </div>
        <div
          className="absolute bottom-[170px] left-[74px] text-[56px] leading-none text-white/28 md:bottom-[116px] md:left-[118px] md:text-[88px]"
          style={{
            fontFamily:
              "'Hiragino Sans', 'Yu Gothic', 'Noto Sans JP', sans-serif",
            writingMode: "vertical-rl",
            textOrientation: "mixed",
            transform: "rotate(8deg)",
            filter: "blur(0.2px)",
          }}
        >
          すわっぷ
        </div>

        <div
          className="absolute bottom-[18px] left-[100px] right-[18px] top-[18px] overflow-hidden rounded-[12px] border border-white/70 md:bottom-[28px] md:left-[160px] md:right-[28px] md:top-[28px] md:rounded-[16px]"
          style={{
            background:
              "radial-gradient(circle at 75% 24%, rgba(255,214,182,0.52), transparent 12%), radial-gradient(circle at 68% 14%, rgba(255,192,162,0.36), transparent 8%), linear-gradient(180deg, rgba(153,214,228,0.9) 0%, rgba(144,208,223,0.92) 26%, rgba(209,242,239,0.72) 54%, rgba(196,235,230,0.86) 100%)",
          }}
        >
          <div
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(circle at 22% 18%, rgba(255,255,255,0.48), transparent 18%), linear-gradient(180deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0) 38%, rgba(255,255,255,0.18) 52%, rgba(255,255,255,0.04) 100%)",
            }}
          />
          <div
            className="absolute bottom-[-6%] right-[8%] h-[44%] w-[24%] rounded-[45%] md:bottom-[-2%] md:right-[10%] md:h-[54%] md:w-[28%]"
            style={{
              background:
                "linear-gradient(180deg, rgba(198,245,246,0.94) 0%, rgba(149,219,224,0.98) 100%)",
              filter: "blur(0.4px)",
              transform: "rotate(14deg)",
            }}
          />
          <div
            className="absolute right-[18%] top-[30%] h-[10%] w-[7%] rounded-full border border-white/70 bg-white/18 md:right-[20%] md:top-[28%]"
            style={{ transform: "rotate(-6deg)" }}
          />
          <div className="absolute left-[14%] top-[10%] opacity-18 md:left-[12%] md:top-[8%]">
            <SakuraBloomMotif size={110} tone="soft" rotation={-10} />
          </div>
          <div className="absolute right-[10%] top-[12%] hidden opacity-12 md:block">
            <SakuraBloomMotif size={132} tone="mist" rotation={18} />
          </div>
          <div className="absolute left-[10%] top-[14%] opacity-34 md:left-[12%] md:top-[12%]">
            <PersimmonMark
              size={62}
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
          <div className="absolute left-[44%] top-[4%] hidden opacity-26 blur-[1px] sm:block">
            <PersimmonMark
              size={84}
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
          <div className="absolute right-[2%] top-[8%] opacity-26 blur-[3px] md:opacity-34">
            <PersimmonMark
              size={108}
              palette="butter"
              variant="orchard"
              shell="fuyu"
              frame="none"
              cutoutMode="none"
              leafCount={4}
              withGlow={false}
              leftGlyph="USDC"
              rightGlyph="CircleYEN"
            />
          </div>

          <div className="relative z-10 flex h-full flex-col justify-between p-4 md:p-6">
            <div className="max-w-xl">
              <div className="rounded-full border border-white/70 bg-white/40 px-3 py-1 text-[10px] uppercase tracking-[0.28em] text-[#5b90a4] backdrop-blur-sm">
                {eyebrow}
              </div>
              <h2 className="mt-4 text-3xl font-semibold tracking-[-0.05em] text-[#243848] md:text-5xl">
                {title}
              </h2>
              <p className="mt-3 max-w-lg text-sm leading-6 text-[#456677] md:text-base">
                {description}
              </p>
            </div>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

function GlassCard({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={joinClasses(
        "terminal-theme-card p-[var(--terminal-space-panel)] supports-[backdrop-filter]:backdrop-blur-md",
        className,
      )}
    >
      {children}
    </div>
  );
}

function ConciergeBoard() {
  const [wallets, setWallets] = useState(walletSeeds);

  return (
    <SummerBreezeShell
      eyebrow="concierge organism"
      title="Drifting concierge"
      description="Wallet intake and watchlist care, re-staged inside the summer-breeze frame instead of a dense utilitarian dashboard."
    >
      <div className="grid gap-4 lg:grid-cols-[0.9fr_1.35fr]">
        <GlassCard className="lg:translate-y-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="terminal-theme-heading text-sm font-semibold text-terminal-text">
              Wallet intake
            </h3>
            <MetaPill>{wallets.length} tracked</MetaPill>
          </div>
          <AddWalletForm
            onAdd={(address, label) => {
              setWallets((current) => [...current, { address, label }]);
            }}
          />
          <div className="mt-4 grid gap-2">
            {wallets.map((wallet) => (
              <ContentCard key={`${wallet.address}-${wallet.label ?? ""}`}>
                <div className="min-w-0 break-all font-mono text-xs leading-5 text-terminal-text">
                  {wallet.address}
                </div>
                {wallet.label ? (
                  <div className="mt-1 text-[11px] text-terminal-text-secondary">
                    {wallet.label}
                  </div>
                ) : null}
              </ContentCard>
            ))}
          </div>
        </GlassCard>

        <GlassCard className="lg:translate-y-10">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="terminal-theme-heading text-sm font-semibold text-terminal-text">
              Watchlist breeze
            </h3>
            <MetaPill>market care</MetaPill>
          </div>
          <ContentInset className="grid gap-2">
            {watchlistRows.map((row) => (
              <ContentCard key={row.token.address} className="px-1">
                <WatchlistItem
                  token={row.token}
                  priceData={row.priceData}
                  onRemove={() => undefined}
                  onClick={() => undefined}
                />
              </ContentCard>
            ))}
          </ContentInset>
        </GlassCard>
      </div>
    </SummerBreezeShell>
  );
}

function SignalBoard() {
  const [alerts, setAlerts] = useState(alertSeeds);

  return (
    <SummerBreezeShell
      eyebrow="signal organism"
      title="Signal breeze"
      description="Alert design, current triggers, and the live market rail stay suspended in the same airy field so it still feels editorial."
    >
      <div className="grid gap-4 xl:grid-cols-[1fr_1.2fr]">
        <div className="grid gap-4">
          <GlassCard className="lg:translate-y-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="terminal-theme-heading text-sm font-semibold text-terminal-text">
                Create alert
              </h3>
              <MetaPill>trigger design</MetaPill>
            </div>
            <CreateAlertForm
              isLoading={false}
              onSubmit={(submission) => {
                setAlerts((current) => [
                  {
                    id: `alert-${submission.tokenSymbol.toLowerCase()}-${current.length + 1}`,
                    tokenSymbol: submission.tokenSymbol,
                    tokenAddress: `draft-${submission.tokenSymbol.toLowerCase()}`,
                    chain: "ethereum",
                    alertType: submission.alertType,
                    targetValue: submission.targetValue,
                    currentPrice: undefined,
                    status: "active",
                    createdAt: new Date().toISOString(),
                  },
                  ...current,
                ]);
              }}
            />
          </GlassCard>

          <GlassCard className="lg:translate-y-8">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="terminal-theme-heading text-sm font-semibold text-terminal-text">
                Current rail
              </h3>
              <MetaPill>live context</MetaPill>
            </div>
            <ContentInset className="grid gap-2">
              {watchlistRows.slice(0, 2).map((row) => (
                <ContentCard key={row.token.address} className="px-1">
                  <WatchlistItem
                    token={row.token}
                    priceData={row.priceData}
                    onRemove={() => undefined}
                    onClick={() => undefined}
                  />
                </ContentCard>
              ))}
            </ContentInset>
          </GlassCard>
        </div>

        <GlassCard className="lg:translate-y-12">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="terminal-theme-heading text-sm font-semibold text-terminal-text">
              Signal stack
            </h3>
            <MetaPill>{alerts.length} rules</MetaPill>
          </div>
          <div className="grid gap-3">
            {alerts.map((alert) => (
              <AlertCard
                key={alert.id}
                alert={alert}
                onDelete={(id) => {
                  setAlerts((current) =>
                    current.filter((entry) => entry.id !== id),
                  );
                }}
              />
            ))}
          </div>
        </GlassCard>
      </div>
    </SummerBreezeShell>
  );
}

function CopilotBoard() {
  const [lastPrompt, setLastPrompt] = useState("Swap ETH to USDC");
  const now = Date.now();

  return (
    <SummerBreezeShell
      eyebrow="copilot organism"
      title="Breeze copilot"
      description="The same summer-breeze world can hold conversation too: guided prompts, quote execution, and portfolio context without dropping the mood."
    >
      <div className="grid gap-4 xl:grid-cols-[0.92fr_1.18fr]">
        <GlassCard className="lg:translate-y-6">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="terminal-theme-heading text-sm font-semibold text-terminal-text">
              Prompt drift
            </h3>
            <MetaPill>suggestions</MetaPill>
          </div>
          <SuggestedCommands onSelect={setLastPrompt} />
          <ContentCard className="mt-4 p-[var(--terminal-space-inset)]">
            <div className="terminal-theme-caption text-[9px] uppercase text-terminal-text-muted">
              Selected
            </div>
            <div className="mt-2 text-lg font-semibold tracking-[-0.03em] text-terminal-text">
              {lastPrompt}
            </div>
          </ContentCard>
          <div className="mt-4">
            <QuoteCard
              data={{
                fromToken: { symbol: "ETH" },
                toToken: { symbol: "USDC" },
                fromAmount: "1.5",
                toAmount: "5232.18",
                exchangeRate: 3488.12,
                priceImpact: 0.42,
                gasUsd: 4.82,
              }}
            />
          </div>
        </GlassCard>

        <GlassCard className="lg:translate-y-12">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="terminal-theme-heading text-sm font-semibold text-terminal-text">
              Conversation stream
            </h3>
            <MetaPill>assisted</MetaPill>
          </div>
          <ContentInset>
            <ChatMessage
              role="user"
              type="text"
              content={lastPrompt}
              timestamp={now - 1000 * 60 * 2}
            />
            <ChatMessage
              role="assistant"
              type="quote"
              content="Best route found through the summer breeze stack. Execution quality looks clean."
              data={{
                fromToken: { symbol: "ETH" },
                toToken: { symbol: "USDC" },
                fromAmount: "1.5",
                toAmount: "5232.18",
                exchangeRate: 3488.12,
                priceImpact: 0.42,
                gasUsd: 4.82,
              }}
              timestamp={now - 1000 * 60}
            />
            <ChatMessage
              role="assistant"
              type="portfolio"
              content="Here is the portfolio context before you confirm."
              data={{
                totalUsdValue: 18234.11,
                tokens: [
                  { symbol: "ETH", balance: "3.1", usdValue: 10813.14 },
                  { symbol: "USDC", balance: "2400", usdValue: 2400 },
                  { symbol: "SOL", balance: "18", usdValue: 3283.92 },
                ],
              }}
              timestamp={now}
            />
          </ContentInset>
        </GlassCard>
      </div>
    </SummerBreezeShell>
  );
}

function RouteBoard() {
  const [slippage, setSlippage] = useState(0.5);

  return (
    <SummerBreezeShell
      eyebrow="route organism"
      title="Drifting route deck"
      description="A lighter execution board built from slippage tuning, route data, and a small market context rail, all still inside the same bright surf frame."
    >
      <div className="grid gap-4 xl:grid-cols-[0.92fr_1.18fr]">
        <GlassCard className="lg:translate-y-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="terminal-theme-heading text-sm font-semibold text-terminal-text">
              Execution tuning
            </h3>
            <MetaPill>{slippage.toFixed(2)}%</MetaPill>
          </div>
          <ContentCard className="p-[var(--terminal-space-inset)]">
            <SlippageControl value={slippage} onChange={setSlippage} />
          </ContentCard>
          <ContentInset className="mt-4 grid gap-2">
            {watchlistRows.slice(0, 2).map((row) => (
              <ContentCard key={row.token.address} className="px-1">
                <WatchlistItem
                  token={row.token}
                  priceData={row.priceData}
                  onRemove={() => undefined}
                  onClick={() => undefined}
                />
              </ContentCard>
            ))}
          </ContentInset>
        </GlassCard>

        <GlassCard className="lg:translate-y-12">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="terminal-theme-heading text-sm font-semibold text-terminal-text">
              Route offer
            </h3>
            <MetaPill>agent ready</MetaPill>
          </div>
          <QuoteCard
            data={{
              fromToken: { symbol: "ETH" },
              toToken: { symbol: "USDC" },
              fromAmount: "1.5",
              toAmount: "5232.18",
              exchangeRate: 3488.12,
              priceImpact: 0.42,
              gasUsd: 4.82,
            }}
          />
        </GlassCard>
      </div>
    </SummerBreezeShell>
  );
}

const meta = {
  title: "Organisms/Summer Breeze Variants",
  tags: ["autodocs"],
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const DriftingConcierge: Story = {
  render: () => <ConciergeBoard />,
};

export const SignalBreeze: Story = {
  render: () => <SignalBoard />,
};

export const BreezeCopilot: Story = {
  render: () => <CopilotBoard />,
};

export const DriftingRouteDeck: Story = {
  render: () => <RouteBoard />,
};
