import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { ChartToolbar } from "../../components/chart/ChartToolbar";
import { ChatMessage } from "../../components/copilot/ChatMessage";
import { SuggestedCommands } from "../../components/copilot/SuggestedCommands";
import { TerminalSegmentedTabs } from "../../components/foundation/TerminalControls";
import { SecurityBadge } from "../../components/discover/SecurityBadge";
import { TierBadge } from "../../components/points/TierBadge";
import { QuoteComparison } from "../../components/swap/QuoteComparison";
import { SlippageControl } from "../../components/swap/SlippageControl";
import { OrderTabs } from "../../components/trade/OrderTabs";
import { TerminalWalletOperatorSurface } from "../../components/tracker/TerminalWalletOperatorSurface";
import { TrustScoreBadge } from "../../components/discover/TrustScoreBadge";
import {
  SummerBreezeStoryFrame,
  SummerBreezeSurface,
} from "../_components/SummerBreezeStoryFrame";
import {
  cautionSecurity,
  copilotQuoteCardData,
  ethToUsdcQuote,
  portfolioSummaryData,
  safeSecurity,
  trackedWallet,
  trackedWallets,
  walletActivities,
  walletStatsMap,
} from "../_fixtures/terminal";

type LabMode = "audit" | "reroll";
type TradeTab = "swap" | "limit" | "dca";
type ChartType = "candle" | "line";
type WorkbenchTab = "market" | "execution" | "wallet" | "copilot";
type WalletDeskMode = "focused" | "market";

