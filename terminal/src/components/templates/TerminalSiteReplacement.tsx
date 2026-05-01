import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  PersimmonMark,
  PersimmonStemMotif,
  SakuraBloomMotif,
} from "../brand/PersimmonLogo";
import { TerminalThemeScope } from "../../theme/TerminalThemeScope";

type Market = {
  symbol: string;
  pair: string;
  name: string;
  chain: string;
  price: string;
  change: string;
  volume: string;
  route: string;
  accent: string;
  tint: string;
  soft: string;
};

const markets: Market[] = [
  {
    symbol: "ETH",
    pair: "ETH/USDC",
    name: "Ethereum",
    chain: "Ethereum",
    price: "$3,483.28",
    change: "+6.94%",
    volume: "$88.9K",
    route: "ETH -> USDC",
    accent: "#0ea5e9",
    tint: "rgba(14, 165, 233, 0.18)",
    soft: "#dff7ff",
  },
  {
    symbol: "SOL",
    pair: "SOL/USDC",
    name: "Solana",
    chain: "Solana",
    price: "$182.34",
    change: "+2.14%",
    volume: "$41.2K",
    route: "SOL -> USDC",
    accent: "#e58d2b",
    tint: "rgba(229, 141, 43, 0.18)",
    soft: "#fff0d4",
  },
  {
    symbol: "JUP",
    pair: "JUP/SOL",
    name: "Jupiter",
    chain: "Solana",
    price: "$1.18",
    change: "-1.08%",
    volume: "$19.8K",
    route: "JUP -> SOL",
    accent: "#e66d85",
    tint: "rgba(230, 109, 133, 0.18)",
    soft: "#ffe5ec",
  },
  {
    symbol: "BASE",
    pair: "BASE/ETH",
    name: "Base",
    chain: "Base",
    price: "$1.02",
    change: "+0.62%",
    volume: "$12.4K",
    route: "BASE -> ETH",
    accent: "#2f8f5b",
    tint: "rgba(47, 143, 91, 0.16)",
    soft: "#e2f6eb",
  },
];

const candles = [
  36, 32, 42, 39, 48, 58, 52, 66, 61, 73, 68, 77, 71, 64, 78, 82, 74, 80,
  86, 76, 84, 90, 81, 88, 92, 85, 94, 89,
];

const orderRows = [
  ["3245.60", "3.0244", "60.0843"],
  ["3245.59", "2.6181", "57.0599"],
  ["3245.58", "5.4322", "54.4418"],
  ["3245.57", "5.2265", "49.0096"],
  ["3245.56", "11.9095", "43.7831"],
  ["3245.55", "8.1606", "31.8736"],
  ["3245.54", "6.8441", "23.7130"],
  ["3245.53", "8.7420", "16.8689"],
];

const walletRows = [
  ["0x3b6d...3c4d", "Treasury lane", "$9,842.11", "+4.8%"],
  ["So1111...1112", "Solana float", "$4,102.33", "+2.1%"],
  ["0x8453...base", "Base scout", "$1,904.20", "-0.7%"],
];

const tabs = ["Portfolio", "Discovery", "Watchlist", "Copy", "Wallets", "Signals"];

