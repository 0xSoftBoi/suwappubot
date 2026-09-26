'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  Evidence,
  HackathonStatus,
  TRADE_DEFAULTS,
  TradeIntent,
  WorldIdStartResponse,
  getEvidence,
  getStatus,
  startWorldId,
  verifyWorldId,
} from './api';

export type WorldPhase = 'idle' | 'starting' | 'awaiting' | 'verified' | 'failed' | 'error';

const POLL_INTERVAL_MS = 2500;
const POLL_ERROR_BACKOFF_MS = 3500;
const POLL_CAP_MS = 5 * 60 * 1000;

export function usePassportFlow() {
  const [status, setStatus] = useState<HackathonStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);

  const [trade, setTrade] = useState<TradeIntent>(TRADE_DEFAULTS);

  const [worldPhase, setWorldPhase] = useState<WorldPhase>('idle');
  const [worldError, setWorldError] = useState<string | null>(null);
  const [start, setStart] = useState<WorldIdStartResponse | null>(null);
  const [nullifier, setNullifier] = useState<string | null>(null);

  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const [evidenceLoading, setEvidenceLoading] = useState(true);

  const pollToken = useRef<{ cancelled: boolean } | null>(null);

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
    setEvidenceLoading(true);
    try {
      const ev = await getEvidence();
      setEvidence(ev);
      setEvidenceError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        setEvidenceError('not-deployed');
      } else {
        setEvidenceError(e instanceof Error ? e.message : 'Evidence endpoint unavailable.');
      }
    } finally {
      setEvidenceLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
    loadEvidence();
    const t = setInterval(loadStatus, 20000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopPolling = useCallback(() => {
    if (pollToken.current) pollToken.current.cancelled = true;
  }, []);

  const cancelVerification = useCallback(() => {
    stopPolling();
    setWorldPhase('idle');
    setWorldError(null);
  }, [stopPolling]);

  const beginVerification = useCallback(async () => {
    stopPolling();
    setWorldError(null);
    setNullifier(null);
    setWorldPhase('starting');

    try {
      const summary = `${trade.amountIn} ${trade.fromToken} -> ${trade.toToken} on ${trade.chain}`;
      const res = await startWorldId({ ...trade, summary });
      setStart(res);
      setWorldPhase('awaiting');

      const token = { cancelled: false };
      pollToken.current = token;
      const deadline = Date.now() + POLL_CAP_MS;

      const poll = async () => {
        if (token.cancelled) return;
        if (Date.now() > deadline) {
          if (!token.cancelled) {
            setWorldPhase('failed');
            setWorldError('Verification timed out after 5 minutes — retry when ready.');
          }
          return;
        }
        try {
          const v = await verifyWorldId(res.signal);
          if (token.cancelled) return;
          if (v.status === 'verified') {
            setWorldPhase('verified');
            setNullifier(v.nullifier);
            loadEvidence();
            return;
          }
          if (v.status === 'failed') {
            setWorldPhase('failed');
            setWorldError(v.reason || 'Verification failed.');
            return;
          }
          setTimeout(poll, POLL_INTERVAL_MS);
        } catch {
          // Network errors and 5xx/524 count as "keep polling" per the API contract.
          setTimeout(poll, POLL_ERROR_BACKOFF_MS);
        }
      };
      poll();
    } catch (e) {
      setWorldPhase('error');
      if (e instanceof ApiError && e.status === 404) {
        setWorldError('World ID start endpoint is not deployed yet.');
      } else {
        setWorldError(e instanceof Error ? e.message : 'Could not start verification.');
      }
    }
  }, [trade, stopPolling, loadEvidence]);

  useEffect(() => stopPolling, [stopPolling]);

  return {
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
    loadEvidence,
  };
}