function joinClasses(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function MarketTab({
  interval,
  chartType,
  orderTab,
  slippage,
  onIntervalChange,
  onChartTypeChange,
  onOrderTabChange,
  onSlippageChange,
}: {
  interval: string;
  chartType: ChartType;
  orderTab: TradeTab;
  slippage: number;
  onIntervalChange: (value: string) => void;
  onChartTypeChange: (value: ChartType) => void;
  onOrderTabChange: (value: TradeTab) => void;
  onSlippageChange: (value: number) => void;
}) {
  return (
    <div className="grid gap-3 xl:grid-cols-[0.94fr_1.06fr]">
      <SummerBreezeSurface
        title="Chart + controls"
        meta={`${interval} / ${chartType}`}
      >
        <div className="grid gap-3">
          <div className="overflow-hidden rounded-[22px] border border-[#2A232A] bg-[#151217]">
            <ChartToolbar
              interval={interval}
              onIntervalChange={onIntervalChange}
              chartType={chartType}
              onChartTypeChange={onChartTypeChange}
            />
          </div>

          <div className="terminal-theme-inset p-[var(--terminal-space-inset)]">
            <OrderTabs active={orderTab} onSelect={onOrderTabChange} />
            <div className="mt-3">
              <SlippageControl value={slippage} onChange={onSlippageChange} />
            </div>
          </div>
        </div>
      </SummerBreezeSurface>

      <SummerBreezeSurface title="Trust + route" meta="review before execute">
        <div className="grid gap-3">
          <div className="terminal-theme-card p-[var(--terminal-space-inset)]">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <TierBadge tier="Gold" points={12840} />
              <TrustScoreBadge score={91} level="safe" />
              <SecurityBadge security={safeSecurity} />
              <SecurityBadge security={cautionSecurity} compact />
            </div>
            <QuoteComparison quote={ethToUsdcQuote} />
          </div>
        </div>
      </SummerBreezeSurface>
    </div>
  );
}

function CopilotTab({
  selectedCommand,
  onSelectCommand,
}: {
  selectedCommand: string | null;
  onSelectCommand: (value: string) => void;
}) {
  return (
    <div className="grid gap-3 xl:grid-cols-[1.08fr_0.92fr]">
      <SummerBreezeSurface title="Conversation" meta="assistant + portfolio">
        <div className="rounded-[22px] border border-[#2A232A] bg-[#151217] p-3">
          <ChatMessage
            role="assistant"
            type="quote"
            content="Route looks clean. You can execute now or tighten slippage if you want a stricter fill."
            data={copilotQuoteCardData}
            timestamp={Date.now() - 1000 * 60 * 3}
          />
          <ChatMessage
            role="assistant"
            type="portfolio"
            content="Your wallet is still concentrated in ETH and stablecoins."
            data={portfolioSummaryData}
            timestamp={Date.now() - 1000 * 60}
          />
        </div>
      </SummerBreezeSurface>

      <SummerBreezeSurface title="Command pack" meta="prompt testing">
        <div className="grid gap-3">
          <div className="rounded-[22px] border border-[#2A232A] bg-[#151217] p-2">
            <SuggestedCommands onSelect={onSelectCommand} />
          </div>
          <div
            className={joinClasses(
              "terminal-theme-card px-[var(--terminal-space-card)] py-[var(--terminal-space-card)] text-xs text-[#6E5B49]",
              selectedCommand
                ? "border-[#CFE7F6] bg-[#EFF8FF] text-[#3972A3]"
                : "",
            )}
          >
            {selectedCommand
              ? `Selected prompt: ${selectedCommand}`
              : "Tap a command to test wording."}
          </div>
        </div>
      </SummerBreezeSurface>
    </div>
  );
}

function TerminalRebuildLab({ mode }: { mode: LabMode }) {
  const [activeTab, setActiveTab] = useState<WorkbenchTab>(
    mode === "audit" ? "market" : "wallet",
  );
  const [slippage, setSlippage] = useState(0.5);
  const [orderTab, setOrderTab] = useState<TradeTab>("swap");
  const [interval, setInterval] = useState("15m");
  const [chartType, setChartType] = useState<ChartType>("candle");
  const [selectedCommand, setSelectedCommand] = useState<string | null>(null);
  const [walletDeskMode, setWalletDeskMode] =
    useState<WalletDeskMode>("focused");
  const [walletQuery, setWalletQuery] = useState("");
  const [selectedWalletAddress, setSelectedWalletAddress] = useState(
    trackedWallet.address,
  );

  return (
    <SummerBreezeStoryFrame
      eyebrow="Terminal workbench"
      title="Terminal rebuild lab"
      description="Provider-free tabs for the slices that matter. Pick a lane and work it without the full app shell."
      metricLabel="Tab"
      metricValue={activeTab}
    >
      <div className="grid gap-3">
        <div className="terminal-theme-inset p-1">
          <TerminalSegmentedTabs
            activeId={activeTab}
            onChange={(value) => setActiveTab(value as WorkbenchTab)}
            options={[
              { id: "market", label: "Market", meta: "chart + trust" },
              { id: "execution", label: "Execution", meta: "swap controls" },
              { id: "wallet", label: "Wallet", meta: "operator desk" },
              { id: "copilot", label: "Copilot", meta: "command surface" },
            ]}
          />
        </div>

        {activeTab === "market" ? (
          <MarketTab
            interval={interval}
            chartType={chartType}
            orderTab={orderTab}
            slippage={slippage}
            onIntervalChange={setInterval}
            onChartTypeChange={setChartType}
            onOrderTabChange={setOrderTab}
            onSlippageChange={setSlippage}
          />
        ) : null}

        {activeTab === "execution" ? (
          <div className="grid gap-3 xl:grid-cols-[0.9fr_1.1fr]">
            <SummerBreezeSurface title="Execution controls" meta={orderTab}>
              <div className="grid gap-3">
                <div className="terminal-theme-inset p-[var(--terminal-space-inset)]">
                  <OrderTabs active={orderTab} onSelect={setOrderTab} />
                  <div className="mt-3">
                    <SlippageControl value={slippage} onChange={setSlippage} />
                  </div>
                </div>
                <div className="terminal-theme-card p-[var(--terminal-space-inset)]">
                  <QuoteComparison quote={ethToUsdcQuote} />
                </div>
              </div>
            </SummerBreezeSurface>

            <SummerBreezeSurface
              title="Execution direction"
              meta="keep this dense"
            >
              <div className="terminal-theme-card p-[var(--terminal-space-inset)]">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <TrustScoreBadge score={91} level="safe" />
                  <SecurityBadge security={safeSecurity} compact />
                </div>
                <div className="grid gap-2 text-sm text-[#6F604D]">
                  <div>
                    Tabs should switch between live execution lanes, not between
                    filler cards.
                  </div>
                  <div>
                    Swap, limit, and DCA belong under one desk shell with direct
                    state transitions.
                  </div>
                </div>
              </div>
            </SummerBreezeSurface>
          </div>
        ) : null}

        {activeTab === "wallet" ? (
          <SummerBreezeSurface
            title="Wallet operator desk"
            meta={walletDeskMode}
          >
            <TerminalWalletOperatorSurface
              wallets={trackedWallets}
              statsMap={walletStatsMap}
              activities={walletActivities}
              selectedAddress={selectedWalletAddress}
              onSelectAddress={setSelectedWalletAddress}
              mode={walletDeskMode}
              onModeChange={(value) => setWalletDeskMode(value)}
              query={walletQuery}
              onQueryChange={setWalletQuery}
              onPrimaryAction={(wallet) =>
                setSelectedCommand(
                  `stage action for ${wallet.label || wallet.address}`,
                )
              }
              onSecondaryAction={(wallet) =>
                setSelectedCommand(
                  `open tape for ${wallet.label || wallet.address}`,
                )
              }
            />
          </SummerBreezeSurface>
        ) : null}

        {activeTab === "copilot" ? (
          <CopilotTab
            selectedCommand={selectedCommand}
            onSelectCommand={(value) => setSelectedCommand(value)}
          />
        ) : null}
      </div>
    </SummerBreezeStoryFrame>
  );
}

const meta = {
  title: "Workbench/Terminal Rebuild Lab",
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
  args: {
    mode: "audit" as LabMode,
  },
  render: ({ mode }) => (
    <div className="terminal-theme-page min-h-screen p-[var(--terminal-space-page)]">
      <TerminalRebuildLab mode={mode} />
    </div>
  ),
} satisfies Meta<{ mode: LabMode }>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Audit: Story = {};

export const Reroll: Story = {
  args: {
    mode: "reroll",
  },
};
