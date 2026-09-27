'use client';

import { motion, useReducedMotion } from 'framer-motion';
import SummerNav from '@/components/SummerNav';
import SummerFooter from '@/components/SummerFooter';
import AmbientOrb, { OrbState } from './AmbientOrb';
import QrModal from './QrModal';
import StatusStrip from './StatusStrip';
import CopyField from './CopyField';
import { HOOK_ADDRESS, ensAppUrl, etherscanAddress, etherscanTx } from './api';
import { usePassportFlow, type SwapView } from './usePassportFlow';
import styles from './passport.module.css';

const EASE = [0.22, 1, 0.36, 1] as const;

export default function PassportPageClient() {
  const reduceMotion = useReducedMotion();
  const {
    status,
    statusError,
    statusLoading,
    wallet,
    setWallet,
    newWallet,
    swaps,
    swapBeat,
    attemptSwap,
    verifyPhase,
    verifyError,
    start,
    verified,
    humanVerified,
    beginVerification,
    cancelVerification,
    passportRecord,
    evidence,
    evidenceError,
  } = usePassportFlow();

  const enabled = status?.trustLayer !== undefined || !statusError;
  const notEnabled = !statusLoading && !!statusError && !status;

  const swapPhase = swaps[swapBeat].phase;
  const swapBusy = (b: 'pre' | 'post') => swaps[b].phase === 'checking' || swaps[b].phase === 'submitted';

  const orbState: OrbState =
    swapPhase === 'checking' || swapPhase === 'submitted' || verifyPhase === 'starting' || verifyPhase === 'pending' || verifyPhase === 'provisioning'
      ? 'thinking'
      : swapPhase === 'executed' || humanVerified
        ? 'success'
        : swapPhase === 'failed' || verifyPhase === 'failed' || verifyPhase === 'error'
          ? 'error'
          : 'idle';

  const qrOpen = verifyPhase === 'starting' || verifyPhase === 'pending' || verifyPhase === 'provisioning';

  return (
    <div className={`summer-page ${styles.canvas}`}>
      <SummerNav />

      <main className={styles.shell}>
        <section className={styles.hero}>
          <AmbientOrb state={orbState} />

          <motion.div
            className={styles.heroCopy}
            initial={{ opacity: 0, y: reduceMotion ? 0 : 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: EASE }}
          >
            <h1 className={styles.h1}>Agent Swap Passport</h1>
            <p className={styles.lede}>
              A human proves they&rsquo;re real once. From then on, a Uniswap v4 hook checks that
              proof on every trade the agent&rsquo;s wallet tries to make.
            </p>
          </motion.div>

          {notEnabled ? (
            <div className={styles.banner} data-tone="pending">
              <span className={styles.bannerTitle}>Trust layer not enabled on this deploy.</span>
              <span>
                {statusError} — the demo endpoints (<code>/hackathon/*</code>) haven&rsquo;t shipped
                to this environment yet.
              </span>
            </div>
          ) : (
            <div className={styles.flowStage} style={{ maxWidth: 560, gap: 24 }}>
              {/* Beat 0 — wallet */}
              <div className={styles.beat}>
                <span className={styles.beatKicker}>Beat 0 — the agent&rsquo;s wallet</span>
                <p className={styles.hint} style={{ margin: 0 }}>
                  This is the agent&rsquo;s own wallet. The demo relayer executes swaps on its
                  behalf, and the Uniswap v4 hook checks <em>this</em> address before letting any
                  trade through.
                </p>
                <div className={styles.walletRow}>
                  <input
                    className={styles.walletInput}
                    value={wallet}
                    onChange={(e) => setWallet(e.target.value.trim())}
                    spellCheck={false}
                    aria-label="Agent wallet address"
                  />
                  <button type="button" className={styles.walletBtn} onClick={newWallet}>
                    New wallet
                  </button>
                </div>
              </div>

              {/* Beat 1 — swap without a passport */}
              <div className={styles.beat}>
                <span className={styles.beatKicker}>Beat 1</span>
                <h2 className={styles.beatTitle}>Try to swap without a passport</h2>
                <button
                  type="button"
                  className={styles.cta}
                  onClick={() => attemptSwap('pre')}
                  disabled={swapBusy('pre') || swapBusy('post')}
                >
                  {swapBusy('pre')
                    ? 'Checking…'
                    : swaps.pre.phase === 'blocked'
                      ? 'Try again'
                      : 'Attempt swap'}
                </button>

                <SwapOutcome view={swaps.pre} wallet={wallet} beat="pre" />
              </div>

              {/* Beat 2 — prove human */}
              <div className={styles.beat}>
                <span className={styles.beatKicker}>Beat 2</span>
                <h2 className={styles.beatTitle}>Prove you&rsquo;re human</h2>
                <button
                  type="button"
                  className={styles.cta}
                  onClick={() =>
                    verifyPhase === 'pending' || verifyPhase === 'provisioning' || verifyPhase === 'starting'
                      ? cancelVerification()
                      : beginVerification()
                  }
                  disabled={humanVerified}
                >
                  {humanVerified
                    ? 'Verified'
                    : verifyPhase === 'starting'
                      ? 'Starting…'
                      : verifyPhase === 'pending' || verifyPhase === 'provisioning'
                        ? 'Cancel'
                        : verifyPhase === 'failed' || verifyPhase === 'error'
                          ? 'Try again'
                          : 'Get a passport'}
                </button>

                {verifyPhase === 'provisioning' && (
                  <div className={styles.banner} data-tone="pending">
                    Minting your agent&rsquo;s ENS name and allowlisting it on the hook…
                  </div>
                )}

                {(verifyPhase === 'ready' || verifyPhase === 'existing') &&
                  verified &&
                  (verified.status === 'ready' || verified.status === 'existing') && (
                    <div className={styles.banner} data-tone="success">
                      {verifyPhase === 'existing' && (
                        <span className={styles.bannerTitle}>This human already holds a passport.</span>
                      )}
                      <span>
                        ENS name:{' '}
                        <a
                          href={ensAppUrl(verified.ens.name)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.copyFieldLink}
                        >
                          {verified.ens.name}
                        </a>
                        {verified.ens.txHash && (
                          <>
                            {' '}
                            (
                            <CopyField value={verified.ens.txHash} href={etherscanTx(verified.ens.txHash)} display="tx" />
                            )
                          </>
                        )}
                        {verified.ens.existing && ' — already registered'}
                      </span>
                      <span>
                        Hook allowlist:{' '}
                        {verified.hook.allowlistTx ? (
                          <CopyField value={verified.hook.allowlistTx} href={etherscanTx(verified.hook.allowlistTx)} display="tx" />
                        ) : (
                          'already allowlisted'
                        )}
                        {verified.hook.existing && ' — already allowlisted'}
                      </span>
                      <span>Bound wallet: <code>{verified.wallet}</code></span>
                    </div>
                  )}

                {(verifyPhase === 'failed' || verifyPhase === 'error') && (
                  <div className={styles.banner} data-tone="blocked">
                    <span className={styles.bannerTitle} data-tone="blocked">Verification failed</span>
                    <span>{verifyError}</span>
                  </div>
                )}
              </div>

              <QrModal
                open={qrOpen}
                connectorURI={start?.connectorURI ?? null}
                onClose={cancelVerification}
                simulatorUrl={start?.simulatorUrl}
              />

              {/* Beat 3 — swap with passport */}
              {humanVerified && (
                <div className={styles.beat}>
                  <span className={styles.beatKicker}>Beat 3</span>
                  <h2 className={styles.beatTitle}>Swap with passport</h2>
                  <button
                    type="button"
                    className={styles.cta}
                    onClick={() => attemptSwap('post')}
                    disabled={swapBusy('pre') || swapBusy('post')}
                  >
                    {swaps.post.phase === 'checking'
                      ? 'Checking…'
                      : swaps.post.phase === 'submitted'
                        ? 'Submitted…'
                        : swaps.post.phase === 'executed'
                          ? 'Swap again'
                          : 'Swap with passport'}
                  </button>

                  <SwapOutcome view={swaps.post} wallet={wallet} beat="post" />

                  {swaps.pre.phase === 'blocked' && swaps.post.phase === 'executed' && (
                    <p className={styles.hint} style={{ margin: 0 }}>
                      Same wallet, same pool, same hook. Beat 1 was refused; this one went through
                      because a verified human now stands behind the wallet.
                    </p>
                  )}

                  {passportRecord?.swaps && passportRecord.swaps.length > 0 && (
                    <p className={styles.hint} style={{ margin: 0 }}>
                      {passportRecord.swaps.length} swap{passportRecord.swaps.length === 1 ? '' : 's'} recorded for
                      this passport.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          <p className={styles.poweredBy}>Powered by World · ENS · Uniswap</p>
        </section>

        <section className={styles.techSection}>
          <span className={styles.beatKicker}>Reference deployment</span>
          <div className={styles.techBody} style={{ marginTop: 12 }}>
            <StatusStrip status={status} error={statusError} loading={statusLoading} />
            {evidenceError === 'not-deployed' ? (
              <p className={styles.hint}>
                <code>/hackathon/evidence</code> isn&rsquo;t live on this deploy yet.
              </p>
            ) : (
              <>
                <div className={styles.techRow}>
                  <span className={styles.techLabel}>Hook</span>
                  <CopyField value={HOOK_ADDRESS} href={etherscanAddress(HOOK_ADDRESS)} />
                </div>
                {evidence?.uniswap?.deployTx && (
                  <div className={styles.techRow}>
                    <span className={styles.techLabel}>Hook deploy tx</span>
                    <CopyField value={evidence.uniswap.deployTx} href={etherscanTx(evidence.uniswap.deployTx)} />
                  </div>
                )}
                {evidence?.ens?.parent && (
                  <div className={styles.techRow}>
                    <span className={styles.techLabel}>ENS parent</span>
                    <span>{evidence.ens.parent}</span>
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      </main>

      <SummerFooter />
    </div>
  );
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** One beat's swap outcome. Each beat owns its own SwapView, so a later beat
 * can never overwrite an earlier one's result. */
function SwapOutcome({ view, wallet, beat }: { view: SwapView; wallet: string; beat: 'pre' | 'post' }) {
  const { phase, result, job, error } = view;

  if (phase === 'submitted') {
    return (
      <div className={styles.banner} data-tone="pending">
        Allowed by the hook — the relayer is sending the swap…
      </div>
    );
  }

  if (phase === 'blocked' && result?.status === 'blocked') {
    return (
      <div className={styles.banner} data-tone="blocked">
        <span className={styles.bannerTitle} data-tone="blocked">
          {beat === 'pre' ? 'Blocked by the hook' : 'Still blocked'} — {result.reason}
        </span>
        <span>
          Rejected during simulation, so no transaction was sent and no gas was spent.
        </span>
        <a
          href={etherscanAddress(HOOK_ADDRESS)}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.copyFieldLink}
        >
          View the hook on Etherscan →
        </a>
      </div>
    );
  }

  if (phase === 'executed' && job?.status === 'executed') {
    const swapper = job.swapper || wallet;
    return (
      <div className={styles.banner} data-tone="success">
        <span className={styles.bannerTitle}>
          Swap executed{job.blockNumber ? ` in block ${job.blockNumber.toLocaleString()}` : ''}
        </span>
        {job.txHash && <CopyField value={job.txHash} href={etherscanTx(job.txHash)} display="view transaction" />}
        <span>
          The hook checked <code>{short(swapper)}</code> and let it through.
          {job.executedBy && (
            <>
              {' '}Sent by the demo relayer{' '}
              <a
                href={etherscanAddress(job.executedBy)}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.copyFieldLink}
              >
                {short(job.executedBy)}
              </a>{' '}
              on the agent&rsquo;s behalf.
            </>
          )}
        </span>
      </div>
    );
  }

  if (phase === 'failed') {
    return (
      <div className={styles.banner} data-tone="blocked">
        <span className={styles.bannerTitle} data-tone="blocked">Swap failed</span>
        <span>{error}</span>
      </div>
    );
  }

  return null;
}
