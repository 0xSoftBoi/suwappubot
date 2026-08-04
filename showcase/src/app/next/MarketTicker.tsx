'use client';

import { useEffect, useReducer, useRef } from 'react';
import styles from './next.module.css';

/* ── Seeded deterministic ticker ────────────────────────────────
   No Math.random() in render. Values advance on a fixed cadence
   through a pre-computed table. reduced-motion freezes the state. */

type Token = {
  sym:   string;
  price: number;
  chg:   number;  // % change display
};

// Seed table: [price_cents, last_digit_cycle[], chg_bps]
// Prices are illustrative sample values: never labelled live.
const SEED: Token[] = [
  { sym: 'ETH',  price: 3_487.14, chg:  +1.83 },
  { sym: 'BTC',  price: 67_204.80, chg: +0.74 },
  { sym: 'SOL',  price: 148.62,   chg:  +3.21 },
  { sym: 'HYPE', price: 22.47,    chg:  +5.09 },
  { sym: 'USDC', price: 1.0001,   chg:  +0.00 },
];

// Tiny tick deltas per token: last digit(s) only
const TICKS: number[][] = [
  [+0.01, -0.02, +0.03, -0.01, +0.02, -0.03, +0.01],
  [+1.00, -2.00, +3.00, -1.00, +2.00, -1.00, +0.00],
  [+0.01, -0.02, +0.01,  0.00, +0.03, -0.01, +0.02],
  [+0.01,  0.00, -0.01, +0.02, -0.02, +0.01,  0.00],
  [ 0.00,  0.00,  0.00,  0.00,  0.00,  0.00,  0.00],
];

function fmt(sym: string, price: number): string {
  if (sym === 'BTC')  return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (sym === 'USDC') return price.toFixed(4);
  return price.toFixed(2);
}

type State = { tokens: Token[]; step: number };

function reducer(state: State): State {
  const next = state.tokens.map((t, i) => {
    const delta = TICKS[i][state.step % TICKS[i].length];
    return { ...t, price: Math.max(0.0001, t.price + delta) };
  });
  return { tokens: next, step: state.step + 1 };
}

export function MarketTicker() {
  const [state, tick] = useReducer(reducer, { tokens: SEED, step: 0 });
  const prefersReduced = useRef(false);

  useEffect(() => {
    prefersReduced.current =
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced.current) return;

    // ~0.5 fps per token feel; stagger each token on its own interval
    const id = setInterval(tick, 1800);
    return () => clearInterval(id);
  }, []);

  return (
    <div className={styles.tickerGrid} role="table" aria-label="Sample market prices (illustrative)">
      <div className={styles.tickerHead} role="row" aria-hidden="true">
        <span>SYMBOL</span>
        <span className={styles.tickerRight}>PRICE (USD)</span>
        <span className={styles.tickerRight}>CHG 24H</span>
      </div>

      {state.tokens.map((t) => {
        const pos = t.chg >= 0;
        return (
          <div key={t.sym} className={styles.tickerRow} role="row">
            <span className={styles.tickerSym}>{t.sym}</span>
            <span className={`${styles.tickerPrice} ${styles.tickerRight}`}>
              {fmt(t.sym, t.price)}
            </span>
            <span
              className={`${styles.tickerChg} ${styles.tickerRight} ${pos ? styles.tickerPos : styles.tickerNeg}`}
            >
              {pos ? '+' : ''}{t.chg.toFixed(2)}%
            </span>
          </div>
        );
      })}

      <div className={styles.tickerCaption}>
        illustrative sample · not live data · prices update ~every 2 s
      </div>
    </div>
  );
}
