const INTERVALS = [
  { id: "1m", label: "1m", key: "1" },
  { id: "5m", label: "5m", key: "2" },
  { id: "15m", label: "15m", key: "3" },
  { id: "1h", label: "1H", key: "4" },
  { id: "4h", label: "4H", key: "5" },
  { id: "1D", label: "1D", key: "6" },
];

function joinClasses(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

interface Props {
  interval: string;
  onIntervalChange: (interval: string) => void;
  chartType: "candle" | "line";
  onChartTypeChange: (type: "candle" | "line") => void;
}

export function ChartToolbar({
  interval,
  onIntervalChange,
  chartType,
  onChartTypeChange,
}: Props) {
  return (
    <div className="terminal-chart-toolbar terminal-theme-inset flex items-center justify-between gap-2 overflow-x-auto px-2 py-1.5">
      <div className="flex flex-wrap items-center gap-1">
        {INTERVALS.map((i) => (
          <button
            key={i.id}
            onClick={() => onIntervalChange(i.id)}
            className={joinClasses(
              "terminal-theme-control min-h-[28px] min-w-[36px] px-2 py-0.5 font-mono text-[11px] leading-none transition-colors hover:translate-y-0 focus:translate-y-0 active:scale-[0.98]",
              interval === i.id
                ? "terminal-theme-control-active text-terminal-text"
                : "text-terminal-text-secondary hover:text-terminal-text",
            )}
            title={`Press ${i.key}`}
          >
            {i.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={() => onChartTypeChange("candle")}
          aria-label="Candlestick chart"
          aria-pressed={chartType === "candle"}
          className={joinClasses(
            "terminal-theme-control inline-flex h-7 w-7 items-center justify-center transition-colors hover:translate-y-0 focus:translate-y-0 active:scale-[0.98]",
            chartType === "candle"
              ? "terminal-theme-control-active text-terminal-text"
              : "text-terminal-text-muted hover:text-terminal-text",
          )}
          title="Candlestick"
        >
          <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
            <rect x="3" y="2" width="2" height="12" rx="0.5" />
            <rect x="7" y="4" width="2" height="8" rx="0.5" />
            <rect x="11" y="1" width="2" height="14" rx="0.5" />
          </svg>
        </button>
        <button
          onClick={() => onChartTypeChange("line")}
          aria-label="Line chart"
          aria-pressed={chartType === "line"}
          className={joinClasses(
            "terminal-theme-control inline-flex h-7 w-7 items-center justify-center transition-colors hover:translate-y-0 focus:translate-y-0 active:scale-[0.98]",
            chartType === "line"
              ? "terminal-theme-control-active text-terminal-text"
              : "text-terminal-text-muted hover:text-terminal-text",
          )}
          title="Line"
        >
          <svg
            className="w-4 h-4"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <polyline points="1,12 4,8 7,10 10,4 14,6" />
          </svg>
        </button>
      </div>
    </div>
  );
}
