import type { OrderBookLevel } from "../../hooks/useOrderBook";

function formatPrice(price: number, precision: number): string {
  const decimals = Math.max(2, -Math.log10(precision));
  return price.toFixed(decimals);
}

function formatSize(size: number): string {
  return size.toFixed(4);
}

export function TerminalOrderBookDepthRow({
  level,
  maxTotal,
  side,
  precision,
}: {
  level: OrderBookLevel;
  maxTotal: number;
  side: "bid" | "ask";
  precision: number;
}) {
  const bid = side === "bid";
  const width = maxTotal > 0 ? (level.total / maxTotal) * 100 : 0;

  return (
    <div className="terminal-row relative grid grid-cols-3 items-center gap-2 overflow-hidden px-2 py-0.5 font-mono text-[9px] leading-4 [border-radius:var(--terminal-radius-card)]">
      <div
        className={`absolute inset-y-0 right-0 ${bid ? "up-wash" : "down-wash"}`}
        style={{ width: `${width}%` }}
      />
      <span
        className={`relative z-10 tnum ${bid ? "text-bull" : "text-bear"}`}
      >
        {bid ? "▲" : "▼"} {formatPrice(level.price, precision)}
      </span>
      <span className="relative z-10 text-right tnum text-terminal-text-secondary">
        {formatSize(level.size)}
      </span>
      <span className="relative z-10 text-right tnum text-terminal-text-muted">
        {formatSize(level.total)}
      </span>
    </div>
  );
}
