'use client';

import { useMemo, useState } from 'react';
import { motion, useReducedMotion, type Easing } from 'framer-motion';
import SummerNav from '@/components/SummerNav';
import SummerFooter from '@/components/SummerFooter';
import PassportCard, { StampKey } from './PassportCard';
import QrPanel from './QrPanel';
import StatusStrip from './StatusStrip';
import CopyField from './CopyField';
import { usePassportFlow } from './usePassportFlow';
import { etherscanAddress, etherscanTx } from './api';
import styles from './passport.module.css';

const CHAINS = ['base', 'ethereum', 'arbitrum', 'optimism'];
const TOKENS = ['USDC', 'ETH', 'USDT', 'WBTC'];

function receiptOk(receipts: Record<string, { status?: string }> | undefined, hash?: string) {
  if (!receipts || !hash) return false;
  const r = receipts[hash];
  return !!r && /success|1|confirmed|ok/i.test(String(r.status ?? ''));
}

const EASE: Easing = [0.22, 1, 0.36, 1];

function fadeUp(reduce: boolean | null) {
  return {
    initial: { opacity: 0, y: reduce ? 0 : 28 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, margin: '-80px' },
    transition: { duration: 0.6, ease: EASE },
  };
}

export default function PassportPageClient() {
  const reduceMotion = useReducedMotion();
  const flow = usePassportFlow();
  const [showAdvanced, setShowAdvanced] = useState(false);

  const {
    status,
    statusError,
    statusLoading,
    trade,
    setTrade,
    worldPhase,
    worldError,
    start,
    nullifier,
    beginVerification,
    cancelVerification,
    evidence,
    evidenceError,
    evidenceLoading,
  } = flow;

  const ensLanded = !!evidence?.ens?.sample?.resolvedAddress;
  const swapHash = evidence?.uniswap?.swapTx;
  const swapLanded = receiptOk(evidence?.receipts, swapHash) || (!!swapHash && !evidence?.receipts);

  const landed: Record<StampKey, boolean> = {
    worldId: worldPhase === 'verified',
    ens: ensLanded,
    uniswap: swapLanded,
  };

  const evidenceUnavailable = evidenceError === 'not-deployed';

  const stepAnim = useMemo(() => fadeUp(reduceMotion), [reduceMotion]);

  return (
    <div className="summer-page summer-page--cosmic">
      <SummerNav />

      <main className={styles.shell}>
        {/* ── Hero ── */}
        <section className={styles.hero}>
          <motion.div
            className={styles.heroCopy}
            initial={{ opacity: 0, y: reduceMotion ? 0 : 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          >
            <span className={styles.eyebrow}>ETHGlobal Tokyo 2026 · Live demo</span>
            <h1 className={styles.h1}>The Agent Swap Passport</h1>
            <p className={styles.lede}>
              One identity, three sponsors, one gated trade. A human proves personhood with{' '}
              <strong>World ID</strong>, their agent is issued an <strong>ENSv2</strong> subname on
              Sepolia, and every swap it makes routes through a World-ID-gated{' '}
              <strong>Uniswap v4</strong> hook. Watch the stamps land as each proof clears, live.
            </p>
            <StatusStrip status={status} error={statusError} loading={statusLoading} />
          </motion.div>

          <PassportCard agentId={trade.agentId} landed={landed} />
        </section>

        {/* ── Connector line ── */}
        <div className={styles.connector} aria-hidden="true">
          <div className={styles.connectorLine} />
          {!reduceMotion && (
            <>
              <span className={styles.connectorDot} style={{ ['--d' as string]: '0s' }} />
              <span className={styles.connectorDot} style={{ ['--d' as string]: '1.1s' }} />
              <span className={styles.connectorDot} style={{ ['--d' as string]: '2.2s' }} />
            </>
          )}
        </div>

        {/* ── Step 1: Verify human ── */}
        <motion.section className={styles.step} {...stepAnim}>
          <header className={styles.stepHead}>
            <span className={styles.stepNum}>01</span>
            <div>
              <h2>Verify human</h2>
              <p>World ID confirms a real person is behind this agent before it trades.</p>
            </div>
            <span
              className={styles.stepBadge}
              data-state={
                worldPhase === 'verified' ? 'success' : worldPhase === 'failed' || worldPhase === 'error' ? 'error' : worldPhase === 'idle' ? 'idle' : 'loading'
              }
            >
              {worldPhase === 'verified'
                ? 'Verified'
                : worldPhase === 'failed'
                  ? 'Failed'
                  : worldPhase === 'error'
                    ? 'Error'
                    : worldPhase === 'awaiting'
                      ? 'Awaiting scan'
                      : worldPhase === 'starting'
                        ? 'Starting…'
                        : 'Idle'}
            </span>
          </header>

          <div className={styles.stepBody}>
            <form
              className={styles.tradeForm}
              onSubmit={(e) => {
                e.preventDefault();
                beginVerification();
              }}
            >
              <label className={styles.field}>
                <span>Chain</span>
                <select
                  value={trade.chain}
                  onChange={(e) => setTrade({ ...trade, chain: e.target.value })}
                  disabled={worldPhase === 'awaiting' || worldPhase === 'starting'}
                >
                  {CHAINS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                <span>From</span>
                <select
                  value={trade.fromToken}
                  onChange={(e) => setTrade({ ...trade, fromToken: e.target.value })}
                  disabled={worldPhase === 'awaiting' || worldPhase === 'starting'}
                >
                  {TOKENS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                <span>To</span>
                <select
                  value={trade.toToken}
                  onChange={(e) => setTrade({ ...trade, toToken: e.target.value })}
                  disabled={worldPhase === 'awaiting' || worldPhase === 'starting'}
                >
                  {TOKENS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                <span>Amount</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={trade.amountIn}
                  onChange={(e) => setTrade({ ...trade, amountIn: e.target.value })}
                  disabled={worldPhase === 'awaiting' || worldPhase === 'starting'}
                />
              </label>

              <div className={styles.tradeActions}>
                {worldPhase === 'awaiting' ? (
                  <button type="button" className={styles.btnGhost} onClick={cancelVerification}>
                    Cancel
                  </button>
                ) : (
                  <button type="submit" className={styles.btnPrimary} disabled={worldPhase === 'starting'}>
                    {worldPhase === 'starting'
                      ? 'Starting…'
                      : worldPhase === 'failed' || worldPhase === 'error'
                        ? 'Retry verification'
                        : worldPhase === 'verified'
                          ? 'Verify again'
                          : 'Start verification'}
                  </button>
                )}
              </div>
            </form>

            <div className={styles.verifyPanel}>
              {worldPhase === 'idle' && (
                <p className={styles.hint}>Fill the intent above, then start verification to get a scannable QR.</p>
              )}
              {(worldPhase === 'starting' || worldPhase === 'awaiting') && start && (
                <QrPanel connectorURI={start.connectorURI} />
              )}
              {worldPhase === 'awaiting' && (
                <p className={styles.hint} aria-live="polite">
                  Waiting for World App confirmation — polling every few seconds, up to 5 minutes.
                </p>
              )}
              {worldPhase === 'verified' && nullifier && (
                <div className={styles.verifiedPanel}>
                  <p className={styles.hint}>Human verified. Nullifier:</p>
                  <CopyField value={nullifier} />
                </div>
              )}
              {(worldPhase === 'failed' || worldPhase === 'error') && (
                <div className={styles.errorPanel} role="alert">
                  <p>{worldError || 'Something went wrong.'}</p>
                  <button type="button" className={styles.btnGhost} onClick={beginVerification}>
                    Retry
                  </button>
                </div>
              )}
            </div>
          </div>
        </motion.section>

        {/* ── Step 2: ENS identity ── */}
        <motion.section className={styles.step} {...stepAnim}>
          <header className={styles.stepHead}>
            <span className={styles.stepNum}>02</span>
            <div>
              <h2>ENS identity</h2>
              <p>The agent is issued a subname under Suwappu&rsquo;s ENSv2 parent, resolvable on Sepolia.</p>
            </div>
            <span
              className={styles.stepBadge}
              data-state={evidenceUnavailable ? 'error' : ensLanded ? 'success' : evidenceLoading ? 'loading' : 'idle'}
            >
              {evidenceUnavailable ? 'Not deployed' : ensLanded ? 'Resolved' : evidenceLoading ? 'Loading…' : 'Pending'}
            </span>
          </header>

          <div className={styles.stepBody}>
            {evidenceUnavailable ? (
              <p className={styles.hint}>
                The evidence endpoint (<code>/hackathon/evidence</code>) 404s on this deploy — the API branch
                hasn&rsquo;t shipped yet. This card will populate live once it does.
              </p>
            ) : evidenceError ? (
              <p className={styles.hint}>Evidence unavailable: {evidenceError}</p>
            ) : (
              <dl className={styles.evidenceGrid}>
                <div>
                  <dt>Parent domain</dt>
                  <dd>{evidence?.ens?.parent || '—'}</dd>
                </div>
                <div>
                  <dt>Subregistry</dt>
                  <dd>
                    {evidence?.ens?.subregistry ? (
                      <CopyField value={evidence.ens.subregistry} href={etherscanAddress(evidence.ens.subregistry)} />
                    ) : (
                      '—'
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Sample subname</dt>
                  <dd>{evidence?.ens?.sample?.name || '—'}</dd>
                </div>
                <div>
                  <dt>Resolved address</dt>
                  <dd>
                    {evidence?.ens?.sample?.resolvedAddress ? (
                      <CopyField
                        value={evidence.ens.sample.resolvedAddress}
                        href={etherscanAddress(evidence.ens.sample.resolvedAddress)}
                      />
                    ) : (
                      '—'
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Registration tx</dt>
                  <dd>
                    {evidence?.ens?.sample?.txHash ? (
                      <>
                        <CopyField value={evidence.ens.sample.txHash} href={etherscanTx(evidence.ens.sample.txHash)} />{' '}
                        <span className={styles.receiptBadge} data-state={receiptOk(evidence?.receipts, evidence.ens.sample.txHash) ? 'success' : 'pending'}>
                          {receiptOk(evidence?.receipts, evidence.ens.sample.txHash) ? 'confirmed' : 'pending'}
                        </span>
                      </>
                    ) : (
                      '—'
                    )}
                  </dd>
                </div>
              </dl>
            )}
          </div>
        </motion.section>

        {/* ── Step 3: Gated swap ── */}
        <motion.section className={styles.step} {...stepAnim}>
          <header className={styles.stepHead}>
            <span className={styles.stepNum}>03</span>
            <div>
              <h2>Gated swap</h2>
              <p>The trade executes through a Uniswap v4 hook that only accepts World-ID-verified callers.</p>
            </div>
            <span
              className={styles.stepBadge}
              data-state={evidenceUnavailable ? 'error' : swapLanded ? 'success' : evidenceLoading ? 'loading' : 'idle'}
            >
              {evidenceUnavailable ? 'Not deployed' : swapLanded ? 'Swap confirmed' : evidenceLoading ? 'Loading…' : 'Pending'}
            </span>
          </header>

          <div className={styles.stepBody}>
            {evidenceUnavailable ? (
              <p className={styles.hint}>Same branch dependency as step 2 — the hook and swap receipts will appear once evidence is live.</p>
            ) : evidenceError ? (
              <p className={styles.hint}>Evidence unavailable: {evidenceError}</p>
            ) : (
              <dl className={styles.evidenceGrid}>
                <div>
                  <dt>Chain</dt>
                  <dd>{evidence?.chainId ? `Sepolia (${evidence.chainId})` : '—'}</dd>
                </div>
                <div>
                  <dt>Hook contract</dt>
                  <dd>
                    {evidence?.uniswap?.hook ? (
                      <CopyField value={evidence.uniswap.hook} href={etherscanAddress(evidence.uniswap.hook)} />
                    ) : (
                      '—'
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Hook deploy tx</dt>
                  <dd>
                    {evidence?.uniswap?.deployTx ? (
                      <>
                        <CopyField value={evidence.uniswap.deployTx} href={etherscanTx(evidence.uniswap.deployTx)} />{' '}
                        <span className={styles.receiptBadge} data-state={receiptOk(evidence?.receipts, evidence.uniswap.deployTx) ? 'success' : 'pending'}>
                          {receiptOk(evidence?.receipts, evidence.uniswap.deployTx) ? 'confirmed' : 'pending'}
                        </span>
                      </>
                    ) : (
                      '—'
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Swap tx</dt>
                  <dd>
                    {swapHash ? (
                      <>
                        <CopyField value={swapHash} href={etherscanTx(swapHash)} />{' '}
                        <span className={styles.receiptBadge} data-state={swapLanded ? 'success' : 'pending'}>
                          {swapLanded ? 'confirmed' : 'pending'}
                        </span>
                      </>
                    ) : (
                      '—'
                    )}
                  </dd>
                </div>
              </dl>
            )}
            <p className={styles.hint} style={{ marginTop: 12 }}>
              Intercepta&rsquo;s risk layer is out of scope for this demo —{' '}
              <button type="button" className={styles.inlineToggle} onClick={() => setShowAdvanced((v) => !v)}>
                {showAdvanced ? 'hide details' : 'coming soon, why?'}
              </button>
            </p>
            {showAdvanced && (
              <p className={styles.hint}>
                Intercepta wires pre-trade risk scoring into the same gate; it&rsquo;s scoped out here to keep the
                Tokyo demo to the three sponsor tracks judged tonight — World ID, ENS, and Uniswap.
              </p>
            )}
          </div>
        </motion.section>
      </main>

      <SummerFooter />
    </div>
  );
}
