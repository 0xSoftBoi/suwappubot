import type { ReactNode } from "react";
import type { SwapQuote, SwapToken } from "../../types/api";
import {
  TerminalButton,
  TerminalSelectPill,
  TerminalTokenPill,
} from "../foundation/TerminalControls";
import {
  TerminalChainBadge,
  TerminalKeyValueRow,
} from "../foundation/TerminalDataDisplay";
import {
  TerminalInset,
  TerminalMetricCard,
  TerminalStatusPill,
} from "../foundation/TerminalPrimitives";

function joinClasses(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export type TerminalExecutionMode = "swap" | "limit" | "dca";
export type TerminalExecutionSide = "buy" | "sell";

type Tone = "neutral" | "warm" | "sky";

type Option = {
  id: string;
  label: string;
};

type NumericOption = {
  value: number;
  label: string;
};

function formatUsd(value: number): string {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}

function formatDuration(seconds?: number): string {
  if (!seconds) return "--";
  if (seconds < 60) return `${seconds}s`;
  return `${Math.round(seconds / 60)}m`;
}

function routeTone(quote?: SwapQuote): Tone {
  if (!quote) return "neutral";
  if (quote.priceImpact < 0.5) return "sky";
  if (quote.priceImpact < 1.5) return "neutral";
  return "warm";
}

function routeLabel(quote?: SwapQuote): string {
  if (!quote) return "awaiting route";
  if (quote.priceImpact < 0.5) return "clean route";
  if (quote.priceImpact < 1.5) return "monitor route";
  return "high impact";
}

function inputValue(value?: string): string {
  return value ?? "";
}

function safeNumber(value: string): number | null {
  const numeric = Number.parseFloat(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function estimatedPerOrder(totalBudget: string, orderCount: string): string {
  const budget = safeNumber(totalBudget);
  const count = Number.parseInt(orderCount, 10);

  if (!budget || !count || count <= 0) return "--";
  return formatUsd(budget / count);
}

function ExecutionToggle({
  active,
  onClick,
  children,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  tone: "bull" | "bear";
}) {
  return (
    <button
      onClick={onClick}
      className={joinClasses(
        "terminal-theme-control flex-1 px-3 py-1 text-[12px] font-semibold transition-colors hover:translate-y-0 focus:translate-y-0",
        active ? "terminal-theme-control-active" : "",
        active && tone === "bull" ? "text-bull" : "",
        active && tone === "bear" ? "text-bear" : "",
        !active ? "text-terminal-text-secondary hover:text-terminal-text" : "",
      )}
    >
      {children}
    </button>
  );
}

function ExecutionModeTabs({
  mode,
  onChange,
}: {
  mode: TerminalExecutionMode;
  onChange: (mode: TerminalExecutionMode) => void;
}) {
  const options: Array<{
    id: TerminalExecutionMode;
    label: string;
    meta: string;
  }> = [
    { id: "swap", label: "Swap", meta: "instant" },
    { id: "limit", label: "Limit", meta: "resting" },
    { id: "dca", label: "DCA", meta: "scheduled" },
  ];

  return (
    <div className="terminal-theme-inset inline-flex flex-wrap gap-1 p-1">
      {options.map((option) => (
        <button
          key={option.id}
          onClick={() => onChange(option.id)}
          className={joinClasses(
            "px-3 py-1 text-left transition-colors [border-radius:var(--terminal-radius-card)]",
            mode === option.id
              ? "terminal-theme-control terminal-theme-control-active text-terminal-text"
              : "text-terminal-text-secondary hover:bg-white/70 hover:text-terminal-text",
          )}
        >
          <div className="text-[12px] font-medium leading-[1.05]">
            {option.label}
          </div>
          <div className="terminal-theme-caption text-[9px] uppercase opacity-70">
            {option.meta}
          </div>
        </button>
      ))}
    </div>
  );
}

function AssetLeg({
  label,
  token,
  amount,
  onAmountChange,
  usdValue,
  readOnly = false,
  detail,
}: {
  label: string;
  token: SwapToken;
  amount: string;
  onAmountChange?: (value: string) => void;
  usdValue?: number;
  readOnly?: boolean;
  detail?: string;
}) {
  return (
    <div className="terminal-theme-card px-[var(--terminal-space-card)] py-2.5">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div className="min-w-0 flex-1">
          <div className="terminal-theme-caption text-[9px] uppercase text-terminal-text-muted">
            {label}
          </div>
          <input
            value={amount}
            onChange={(event) => onAmountChange?.(event.target.value)}
            readOnly={readOnly}
            className="mt-1 w-full bg-transparent font-mono text-[16px] leading-none text-terminal-text outline-none placeholder:text-terminal-text-muted sm:text-[18px]"
            placeholder="0.0"
          />
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[10px] text-terminal-text-secondary">
            <span>
              Balance{" "}
              {token.balance ? `${token.balance} ${token.symbol}` : "--"}
            </span>
            {usdValue !== undefined ? <span>{formatUsd(usdValue)}</span> : null}
            {detail ? <span>{detail}</span> : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-1.5 sm:justify-end">
          <TerminalTokenPill symbol={token.symbol} />
          <TerminalChainBadge chain={token.chain} />
        </div>
      </div>
    </div>
  );
}

function TicketMeta({
  mode,
  slippage,
  slippageOptions,
  onSlippageChange,
  showTpSl,
  onToggleTpSl,
  tpPrice,
  slPrice,
  onTpPriceChange,
  onSlPriceChange,
  limitPrice,
  onLimitPriceChange,
  expiry,
  expiryOptions,
  onExpiryChange,
  totalBudget,
  onTotalBudgetChange,
  frequency,
  frequencyOptions,
  onFrequencyChange,
  orderCount,
  onOrderCountChange,
}: {
  mode: TerminalExecutionMode;
  slippage: number;
  slippageOptions: NumericOption[];
  onSlippageChange: (value: number) => void;
  showTpSl: boolean;
  onToggleTpSl: () => void;
  tpPrice: string;
  slPrice: string;
  onTpPriceChange: (value: string) => void;
  onSlPriceChange: (value: string) => void;
  limitPrice: string;
  onLimitPriceChange: (value: string) => void;
  expiry: string;
  expiryOptions: Option[];
  onExpiryChange: (value: string) => void;
  totalBudget: string;
  onTotalBudgetChange: (value: string) => void;
  frequency: string;
  frequencyOptions: Option[];
  onFrequencyChange: (value: string) => void;
  orderCount: string;
  onOrderCountChange: (value: string) => void;
}) {
  if (mode === "limit") {
    return (
      <TerminalInset className="grid gap-2 p-[var(--terminal-space-card)]">
        <div className="flex items-center justify-between gap-2">
          <div className="terminal-theme-caption text-[9px] uppercase text-terminal-text-muted">
            Limit conditions
          </div>
          <div className="terminal-theme-caption text-[9px] uppercase text-terminal-text-secondary">
            Resting order
          </div>
        </div>
        <div className="grid gap-2 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="terminal-theme-control px-3 py-2.5">
            <div className="terminal-theme-caption text-[9px] uppercase text-terminal-text-muted">
              Limit price
            </div>
            <input
              value={limitPrice}
              onChange={(event) => onLimitPriceChange(event.target.value)}
              className="mt-1.5 w-full bg-transparent font-mono text-[16px] text-terminal-text outline-none"
              placeholder="0.00"
            />
          </div>
          <div className="grid gap-1.5">
            <div className="terminal-theme-caption text-[9px] uppercase text-terminal-text-muted">
              Expiry
            </div>
            <div className="flex flex-wrap gap-2">
              {expiryOptions.map((option) => (
                <TerminalSelectPill
                  key={option.id}
                  label={option.label}
                  detail="expiry"
                  active={expiry === option.id}
                  onClick={() => onExpiryChange(option.id)}
                />
              ))}
            </div>
          </div>
        </div>
      </TerminalInset>
    );
  }

  if (mode === "dca") {
    return (
      <TerminalInset className="grid gap-2 p-[var(--terminal-space-card)]">
        <div className="flex items-center justify-between gap-2">
          <div className="terminal-theme-caption text-[9px] uppercase text-terminal-text-muted">
            Schedule
          </div>
          <div className="terminal-theme-caption text-[9px] uppercase text-terminal-text-secondary">
            DCA cadence
          </div>
        </div>
        <div className="grid gap-2 xl:grid-cols-[1fr_1fr_1.2fr] xl:items-end">
          <div className="terminal-theme-control px-3 py-2.5">
            <div className="terminal-theme-caption text-[9px] uppercase text-terminal-text-muted">
              Total budget
            </div>
            <input
              value={totalBudget}
              onChange={(event) => onTotalBudgetChange(event.target.value)}
              className="mt-1.5 w-full bg-transparent font-mono text-[16px] text-terminal-text outline-none"
              placeholder="1000"
            />
          </div>
          <div className="terminal-theme-control px-3 py-2.5">
            <div className="terminal-theme-caption text-[9px] uppercase text-terminal-text-muted">
              Orders
            </div>
            <input
              value={orderCount}
              onChange={(event) => onOrderCountChange(event.target.value)}
              className="mt-1.5 w-full bg-transparent font-mono text-[16px] text-terminal-text outline-none"
              placeholder="7"
            />
          </div>
          <div className="grid gap-1.5">
            <div className="terminal-theme-caption text-[9px] uppercase text-terminal-text-muted">
              Cadence
            </div>
            <div className="flex flex-wrap gap-1.5">
              {frequencyOptions.map((option) => (
                <TerminalSelectPill
                  key={option.id}
                  label={option.label}
                  detail="frequency"
                  active={frequency === option.id}
                  onClick={() => onFrequencyChange(option.id)}
                />
              ))}
            </div>
          </div>
        </div>
        <div className="grid gap-1.5 md:grid-cols-3">
          <TerminalKeyValueRow
            label="Per order"
            value={estimatedPerOrder(totalBudget, orderCount)}
            detail="Scheduled notional."
          />
          <TerminalKeyValueRow
            label="Cadence"
            value={frequency}
            detail="Execution frequency."
          />
          <TerminalKeyValueRow
            label="Orders"
            value={orderCount || "--"}
            detail="Planned schedule count."
          />
        </div>
      </TerminalInset>
    );
  }

  return (
    <TerminalInset className="grid gap-2 p-[var(--terminal-space-card)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="terminal-theme-caption text-[9px] uppercase text-terminal-text-muted">
          Execution controls
        </div>
        <button
          onClick={onToggleTpSl}
          className="terminal-theme-caption text-[9px] uppercase text-terminal-text-secondary transition-colors hover:text-terminal-text"
        >
          TP / SL {showTpSl ? "on" : "off"}
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {slippageOptions.map((option) => (
          <TerminalSelectPill
            key={option.value}
            label={option.label}
            detail="slippage"
            active={slippage === option.value}
            onClick={() => onSlippageChange(option.value)}
          />
        ))}
      </div>

      {showTpSl ? (
        <div className="grid gap-2 lg:grid-cols-2">
          <div className="terminal-theme-control px-3 py-2.5">
            <div className="terminal-theme-caption text-[9px] uppercase text-terminal-text-muted">
              Take profit
            </div>
            <input
              value={tpPrice}
              onChange={(event) => onTpPriceChange(event.target.value)}
              className="mt-1.5 w-full bg-transparent font-mono text-[16px] text-terminal-text outline-none"
              placeholder="0.00"
            />
          </div>
          <div className="terminal-theme-control px-3 py-2.5">
            <div className="terminal-theme-caption text-[9px] uppercase text-terminal-text-muted">
              Stop loss
            </div>
            <input
              value={slPrice}
              onChange={(event) => onSlPriceChange(event.target.value)}
              className="mt-1.5 w-full bg-transparent font-mono text-[16px] text-terminal-text outline-none"
              placeholder="0.00"
            />
          </div>
        </div>
      ) : null}
    </TerminalInset>
  );
}

function RouteSummary({
  quote,
  mode,
}: {
  quote?: SwapQuote;
  mode: TerminalExecutionMode;
}) {
  const tone = routeTone(quote);

  return (
    <TerminalInset className="grid gap-2 p-[var(--terminal-space-card)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <TerminalStatusPill tone={tone}>
            {routeLabel(quote)}
          </TerminalStatusPill>
          {quote ? <TerminalChainBadge chain={quote.fromToken.chain} /> : null}
          {quote && quote.fromToken.chain !== quote.toToken.chain ? (
            <TerminalChainBadge chain={quote.toToken.chain} />
          ) : null}
        </div>
        <div className="terminal-theme-caption text-[10px] uppercase text-terminal-text-muted">
          {quote ? quote.route : `${mode} summary`}
        </div>
      </div>

      <div className="grid gap-1.5 md:grid-cols-3">
        <TerminalMetricCard
          label={
            mode === "swap"
              ? "Expected out"
              : mode === "limit"
                ? "Target out"
                : "Projected out"
          }
          value={quote ? `${quote.toAmount} ${quote.toToken.symbol}` : "--"}
          detail={quote ? formatUsd(quote.toAmountUsd) : "Waiting for quote"}
          tone={tone}
        />
        <TerminalMetricCard
          label="Impact"
          value={quote ? `${quote.priceImpact.toFixed(2)}%` : "--"}
          detail={quote ? routeLabel(quote) : "No route yet"}
          tone={tone}
        />
        <TerminalMetricCard
          label="Network"
          value={quote ? formatUsd(quote.gasUsd) : "--"}
          detail={
            quote ? formatDuration(quote.estimatedDuration) : "Route timing"
          }
        />
      </div>

      <div className="grid gap-1.5 md:grid-cols-3">
        <TerminalKeyValueRow
          label="Rate"
          value={
            quote
              ? `1 ${quote.fromToken.symbol} = ${quote.exchangeRate.toFixed(4)} ${quote.toToken.symbol}`
              : "--"
          }
          detail="Current route ratio."
        />
        <TerminalKeyValueRow
          label="Min received"
          value={quote ? `${quote.minReceived} ${quote.toToken.symbol}` : "--"}
          detail="Protected output."
        />
        <TerminalKeyValueRow
          label="Expires"
          value={
            quote
              ? new Date(quote.expiresAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "--"
          }
          detail="Route validity."
        />
      </div>
    </TerminalInset>
  );
}

function primaryLabel({
  mode,
  side,
  token,
  isAuthenticated,
  isBusy,
  hasQuote,
}: {
  mode: TerminalExecutionMode;
  side: TerminalExecutionSide;
  token: SwapToken;
  isAuthenticated: boolean;
  isBusy: boolean;
  hasQuote: boolean;
}) {
  if (!isAuthenticated) return "Connect wallet";
  if (isBusy)
    return mode === "swap"
      ? "Staging route..."
      : mode === "limit"
        ? "Placing order..."
        : "Scheduling...";
  if (mode === "swap")
    return `${side === "buy" ? "Buy" : "Sell"} ${token.symbol}`;
  if (mode === "limit") return `Place ${side === "buy" ? "bid" : "ask"}`;
  if (!hasQuote) return "Set DCA schedule";
  return "Schedule DCA";
}

export function TerminalExecutionTicket({
  mode,
  side,
  fromToken,
  toToken,
  amount,
  onAmountChange,
  quote,
  onFlip,
  onModeChange,
  onSideChange,
  slippage,
  slippageOptions,
  onSlippageChange,
  showTpSl,
  onToggleTpSl,
  tpPrice,
  slPrice,
  onTpPriceChange,
  onSlPriceChange,
  limitPrice,
  onLimitPriceChange,
  expiry,
  expiryOptions,
  onExpiryChange,
  totalBudget,
  onTotalBudgetChange,
  frequency,
  frequencyOptions,
  onFrequencyChange,
  orderCount,
  onOrderCountChange,
  onPrimaryAction,
  onSecondaryAction,
  isAuthenticated = true,
  isBusy = false,
}: {
  mode: TerminalExecutionMode;
  side: TerminalExecutionSide;
  fromToken: SwapToken;
  toToken: SwapToken;
  amount: string;
  onAmountChange: (value: string) => void;
  quote?: SwapQuote;
  onFlip: () => void;
  onModeChange: (mode: TerminalExecutionMode) => void;
  onSideChange: (side: TerminalExecutionSide) => void;
  slippage: number;
  slippageOptions: NumericOption[];
  onSlippageChange: (value: number) => void;
  showTpSl: boolean;
  onToggleTpSl: () => void;
  tpPrice: string;
  slPrice: string;
  onTpPriceChange: (value: string) => void;
  onSlPriceChange: (value: string) => void;
  limitPrice: string;
  onLimitPriceChange: (value: string) => void;
  expiry: string;
  expiryOptions: Option[];
  onExpiryChange: (value: string) => void;
  totalBudget: string;
  onTotalBudgetChange: (value: string) => void;
  frequency: string;
  frequencyOptions: Option[];
  onFrequencyChange: (value: string) => void;
  orderCount: string;
  onOrderCountChange: (value: string) => void;
  onPrimaryAction?: () => void;
  onSecondaryAction?: () => void;
  isAuthenticated?: boolean;
  isBusy?: boolean;
}) {
  const buyMode = side === "buy";
  const tone = routeTone(quote);
  const resultAmount =
    mode === "swap"
      ? (quote?.toAmount ?? "")
      : mode === "limit"
        ? (quote?.toAmount ?? "")
        : totalBudget;
  const resultDetail =
    mode === "dca"
      ? `${estimatedPerOrder(totalBudget, orderCount)} / ${frequency}`
      : quote
        ? formatUsd(quote.toAmountUsd)
        : undefined;

  return (
    <div className="grid gap-2.5">
      <div className="grid gap-1.5 lg:grid-cols-[auto_1fr] lg:items-center">
        <div className="flex max-w-[220px] gap-1.5">
          <ExecutionToggle
            active={buyMode}
            onClick={() => onSideChange("buy")}
            tone="bull"
          >
            Buy
          </ExecutionToggle>
          <ExecutionToggle
            active={!buyMode}
            onClick={() => onSideChange("sell")}
            tone="bear"
          >
            Sell
          </ExecutionToggle>
        </div>
        <ExecutionModeTabs mode={mode} onChange={onModeChange} />
      </div>

      <div className="grid gap-2 lg:grid-cols-[1fr_auto_1fr] lg:items-center">
        <AssetLeg
          label={mode === "dca" ? "Funding asset" : "From"}
          token={fromToken}
          amount={mode === "dca" ? totalBudget : amount}
          onAmountChange={mode === "dca" ? onTotalBudgetChange : onAmountChange}
          usdValue={quote?.fromAmountUsd}
          detail={
            mode === "dca" ? "Total schedule budget" : "Operator entry size"
          }
        />

        <div className="flex justify-center">
          <button
            onClick={onFlip}
            className="terminal-theme-control inline-flex h-9 w-9 items-center justify-center text-terminal-text-secondary hover:text-terminal-text hover:translate-y-0 focus:translate-y-0"
            aria-label="Flip assets"
          >
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
                d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"
              />
            </svg>
          </button>
        </div>

        <AssetLeg
          label={
            mode === "swap"
              ? "To"
              : mode === "limit"
                ? "Target asset"
                : "Accumulating"
          }
          token={toToken}
          amount={inputValue(resultAmount)}
          usdValue={
            mode === "dca"
              ? (safeNumber(totalBudget) ?? undefined)
              : quote?.toAmountUsd
          }
          readOnly
          detail={resultDetail}
        />
      </div>

      <div className="grid gap-2 xl:grid-cols-[0.94fr_1.06fr]">
        <TicketMeta
          mode={mode}
          slippage={slippage}
          slippageOptions={slippageOptions}
          onSlippageChange={onSlippageChange}
          showTpSl={showTpSl}
          onToggleTpSl={onToggleTpSl}
          tpPrice={tpPrice}
          slPrice={slPrice}
          onTpPriceChange={onTpPriceChange}
          onSlPriceChange={onSlPriceChange}
          limitPrice={limitPrice}
          onLimitPriceChange={onLimitPriceChange}
          expiry={expiry}
          expiryOptions={expiryOptions}
          onExpiryChange={onExpiryChange}
          totalBudget={totalBudget}
          onTotalBudgetChange={onTotalBudgetChange}
          frequency={frequency}
          frequencyOptions={frequencyOptions}
          onFrequencyChange={onFrequencyChange}
          orderCount={orderCount}
          onOrderCountChange={onOrderCountChange}
        />

        <RouteSummary quote={quote} mode={mode} />
      </div>

      <div className="grid gap-2 md:grid-cols-[1fr_auto] md:items-center">
        <div className="flex flex-wrap items-center gap-2">
          <TerminalStatusPill tone={tone}>{mode}</TerminalStatusPill>
          <TerminalStatusPill tone="neutral">
            {slippage}% slippage
          </TerminalStatusPill>
          {mode === "swap" && showTpSl ? (
            <TerminalStatusPill tone="warm">TP / SL armed</TerminalStatusPill>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2 md:justify-end">
          <TerminalButton variant="secondary" onClick={onSecondaryAction}>
            Save draft
          </TerminalButton>
          <TerminalButton onClick={onPrimaryAction}>
            {primaryLabel({
              mode,
              side,
              token: toToken,
              isAuthenticated,
              isBusy,
              hasQuote: Boolean(quote),
            })}
          </TerminalButton>
        </div>
      </div>
    </div>
  );
}
