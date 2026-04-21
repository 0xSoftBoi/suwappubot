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
    <div className="relative grid grid-cols-3 items-center gap-2 overflow-hidden px-2.5 py-1 font-mono text-[10px] leading-4 transition-colors hover:bg-white/70 [border-radius:var(--terminal-radius-card)]">
      <div
        className={`absolute inset-y-0 ${bid ? "right-0 bg-bull/10" : "right-0 bg-bear/10"}`}
        style={{ width: `${width}%` }}
      />
      <span className={`relative z-10 ${bid ? "text-bull" : "text-bear"}`}>
        {formatPrice(level.price, precision)}
      </span>
      <span className="relative z-10 text-right text-terminal-text-secondary">
        {formatSize(level.size)}
      </span>
      <span className="relative z-10 text-right text-terminal-text-muted">
        {formatSize(level.total)}
      </span>
    </div>
  );
}
