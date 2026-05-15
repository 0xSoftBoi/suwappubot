import Analytics from '@/components/Analytics';
import StructuredData from '@/components/StructuredData';

const TERMINAL_URL = 'https://terminal.suwappu.bot';

const modules = [
  {
    eyebrow: 'Live workspace',
    title: 'Terminal',
    body: 'Charts, market tables, order books, swap tickets, wallet rail, and execution controls in one dense trading surface.',
    stat: 'Full desk',
  },
  {
    eyebrow: 'Execution layer',
    title: 'Agent API',
    body: 'Quotes, swaps, status checks, perps, prediction markets, lending, and managed wallet actions through one API.',
    stat: '15+ chains',
  },
  {
    eyebrow: 'Fast command lane',
    title: 'Telegram bot',
    body: 'Ask for a quote, follow a route, watch a wallet, or execute from the bot without leaving the flow.',
    stat: '@suwappu_bot',
  },
];

const sdkLines = [
  'bun add @suwappu/sdk',
  'suwappu quote ETH USDC 1.0 --chain base',
  'route: Base -> Uniswap V3',
  'out: 3,483.28 USDC',
  'suwappu execute quote_live_42',
  'status: confirmed',
];

const rows = [
  ['ETH/USDC', '$3,483.28', '+6.94%', 'Uniswap V3'],
  ['SOL/USDC', '$182.34', '+2.14%', 'Jupiter'],
  ['BASE/ETH', '$1.02', '+0.62%', 'Base'],
];

const candles = [34, 48, 42, 56, 62, 58, 70, 66, 78, 72, 84, 80];

