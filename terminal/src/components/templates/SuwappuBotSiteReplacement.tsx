import type { ReactNode } from "react";
import {
  PersimmonMark,
  PersimmonStemMotif,
  SakuraBloomMotif,
} from "../brand/PersimmonLogo";
import { TerminalThemeScope } from "../../theme/TerminalThemeScope";

const productModules = [
  {
    title: "Terminal",
    eyebrow: "Live workspace",
    body: "Chart, market table, order book, swap ticket, wallet rail, and execution controls in one dense trading surface.",
    stat: "Full desk",
  },
  {
    title: "Agent API",
    eyebrow: "Execution layer",
    body: "Quotes, swaps, status checks, perps, prediction markets, lending, and managed wallet actions through one API.",
    stat: "15+ chains",
  },
  {
    title: "Telegram bot",
    eyebrow: "Fast command lane",
    body: "Ask for a quote, follow a route, watch a wallet, or execute from the bot without leaving the flow.",
    stat: "@suwappu_bot",
  },
];

const proofRows = [
  ["ETH/USDC", "$3,483.28", "+6.94%", "Uniswap V3"],
  ["SOL/USDC", "$182.34", "+2.14%", "Jupiter"],
  ["BASE/ETH", "$1.02", "+0.62%", "Base"],
];

const sdkLines = [
  "bun add @suwappu/sdk",
  "suwappu quote ETH USDC 1.0 --chain base",
  "route: Base -> Uniswap V3",
  "out: 3,483.28 USDC",
  "suwappu execute quote_live_42",
  "status: confirmed",
];

const flowSteps = [
  "Register an agent",
  "Request a quote",
  "Execute the route",
  "Track status",
];

