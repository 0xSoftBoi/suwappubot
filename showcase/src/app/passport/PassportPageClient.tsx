'use client';

import { motion, useReducedMotion } from 'framer-motion';
import SummerNav from '@/components/SummerNav';
import SummerFooter from '@/components/SummerFooter';
import AmbientOrb, { OrbState } from './AmbientOrb';
import QrModal from './QrModal';
import StatusStrip from './StatusStrip';
import CopyField from './CopyField';
import { HOOK_ADDRESS, ensAppUrl, etherscanAddress, etherscanTx } from './api';
import { usePassportFlow } from './usePassportFlow';
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
    swapPhase,
    swapResult,
    swapJob,
    swapError,
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
                  onClick={attemptSwap}
                  disabled={swapPhase === 'checking' || swapPhase === 'submitted'}
                >
                  {swapPhase === 'checking'
                    ? 'Checking…'
                    : swapPhase === 'submitted'
                      ? 'Submitted…'
                      : 'Attempt swap'}
                </button>

                {swapPhase === 'blocked' && swapResult?.status === 'blocked' && (
                  <div className={styles.banner} data-tone="blocked">
                    <span className={styles.bannerTitle} data-tone="blocked">
                      Reverted: {swapResult.reason}
                    </span>
                    <span>
                      0 gas spent — rejected by the hook before execution.
                      {swapResult.detail ? ` ${swapResult.detail}` : ''}
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
                )}

                {swapPhase === 'executed' && swapJob?.status === 'executed' && (
                  <SwapExecutedBanner wallet={wallet} txHash={swapJob.txHash} executedBy={swapJob.executedBy} swapper={swapJob.swapper} />
                )}

                {swapPhase === 'failed' && (
                  <div className={styles.banner} data-tone="blocked">
                    <span className={styles.bannerTitle} data-tone="blocked">Swap failed</span>
                    <span>{swapError}</span>
                  </div>
                )}
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
                    onClick={attemptSwap}
                    disabled={swapPhase === 'checking' || swapPhase === 'submitted'}
                  >
                    {swapPhase === 'checking'
                      ? 'Checking…'
                      : swapPhase === 'submitted'
                        ? 'Submitted…'
                        : 'Swap with passport'}
                  </button>

                  {swapPhase === 'submitted' && (
                    <div className={styles.banner} data-tone="pending">Job submitted — waiting for the relayer…</div>
                  )}

                  {swapPhase === 'executed' && swapJob?.status === 'executed' && (
                    <SwapExecutedBanner wallet={wallet} txHash={swapJob.txHash} executedBy={swapJob.executedBy} swapper={swapJob.swapper} />
                  )}

                  {swapPhase === 'blocked' && swapResult?.status === 'blocked' && (
                    <div className={styles.banner} data-tone="blocked">
                      <span className={styles.bannerTitle} data-tone="blocked">
                        Still blocked: {swapResult.reason}
                      </span>
                      <span>{swapResult.detail}</span>
                    </div>
                  )}

                  {swapPhase === 'failed' && (
                    <div className={styles.banner} data-tone="blocked">
                      <span className={styles.bannerTitle} data-tone="blocked">Swap failed</span>
                      <span>{swapError}</span>
                    </div>
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

function SwapExecutedBanner({
  wallet,
  txHash,
  executedBy,
  swapper,
}: {
  wallet: string;
  txHash?: string;
  executedBy?: string;
  swapper?: string;
}) {
  return (
    <div className={styles.banner} data-tone="success">
      <span className={styles.bannerTitle}>Executed</span>
      {txHash && <CopyField value={txHash} href={etherscanTx(txHash)} display="view transaction" />}
      <span>
        Executed by relayer <code>{executedBy || 'the relayer'}</code> on behalf of{' '}
        <code>{swapper || wallet}</code>; the hook verified <code>{wallet}</code>.
      </span>
    </div>
  );
}
