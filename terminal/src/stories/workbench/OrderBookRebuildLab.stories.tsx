import { useMemo, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import {
  TerminalIconButton,
  TerminalSegmentedTabs,
  TerminalSelectPill,
} from "../../components/foundation/TerminalControls";
import {
  TerminalMetricCard,
  TerminalPage,
  TerminalPanel,
  TerminalPanelHeader,
  TerminalStatusPill,
  TerminalInset,
} from "../../components/foundation/TerminalPrimitives";
import { TerminalOrderBookDepthRow } from "../../components/orderbook/TerminalOrderBookDepthRow";
import type { OrderBookLevel } from "../../hooks/useOrderBook";

type ViewMode = "both" | "bids" | "asks";
type PrecisionStep = 0.01 | 0.1 | 1;

function roundToStep(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function generateSide(
  basePrice: number,
  levels: number,
  step: number,
  side: "bid" | "ask",
) {
  const result: OrderBookLevel[] = [];
  let cumulative = 0;

  for (let index = 0; index < levels; index++) {
    const offset = (index + 1) * step;
    const price =
      side === "bid"
        ? roundToStep(basePrice - offset, step)
        : roundToStep(basePrice + offset, step);
    const size = parseFloat(
      (2.4 + index * 0.42 + (side === "bid" ? 0.4 : 0.2)).toFixed(4),
    );
    cumulative += size;
    result.push({
      price: parseFloat(price.toFixed(Math.max(2, -Math.log10(step)))),
      size,
      total: parseFloat(cumulative.toFixed(4)),
    });
  }

  return result;
}

function buildBook(step: PrecisionStep) {
  const midPrice = roundToStep(3245.5, step);
  const bids = generateSide(midPrice, 10, step, "bid");
  const asks = generateSide(midPrice, 10, step, "ask");
  const spread = asks[0].price - bids[0].price;
  const spreadPercent = (spread / midPrice) * 100;
  const maxTotal = Math.max(
    bids[bids.length - 1].total,
    asks[asks.length - 1].total,
  );

  return {
    bids,
    asks,
    midPrice,
    spread: parseFloat(spread.toFixed(2)),
    spreadPercent: parseFloat(spreadPercent.toFixed(4)),
    maxTotal,
  };
}

function TimeAndSales() {
  const trades = [
    {
      id: "t1",
      price: 3245.52,
      size: 0.8124,
      time: "14:32:11",
      side: "buy" as const,
    },
    {
      id: "t2",
      price: 3245.47,
      size: 1.2011,
      time: "14:32:09",
      side: "sell" as const,
    },
    {
      id: "t3",
      price: 3245.49,
      size: 0.4421,
      time: "14:32:06",
      side: "buy" as const,
    },
    {
      id: "t4",
      price: 3245.44,
      size: 2.3042,
      time: "14:32:03",
      side: "sell" as const,
    },
  ];

  return (
    <TerminalInset className="grid gap-1 p-[var(--terminal-space-card)]">
      <div className="flex items-center justify-between gap-2">
        <div className="terminal-theme-caption text-[9px] uppercase text-terminal-text-muted">
          Tape
        </div>
        <div className="terminal-theme-caption text-[9px] uppercase text-terminal-text-secondary">
          Recent prints
        </div>
      </div>
      <div className="grid gap-0.5 font-mono text-[9px]">
        <div className="terminal-theme-caption grid grid-cols-3 gap-2 px-2 text-[9px] uppercase text-terminal-text-muted">
          <span>Price</span>
          <span className="text-right">Size</span>
          <span className="text-right">Time</span>
        </div>
        {trades.map((trade) => (
          <div
            key={trade.id}
            className="terminal-theme-card grid grid-cols-3 gap-2 bg-white/90 px-2 py-0.5"
          >
            <span className={trade.side === "buy" ? "text-bull" : "text-bear"}>
              {trade.price.toFixed(2)}
            </span>
            <span className="text-right text-terminal-text-secondary">
              {trade.size.toFixed(4)}
            </span>
            <span className="text-right text-terminal-text-muted">
              {trade.time}
            </span>
          </div>
        ))}
      </div>
    </TerminalInset>
  );
}

function OrderBookLab() {
  const [viewMode, setViewMode] = useState<ViewMode>("both");
  const [precision, setPrecision] = useState<PrecisionStep>(0.01);

  const book = useMemo(() => buildBook(precision), [precision]);

  const showBids = viewMode === "both" || viewMode === "bids";
  const showAsks = viewMode === "both" || viewMode === "asks";

  return (
    <TerminalPage>
      <div className="mx-auto grid max-w-6xl gap-2.5">
        <TerminalPanel elevated>
          <TerminalPanelHeader
            eyebrow={
              <TerminalStatusPill tone="warm">
                order book slice
              </TerminalStatusPill>
            }
            title="Provider-free order book rebuild lab"
            description="Compact market depth, spread, and tape without the live hook noise."
            meta={
              <TerminalMetricCard
                label="Spread"
                value={`${book.spread.toFixed(2)} (${book.spreadPercent.toFixed(3)}%)`}
                tone="sky"
              />
            }
          />

          <div className="grid gap-2.5 xl:grid-cols-[1.7fr_0.52fr] xl:items-start">
            <TerminalInset className="p-[var(--terminal-space-card)]">
              <div className="flex flex-col gap-1.5 border-b border-terminal-border pb-2 md:flex-row md:items-center md:justify-between">
                <TerminalSegmentedTabs
                  activeId={viewMode}
                  onChange={(value) => setViewMode(value as ViewMode)}
                  options={[
                    { id: "both", label: "Both", meta: "full depth" },
                    { id: "bids", label: "Bids", meta: "buy wall" },
                    { id: "asks", label: "Asks", meta: "sell wall" },
                  ]}
                />
                <div className="flex flex-wrap items-center gap-2">
                  {[0.01, 0.1, 1].map((step) => (
                    <TerminalSelectPill
                      key={step}
                      label={String(step)}
                      detail="tick"
                      active={precision === step}
                      onClick={() => setPrecision(step as PrecisionStep)}
                    />
                  ))}
                  <TerminalIconButton label="Depth settings">
                    <svg
                      className="h-4 w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M12 6v12m6-6H6"
                      />
                    </svg>
                  </TerminalIconButton>
                </div>
              </div>

              <div className="mt-2 grid gap-0.5 font-mono text-[9px]">
                <div className="terminal-theme-caption grid grid-cols-3 gap-2 px-2 text-[9px] uppercase text-terminal-text-muted">
                  <span>Price</span>
                  <span className="text-right">Size</span>
                  <span className="text-right">Total</span>
                </div>

                {showAsks ? (
                  <div className="grid gap-0.5">
                    {[...book.asks].reverse().map((level) => (
                      <TerminalOrderBookDepthRow
                        key={`ask-${level.price}`}
                        level={level}
                        side="ask"
                        maxTotal={book.maxTotal}
                        precision={precision}
                      />
                    ))}
                  </div>
                ) : null}

                <div className="my-0.5 border border-terminal-border-active bg-white px-2 py-1 [border-radius:var(--terminal-radius-inset)] [box-shadow:var(--terminal-shadow-raised)]">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono text-[12px] font-semibold leading-none text-terminal-text">
                      {book.midPrice.toFixed(
                        Math.max(2, -Math.log10(precision)),
                      )}
                    </span>
                    <span className="text-[10px] text-terminal-text-secondary">
                      Spread {book.spread.toFixed(2)} /{" "}
                      {book.spreadPercent.toFixed(3)}%
                    </span>
                  </div>
                </div>

                {showBids ? (
                  <div className="grid gap-0.5">
                    {book.bids.map((level) => (
                      <TerminalOrderBookDepthRow
                        key={`bid-${level.price}`}
                        level={level}
                        side="bid"
                        maxTotal={book.maxTotal}
                        precision={precision}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            </TerminalInset>

            <div className="grid gap-2">
              <TimeAndSales />
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
                <TerminalMetricCard
                  label="Rows"
                  value={`${showAsks ? book.asks.length : 0} / ${showBids ? book.bids.length : 0}`}
                  detail="ask / bid"
                />
                <TerminalMetricCard
                  label="Tick"
                  value={String(precision)}
                  detail="active ladder precision"
                  tone="sky"
                />
              </div>
              <div className="grid gap-1.5">
                <TerminalMetricCard
                  label="Port target"
                  value="OrderBookPanel"
                  detail="Compact tape and spread rail."
                  tone="warm"
                />
                <TerminalMetricCard
                  label="Use case"
                  value="ladder first"
                  detail="Depth, spread, then tape."
                />
              </div>
            </div>
          </div>
        </TerminalPanel>
      </div>
    </TerminalPage>
  );
}

const meta = {
  title: "Workbench/Order Book Rebuild Lab",
  parameters: {
    layout: "fullscreen",
  },
  render: () => <OrderBookLab />,
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Overview: Story = {};