function joinClasses(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function SiteSection({
  children,
  id,
  className,
  motif = "bloom",
}: {
  children: ReactNode;
  id?: string;
  className?: string;
  motif?: "bloom" | "stem" | "coin" | "none";
}) {
  return (
    <section
      id={id}
      className="terminal-theme-panel relative min-w-0 overflow-hidden p-3 md:p-5"
    >
      {motif === "bloom" ? (
        <div className="pointer-events-none absolute -right-10 -top-10 z-0 opacity-[0.12]">
          <SakuraBloomMotif size={150} tone="mist" rotation={16} />
        </div>
      ) : null}
      {motif === "stem" ? (
        <div className="pointer-events-none absolute -bottom-16 -right-16 z-0 opacity-[0.1]">
          <PersimmonStemMotif size={230} palette="butter" rotation={24} flipX />
        </div>
      ) : null}
      {motif === "coin" ? (
        <div className="pointer-events-none absolute -right-5 -top-5 z-0 opacity-[0.12]">
          <PersimmonMark
            size={112}
            palette="butter"
            variant="orchard"
            shell="coin"
            frame="none"
            cutoutMode="none"
            withGlow={false}
          />
        </div>
      ) : null}
      <div className={joinClasses("relative z-10", className)}>{children}</div>
    </section>
  );
}

function TopNav() {
  return (
    <header className="sticky top-0 z-30 border-b border-terminal-border bg-white/78 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-3 py-2 md:px-5">
        <a href="/" className="flex min-w-0 items-center gap-2">
          <PersimmonMark
            size={42}
            palette="butter"
            variant="orchard"
            shell="coin"
            frame="none"
            cutoutMode="none"
            withGlow={false}
          />
          <span className="terminal-theme-heading text-lg font-semibold text-terminal-text">
            suwappu
          </span>
        </a>
        <nav className="hidden items-center gap-1 text-sm text-terminal-text-secondary md:flex">
          {["Terminal", "API", "Bot", "Docs"].map((item) => (
            <a
              key={item}
              href={item === "Docs" ? "/docs" : `#${item.toLowerCase()}`}
              className="terminal-theme-control px-3 py-1.5"
            >
              {item}
            </a>
          ))}
          <a
            href="https://github.com/0xSoftBoi/suwappubot"
            className="terminal-theme-control px-3 py-1.5"
          >
            GitHub
          </a>
        </nav>
        <a
          href="https://terminal.suwappu.bot"
          className="terminal-button shrink-0 rounded-[8px] px-3 py-2 text-sm font-semibold"
        >
          Open Terminal
        </a>
      </div>
    </header>
  );
}

function TerminalPreview() {
  const candles = [34, 48, 42, 56, 62, 58, 70, 66, 78, 72, 84, 80];

  return (
    <div className="terminal-theme-panel terminal-theme-panel-elevated relative overflow-hidden p-2">
      <div className="mb-2 flex items-center justify-between gap-2 border-b border-terminal-border pb-2">
        <div className="flex items-center gap-1">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: "#f7d5df" }}
          />
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: "#f4c963" }}
          />
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: "#2f8f5b" }}
          />
          <span className="ml-2 truncate font-mono text-[10px] text-terminal-text-muted">
            terminal.suwappu.bot
          </span>
        </div>
        <span className="terminal-theme-pill border border-terminal-border px-2 py-0.5 text-[9px] uppercase text-terminal-text-muted">
          live route
        </span>
      </div>

      <div className="grid gap-2 md:grid-cols-[1.1fr_0.82fr]">
        <div className="terminal-theme-inset min-w-0 p-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="terminal-theme-caption text-[9px] uppercase text-terminal-text-muted">
                Market
              </div>
              <div className="font-mono text-lg font-semibold text-terminal-text">
                ETH/USDC
              </div>
            </div>
            <div className="text-right font-mono">
              <div className="text-sm font-semibold text-terminal-text">
                $3,483.28
              </div>
              <div className="text-xs text-bull">+6.94%</div>
            </div>
          </div>
          <div className="relative mt-3 h-40 overflow-hidden rounded-[8px] border border-terminal-border bg-[linear-gradient(180deg,rgba(255,255,255,0.86),rgba(237,248,251,0.72))]">
            <div className="absolute inset-0 bg-[linear-gradient(rgba(142,182,197,0.25)_1px,transparent_1px),linear-gradient(90deg,rgba(142,182,197,0.24)_1px,transparent_1px)] bg-[size:52px_36px]" />
            <div className="absolute bottom-4 left-3 right-3 top-8 flex items-end gap-1.5">
              {candles.map((height, index) => (
                <span
                  key={`${height}-${index}`}
                  style={{
                    backgroundColor: index % 5 === 2 ? "#77bfd0" : "#2f8f5b",
                    height: `${height}%`,
                    flex: 1,
                  }}
                />
              ))}
            </div>
            <span
              className="absolute right-2 top-[44%] rounded-[5px] px-2 py-1 font-mono text-[10px] font-semibold text-white"
              style={{ backgroundColor: "#0ea5e9" }}
            >
              $3,483.28
            </span>
          </div>
        </div>

        <div className="grid min-w-0 gap-2">
          <div className="terminal-theme-inset p-2">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-semibold text-terminal-text">
                Route
              </span>
              <span className="font-mono text-[10px] text-bull">98.2%</span>
            </div>
            <div className="grid gap-1 font-mono text-[10px] text-terminal-text-secondary">
              <div className="flex justify-between gap-2">
                <span>ETH</span>
                <span>Base</span>
              </div>
              <div className="flex justify-between gap-2">
                <span>USDC</span>
                <span>Uniswap V3</span>
              </div>
              <div className="flex justify-between gap-2">
                <span>Gas</span>
                <span>$0.12</span>
              </div>
            </div>
          </div>
          <div className="terminal-theme-inset p-2">
            <div className="mb-1 text-xs font-semibold text-terminal-text">
              Wallet rail
            </div>
            {["Treasury lane", "Solana float", "Base scout"].map((item) => (
              <div
                key={item}
                className="flex justify-between gap-2 border-t border-terminal-border/60 py-1 font-mono text-[10px]"
              >
                <span className="truncate text-terminal-text-secondary">{item}</span>
                <span className="text-bull">+2.1%</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function SdkModule() {
  return (
    <SiteSection
      id="api"
      className="grid gap-4 md:grid-cols-2 md:items-center"
      motif="stem"
    >
      <div className="max-w-xl">
        <div className="terminal-theme-caption text-[10px] uppercase text-terminal-text-muted">
          SDK in action
        </div>
        <h2 className="terminal-theme-heading mt-2 text-3xl font-semibold leading-tight text-terminal-text md:text-5xl">
          Three calls. Full route.
        </h2>
        <p className="mt-3 text-sm leading-6 text-terminal-text-secondary md:text-base md:leading-7">
          Keep the current text-module clarity, but make it accurate to the
          product: quote, execute, and track a trade across the same execution
          surface the terminal uses.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          {flowSteps.map((step, index) => (
            <div key={step} className="terminal-theme-inset p-2">
              <div className="font-mono text-[10px] text-terminal-text-muted">
                0{index + 1}
              </div>
              <div className="mt-1 text-sm font-semibold text-terminal-text">
                {step}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="terminal-theme-panel overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-terminal-border px-3 py-2">
          <div className="flex items-center gap-1">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: "#f7d5df" }}
            />
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: "#f4c963" }}
            />
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: "#2f8f5b" }}
            />
          </div>
          <span className="font-mono text-xs text-terminal-text-muted">
            @suwappu/sdk
          </span>
        </div>
        <div className="grid gap-1 p-3 font-mono text-[12px] leading-6 md:text-sm">
          {sdkLines.map((line, index) => (
            <div
              key={line}
              className={joinClasses(
                "min-w-0 break-words",
                index === 3 || index === 5
                  ? "text-bull"
                  : index === 2
                    ? "text-terminal-text-muted"
                    : "text-[#0b789a]",
              )}
            >
              <span className="mr-2 text-[#e58d2b]">
                {index === 2 || index === 3 || index === 5 ? "=" : ">"}
              </span>
              {line}
            </div>
          ))}
        </div>
      </div>
    </SiteSection>
  );
}

