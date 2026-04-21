import type { WatchlistToken } from "../../hooks/useWatchlist";
import type { TokenPriceData } from "../../hooks/useWatchlistPrices";
import {
  TerminalChainBadge,
  TerminalDeltaText,
} from "../foundation/TerminalDataDisplay";

function formatPrice(price: number): string {
  if (price >= 1000)
    return `$${price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  if (price >= 1) return `$${price.toFixed(2)}`;
  if (price >= 0.01) return `$${price.toFixed(4)}`;
  if (price >= 0.0001) return `$${price.toFixed(6)}`;
  return `$${price.toExponential(2)}`;
}

export function TerminalWatchlistRow({
  token,
  priceData,
  selected = false,
  onOpen,
  onRemove,
}: {
  token: WatchlistToken;
  priceData: TokenPriceData;
  selected?: boolean;
  onOpen?: (token: WatchlistToken) => void;
  onRemove?: (token: WatchlistToken) => void;
}) {
  const { price, change24h, loading } = priceData;
  const positive = change24h !== null && change24h >= 0;

  return (
    <div
      className={`group grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] items-center gap-2.5 border px-2.5 py-2 transition-colors [border-radius:var(--terminal-radius-inset)] ${
        selected
          ? "border-terminal-border-active bg-white [box-shadow:var(--terminal-shadow-raised)]"
          : "border-terminal-border bg-terminal-bg-secondary hover:bg-white"
      }`}
      onClick={() => onOpen?.(token)}
    >
      <span
        className={`h-2.5 w-2.5 rounded-full ${loading ? "bg-terminal-border animate-pulse" : positive ? "bg-bull" : change24h === null ? "bg-terminal-border" : "bg-bear"}`}
      />

      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold leading-none text-terminal-text">
            {token.symbol}
          </span>
          <TerminalChainBadge chain={token.chain} />
        </div>
        <div className="mt-0.5 truncate text-[11px] leading-4 text-terminal-text-secondary">
          {token.name}
        </div>
      </div>

      <div className="text-right">
        <div className="text-[10px] text-terminal-text-muted">Price</div>
        <div className="mt-0.5 font-mono text-[13px] text-terminal-text">
          {loading ? (
            <span className="inline-block h-3 w-14 rounded bg-terminal-bg-tertiary animate-shimmer" />
          ) : price !== null ? (
            formatPrice(price)
          ) : (
            "--"
          )}
        </div>
      </div>

      <div className="text-right">
        <div className="text-[10px] text-terminal-text-muted">24h</div>
        <div className="mt-0.5">
          <TerminalDeltaText value={change24h} loading={loading} />
        </div>
      </div>

      <button
        onClick={(event) => {
          event.stopPropagation();
          onRemove?.(token);
        }}
        className="border border-transparent px-1.5 py-1.5 text-terminal-text-muted opacity-0 transition-all hover:border-terminal-border hover:bg-white hover:text-bear group-hover:opacity-100 [border-radius:var(--terminal-radius-card)]"
        title="Remove token"
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
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>
    </div>
  );
}
