import type { Metadata } from 'next';
import { JetBrains_Mono } from 'next/font/google';
import { PhosphorRace } from './PhosphorRace';
import { MarketTicker } from './MarketTicker';
import styles from './next.module.css';

export const metadata: Metadata = {
  title: 'Suwappu | the cross-chain execution terminal',
  description:
    'Nine routers race for every swap. Non-custodial, sub-second, 42 chains. The best price wins, and you sign.',
};

const jb = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '700', '800'],
  variable: '--font-jb',
  display: 'swap',
});

export default function KakisPage() {
  return (
    <div className={`${jb.variable} ${styles.page}`}>
      {/* CRT overlays */}
      <div className={styles.scanlines} aria-hidden="true" />
      <div className={styles.vignette}  aria-hidden="true" />
      <div className={styles.grain}     aria-hidden="true" />

      <div className={styles.column}>
        {/* ── Terminal chrome bar ──────────────────────────────── */}
        <header className={styles.chromeBar}>
          <div className={styles.chromeDots} aria-hidden="true">
            <span className={styles.dot} />
            <span className={styles.dot} />
            <span className={styles.dot} />
          </div>

          <div className={styles.chromePrompt}>
            <span>suwappu ~ %</span>
            <span className={styles.cursor} aria-hidden="true" />
          </div>

          <div className={styles.chromeLockup}>
            <strong>SWAP</strong> / すわっぷ
          </div>
        </header>

        {/* ── Hero: running quote ──────────────────────────────── */}
        <main>
          <PhosphorRace />

          {/* ── 1. STATS READOUT STRIP ───────────────────────── */}
          <div className={styles.statsStrip} role="status" aria-label="Verified platform facts">
            <div className={styles.statItem}>
              <span className={styles.statLabel}>CHAINS</span>
              <span className={styles.statVal}>41</span>
            </div>
            <span className={styles.statRule} aria-hidden="true">·</span>
            <div className={styles.statItem}>
              <span className={styles.statLabel}>ROUTERS</span>
              <span className={styles.statVal}>9</span>
            </div>
            <span className={styles.statRule} aria-hidden="true">·</span>
            <div className={styles.statItem}>
              <span className={styles.statLabel}>MCP TOOLS</span>
              <span className={styles.statVal}>14</span>
            </div>
            <span className={styles.statRule} aria-hidden="true">·</span>
            <div className={styles.statItem}>
              <span className={styles.statLabel}>CUSTODY</span>
              <span className={styles.statVal}>NON-CUSTODIAL</span>
            </div>
            <span className={styles.statRule} aria-hidden="true">·</span>
            <div className={styles.statItem}>
              <span className={styles.statLabel}>KEYS</span>
              <span className={styles.statVal}>MPC</span>
            </div>
            <span className={styles.statRule} aria-hidden="true">·</span>
            <div className={styles.statItem}>
              <span className={styles.statLabel}>EXEC</span>
              <span className={styles.statVal}>SUB-SECOND</span>
            </div>
          </div>

          {/* ── Product sections ─────────────────────────────── */}
          <div className={styles.sections}>

            {/* ── 2. ENGINE --how ──────────────────────────────── */}
            <section className={styles.section}>
              <div className={styles.sectionPrompt}>
                <span className={styles.sectionDollar}>$</span>
                <span className={styles.sectionCmd}>suwappu engine --how</span>
              </div>
              <div className={styles.sectionBody}>
                <div className={styles.tracePanel}>
                  <div className={styles.traceStep}>
                    <span className={styles.traceNum}>01</span>
                    <div className={styles.traceContent}>
                      <span className={styles.traceLabel}>QUOTE</span>
                      <span className={styles.traceArrow}>→</span>
                      <span className={styles.traceDesc}>
                        9 routers race in parallel: LiFi · CoW · OKX · 1inch · KyberSwap ·
                        Jupiter · Across · CCTP · ParaSwap. All results surface in &lt;400 ms.
                      </span>
                    </div>
                  </div>
                  <div className={styles.traceConnector} aria-hidden="true">│</div>
                  <div className={styles.traceStep}>
                    <span className={styles.traceNum}>02</span>
                    <div className={styles.traceContent}>
                      <span className={styles.traceLabel}>SIMULATE</span>
                      <span className={styles.traceArrow}>→</span>
                      <span className={styles.traceDesc}>
                        Pre-trade simulation runs against the winning path. Bad fills, sandwich
                        exposure, and excess slippage are flagged before broadcast.
                      </span>
                    </div>
                  </div>
                  <div className={styles.traceConnector} aria-hidden="true">│</div>
                  <div className={styles.traceStep}>
                    <span className={styles.traceNum}>03</span>
                    <div className={styles.traceContent}>
                      <span className={styles.traceLabel}>SIGN</span>
                      <span className={styles.traceArrow}>→</span>
                      <span className={styles.traceDesc}>
                        You sign. MPC keys, non-custodial throughout. Nothing touches a custody
                        account. Gasless on Tempo chains.
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* ── 3. PERPS ─────────────────────────────────────── */}
            <section className={styles.section}>
              <div className={styles.sectionPrompt}>
                <span className={styles.sectionDollar}>$</span>
                <span className={styles.sectionCmd}>suwappu perps</span>
              </div>
              <div className={styles.sectionBody}>
                <div className={styles.panel}>
                  <div className={styles.panelHeader}>
                    <span className={styles.panelTitle}>POSITIONS</span>
                    <span className={styles.panelBadge}>HYPERLIQUID · SAMPLE READOUT</span>
                  </div>

                  <div className={styles.perpsTable} role="table" aria-label="Sample perps positions">
                    <div className={styles.perpsHead} role="row" aria-hidden="true">
                      <span>MARKET</span>
                      <span>SIDE</span>
                      <span className={styles.numCol}>LEV</span>
                      <span className={styles.numCol}>ENTRY</span>
                      <span className={styles.numCol}>PnL</span>
                    </div>

                    <div className={styles.perpsRow} role="row">
                      <span className={styles.perpsSym}>BTC-PERP</span>
                      <span className={styles.perpsSide} data-side="long">LONG</span>
                      <span className={`${styles.numCol} ${styles.perpsDim}`}>20×</span>
                      <span className={`${styles.numCol} ${styles.perpsDim}`}>67,100.00</span>
                      <span className={`${styles.numCol} ${styles.perpsPos}`}>+$2,104.80</span>
                    </div>

                    <div className={styles.perpsRow} role="row">
                      <span className={styles.perpsSym}>ETH-PERP</span>
                      <span className={styles.perpsSide} data-side="short">SHORT</span>
                      <span className={`${styles.numCol} ${styles.perpsDim}`}>10×</span>
                      <span className={`${styles.numCol} ${styles.perpsDim}`}>3,510.00</span>
                      <span className={`${styles.numCol} ${styles.perpsPos}`}>+$842.50</span>
                    </div>

                    <div className={styles.perpsRow} role="row">
                      <span className={styles.perpsSym}>SOL-PERP</span>
                      <span className={styles.perpsSide} data-side="long">LONG</span>
                      <span className={`${styles.numCol} ${styles.perpsDim}`}>5×</span>
                      <span className={`${styles.numCol} ${styles.perpsDim}`}>142.30</span>
                      <span className={`${styles.numCol} ${styles.perpsPos}`}>+$316.60</span>
                    </div>
                  </div>

                  <p className={styles.panelCaption}>
                    HyperLiquid up to 20×: funding, HYPE staking, vaults, TWAP, from chat.
                  </p>
                </div>

                <div className={styles.chipRow} aria-label="Available commands">
                  {['/perps', '/fund', '/stake', '/vault', '/twap', '/spot'].map((c) => (
                    <span key={c} className={styles.chip}>{c}</span>
                  ))}
                </div>
              </div>
            </section>

            {/* ── 4. MCP --tools ───────────────────────────────── */}
            <section className={styles.section}>
              <div className={styles.sectionPrompt}>
                <span className={styles.sectionDollar}>$</span>
                <span className={styles.sectionCmd}>suwappu mcp --tools</span>
              </div>
              <div className={styles.sectionBody}>
                <div className={styles.panel}>
                  <div className={styles.panelHeader}>
                    <span className={styles.panelTitle}>TOOL REGISTRY</span>
                    <span className={styles.panelBadge}>
                      14 tools · Bearer suwappu_sk_ · streamable-http
                    </span>
                  </div>

                  <div className={styles.toolGrid} aria-label="MCP tools">
                    {[
                      'get_quote',
                      'execute_swap',
                      'get_portfolio',
                      'get_prices',
                      'list_chains',
                      'list_tokens',
                      'get_tempo_tokens',
                      'browse_mpp_directory',
                      'predict_markets',
                      'predict_market',
                      'perps_markets',
                      'perps_quote',
                      'perps_positions',
                      'lend_markets',
                    ].map((tool, i) => (
                      <div key={tool} className={styles.toolItem}>
                        <span className={styles.toolIdx}>{String(i + 1).padStart(2, '0')}</span>
                        <span className={styles.toolName}>{tool}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <pre className={styles.codeBlock}>{`{
  "mcpServers": {
    "suwappu": {
      "url": "https://api.suwappu.bot/mcp",
      "headers": {
        "Authorization": "Bearer suwappu_sk_YOUR_KEY"
      }
    }
  }
}`}</pre>

                <p className={styles.codeNote}>
                  @suwappu/openclaw · TypeScript + Python SDK · REST /v1/agent · A2A JSON-RPC
                </p>
              </div>
            </section>

            {/* ── 5. SURFACES ──────────────────────────────────── */}
            <section className={styles.section}>
              <div className={styles.sectionPrompt}>
                <span className={styles.sectionDollar}>$</span>
                <span className={styles.sectionCmd}>suwappu surfaces</span>
              </div>
              <div className={styles.sectionBody}>
                <div className={styles.panel}>
                  <pre className={styles.asciiDiagram} aria-label="Architecture diagram: four surfaces connect to one engine">{`
  ┌─────────────────┐     ┌─────────────────┐
  │  Telegram bot   │     │  Web terminal   │
  └────────┬────────┘     └────────┬────────┘
           │                       │
           └──────────┬────────────┘
                      │
             ┌────────▼────────┐
             │  suwappu engine │
             │  42 chains · 9  │
             │  routers · MPC  │
             └────────┬────────┘
                      │
           ┌──────────┴────────────┐
           │                       │
  ┌────────▼────────┐     ┌────────▼────────┐
  │   REST API      │     │   MCP server    │
  │  /v1/agent      │     │  /mcp  14 tools │
  └─────────────────┘     └─────────────────┘
`}</pre>
                  <p className={styles.panelCaption}>
                    Same price, same speed, same security: wherever you trade.
                    Gasless on Tempo.
                  </p>
                </div>
              </div>
            </section>

            {/* ── 6. LIVE MARKET TICKER ────────────────────────── */}
            <section className={styles.section}>
              <div className={styles.sectionPrompt}>
                <span className={styles.sectionDollar}>$</span>
                <span className={styles.sectionCmd}>suwappu watch</span>
              </div>
              <div className={styles.sectionBody}>
                <div className={styles.panel}>
                  <div className={styles.panelHeader}>
                    <span className={styles.panelTitle}>MARKET WATCH</span>
                    <span className={`${styles.panelBadge} ${styles.badgeLive}`}>
                      <span className={styles.liveDot} aria-hidden="true" />
                      SAMPLE · NOT LIVE
                    </span>
                  </div>
                  <MarketTicker />
                </div>
              </div>
            </section>

          </div>{/* end sections */}

          {/* ── 7. CTA TERMINAL MOMENT ───────────────────────── */}
          <div className={styles.ctaBlock}>
            <div className={styles.ctaPromptLine}>
              <span className={styles.ctaDollar}>$</span>
              <span className={styles.ctaCmd}>bun add @suwappu/sdk</span>
              <span className={styles.cursor} aria-hidden="true" />
            </div>
            <div className={styles.ctaComment}># start trading in one line</div>
            <div className={styles.ctaButtons}>
              <a
                href="https://t.me/suwappu_bot"
                className={styles.ctaBtn}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open the bot →
              </a>
              <a
                href="https://terminal.suwappu.bot"
                className={styles.ctaBtn}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open the terminal →
              </a>
            </div>
          </div>
        </main>

        {/* ── Footer ───────────────────────────────────────────── */}
        <footer className={styles.footer}>
          <div className={styles.footerCopy}>
            © 2026 Suwappu · すわっぷ · Non-custodial by design
          </div>
          <nav className={styles.footerNav} aria-label="Site navigation">
            {[
              { label: 'Docs',     href: 'https://suwappu.bot/docs' },
              { label: 'Pricing',  href: '/pricing' },
              { label: 'Agents',   href: 'https://suwappu.bot/agents' },
              { label: 'Terminal', href: 'https://terminal.suwappu.bot' },
              { label: 'Telegram', href: 'https://t.me/suwappu_bot' },
            ].map((link, i, arr) => (
              <span key={link.href}>
                <a
                  href={link.href}
                  className={styles.footerLink}
                  target={link.href.startsWith('http') ? '_blank' : undefined}
                  rel={link.href.startsWith('http') ? 'noopener noreferrer' : undefined}
                >
                  {link.label}
                </a>
                {i < arr.length - 1 && (
                  <span className={styles.footerSep} aria-hidden="true"> · </span>
                )}
              </span>
            ))}
          </nav>
        </footer>
      </div>
    </div>
  );
}