function joinClasses(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function Surface({
  children,
  className,
  motif = "bloom",
}: {
  children: ReactNode;
  className?: string;
  motif?: "bloom" | "stem" | "coin" | "none";
}) {
  return (
    <section
      className={joinClasses(
        "terminal-theme-panel min-w-0 p-2 md:p-3",
        className,
      )}
    >
      {motif !== "none" ? (
        <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
          {motif === "bloom" ? (
            <div className="absolute -right-8 -top-8 opacity-[0.11]">
              <SakuraBloomMotif size={116} tone="mist" rotation={18} />
            </div>
          ) : null}
          {motif === "stem" ? (
            <div className="absolute -bottom-14 -right-16 opacity-[0.1]">
              <PersimmonStemMotif
                size={180}
                palette="butter"
                rotation={28}
                flipX
              />
            </div>
          ) : null}
          {motif === "coin" ? (
            <div className="absolute -right-4 -top-4 opacity-[0.1]">
              <PersimmonMark
                size={92}
                palette="butter"
                variant="orchard"
                shell="coin"
                frame="none"
                cutoutMode="none"
                withGlow={false}
              />
            </div>
          ) : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

function Header({
  market,
  onMarketChange,
}: {
  market: Market;
  onMarketChange: (symbol: string) => void;
}) {
  return (
    <header className="terminal-theme-panel flex min-w-0 flex-col gap-2 p-2 md:grid md:grid-cols-[360px_1fr_auto] md:items-center md:gap-3 md:p-3">
      <div className="flex min-w-0 items-center gap-3 md:gap-4">
        <span className="relative -my-2 -ml-1 shrink-0 md:hidden">
          <PersimmonMark
            size={74}
            palette="butter"
            variant="orchard"
            shell="coin"
            frame="none"
            cutoutMode="none"
            withGlow={false}
          />
        </span>
        <span className="relative -my-3 -ml-2 hidden shrink-0 md:block">
          <PersimmonMark
            size={96}
            palette="butter"
            variant="orchard"
            shell="coin"
            frame="none"
            cutoutMode="none"
            withGlow={false}
          />
        </span>
        <div className="min-w-0">
          <div className="terminal-theme-heading truncate text-lg font-semibold leading-5 text-terminal-text md:text-2xl md:leading-7">
            Suwappu Terminal
          </div>
          <div className="truncate text-[11px] text-terminal-text-muted md:text-xs">
            {market.chain} execution workspace
          </div>
        </div>
      </div>
      <div className="grid min-w-0 grid-cols-4 gap-1 md:flex md:items-center md:gap-1.5">
        {markets.map((item) => (
          <button
            key={item.symbol}
            type="button"
            onClick={() => onMarketChange(item.symbol)}
            className={joinClasses(
              "terminal-theme-control min-w-0 rounded-[6px] px-2 py-1.5 font-mono text-[10px] transition-colors md:px-3 md:text-xs",
              item.symbol === market.symbol
                ? "text-terminal-text"
                : "text-terminal-text-muted",
            )}
            style={
              item.symbol === market.symbol
                ? {
                    borderColor: item.accent,
                    background: `linear-gradient(180deg, rgba(255,255,255,0.94), ${item.tint})`,
                  }
                : undefined
            }
          >
            {item.pair}
          </button>
        ))}
      </div>
      <button className="terminal-button min-h-9 rounded-[7px] px-4 text-sm font-semibold">
        Connect Wallet
      </button>
    </header>
  );
}

function MetricStrip({ market }: { market: Market }) {
  return (
    <Surface className="grid grid-cols-3 gap-1 p-1.5 md:grid-cols-6" motif="stem">
      {[
        ["Pair", market.pair],
        ["Price", market.price],
        ["24h", market.change],
        ["Volume", market.volume],
        ["Route", market.route],
        ["Health", "98.2%"],
      ].map(([label, value]) => (
        <div
          key={label}
          className="terminal-theme-inset min-w-0 rounded-[6px] px-2 py-1.5"
        >
          <div className="terminal-theme-caption truncate text-[8px] uppercase text-terminal-text-muted">
            {label}
          </div>
          <div
            className={joinClasses(
              "mt-0.5 truncate font-mono text-[10px] font-semibold md:text-xs",
              label === "24h" ? "text-bull" : "text-terminal-text",
            )}
          >
            {value}
          </div>
        </div>
      ))}
    </Surface>
  );
}

function ChartPanel({ market }: { market: Market }) {
  return (
    <Surface className="min-h-[360px] p-2 md:min-h-0" motif="coin">
      <div className="mb-2 flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="terminal-theme-caption text-[9px] uppercase text-terminal-text-muted">
            Price workspace
          </div>
          <h2 className="mt-0.5 truncate text-lg font-semibold text-terminal-text md:text-2xl">
            {market.route}
          </h2>
        </div>
        <div className="text-right font-mono">
          <div className="text-sm font-semibold text-terminal-text md:text-lg">
            {market.price}
          </div>
          <div className="text-xs text-bull">{market.change}</div>
        </div>
      </div>
      <div
        className="relative h-[288px] overflow-hidden rounded-[8px] border border-terminal-border md:h-full md:min-h-[420px]"
        style={{
          background: `radial-gradient(circle at 82% 12%, ${market.tint}, transparent 24%), linear-gradient(180deg, rgba(255,255,255,0.88), rgba(240,252,255,0.58))`,
        }}
      >
        <div className="absolute inset-0 bg-[linear-gradient(rgba(142,182,197,0.34)_1px,transparent_1px),linear-gradient(90deg,rgba(142,182,197,0.3)_1px,transparent_1px)] bg-[size:72px_48px]" />
        <div className="absolute left-2 top-2 z-10 flex gap-1">
          {["1m", "5m", "15m", "1H", "4H", "1D"].map((range) => (
            <button
              key={range}
              className={joinClasses(
                "h-7 rounded-[5px] border px-2 font-mono text-[10px]",
                range === "1H"
                  ? "border-terminal-border-active bg-white text-terminal-text"
                  : "border-transparent text-terminal-text-muted",
              )}
            >
              {range}
            </button>
          ))}
        </div>
        <div className="absolute inset-x-0 top-[48%] border-t border-dashed border-[#e66d85]/80" />
        <div className="absolute bottom-8 left-2 right-10 top-14 flex items-end gap-[4px]">
          {candles.map((height, index) => {
            const up = index % 5 !== 1;
            return (
              <div
                key={`${height}-${index}`}
                className="relative flex h-full flex-1 items-end justify-center"
              >
                <span
                  className={joinClasses(
                    "absolute w-px",
                    up ? "bg-[#2f8f5b]" : "bg-[#e66d85]",
                  )}
                  style={{
                    bottom: `${Math.max(4, height - 18)}%`,
                    height: `${Math.min(30, height / 2)}%`,
                  }}
                />
                <span
                  className={joinClasses(
                    "w-full max-w-[9px] rounded-t-[2px]",
                    up ? "bg-[#2f8f5b]" : "bg-[#e66d85]",
                  )}
                  style={{ height: `${height}%` }}
                />
              </div>
            );
          })}
        </div>
        <div className="absolute bottom-0 left-0 right-0 flex h-16 items-end gap-[4px] border-t border-terminal-border/70 px-2 opacity-50">
          {candles.map((height, index) => (
            <span
              key={`volume-${height}-${index}`}
              className={index % 5 === 1 ? "bg-[#e66d85]" : "bg-[#2f8f5b]"}
              style={{ height: `${Math.max(20, height * 0.55)}%`, flex: 1 }}
            />
          ))}
        </div>
        <div
          className="absolute right-2 top-[46%] rounded-[5px] px-2 py-1 font-mono text-[10px] font-semibold text-white"
          style={{ background: market.accent }}
        >
          {market.price}
        </div>
      </div>
    </Surface>
  );
}

function MarketTable({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (symbol: string) => void;
}) {
  return (
    <Surface className="p-0" motif="bloom">
      <div className="flex items-center justify-between border-b border-terminal-border px-2 py-2">
        <h3 className="text-sm font-semibold text-terminal-text">Market table</h3>
        <span className="terminal-theme-pill border border-terminal-border px-2 py-0.5 text-[9px] uppercase text-terminal-text-muted">
          Live reads
        </span>
      </div>
      <div className="grid grid-cols-[minmax(6.5rem,1fr)_5.75rem_4.25rem] gap-2 border-b border-terminal-border/70 px-2 py-1.5 font-mono text-[9px] uppercase text-terminal-text-muted md:grid-cols-[minmax(7.5rem,1fr)_6.25rem_4.5rem]">
        <span>Asset</span>
        <span className="text-right">Price</span>
        <span className="text-right">24h</span>
      </div>
      {markets.map((row) => (
        <button
          key={row.symbol}
          type="button"
          onClick={() => onSelect(row.symbol)}
          className="grid w-full min-w-0 grid-cols-[minmax(6.5rem,1fr)_5.75rem_4.25rem] items-center gap-2 border-b border-l-2 border-b-terminal-border/50 px-2 py-2 text-left last:border-b-0 md:grid-cols-[minmax(7.5rem,1fr)_6.25rem_4.5rem]"
          style={{
            borderLeftColor: selected === row.symbol ? row.accent : "transparent",
            background:
              selected === row.symbol
                ? `linear-gradient(90deg, ${row.tint}, rgba(255,255,255,0.72))`
                : undefined,
          }}
        >
          <div className="min-w-0">
            <div className="truncate text-xs font-semibold text-terminal-text">
              {row.pair}
            </div>
            <div className="truncate text-[10px] text-terminal-text-muted">
              {row.name} - Vol {row.volume}
            </div>
          </div>
          <span className="truncate text-right font-mono text-xs font-semibold text-terminal-text">
            {row.price}
          </span>
          <span
            className={joinClasses(
              "text-right font-mono text-[11px]",
              row.change.startsWith("-") ? "text-[#b75d21]" : "text-bull",
            )}
          >
            {row.change}
          </span>
        </button>
      ))}
    </Surface>
  );
}

function OrderBook() {
  return (
    <Surface className="p-0" motif="stem">
      <div className="flex items-center justify-between border-b border-terminal-border px-2 py-2">
        <h3 className="text-sm font-semibold text-terminal-text">Order book</h3>
        <span className="rounded-[5px] border border-terminal-border bg-white px-2 py-0.5 font-mono text-[10px] text-terminal-text-muted">
          0.01
        </span>
      </div>
      <div className="grid grid-cols-3 px-2 py-1 font-mono text-[9px] uppercase text-terminal-text-muted">
        <span>Price</span>
        <span className="text-right">Size</span>
        <span className="text-right">Total</span>
      </div>
      <div className="px-2 pb-2 font-mono text-[11px]">
        {orderRows.map((row, index) => (
          <div key={`${row[0]}-ask`} className="relative grid grid-cols-3 py-0.5">
            <span className="relative z-10 text-[#b75d21]">{row[0]}</span>
            <span className="relative z-10 text-right text-terminal-text-secondary">
              {row[1]}
            </span>
            <span className="relative z-10 text-right text-terminal-text-muted">
              {row[2]}
            </span>
            <span
              className="absolute right-0 top-0 h-full rounded-[2px] bg-[#e66d85]/10"
              style={{ width: `${24 + index * 8}%` }}
            />
          </div>
        ))}
        <div className="my-1 border-t border-terminal-border py-1 text-center text-[10px] text-terminal-text-muted">
          Spread 0.02 (0.001%)
        </div>
        {orderRows
          .slice()
          .reverse()
          .map((row, index) => (
            <div key={`${row[0]}-bid`} className="relative grid grid-cols-3 py-0.5">
              <span className="relative z-10 text-bull">{row[0]}</span>
              <span className="relative z-10 text-right text-terminal-text-secondary">
                {row[1]}
              </span>
              <span className="relative z-10 text-right text-terminal-text-muted">
                {row[2]}
              </span>
              <span
                className="absolute right-0 top-0 h-full rounded-[2px] bg-[#2f8f5b]/10"
                style={{ width: `${24 + index * 8}%` }}
              />
            </div>
          ))}
      </div>
    </Surface>
  );
}

function SwapTicket({ market }: { market: Market }) {
  const [side, setSide] = useState<"Buy" | "Sell">("Buy");

  return (
    <Surface className="grid gap-2" motif="coin">
      <div className="grid grid-cols-2 gap-1">
        {(["Buy", "Sell"] as const).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setSide(item)}
            className={joinClasses(
              "min-h-9 rounded-[6px] border text-sm font-semibold",
              side === item
                ? item === "Buy"
                  ? "border-[#2f8f5b] bg-[#2f8f5b] text-white"
                  : "border-[#e66d85] bg-[#e66d85] text-white"
                : "border-terminal-border bg-white text-terminal-text-secondary",
            )}
          >
            {item}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-1 text-xs">
        {["Swap", "Limit", "DCA"].map((item) => (
          <button
            key={item}
            className={joinClasses(
              "rounded-[6px] border px-2 py-1.5",
              item === "Swap"
                ? "border-terminal-border-active bg-white text-terminal-text"
                : "border-transparent text-terminal-text-muted",
            )}
          >
            {item}
          </button>
        ))}
      </div>
      {["From", "To"].map((label, index) => (
        <div key={label} className="terminal-theme-inset rounded-[7px] p-2">
          <div className="text-[10px] text-terminal-text-muted">{label}</div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="font-mono text-xl font-semibold text-terminal-text">
              {index === 0 ? "0.0" : market.price.replace("$", "")}
            </span>
            <button className="rounded-[6px] border border-terminal-border bg-white px-3 py-1 text-xs text-terminal-text-secondary">
              Select
            </button>
          </div>
        </div>
      ))}
      <div className="flex items-center justify-between gap-2 text-xs text-terminal-text-muted">
        <span>Slippage</span>
        <div className="flex gap-1">
          {["0.1%", "0.5%", "1%"].map((item) => (
            <button
              key={item}
              className={joinClasses(
                "rounded-[5px] border px-2 py-1 font-mono",
                item === "0.5%"
                  ? "border-[#0ea5e9] bg-white text-[#0b789a]"
                  : "border-terminal-border text-terminal-text-muted",
              )}
            >
              {item}
            </button>
          ))}
        </div>
      </div>
      <button className="terminal-button min-h-10 rounded-[7px] text-sm font-semibold">
        Connect Wallet
      </button>
    </Surface>
  );
}

function WalletRail() {
  return (
    <Surface className="p-0" motif="bloom">
      <div className="flex items-center justify-between border-b border-terminal-border px-2 py-2">
        <h3 className="text-sm font-semibold text-terminal-text">Wallet rail</h3>
        <span className="text-[10px] text-terminal-text-muted">3 tracked</span>
      </div>
      <div className="grid divide-y divide-terminal-border/60">
        {walletRows.map((row) => (
          <div key={row[0]} className="grid grid-cols-[1fr_auto] gap-2 px-2 py-2">
            <div className="min-w-0">
              <div className="truncate font-mono text-xs text-terminal-text">
                {row[0]}
              </div>
              <div className="truncate text-[10px] text-terminal-text-muted">
                {row[1]}
              </div>
            </div>
            <div className="text-right">
              <div className="font-mono text-xs font-semibold text-terminal-text">
                {row[2]}
              </div>
              <div
                className={joinClasses(
                  "font-mono text-[10px]",
                  row[3].startsWith("+") ? "text-bull" : "text-[#b75d21]",
                )}
              >
                {row[3]}
              </div>
            </div>
          </div>
        ))}
      </div>
    </Surface>
  );
}

function BottomWorkspace() {
  const [tab, setTab] = useState("Portfolio");

  return (
    <Surface className="hidden h-36 overflow-hidden p-0 md:block" motif="stem">
      <div className="flex min-w-0 items-center justify-between border-b border-terminal-border">
        <div className="flex min-w-0 overflow-x-auto px-1">
          {tabs.map((item) => (
            <button
              key={item}
              onClick={() => setTab(item)}
              className={joinClasses(
                "shrink-0 border-b-2 px-3 py-2 text-sm",
                tab === item
                  ? "border-[#0ea5e9] text-terminal-text"
                  : "border-transparent text-terminal-text-muted",
              )}
            >
              {item}
            </button>
          ))}
        </div>
        <div className="flex gap-2 px-2">
          <button className="rounded-[6px] border border-terminal-border bg-white px-4 py-1.5 text-xs text-terminal-text">
            Deposit
          </button>
          <button className="rounded-[6px] border border-terminal-border bg-white px-4 py-1.5 text-xs text-terminal-text">
            Withdraw
          </button>
        </div>
      </div>
      <div className="grid grid-cols-4 divide-x divide-terminal-border/70">
        {walletRows.map((row) => (
          <div key={row[0]} className="min-w-0 p-3">
            <div className="truncate font-mono text-xs text-terminal-text">
              {row[0]}
            </div>
            <div className="truncate text-[10px] text-terminal-text-muted">
              {row[1]}
            </div>
            <div className="mt-2 font-mono text-lg text-terminal-text">
              {row[2]}
            </div>
          </div>
        ))}
        <div className="p-3 text-xs text-terminal-text-muted">
          Connect wallet for portfolio depth
        </div>
      </div>
    </Surface>
  );
}

export function TerminalSiteReplacement() {
  const [selectedSymbol, setSelectedSymbol] = useState("ETH");
  const market = useMemo(
    () => markets.find((item) => item.symbol === selectedSymbol) ?? markets[0],
    [selectedSymbol],
  );

  return (
    <TerminalThemeScope mode="summer-breeze">
      <div className="terminal-theme-page min-h-screen p-1.5 text-terminal-text md:h-screen md:overflow-hidden md:p-3">
        <div className="pointer-events-none fixed -left-20 top-20 hidden opacity-[0.08] md:block">
          <PersimmonStemMotif size={260} palette="butter" rotation={-18} />
        </div>
        <div className="pointer-events-none fixed right-[-54px] top-24 hidden opacity-[0.1] md:block">
          <SakuraBloomMotif size={180} tone="mist" rotation={24} />
        </div>
        <div className="pointer-events-none fixed bottom-[-90px] right-[22%] hidden opacity-[0.08] md:block">
          <PersimmonStemMotif
            size={300}
            palette="butter"
            rotation={24}
            flipX
          />
        </div>
        <div className="mx-auto grid min-h-full max-w-[1440px] grid-rows-[auto_auto_1fr_auto] gap-2 md:gap-3">
          <Header market={market} onMarketChange={setSelectedSymbol} />
          <MetricStrip market={market} />
          <main className="grid min-h-0 gap-2 md:grid-cols-[minmax(0,1.45fr)_minmax(270px,0.72fr)_minmax(290px,0.68fr)] md:gap-3">
            <ChartPanel market={market} />
            <div className="grid min-h-0 gap-2 md:gap-3">
              <MarketTable selected={market.symbol} onSelect={setSelectedSymbol} />
              <OrderBook />
            </div>
            <aside className="grid content-start gap-2 md:gap-3">
              <SwapTicket market={market} />
              <WalletRail />
            </aside>
          </main>
          <BottomWorkspace />
        </div>
      </div>
    </TerminalThemeScope>
  );
}
