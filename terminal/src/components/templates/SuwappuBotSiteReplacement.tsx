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

const DOCS_URL = "https://api.suwappu.bot/docs";

function joinClasses(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function BloomSpray({
  className,
  scale = "compact",
}: {
  className?: string;
  scale?: "compact" | "wide";
}) {
  const blooms =
    scale === "wide"
      ? [
          ["left-2 top-7", 64, -20, "soft"],
          ["left-24 top-1", 42, 18, "sun"],
          ["right-10 top-10", 56, 24, "mist"],
          ["right-28 bottom-0", 38, -12, "soft"],
          ["left-44 bottom-4", 30, 34, "sun"],
        ]
      : [
          ["left-1 top-2", 42, -16, "soft"],
          ["right-2 top-8", 34, 18, "sun"],
          ["left-14 bottom-1", 28, 26, "mist"],
        ];

  return (
    <div className={joinClasses("pointer-events-none absolute z-0", className)}>
      {blooms.map(([position, size, rotation, tone], index) => (
        <div
          key={`${position}-${index}`}
          className={joinClasses("absolute", String(position))}
          style={{
            filter: "drop-shadow(0 8px 12px rgba(75, 112, 126, 0.12))",
          }}
        >
          <SakuraBloomMotif
            size={Number(size)}
            rotation={Number(rotation)}
            tone={tone as "soft" | "mist" | "sun"}
            opacity={0.9}
          />
        </div>
      ))}
      <span className="absolute left-20 top-14 h-2 w-2 rounded-full bg-[#f0c95a]/70" />
      <span className="absolute right-20 top-4 h-1.5 w-1.5 rounded-full bg-[#e66d85]/55" />
      <span className="absolute bottom-8 left-36 h-1.5 w-1.5 rounded-full bg-[#7fc7d4]/70" />
    </div>
  );
}

function PetalDrift({ className }: { className?: string }) {
  return (
    <div className={joinClasses("pointer-events-none absolute z-0", className)}>
      {[
        ["left-[8%] top-[18%]", "#f4cbd7", "rotate-[-18deg]"],
        ["left-[22%] top-[42%]", "#f0c95a", "rotate-[24deg]"],
        ["right-[14%] top-[26%]", "#f3d3cf", "rotate-[38deg]"],
        ["right-[28%] bottom-[16%]", "#d9c4d4", "rotate-[-30deg]"],
        ["left-[46%] bottom-[8%]", "#8ed3de", "rotate-[12deg]"],
      ].map(([position, color, rotation], index) => (
        <span
          key={`${position}-${index}`}
          className={joinClasses(
            "absolute h-3 w-2 rounded-[999px_999px_999px_2px] opacity-75",
            position,
            rotation,
          )}
          style={{
            backgroundColor: color,
            boxShadow: "0 4px 10px rgba(40, 83, 99, 0.12)",
          }}
        />
      ))}
    </div>
  );
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
      {motif !== "none" ? (
        <BloomSpray className="inset-x-0 top-0 h-24 opacity-40" />
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
              href={item === "Docs" ? DOCS_URL : `#${item.toLowerCase()}`}
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
        <div className="pointer-events-none absolute left-[38px] top-16 opacity-75">
          <SakuraBloomMotif size={118} tone="soft" rotation={-10} />
        </div>
        <div className="pointer-events-none absolute left-[-46px] top-[230px] opacity-55">
          <SakuraBloomMotif size={92} tone="sun" rotation={18} />
        </div>
        <div className="pointer-events-none absolute right-2 top-[318px] opacity-70">
          <SakuraBloomMotif size={58} tone="mist" rotation={-28} />
        </div>
        <div className="pointer-events-none absolute bottom-[-44px] right-[-48px] opacity-45">
          <PersimmonStemMotif size={210} palette="butter" rotation={26} flipX />
        </div>
        <BloomSpray className="left-5 top-6 h-24 w-[300px] opacity-60" scale="wide" />
        <PetalDrift className="inset-0 opacity-80" />

        <div
          className="relative z-10 grid"
          style={{
            gridTemplateColumns: "52px minmax(0, 1fr)",
          }}
        >
          <div className="relative m-2 mr-0 min-h-[594px] overflow-hidden rounded-[10px] border border-white/80 bg-white/74 shadow-[0_16px_34px_rgba(88,142,162,0.12)]">
            <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-gradient-to-b from-transparent via-[#9bd6df]/70 to-transparent" />
            <div className="absolute left-1/2 top-[142px] h-28 w-10 -translate-x-1/2 rounded-full border border-[#8ed3de]/45 bg-[#e9fbfb]/50" />
            <div className="absolute left-1/2 top-[248px] h-28 w-10 -translate-x-1/2 rounded-full border border-[#f0c95a]/35 bg-[#fff2cf]/42" />
            <div className="absolute left-1/2 top-[374px] h-24 w-10 -translate-x-1/2 rounded-full border border-[#e9bfd0]/40 bg-[#fff3f7]/46" />
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
            <div className="absolute left-1/2 top-[52px] -translate-x-1/2 opacity-90">
              <SakuraBloomMotif size={36} tone="sun" rotation={12} />
            </div>
            <div className="absolute left-1/2 bottom-10 -translate-x-1/2 opacity-85">
              <SakuraBloomMotif size={44} tone="soft" rotation={-20} />
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
              className="relative overflow-hidden rounded-[12px] border border-white/72 p-3"
              style={{
                background:
                  "radial-gradient(circle at 82% 18%, rgba(255,214,182,0.52), transparent 15%), radial-gradient(circle at 15% 4%, rgba(255,255,255,0.62), transparent 20%), radial-gradient(circle at 8% 86%, rgba(244,203,215,0.48), transparent 18%), linear-gradient(180deg, rgba(153,214,228,0.98) 0%, rgba(144,208,223,0.96) 30%, rgba(209,242,239,0.86) 66%, rgba(246,253,252,0.95) 100%)",
                boxShadow: "0 14px 32px rgba(33,88,110,0.12)",
              }}
            >
              <div className="pointer-events-none absolute -left-12 bottom-[-44px] opacity-24">
                <PersimmonStemMotif size={126} palette="butter" rotation={-32} />
              </div>
              <div className="pointer-events-none absolute right-7 top-16 opacity-72">
                <SakuraBloomMotif size={42} tone="soft" rotation={18} />
              </div>
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
                style={{
                  fontSize: "48px",
                  lineHeight: 0.9,
                  textShadow: "0 2px 0 rgba(255,255,255,0.5)",
                }}
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
                  href={DOCS_URL}
                  className="rounded-[8px] border border-white/80 bg-white/54 px-3 py-2 text-center text-xs font-semibold text-[#17324a]"
                >
                  Docs/API
                </a>
              </div>
            </div>

            <div
              className="relative overflow-hidden rounded-[10px] border border-white/80 bg-white/92"
              style={{
                boxShadow:
                  "0 2px 0 rgba(255,255,255,0.9) inset, 0 -18px 42px rgba(132,204,216,0.16) inset, 0 22px 42px rgba(33,88,110,0.2)",
              }}
            >
              <div className="pointer-events-none absolute -right-9 -top-10 z-0 opacity-[0.08]">
                <SakuraBloomMotif size={112} tone="mist" rotation={20} />
              </div>
              <div className="pointer-events-none absolute left-5 top-20 z-0 opacity-80">
                <SakuraBloomMotif size={48} tone="sun" rotation={-18} />
              </div>
              <div className="pointer-events-none absolute right-10 bottom-11 z-0 opacity-70">
                <SakuraBloomMotif size={36} tone="soft" rotation={22} />
              </div>
              <div className="pointer-events-none absolute -bottom-5 left-8 z-0 h-7 w-40 rounded-[999px] bg-[#17324a]/10 blur-[14px]" />
              <div
                className="relative z-10 flex items-center justify-between border-b border-white/70 px-2 py-1.5"
                style={{
                  background:
                    "linear-gradient(180deg, rgba(255,255,255,0.96), rgba(238,248,250,0.8))",
                  boxShadow:
                    "0 1px 0 rgba(255,255,255,0.9) inset, 0 10px 22px rgba(33,88,110,0.08)",
                }}
              >
                <div className="flex items-center gap-1">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{
                      background:
                        "linear-gradient(180deg, #ffe8ef, #f0aec1)",
                      boxShadow: "0 1px 2px rgba(69,39,55,0.22)",
                    }}
                  />
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{
                      background:
                        "linear-gradient(180deg, #ffe8a8, #d99d24)",
                      boxShadow: "0 1px 2px rgba(105,74,20,0.24)",
                    }}
                  />
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{
                      background:
                        "linear-gradient(180deg, #58bd82, #207b4c)",
                      boxShadow: "0 1px 2px rgba(20,79,48,0.26)",
                    }}
                  />
                </div>
                <span className="font-mono text-[9px] text-terminal-text-muted">
                  terminal.suwappu.bot
                </span>
              </div>
              <div className="relative z-10 p-2">
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
                      "linear-gradient(145deg, rgba(255,255,255,0.95), rgba(224,247,249,0.84) 58%, rgba(255,247,231,0.72))",
                    boxShadow:
                      "0 1px 0 rgba(255,255,255,0.95) inset, 0 -18px 30px rgba(48,154,173,0.13) inset, 0 14px 26px rgba(33,88,110,0.16)",
                  }}
                >
                  <div className="absolute left-3 top-3 h-10 w-28 rounded-full bg-white/54 blur-[16px]" />
                  <div className="absolute -right-7 -top-9 opacity-[0.09]">
                    <PersimmonMark
                      size={82}
                      palette="butter"
                      variant="orchard"
                      shell="coin"
                      frame="none"
                      cutoutMode="none"
                      withGlow={false}
                    />
                  </div>
                  <div className="absolute left-4 top-5 opacity-95">
                    <PersimmonMark
                      size={56}
                      palette="butter"
                      variant="orchard"
                      shell="coin"
                      frame="none"
                      cutoutMode="none"
                      withGlow={false}
                    />
                  </div>
                  <div className="absolute inset-0 bg-[linear-gradient(rgba(142,182,197,0.22)_1px,transparent_1px),linear-gradient(90deg,rgba(142,182,197,0.2)_1px,transparent_1px)] bg-[size:42px_28px]" />
                  <div className="absolute bottom-3 left-2 right-2 top-6 flex items-end gap-1">
                    {[35, 48, 42, 57, 64, 61, 70, 79, 74, 84, 80].map(
                      (height, index) => (
                        <span
                          key={`${height}-${index}`}
                          style={{
                            background:
                              index === 2 || index === 7
                                ? "linear-gradient(180deg, #8dd7e2, #53a9bd)"
                                : "linear-gradient(180deg, #43a66d, #237b4d)",
                            borderRadius: "5px 5px 1px 1px",
                            boxShadow:
                              "0 1px 0 rgba(255,255,255,0.44) inset, 0 7px 10px rgba(20,79,48,0.18)",
                            height: `${height}%`,
                            flex: 1,
                          }}
                        />
                      ),
                    )}
                  </div>
                  <span
                    className="absolute right-2 top-2 rounded-[6px] px-2 py-1 font-mono text-[10px] font-semibold text-white"
                    style={{
                      background:
                        "linear-gradient(180deg, #27bdf0, #0b8bc7)",
                      boxShadow:
                        "0 1px 0 rgba(255,255,255,0.42) inset, 0 7px 14px rgba(14,118,158,0.3)",
                    }}
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
                      className="rounded-[6px] border border-white/80 px-1.5 py-1"
                      style={{
                        background:
                          "linear-gradient(180deg, rgba(255,255,255,0.92), rgba(238,248,250,0.78))",
                        boxShadow:
                          "0 1px 0 rgba(255,255,255,0.95) inset, 0 8px 15px rgba(33,88,110,0.09)",
                      }}
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
        {productModules.map((module, index) => (
          <section
            key={module.title}
            className="terminal-theme-panel relative min-h-[104px] overflow-hidden p-2"
          >
            <div className="pointer-events-none absolute -right-3 -top-3 opacity-45">
              {index === 0 ? (
                <PersimmonMark
                  size={48}
                  palette="butter"
                  variant="orchard"
                  shell="coin"
                  frame="none"
                  cutoutMode="none"
                  withGlow={false}
                />
              ) : (
                <SakuraBloomMotif
                  size={52}
                  tone={index === 1 ? "soft" : "sun"}
                  rotation={index === 1 ? -12 : 18}
                />
              )}
            </div>
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

      <section className="terminal-theme-panel relative overflow-hidden p-3">
        <div className="pointer-events-none absolute right-2 top-2 opacity-45">
          <SakuraBloomMotif size={60} tone="mist" rotation={16} />
        </div>
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
        <div className="pointer-events-none fixed -left-24 top-24 hidden opacity-[0.16] md:block">
          <PersimmonStemMotif size={300} palette="butter" rotation={-18} />
        </div>
        <div className="pointer-events-none fixed right-[-72px] top-40 hidden opacity-[0.18] md:block">
          <SakuraBloomMotif size={220} tone="mist" rotation={24} />
        </div>
        <BloomSpray className="left-8 top-20 hidden h-28 w-[520px] opacity-55 md:block" scale="wide" />
        <PetalDrift className="inset-0 hidden opacity-60 md:block" />
        <TopNav />
        <MobileBreezeSite />
        <main className="mx-auto hidden max-w-7xl gap-3 px-3 py-3 md:grid md:gap-4 md:px-5 md:py-5">
          <SiteSection
            className="grid gap-5 py-5 md:min-h-[620px] md:grid-cols-2 md:items-center md:py-8"
            motif="coin"
          >
            <div className="pointer-events-none absolute left-4 top-4 z-0 hidden opacity-45 md:block">
              <SakuraBloomMotif size={120} tone="sun" rotation={-14} />
            </div>
            <div className="pointer-events-none absolute bottom-6 left-[42%] z-0 hidden opacity-35 md:block">
              <PersimmonStemMotif size={190} palette="butter" rotation={42} flipX />
            </div>
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
                  href={DOCS_URL}
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
