'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  Evidence,
  HackathonStatus,
  PassportRecord,
  PassportStartResponse,
  PassportVerifyResponse,
  SwapJob,
  SwapStartResponse,
  getEvidence,
  getPassport,
  getStatus,
  getSwapJob,
  passportStart,
  passportSwap,
  passportVerify,
  randomWallet,
} from './api';

export type SwapPhase = 'idle' | 'checking' | 'blocked' | 'submitted' | 'executed' | 'failed';
export type VerifyPhase = 'idle' | 'starting' | 'pending' | 'provisioning' | 'ready' | 'existing' | 'failed' | 'error';

const POLL_INTERVAL_MS = 2000;
const POLL_ERROR_BACKOFF_MS = 3500;
const POLL_CAP_MS = 5 * 60 * 1000;

export function usePassportFlow() {
  const [status, setStatus] = useState<HackathonStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);

  const [wallet, setWallet] = useState<string>(() =>
    typeof window !== 'undefined' ? randomWallet() : '0x0000000000000000000000000000000000000000',
  );

  // Beat 1 / 3 — swap attempt
  const [swapPhase, setSwapPhase] = useState<SwapPhase>('idle');
  const [swapResult, setSwapResult] = useState<SwapStartResponse | null>(null);
  const [swapJob, setSwapJob] = useState<SwapJob | null>(null);
  const [swapError, setSwapError] = useState<string | null>(null);

  // Beat 2 — proof of human
  const [verifyPhase, setVerifyPhase] = useState<VerifyPhase>('idle');
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [start, setStart] = useState<PassportStartResponse | null>(null);
  const [verified, setVerified] = useState<PassportVerifyResponse | null>(null);

  const [passportRecord, setPassportRecord] = useState<PassportRecord | null>(null);

  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);

  const swapPollToken = useRef<{ cancelled: boolean } | null>(null);
  const verifyPollToken = useRef<{ cancelled: boolean } | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const s = await getStatus();
      setStatus(s);
      setStatusError(null);
    } catch (e) {
      setStatusError(e instanceof Error ? e.message : 'Status endpoint unavailable.');
    } finally {
      setStatusLoading(false);
    }
  }, []);

  const loadEvidence = useCallback(async () => {
    try {
      const ev = await getEvidence();
      setEvidence(ev);
      setEvidenceError(null);
    } catch (e) {
      setEvidenceError(e instanceof ApiError && e.status === 404 ? 'not-deployed' : 'unavailable');
    }
  }, []);

  useEffect(() => {
    loadStatus();
    loadEvidence();
    const t = setInterval(loadStatus, 20000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const newWallet = useCallback(() => {
    setWallet(randomWallet());
    setSwapPhase('idle');
    setSwapResult(null);
    setSwapJob(null);
    setSwapError(null);
    setVerifyPhase('idle');
    setVerifyError(null);
    setStart(null);
    setVerified(null);
    setPassportRecord(null);
  }, []);

  const stopSwapPolling = useCallback(() => {
    if (swapPollToken.current) swapPollToken.current.cancelled = true;
  }, []);
  const stopVerifyPolling = useCallback(() => {
    if (verifyPollToken.current) verifyPollToken.current.cancelled = true;
  }, []);

  // Beat 1 / Beat 3 — same action, called before and after the passport exists.
  const attemptSwap = useCallback(async () => {
    stopSwapPolling();
    setSwapError(null);
    setSwapJob(null);
    setSwapPhase('checking');
    try {
      const res = await passportSwap(wallet);
      setSwapResult(res);
      if (res.status === 'blocked') {
        setSwapPhase('blocked');
        return;
      }
      setSwapPhase('submitted');
      const token = { cancelled: false };
      swapPollToken.current = token;
      const deadline = Date.now() + POLL_CAP_MS;

      const poll = async () => {
        if (token.cancelled) return;
        if (Date.now() > deadline) {
          if (!token.cancelled) {
            setSwapPhase('failed');
            setSwapError('Swap job timed out — retry when ready.');
          }
          return;
        }
        try {
          const job = await getSwapJob(res.jobId);
          if (token.cancelled) return;
          setSwapJob(job);
          if (job.status === 'executed') {
            setSwapPhase('executed');
            return;
          }
          if (job.status === 'failed') {
            setSwapPhase('failed');
            setSwapError(job.reason || 'Swap failed.');
            return;
          }
          setTimeout(poll, POLL_INTERVAL_MS);
        } catch {
          setTimeout(poll, POLL_ERROR_BACKOFF_MS);
        }
      };
      poll();
    } catch (e) {
      setSwapPhase('failed');
      setSwapError(e instanceof Error ? e.message : 'Could not reach the swap endpoint.');
    }
  }, [wallet, stopSwapPolling]);

  // Beat 2 — proof of human
  const beginVerification = useCallback(async () => {
    stopVerifyPolling();
    setVerifyError(null);
    setVerified(null);
    setVerifyPhase('starting');
    try {
      const res = await passportStart(wallet);
      setStart(res);
      setVerifyPhase('pending');

      const token = { cancelled: false };
      verifyPollToken.current = token;
      const deadline = Date.now() + POLL_CAP_MS;

      const poll = async () => {
        if (token.cancelled) return;
        if (Date.now() > deadline) {
          if (!token.cancelled) {
            setVerifyPhase('failed');
            setVerifyError('Verification timed out after 5 minutes — retry when ready.');
          }
          return;
        }
        try {
          const v = await passportVerify(res.signal);
          if (token.cancelled) return;
          setVerified(v);
          if (v.status === 'pending') {
            setTimeout(poll, POLL_INTERVAL_MS);
            return;
          }
          if (v.status === 'provisioning') {
            setVerifyPhase('provisioning');
            setTimeout(poll, POLL_INTERVAL_MS);
            return;
          }
          if (v.status === 'ready') {
            setVerifyPhase('ready');
            getPassport(wallet).then(setPassportRecord).catch(() => {});
            return;
          }
          if (v.status === 'existing') {
            setVerifyPhase('existing');
            getPassport(wallet).then(setPassportRecord).catch(() => {});
            return;
          }
          if (v.status === 'failed') {
            setVerifyPhase('failed');
            setVerifyError(v.reason || 'Verification failed.');
            return;
          }
        } catch {
          setTimeout(poll, POLL_ERROR_BACKOFF_MS);
        }
      };
      poll();
    } catch (e) {
      setVerifyPhase('error');
      setVerifyError(e instanceof Error ? e.message : 'Could not start verification.');
    }
  }, [wallet, stopVerifyPolling]);

  const cancelVerification = useCallback(() => {
    stopVerifyPolling();
    setVerifyPhase('idle');
    setVerifyError(null);
  }, [stopVerifyPolling]);

  useEffect(() => () => {
    stopSwapPolling();
    stopVerifyPolling();
  }, [stopSwapPolling, stopVerifyPolling]);

  const humanVerified = verifyPhase === 'ready' || verifyPhase === 'existing';

  return {
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
  };
}