function ProductModules() {
  return (
    <div id="terminal" className="grid gap-2 md:grid-cols-3">
      {productModules.map((module, index) => (
        <SiteSection
          key={module.title}
          motif={index === 0 ? "coin" : index === 1 ? "bloom" : "stem"}
          className="min-h-[220px]"
        >
          <div className="terminal-theme-caption text-[10px] uppercase text-terminal-text-muted">
            {module.eyebrow}
          </div>
          <h3 className="mt-2 text-2xl font-semibold text-terminal-text">
            {module.title}
          </h3>
          <p className="mt-3 text-sm leading-6 text-terminal-text-secondary">
            {module.body}
          </p>
          <div className="mt-5 inline-flex rounded-[8px] border border-terminal-border bg-white/78 px-3 py-1.5 font-mono text-xs text-terminal-text">
            {module.stat}
          </div>
        </SiteSection>
      ))}
    </div>
  );
}

function MobileBreezeSite() {
  return (
    <main className="grid gap-2 px-2 py-2 md:hidden">
      <section
        className="relative overflow-hidden rounded-[12px] border"
        style={{
          borderColor: "#d7e6ef",
          background:
            "linear-gradient(180deg, #fdfcf8 0%, #fffefb 10%, #d9f1f3 42%, #bde0e6 100%)",
          boxShadow:
            "0 20px 54px rgba(33,88,110,0.1), 0 10px 28px rgba(176,126,64,0.12)",
        }}
      >
        <div className="pointer-events-none absolute right-[-20px] top-10 opacity-20">
          <PersimmonMark
            size={98}
            palette="butter"
            variant="orchard"
            shell="coin"
            frame="none"
            cutoutMode="none"
            withGlow={false}
          />
        </div>
        <div className="pointer-events-none absolute left-[44px] top-20 opacity-28">
          <SakuraBloomMotif size={112} tone="soft" rotation={-10} />
        </div>
        <div className="pointer-events-none absolute bottom-[-44px] right-[-48px] opacity-18">
          <PersimmonStemMotif size={190} palette="butter" rotation={26} flipX />
        </div>

        <div
          className="relative z-10 grid"
          style={{
            gridTemplateColumns: "52px minmax(0, 1fr)",
          }}
        >
          <div className="relative m-2 mr-0 min-h-[594px] overflow-hidden rounded-[10px] border border-white/80 bg-white/74 shadow-[0_16px_34px_rgba(88,142,162,0.12)]">
            <div className="absolute left-1/2 top-5 -translate-x-1/2">
              <PersimmonMark
                size={42}
                palette="butter"
                variant="orchard"
                shell="coin"
                frame="none"
                cutoutMode="none"
                withGlow={false}
              />
            </div>
            <div
              className="absolute left-1/2 top-[92px] -translate-x-1/2 text-[37px] font-semibold leading-none text-[#16b8d1]"
              style={{
                fontFamily:
                  "'Hiragino Sans', 'Yu Gothic', 'Noto Sans JP', sans-serif",
                writingMode: "vertical-rl",
                textOrientation: "mixed",
              }}
            >
              すわっぷ
            </div>
          </div>

          <div className="relative grid min-w-0 gap-2 p-2">
            <div
              className="overflow-hidden rounded-[12px] border border-white/72 p-3"
              style={{
                background:
                  "radial-gradient(circle at 82% 18%, rgba(255,214,182,0.36), transparent 15%), radial-gradient(circle at 15% 4%, rgba(255,255,255,0.52), transparent 20%), linear-gradient(180deg, rgba(153,214,228,0.94) 0%, rgba(144,208,223,0.95) 30%, rgba(209,242,239,0.82) 66%, rgba(246,253,252,0.95) 100%)",
                boxShadow: "0 14px 32px rgba(33,88,110,0.12)",
              }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="rounded-[999px] border border-white/70 bg-white/32 px-3 py-1 text-[9px] uppercase tracking-[0.22em] text-[#4f8ca0]">
                  summer breeze
                </div>
                <PersimmonMark
                  size={48}
                  palette="butter"
                  variant="orchard"
                  shell="coin"
                  frame="none"
                  cutoutMode="none"
                  withGlow={false}
                />
              </div>
              <h1
                className="mt-3 font-semibold text-[#17324a]"
                style={{ fontSize: "48px", lineHeight: 0.9 }}
              >
                Suwappu
              </h1>
              <p className="mt-3 text-[13px] leading-5 text-[#345069]">
                Trade, route, track wallets, and execute through terminal, bot,
                or API.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-1.5">
                <a
                  href="https://terminal.suwappu.bot"
                  className="terminal-button rounded-[8px] px-3 py-2 text-center text-xs font-semibold"
                >
                  Open Terminal
                </a>
                <a
                  href="/docs"
                  className="rounded-[8px] border border-white/80 bg-white/54 px-3 py-2 text-center text-xs font-semibold text-[#17324a]"
                >
                  Docs/API
                </a>
              </div>
            </div>

            <div className="overflow-hidden rounded-[10px] border border-terminal-border bg-white/90 shadow-[0_18px_40px_rgba(33,88,110,0.14)]">
              <div className="flex items-center justify-between border-b border-terminal-border px-2 py-1.5">
                <div className="flex items-center gap-1">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: "#f7d5df" }}
                  />
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: "#f4c963" }}
                  />
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: "#2f8f5b" }}
                  />
                </div>
                <span className="font-mono text-[9px] text-terminal-text-muted">
                  terminal.suwappu.bot
                </span>
              </div>
              <div className="p-2">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div>
                    <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-terminal-text-muted">
                      market
                    </div>
                    <div className="font-mono text-lg font-semibold text-terminal-text">
                      ETH/USDC
                    </div>
                  </div>
                  <div className="text-right font-mono">
                    <div className="text-sm font-semibold text-terminal-text">
                      $3,483.28
                    </div>
                    <div className="text-[11px] text-bull">+6.94%</div>
                  </div>
                </div>
                <div
                  className="relative overflow-hidden rounded-[8px] border border-terminal-border"
                  style={{
                    height: 118,
                    background:
                      "linear-gradient(180deg, rgba(255,255,255,0.9), rgba(237,248,251,0.75))",
                  }}
                >
                  <div className="absolute inset-0 bg-[linear-gradient(rgba(142,182,197,0.22)_1px,transparent_1px),linear-gradient(90deg,rgba(142,182,197,0.2)_1px,transparent_1px)] bg-[size:42px_28px]" />
                  <div className="absolute bottom-3 left-2 right-2 top-6 flex items-end gap-1">
                    {[35, 48, 42, 57, 64, 61, 70, 79, 74, 84, 80].map(
                      (height, index) => (
                        <span
                          key={`${height}-${index}`}
                          style={{
                            backgroundColor:
                              index === 2 || index === 7
                                ? "#77bfd0"
                                : "#2f8f5b",
                            height: `${height}%`,
                            flex: 1,
                          }}
                        />
                      ),
                    )}
                  </div>
                  <span
                    className="absolute right-2 top-2 rounded-[5px] px-2 py-1 font-mono text-[10px] font-semibold text-white"
                    style={{ backgroundColor: "#0ea5e9" }}
                  >
                    $3,483.28
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-1">
                  {[
                    ["Route", "98.2%"],
                    ["Wallets", "3"],
                    ["API", "live"],
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      className="rounded-[6px] border border-terminal-border bg-white/76 px-1.5 py-1"
                    >
                      <div className="font-mono text-[8px] uppercase text-terminal-text-muted">
                        {label}
                      </div>
                      <div className="font-mono text-[11px] font-semibold text-terminal-text">
                        {value}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-1">
              {["Chart", "Table", "Swap"].map((item) => (
                <div
                  key={item}
                  className="rounded-[7px] border border-white/78 bg-white/48 px-1.5 py-1.5 text-center font-mono text-[10px] text-[#345069]"
                >
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-3 gap-1.5">
        {productModules.map((module) => (
          <section
            key={module.title}
            className="terminal-theme-panel min-h-[104px] p-2"
          >
            <div className="terminal-theme-caption text-[8px] uppercase text-terminal-text-muted">
              {module.eyebrow}
            </div>
            <h2 className="mt-1 text-[15px] font-semibold leading-4 text-terminal-text">
              {module.title}
            </h2>
            <div className="mt-2 rounded-[6px] border border-terminal-border bg-white/72 px-1.5 py-1 font-mono text-[9px] text-terminal-text">
              {module.stat}
            </div>
          </section>
        ))}
      </div>

      <section className="terminal-theme-panel p-3">
        <div className="terminal-theme-caption text-[9px] uppercase text-terminal-text-muted">
          SDK lane
        </div>
        <h2 className="mt-1 text-2xl font-semibold leading-7 text-terminal-text">
          Three calls. Full route.
        </h2>
        <div className="mt-3 rounded-[8px] border border-terminal-border bg-white/80 p-2 font-mono text-[11px] leading-5">
          {sdkLines.slice(1, 6).map((line, index) => (
            <div
              key={line}
              className={
                index === 2 || index === 4 ? "text-bull" : "text-[#0b789a]"
              }
            >
              <span className="mr-1 text-[#e58d2b]">
                {index === 1 || index === 2 || index === 4 ? "=" : ">"}
              </span>
              {line}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

function ProofTable() {
  return (
    <SiteSection id="bot" motif="bloom">
      <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="terminal-theme-caption text-[10px] uppercase text-terminal-text-muted">
            Market proof
          </div>
          <h2 className="terminal-theme-heading mt-2 text-3xl font-semibold text-terminal-text md:text-4xl">
            Data modules stay readable.
          </h2>
        </div>
        <p className="max-w-xl text-sm leading-6 text-terminal-text-secondary">
          The replacement keeps the useful homepage modules, but presents real
          trading primitives: market rows, route health, wallet watch, and bot
          commands.
        </p>
      </div>
      <div className="overflow-hidden rounded-[8px] border border-terminal-border bg-white/80">
        <div className="flex gap-2 border-b border-terminal-border px-3 py-2 font-mono text-[10px] uppercase text-terminal-text-muted">
          <span className="min-w-0 flex-1">Pair</span>
          <span className="w-[74px] text-right">Price</span>
          <span className="w-[52px] text-right">24h</span>
          <span className="w-[76px] text-right">Route</span>
        </div>
        {proofRows.map((row) => (
          <div
            key={row[0]}
            className="flex items-center gap-2 border-b border-terminal-border/60 px-3 py-2 text-sm last:border-b-0"
          >
            <span className="min-w-0 flex-1 truncate font-semibold text-terminal-text">
              {row[0]}
            </span>
            <span className="w-[74px] truncate text-right font-mono text-terminal-text">
              {row[1]}
            </span>
            <span className="w-[52px] truncate text-right font-mono text-bull">
              {row[2]}
            </span>
            <span className="w-[76px] truncate text-right text-terminal-text-muted">
              {row[3]}
            </span>
          </div>
        ))}
      </div>
    </SiteSection>
  );
}

export function SuwappuBotSiteReplacement() {
  return (
    <TerminalThemeScope mode="summer-breeze">
      <div className="terminal-theme-page min-h-screen overflow-hidden text-terminal-text">
        <div className="pointer-events-none fixed -left-24 top-24 hidden opacity-[0.08] md:block">
          <PersimmonStemMotif size={300} palette="butter" rotation={-18} />
        </div>
        <div className="pointer-events-none fixed right-[-72px] top-40 hidden opacity-[0.1] md:block">
          <SakuraBloomMotif size={220} tone="mist" rotation={24} />
        </div>
        <TopNav />
        <MobileBreezeSite />
        <main className="mx-auto hidden max-w-7xl gap-3 px-3 py-3 md:grid md:gap-4 md:px-5 md:py-5">
          <SiteSection
            className="grid gap-5 py-5 md:min-h-[620px] md:grid-cols-2 md:items-center md:py-8"
            motif="coin"
          >
            <div className="max-w-2xl">
              <div className="terminal-theme-caption text-[10px] uppercase text-terminal-text-muted">
                Summer Breeze replacement
              </div>
              <h1
                className="mt-3 font-semibold text-terminal-text"
                style={{
                  fontSize: "clamp(3.4rem, 6vw, 6rem)",
                  lineHeight: 0.95,
                }}
              >
                Suwappu
              </h1>
              <p className="mt-4 max-w-xl text-base leading-7 text-terminal-text-secondary md:text-lg md:leading-8">
                One execution workspace for terminal trading, agent APIs,
                wallet rails, bot commands, and route-aware swaps.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <a
                  href="https://terminal.suwappu.bot"
                  className="terminal-button rounded-[8px] px-4 py-2 text-sm font-semibold"
                >
                  Start Trading
                </a>
                <a
                  href="/docs"
                  className="terminal-theme-control rounded-[8px] px-4 py-2 text-sm font-semibold text-terminal-text"
                >
                  Read Docs
                </a>
              </div>
              <div className="mt-5 inline-flex max-w-full rounded-[8px] border border-terminal-border bg-white/82 px-3 py-2 font-mono text-xs text-terminal-text-secondary">
                <span className="mr-2 text-[#e58d2b]">$</span>
                <span className="truncate">bun add @suwappu/sdk</span>
              </div>
            </div>
            <TerminalPreview />
          </SiteSection>

          <ProductModules />
          <SdkModule />
          <ProofTable />
        </main>
      </div>
    </TerminalThemeScope>
  );
}
