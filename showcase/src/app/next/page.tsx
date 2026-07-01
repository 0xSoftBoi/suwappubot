import type { Metadata } from 'next';
import { JetBrains_Mono } from 'next/font/google';
import { PhosphorRace } from './PhosphorRace';
import styles from './next.module.css';

export const metadata: Metadata = {
  title: 'Suwappu — the cross-chain execution terminal',
  description:
    'Nine routers race for every swap. Non-custodial, sub-second, 40+ chains. The best price wins — and you sign.',
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

          {/* ── Product sections ─────────────────────────────── */}
          <div className={styles.sections}>

            {/* suwappu engine */}
            <section className={styles.section}>
              <div className={styles.sectionPrompt}>
                <span className={styles.sectionDollar}>$</span>
                <span className={styles.sectionCmd}>suwappu engine</span>
              </div>
              <div className={styles.sectionBody}>
                <p>
                  One engine races nine routers — LiFi, CoW, OKX, 1inch, KyberSwap, Jupiter,
                  Across, CCTP, ParaSwap — across 40+ chains. Best price simulated before you sign.
                  Non-custodial. MPC keys. Nothing touches a custody account.
                </p>
              </div>
            </section>

            {/* suwappu perps */}
            <section className={styles.section}>
              <div className={styles.sectionPrompt}>
                <span className={styles.sectionDollar}>$</span>
                <span className={styles.sectionCmd}>suwappu perps</span>
              </div>
              <div className={styles.sectionBody}>
                <p>
                  HyperLiquid up to 20× from chat.{' '}
                  <span style={{ color: 'var(--dim)' }}>
                    /perps /fund /stake /vault /twap /spot
                  </span>
                  {'  '}Fund HyperCore directly from any chain — no bridge UI, no extra wallet.
                </p>
              </div>
            </section>

            {/* suwappu mcp */}
            <section className={styles.section}>
              <div className={styles.sectionPrompt}>
                <span className={styles.sectionDollar}>$</span>
                <span className={styles.sectionCmd}>suwappu mcp</span>
              </div>
              <div className={styles.sectionBody}>
                <p>
                  Hosted MCP server at{' '}
                  <span style={{ color: 'var(--signal)' }}>api.suwappu.bot/mcp</span>
                  {' '}— streamable HTTP, 14 tools, Bearer key.
                </p>

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

            {/* suwappu surfaces */}
            <section className={styles.section}>
              <div className={styles.sectionPrompt}>
                <span className={styles.sectionDollar}>$</span>
                <span className={styles.sectionCmd}>suwappu surfaces</span>
              </div>
              <div className={styles.sectionBody}>
                <p>
                  One engine behind the Telegram bot, web terminal, REST API, and MCP.
                  Same price. Same speed. Same security model — wherever you trade.
                </p>
              </div>
            </section>
          </div>

          {/* ── CTA block ────────────────────────────────────── */}
          <div className={styles.ctaBlock}>
            <p className={styles.ctaInstall}>
              bun add @suwappu/sdk
            </p>
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
          © 2026 Suwappu · すわっぷ · Non-custodial by design
        </footer>
      </div>
    </div>
  );
}