function TerminalPreview() {
  return (
    <div className="summer-terminal" aria-label="Terminal preview">
      <div className="summer-flower summer-flower--mist summer-terminal__flower" aria-hidden="true" />
      <div className="summer-terminal__bar">
        <div className="summer-terminal__dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <span className="summer-terminal__host">terminal.suwappu.bot</span>
        <span className="summer-pill">live route</span>
      </div>

      <div className="summer-terminal__grid">
        <div className="summer-chart">
          <div className="summer-chart__head">
            <div>
              <p>Market</p>
              <strong>ETH/USDC</strong>
            </div>
            <div>
              <strong>$3,483.28</strong>
              <span>+6.94%</span>
            </div>
          </div>
          <div className="summer-chart__plot">
            <div className="summer-chart__gridlines" />
            <img className="summer-chart__fruit" src="/logo.svg" alt="" aria-hidden="true" />
            <div className="summer-flower summer-flower--sun summer-chart__flower" aria-hidden="true" />
            <div className="summer-chart__candles">
              {candles.map((height, index) => (
                <span
                  key={`${height}-${index}`}
                  style={{ height: `${height}%` }}
                  className={index % 5 === 2 ? 'summer-candle summer-candle--sky' : 'summer-candle'}
                />
              ))}
            </div>
            <span className="summer-chart__price">$3,483.28</span>
          </div>
        </div>

        <div className="summer-stack">
          <div className="summer-mini-panel">
            <div className="summer-mini-panel__head">
              <strong>Route</strong>
              <span>98.2%</span>
            </div>
            <dl>
              <div><dt>ETH</dt><dd>Base</dd></div>
              <div><dt>USDC</dt><dd>Uniswap V3</dd></div>
              <div><dt>Gas</dt><dd>$0.12</dd></div>
            </dl>
          </div>
          <div className="summer-mini-panel">
            <strong>Wallet rail</strong>
            {['Treasury lane', 'Solana float', 'Base scout'].map((item) => (
              <div className="summer-wallet-row" key={item}>
                <span>{item}</span>
                <b>+2.1%</b>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Hero() {
  return (
    <section className="summer-hero">
      <div className="summer-flower-field summer-flower-field--hero" aria-hidden="true">
        <span className="summer-flower summer-flower--soft" />
        <span className="summer-flower summer-flower--sun" />
        <span className="summer-flower summer-flower--mist" />
        <span className="summer-petal summer-petal--sky" />
        <span className="summer-petal summer-petal--pink" />
      </div>
      <img className="summer-hero__fruit" src="/logo.svg" alt="" aria-hidden="true" />
      <div className="summer-hero__copy">
        <p className="summer-kicker">Summer Breeze system</p>
        <h1>Suwappu</h1>
        <p className="summer-hero__lead">
          One execution workspace for terminal trading, agent APIs, wallet rails,
          bot commands, and route-aware swaps.
        </p>
        <div className="summer-actions">
          <a className="summer-button summer-button--primary" href={TERMINAL_URL}>
            Open Terminal
          </a>
          <a className="summer-button summer-button--secondary" href="/docs">
            Docs/API
          </a>
        </div>
        <div className="summer-install">
          <span>$</span>
          <code>bun add @suwappu/sdk</code>
        </div>
      </div>
      <TerminalPreview />
    </section>
  );
}

export default function Home() {
  return (
    <>
      <StructuredData />
      <Analytics />
      <main id="main-content" className="summer-page">
        <div className="summer-bg summer-bg--stem" aria-hidden="true" />
        <div className="summer-bg summer-bg--bloom" aria-hidden="true" />
        <div className="summer-mobile-rail" aria-hidden="true">
          <img src="/logo.svg" alt="" />
          <span className="summer-flower summer-flower--soft" />
          <b>すわっぷ</b>
          <span className="summer-rail-loop summer-rail-loop--top" />
          <span className="summer-rail-loop summer-rail-loop--bottom" />
          <span className="summer-flower summer-flower--sun" />
        </div>

        <header className="summer-nav">
          <a className="summer-brand" href="/">
            <img src="/logo.svg" alt="" />
            <span>suwappu</span>
          </a>
          <nav aria-label="Primary navigation">
            <a href="#terminal">Terminal</a>
            <a href="#api">API</a>
            <a href="#bot">Bot</a>
            <a href="/docs">Docs</a>
          </nav>
          <a className="summer-nav__cta" href={TERMINAL_URL}>
            Open Terminal
          </a>
        </header>

        <div className="summer-shell">
          <Hero />

          <section id="terminal" className="summer-modules" aria-label="Product modules">
            {modules.map((module, index) => (
              <article className="summer-module" key={module.title}>
                <i
                  className={
                    index === 0
                      ? 'summer-module__mark summer-module__mark--fruit'
                      : `summer-module__mark summer-flower ${index === 1 ? 'summer-flower--soft' : 'summer-flower--sun'}`
                  }
                  aria-hidden="true"
                />
                <p>{module.eyebrow}</p>
                <h2>{module.title}</h2>
                <span>{module.stat}</span>
                <div>{module.body}</div>
              </article>
            ))}
          </section>

          <section id="api" className="summer-sdk">
            <div className="summer-flower summer-flower--mist summer-sdk__flower" aria-hidden="true" />
            <div>
              <p className="summer-kicker">SDK lane</p>
              <h2>Three calls. Full route.</h2>
              <p>
                Quote, execute, and track a trade across the same execution
                surface the terminal uses.
              </p>
              <div className="summer-flow">
                {['Register an agent', 'Request a quote', 'Execute the route', 'Track status'].map((step, index) => (
                  <div key={step}>
                    <span>0{index + 1}</span>
                    <strong>{step}</strong>
                  </div>
                ))}
              </div>
            </div>
            <div className="summer-code" aria-label="SDK example">
              <div className="summer-code__bar">
                <span />
                <span />
                <span />
                <b>@suwappu/sdk</b>
              </div>
              <pre>
                {sdkLines.map((line, index) => (
                  <code key={line} className={index === 3 || index === 5 ? 'is-success' : ''}>
                    <span>{index === 2 || index === 3 || index === 5 ? '=' : '>'}</span>
                    {line}
                  </code>
                ))}
              </pre>
            </div>
          </section>

          <section id="bot" className="summer-proof">
            <div className="summer-flower summer-flower--soft summer-proof__flower" aria-hidden="true" />
            <div className="summer-proof__head">
              <div>
                <p className="summer-kicker">Market proof</p>
                <h2>Readable trading primitives.</h2>
              </div>
              <p>
                Market rows, route health, wallet watch, bot commands, and API
                status stay visible without making the page feel crowded.
              </p>
            </div>
            <div className="summer-table">
              <div className="summer-table__row summer-table__row--head">
                <span>Pair</span>
                <span>Price</span>
                <span>24h</span>
                <span>Route</span>
              </div>
              {rows.map((row) => (
                <div className="summer-table__row" key={row[0]}>
                  <span>{row[0]}</span>
                  <span>{row[1]}</span>
                  <span>{row[2]}</span>
                  <span>{row[3]}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
