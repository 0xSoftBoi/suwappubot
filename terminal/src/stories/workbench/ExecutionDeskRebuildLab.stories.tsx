import { useEffect, useMemo, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import {
  TerminalExecutionTicket,
  type TerminalExecutionMode,
  type TerminalExecutionSide,
} from "../../components/trade/TerminalExecutionTicket";
import {
  TerminalButton,
  TerminalSegmentedTabs,
  TerminalSelectPill,
  TerminalTextField,
} from "../../components/foundation/TerminalControls";
import { TerminalKeyValueRow } from "../../components/foundation/TerminalDataDisplay";
import {
  TerminalInset,
  TerminalMetricCard,
  TerminalPage,
  TerminalPanel,
  TerminalPanelHeader,
  TerminalStatusPill,
} from "../../components/foundation/TerminalPrimitives";
import type { SwapQuote, SwapToken } from "../../types/api";
import {
  ethToKazeQuote,
  ethToken,
  kazeToken,
  solToKazeQuote,
  solToken,
} from "../_fixtures/terminal";

type RoutePack = "direct" | "bridge";

function reverseQuote(quote: SwapQuote): SwapQuote {
  return {
    ...quote,
    id: `${quote.id}-reverse`,
    fromToken: quote.toToken,
    toToken: quote.fromToken,
    fromAmount: quote.toAmount,
    toAmount: quote.fromAmount,
    fromAmountUsd: quote.toAmountUsd,
    toAmountUsd: quote.fromAmountUsd,
    exchangeRate: quote.exchangeRate === 0 ? 0 : 1 / quote.exchangeRate,
    minReceived: quote.fromAmount,
    route: `${quote.route} · reverse`,
  };
}

function ExecutionDeskLab() {
  const [mode, setMode] = useState<TerminalExecutionMode>("swap");
  const [side, setSide] = useState<TerminalExecutionSide>("buy");
  const [routePack, setRoutePack] = useState<RoutePack>("direct");
  const [query, setQuery] = useState("");
  const [flipped, setFlipped] = useState(false);
  const [amount, setAmount] = useState("0.75");
  const [slippage, setSlippage] = useState(0.45);
  const [showTpSl, setShowTpSl] = useState(true);
  const [tpPrice, setTpPrice] = useState("1.02");
  const [slPrice, setSlPrice] = useState("0.74");
  const [limitPrice, setLimitPrice] = useState("0.79");
  const [expiry, setExpiry] = useState("24h");
  const [totalBudget, setTotalBudget] = useState("2400");
  const [frequency, setFrequency] = useState("daily");
  const [orderCount, setOrderCount] = useState("8");
  const [lastAction, setLastAction] = useState("No action triggered yet");

  useEffect(() => {
    if (routePack === "direct") {
      setAmount(flipped ? ethToKazeQuote.toAmount : ethToKazeQuote.fromAmount);
      setSlippage(0.45);
    } else {
      setAmount(flipped ? solToKazeQuote.toAmount : solToKazeQuote.fromAmount);
      setSlippage(1.2);
    }
  }, [routePack, flipped]);

  const baseQuote = routePack === "direct" ? ethToKazeQuote : solToKazeQuote;
  const quote = useMemo(
    () => (flipped ? reverseQuote(baseQuote) : baseQuote),
    [baseQuote, flipped],
  );

  const fromToken: SwapToken = flipped
    ? kazeToken
    : routePack === "direct"
      ? ethToken
      : solToken;
  const toToken: SwapToken = flipped
    ? routePack === "direct"
      ? ethToken
      : solToken
    : kazeToken;

  const promptPacks = [
    { id: "route", label: "Direct route", detail: "clean execution" },
    { id: "bridge", label: "Bridge route", detail: "cross-chain" },
    { id: "risk", label: "High-impact route", detail: "monitor" },
  ].filter((pack) => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return true;
    return (
      pack.label.toLowerCase().includes(normalized) ||
      pack.detail.toLowerCase().includes(normalized)
    );
  });

  return (
    <TerminalPage>
      <div className="mx-auto grid max-w-7xl gap-2.5">
        <TerminalPanel elevated>
          <TerminalPanelHeader
            eyebrow={
              <TerminalStatusPill tone="warm">
                execution slice
              </TerminalStatusPill>
            }
            title="Provider-free execution desk rebuild lab"
            description="Swap, limit, and DCA in one compact trade desk."
            meta={
              <TerminalMetricCard
                label="Mode"
                value={`${routePack} ${mode}`}
                tone={routePack === "direct" ? "sky" : "warm"}
              />
            }
          />

          <div className="grid gap-2.5">
            <TerminalInset className="grid gap-2 p-[var(--terminal-space-card)] xl:grid-cols-[auto_minmax(0,0.8fr)_minmax(0,1fr)_auto] xl:items-end">
              <div className="grid gap-1.5">
                <div className="terminal-theme-caption text-[9px] uppercase text-terminal-text-muted">
                  Route
                </div>
                <TerminalSegmentedTabs
                  activeId={routePack}
                  onChange={(value) => setRoutePack(value as RoutePack)}
                  options={[
                    { id: "direct", label: "Direct", meta: "best depth" },
                    { id: "bridge", label: "Bridge", meta: "cross-chain" },
                  ]}
                />
              </div>

              <TerminalTextField
                label="Filter"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search route presets"
              />

              <div className="grid gap-1.5">
                <div className="terminal-theme-caption text-[9px] uppercase text-terminal-text-muted">
                  Presets
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {promptPacks.map((pack) => (
                    <TerminalSelectPill
                      key={pack.id}
                      label={pack.label.replace(" route", "")}
                      detail={pack.detail}
                      active={
                        (pack.id === "route" &&
                          routePack === "direct" &&
                          mode !== "limit") ||
                        (pack.id === "bridge" &&
                          routePack === "bridge" &&
                          mode !== "limit") ||
                        (pack.id === "risk" &&
                          routePack === "bridge" &&
                          mode === "limit")
                      }
                      onClick={() => {
                        if (pack.id === "route") {
                          setRoutePack("direct");
                          setMode("swap");
                        }
                        if (pack.id === "bridge") {
                          setRoutePack("bridge");
                          setMode("swap");
                        }
                        if (pack.id === "risk") {
                          setRoutePack("bridge");
                          setMode("limit");
                        }
                      }}
                    />
                  ))}
                </div>
              </div>

              <div className="grid gap-1.5">
                <div className="terminal-theme-caption text-[9px] uppercase text-terminal-text-muted">
                  Tape
                </div>
                <div className="flex flex-wrap gap-1.5 xl:justify-end">
                  <TerminalSelectPill
                    label="Tape"
                    detail="normal"
                    active={side === "buy"}
                    onClick={() => setSide("buy")}
                  />
                  <TerminalSelectPill
                    label="Sell bias"
                    detail="distribution"
                    active={side === "sell"}
                    onClick={() => setSide("sell")}
                  />
                  <TerminalSelectPill
                    label="Flip"
                    detail="stress test"
                    active={flipped}
                    onClick={() => setFlipped((current) => !current)}
                  />
                </div>
              </div>
            </TerminalInset>

            <div className="grid gap-2.5 xl:grid-cols-[1.55fr_0.45fr] xl:items-start">
              <TerminalExecutionTicket
                mode={mode}
                side={side}
                fromToken={fromToken}
                toToken={toToken}
                amount={amount}
                onAmountChange={setAmount}
                quote={mode === "dca" ? quote : quote}
                onFlip={() => setFlipped((current) => !current)}
                onModeChange={(nextMode) => {
                  setMode(nextMode);
                  if (nextMode === "swap") setShowTpSl(true);
                }}
                onSideChange={setSide}
                slippage={slippage}
                slippageOptions={[
                  { value: 0.1, label: "0.1%" },
                  { value: 0.45, label: "0.45%" },
                  { value: 1.2, label: "1.2%" },
                  { value: 3, label: "3%" },
                ]}
                onSlippageChange={setSlippage}
                showTpSl={showTpSl}
                onToggleTpSl={() => setShowTpSl((current) => !current)}
                tpPrice={tpPrice}
                slPrice={slPrice}
                onTpPriceChange={setTpPrice}
                onSlPriceChange={setSlPrice}
                limitPrice={limitPrice}
                onLimitPriceChange={setLimitPrice}
                expiry={expiry}
                expiryOptions={[
                  { id: "1h", label: "1h" },
                  { id: "4h", label: "4h" },
                  { id: "24h", label: "24h" },
                  { id: "7d", label: "7d" },
                ]}
                onExpiryChange={setExpiry}
                totalBudget={totalBudget}
                onTotalBudgetChange={setTotalBudget}
                frequency={frequency}
                frequencyOptions={[
                  { id: "hourly", label: "Hourly" },
                  { id: "daily", label: "Daily" },
                  { id: "weekly", label: "Weekly" },
                ]}
                onFrequencyChange={setFrequency}
                orderCount={orderCount}
                onOrderCountChange={setOrderCount}
                onPrimaryAction={() =>
                  setLastAction(`primary: ${mode} ${side} ${toToken.symbol}`)
                }
                onSecondaryAction={() =>
                  setLastAction(`secondary: saved ${mode} draft`)
                }
              />

              <div className="grid gap-2">
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
                  <TerminalMetricCard
                    label="Port target"
                    value="SwapPanel shell"
                    detail="Back-port after the desk language settles."
                    tone="sky"
                  />
                  <TerminalMetricCard
                    label="Theme"
                    value="global surfaces"
                    detail="Density moves with the terminal theme."
                    tone="warm"
                  />
                  <TerminalMetricCard
                    label="Preset"
                    value={`${routePack} ${mode}`}
                    detail="Current review state."
                  />
                </div>
                <TerminalKeyValueRow
                  label="Last action"
                  value={lastAction}
                  detail="CTA wording and route confidence check."
                />
                <div className="flex flex-wrap gap-2">
                  <TerminalButton
                    variant="secondary"
                    size="sm"
                    onClick={() => setMode("swap")}
                  >
                    Reset
                  </TerminalButton>
                  <TerminalButton
                    size="sm"
                    onClick={() => {
                      setRoutePack("bridge");
                      setMode("limit");
                      setLastAction("preset: bridge limit review");
                    }}
                  >
                    Bridge limit review
                  </TerminalButton>
                </div>
              </div>
            </div>
          </div>
        </TerminalPanel>
      </div>
    </TerminalPage>
  );
}

const meta = {
  title: "Workbench/Execution Desk Rebuild Lab",
  parameters: {
    layout: "fullscreen",
  },
  render: () => <ExecutionDeskLab />,
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Overview: Story = {};
