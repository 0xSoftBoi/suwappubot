import { TerminalEmptyState, TerminalStatusPill } from "../foundation";
import type { BridgeRoute } from "../../types/bridge";
import {
  TRUST_COPY,
  formatDuration,
  guaranteedShortfall,
  netValueUsd,
} from "./custody";

/**
 * Route selection.
 *
 * Ordered by what actually arrives net of cost — never by the headline
 * output. A pooled route can quote a higher nominal amount and still be the
 * worse choice once its spread and fees are counted, and that inversion is
 * exactly what a naive "best rate" list hides.
 *
 * The second thing it refuses to hide: a 1:1 mint/burn rail cannot lose value
 * to price impact, while a pooled route can. That is a difference in kind,
 * not in degree, so it is stated per row rather than buried in a tooltip.
 */

interface Props {
  routes: BridgeRoute[];
  selectedProvider: string | null;
  onSelect: (route: BridgeRoute) => void;
  /** Used only to rank and to show net value. */
  tokenPriceUsd: number;
  isLoading?: boolean;
}

export function BridgeRouteList({
  routes,
  selectedProvider,
  onSelect,
  tokenPriceUsd,
  isLoading = false,
}: Props) {
  if (isLoading) {
    return (
      <div className="space-y-1.5" aria-busy="true" aria-label="Finding routes">
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className="terminal-theme-inset h-[76px] animate-pulse rounded-[var(--terminal-radius-card)] opacity-60 motion-reduce:animate-none"
          />
        ))}
      </div>
    );
  }

  if (routes.length === 0) {
    return (
      <TerminalEmptyState
        title="No route for this pair"
        description="Try a different amount, or a chain with a direct rail. Not every token can move between every pair of chains."
      />
    );
  }

  const ranked = [...routes].sort(
    (a, b) => netValueUsd(b, tokenPriceUsd) - netValueUsd(a, tokenPriceUsd),
  );
  const best = ranked[0];

  return (
    <div
      role="radiogroup"
      aria-label="Bridge routes"
      className="space-y-1.5"
    >
      {ranked.map((route) => {
        const trust = TRUST_COPY[route.trustModel];
        const isSelected = route.provider === selectedProvider;
        const isBest = route.provider === best.provider;
        const shortfall = guaranteedShortfall(route);

        return (
          <button
            key={route.provider}
            type="button"
            role="radio"
            aria-checked={isSelected}
            onClick={() => onSelect(route)}
            className={joinClasses(
              "hairline w-full rounded-[var(--terminal-radius-card)] px-3 py-2.5 text-left transition-colors",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-terminal-accent",
              "motion-reduce:transition-none",
              isSelected
                ? "border-terminal-accent bg-terminal-accent/5"
                : "bg-terminal-bg hover:bg-terminal-bg-secondary",
            )}
          >
            <div className="flex items-baseline justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-semibold text-terminal-text">
                  {route.toAmountHuman.toLocaleString(undefined, {
                    maximumFractionDigits: 6,
                  })}{" "}
                  {route.token}
                </span>
                {isBest ? (
                  <TerminalStatusPill tone="accent">Best net</TerminalStatusPill>
                ) : null}
              </div>
              <span className="tnum shrink-0 font-mono text-[11px] text-terminal-text-secondary">
                {formatDuration(route.estimatedTime)}
              </span>
            </div>

            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
              <TerminalStatusPill tone={trust.tone}>
                {trust.label}
              </TerminalStatusPill>
              <TerminalStatusPill tone={route.zeroSlippage ? "accent" : "neutral"}>
                {route.zeroSlippage ? "1:1 — no price impact" : "Pooled"}
              </TerminalStatusPill>
              <span className="text-[10px] uppercase tracking-wide text-terminal-text-secondary">
                {route.provider}
              </span>
            </div>

            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
              <div className="flex justify-between">
                <dt className="text-terminal-text-secondary">Total cost</dt>
                <dd className="tnum font-mono text-terminal-text">
                  ${route.totalCostUsd.toFixed(2)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-terminal-text-secondary">
                  {route.zeroSlippage ? "Guaranteed" : "At least"}
                </dt>
                <dd className="tnum font-mono text-terminal-text">
                  {shortfall > 0
                    ? `−${(shortfall * 100).toFixed(2)}%`
                    : "full amount"}
                </dd>
              </div>
            </dl>
          </button>
        );
      })}
    </div>
  );
}

function joinClasses(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}
