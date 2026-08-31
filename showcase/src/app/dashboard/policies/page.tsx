'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  Copy, Check, Plus, Trash, DownloadSimple, CaretLeft, CaretRight,
  CheckCircle, XCircle, Clock, LockSimple,
} from '@phosphor-icons/react';
import { API_BASE_URL } from '@/lib/links';
import { type AuthState, useDashboardAuth } from '../auth-context';
import dStyles from '../dashboard.module.css';
import styles from './policies.module.css';

// ── Types (mirrors api-ts/src/routes/enterprisePolicies.ts) ────────────────
//
// GET /enterprise/orgs/me returns { org: {id,name,tier}, role } — role is
// the caller's membership role for that org (see enterprise.ts:210), used
// below to gate the mutation controls this page renders.

interface Org {
  id: string;
  name: string;
  tier: string;
}

type Role = 'owner' | 'admin' | 'member' | 'viewer';

interface MeResponse {
  org: Org;
  role: Role;
}

const POLICY_TYPES = ['tx_limit', 'daily_limit', 'velocity', 'allowlist_only', 'spending_tier'] as const;
type PolicyType = (typeof POLICY_TYPES)[number];

const POLICY_TYPE_LABELS: Record<PolicyType, string> = {
  tx_limit: 'Transaction limit',
  daily_limit: 'Daily limit',
  velocity: 'Velocity',
  allowlist_only: 'Allowlist only',
  spending_tier: 'Spending tier',
};

interface Policy {
  id: string;
  orgId: string;
  name: string;
  policyType: PolicyType;
  params: Record<string, unknown>;
  requiredApprovals: number;
  enabled: boolean;
  createdBy: number | string | null;
  createdAt: string;
  updatedAt: string;
}

interface AllowlistEntry {
  id: string;
  orgId: string;
  chain: string;
  address: string;
  label: string | null;
  addedBy: number | string | null;
  createdAt: string;
}

const REQUEST_TYPES = ['transaction', 'policy_change', 'allowlist_add', 'allowlist_remove', 'other'] as const;
type RequestType = (typeof REQUEST_TYPES)[number];

const REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'expired'] as const;
type RequestStatus = (typeof REQUEST_STATUSES)[number];

interface ApprovalRequest {
  id: string;
  orgId: string;
  policyId: string | null;
  requestedBy: number | string | null;
  requestType: RequestType;
  payload: Record<string, unknown>;
  status: RequestStatus;
  requiredApprovals: number;
  expiresAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

// Chains the product supports (api-ts/src/config/chains.ts NATIVE_TOKENS
// keys — validation on POST /allowlist rejects anything not in that map).
// Curated to the set actually surfaced elsewhere in the marketing/product
// UI rather than the full 40+ RPC list, per showcase/CLAUDE.md's "reuse
// before inventing" bar — an allowlist add-form with 40 obscure L2s would
// bury the chains members actually use.
const ALLOWLIST_CHAINS: { value: string; label: string }[] = [
  { value: 'ethereum', label: 'Ethereum' },
  { value: 'base', label: 'Base' },
  { value: 'arbitrum', label: 'Arbitrum' },
  { value: 'optimism', label: 'Optimism' },
  { value: 'polygon', label: 'Polygon' },
  { value: 'bsc', label: 'BNB Chain' },
  { value: 'avalanche', label: 'Avalanche' },
  { value: 'solana', label: 'Solana' },
  { value: 'tron', label: 'TRON' },
  { value: 'starknet', label: 'Starknet' },
  { value: 'robinhood', label: 'Robinhood Chain' },
  { value: 'goat', label: 'GOAT Network' },
];

const PAGE_SIZE = 20;

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtUsd(n: unknown): string {
  const num = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(num)) return '—';
  return num.toLocaleString(undefined, {
    style: 'currency', currency: 'USD',
    maximumFractionDigits: Math.abs(num) >= 1000 ? 0 : 2,
  });
}

function fmtTimestamp(ts: string | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function shortId(id: string | number | null | undefined, head = 8, tail = 6): string {
  if (id === null || id === undefined) return '—';
  const s = String(id);
  return s.length > head + tail + 1 ? `${s.slice(0, head)}…${s.slice(-tail)}` : s;
}

// One-line summary from a policy's params, per policyType — mirrors the
// PARAMS SHAPE contract in api-ts/src/db/schema/policies.ts exactly so this
// never drifts from what the server actually validates/stores.
function summarizePolicyParams(policyType: PolicyType, params: Record<string, unknown>): string {
  switch (policyType) {
    case 'tx_limit':
      return `Blocks single transactions above ${fmtUsd(params.thresholdUsd)}`;
    case 'daily_limit':
      return `Blocks cumulative daily volume above ${fmtUsd(params.thresholdUsd)}`;
    case 'velocity':
      return `Max ${params.maxTxPerWindow ?? '—'} transactions per ${params.windowHours ?? '—'}h window`;
    case 'allowlist_only':
      return 'Destinations must be on the org allowlist below';
    case 'spending_tier':
      return `Requires approval above ${fmtUsd(params.thresholdUsd)}, up to a ${fmtUsd(params.tierUpperUsd)} tier`;
    default:
      return '—';
  }
}

// Derives a one-line summary from a JSON payload — same pattern as
// summarizeDetails() in ../audit/page.tsx (no pre-baked summary field from
// the API, so this reads the same JSON an admin would open in full).
function summarizePayload(payload: unknown): string {
  if (payload === null || payload === undefined) return '—';
  if (typeof payload !== 'object') return String(payload);
  const entries = Object.entries(payload as Record<string, unknown>);
  if (entries.length === 0) return '—';
  const fmt = (v: unknown) => (v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  const shown = entries.slice(0, 4).map(([k, v]) => `${k}: ${fmt(v)}`).join(', ');
  return entries.length > 4 ? `${shown}, …` : shown;
}

function extractErrorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object') return fallback;
  const err = (body as Record<string, unknown>).error;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    // zod .flatten() shape: { formErrors: string[], fieldErrors: {...} }
    const flat = err as { formErrors?: string[]; fieldErrors?: Record<string, string[]> };
    const parts: string[] = [];
    if (flat.formErrors?.length) parts.push(...flat.formErrors);
    if (flat.fieldErrors) {
      Object.entries(flat.fieldErrors).forEach(([k, v]) => {
        if (Array.isArray(v) && v.length) parts.push(`${k}: ${v.join(', ')}`);
      });
    }
    if (parts.length) return parts.join('; ');
  }
  return fallback;
}

function formatCountdown(expiresAt: string, now: number): { text: string; urgent: boolean } {
  const target = new Date(expiresAt).getTime();
  const diffMs = target - now;
  if (diffMs <= 0) return { text: 'Expired', urgent: true };
  const mins = Math.floor(diffMs / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return { text: `Expires in ${days}d ${hours % 24}h`, urgent: false };
  if (hours > 0) return { text: `Expires in ${hours}h ${mins % 60}m`, urgent: hours < 2 };
  return { text: `Expires in ${mins}m`, urgent: true };
}

// clearToken deliberately NOT wired into every non-org 401 — see the same
// comment in ../page.tsx. Only the /enterprise/orgs/me probe below treats a
// 401 as a genuinely dead session.
function useApiFetch(auth: AuthState) {
  return useCallback(
    async (path: string, opts: RequestInit = {}): Promise<Response> => {
      return fetch(`${API_BASE_URL}${path}`, {
        ...opts,
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(auth.kind === 'token' ? { Authorization: `Bearer ${auth.value}` } : {}),
          ...(opts.headers ?? {}),
        },
      });
    },
    [auth]
  );
}

type ApiFetch = ReturnType<typeof useApiFetch>;

// ── Shared bits ──────────────────────────────────────────────────────────────

function CopyChip({ value, mono = true }: { value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);

  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }).catch(() => {});
  }

  return (
    <span className={styles.addressChip} title={value}>
      <span className={mono ? dStyles.mono : undefined}>{shortId(value, 8, 6)}</span>
      <button type="button" className={styles.copyBtn} onClick={handleCopy} aria-label="Copy address">
        {copied ? <Check size={13} weight="bold" /> : <Copy size={13} />}
      </button>
    </span>
  );
}

function Switch({
  on, disabled, onToggle, label,
}: {
  on: boolean;
  disabled: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      className={styles.switch}
      data-on={on || undefined}
      disabled={disabled}
      onClick={onToggle}
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={disabled ? 'Owner or admin role required' : label}
    >
      <span className={styles.switchKnob} />
    </button>
  );
}

function RoleHint({ text = 'Owner or admin role required' }: { text?: string }) {
  return (
    <span className={styles.roleHint}>
      <LockSimple size={11} weight="bold" /> {text}
    </span>
  );
}

// Two-step inline confirm — avoids a native confirm() popup, which reads as
// old-web against this page's premium bar (see showcase/CLAUDE.md).
function ConfirmDelete({
  label, onConfirm, disabled,
}: {
  label: string;
  onConfirm: () => void;
  disabled?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <span className={styles.confirmRow}>
        <span className={styles.confirmText}>Delete?</span>
        <button
          type="button"
          className={`${dStyles.actionBtn} ${styles.dangerBtn}`}
          onClick={() => { setConfirming(false); onConfirm(); }}
        >
          Yes
        </button>
        <button type="button" className={dStyles.actionBtn} onClick={() => setConfirming(false)}>
          Cancel
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      className={`${dStyles.actionBtn} ${styles.dangerBtn}`}
      onClick={() => setConfirming(true)}
      disabled={disabled}
      title={disabled ? 'Owner or admin role required' : label}
      aria-label={label}
    >
      <Trash size={13} />
    </button>
  );
}

// =============================================================================
// 1. Policy rules
// =============================================================================

const EMPTY_POLICY_PARAMS: Record<string, string> = {
  thresholdUsd: '', windowHours: '', maxTxPerWindow: '', tierUpperUsd: '',
};

function CreatePolicyForm({
  orgId, apiFetch, onCreated,
}: {
  orgId: string;
  apiFetch: ApiFetch;
  onCreated: (p: Policy) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [policyType, setPolicyType] = useState<PolicyType>('tx_limit');
  const [params, setParams] = useState(EMPTY_POLICY_PARAMS);
  const [requiredApprovals, setRequiredApprovals] = useState('1');
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function reset() {
    setName(''); setPolicyType('tx_limit'); setParams(EMPTY_POLICY_PARAMS);
    setRequiredApprovals('1'); setEnabled(true); setErr(null);
  }

  function handleTypeChange(next: PolicyType) {
    setPolicyType(next);
    setParams(EMPTY_POLICY_PARAMS);
  }

  function buildParams(): Record<string, unknown> {
    switch (policyType) {
      case 'tx_limit':
      case 'daily_limit':
        return { thresholdUsd: Number(params.thresholdUsd) };
      case 'velocity':
        return { windowHours: Number(params.windowHours), maxTxPerWindow: Number(params.maxTxPerWindow) };
      case 'allowlist_only':
        return {};
      case 'spending_tier':
        return { tierUpperUsd: Number(params.tierUpperUsd), thresholdUsd: Number(params.thresholdUsd) };
      default:
        return {};
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setErr('Give this policy a name.'); return; }
    setBusy(true);
    setErr(null);
    try {
      const res = await apiFetch(`/enterprise/orgs/${orgId}/policies`, {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          policyType,
          params: buildParams(),
          requiredApprovals: Math.max(1, Number(requiredApprovals) || 1),
          enabled,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setErr(extractErrorMessage(body, 'Could not create policy. Please check the values and try again.'));
        return;
      }
      onCreated(body.policy as Policy);
      reset();
      setOpen(false);
    } catch (e2) {
      setErr('Could not create policy. Check your connection.');
      console.error(e2);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className={`${dStyles.actionBtn} ${dStyles['actionBtn--create']}`} onClick={() => setOpen(true)}>
        <Plus size={14} style={{ marginRight: 5, verticalAlign: -2 }} />
        New policy
      </button>
    );
  }

  return (
    <form className={styles.createForm} onSubmit={handleSubmit}>
      <div className={styles.formRow}>
        <label className={styles.formField}>
          <span className={styles.formLabel}>Name</span>
          <input
            className={styles.formInput}
            placeholder="e.g. Large withdrawal review"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
          />
        </label>
        <label className={styles.formField}>
          <span className={styles.formLabel}>Type</span>
          <select
            className={styles.formSelect}
            value={policyType}
            onChange={(e) => handleTypeChange(e.target.value as PolicyType)}
          >
            {POLICY_TYPES.map((t) => <option key={t} value={t}>{POLICY_TYPE_LABELS[t]}</option>)}
          </select>
        </label>
        <label className={styles.formField} style={{ maxWidth: 150 }}>
          <span className={styles.formLabel}>Quorum (approvals)</span>
          <input
            type="number" min={1} max={50}
            className={styles.formInput}
            value={requiredApprovals}
            onChange={(e) => setRequiredApprovals(e.target.value)}
          />
        </label>
      </div>

      {(policyType === 'tx_limit' || policyType === 'daily_limit') && (
        <div className={styles.formRow}>
          <label className={styles.formField}>
            <span className={styles.formLabel}>Threshold (USD)</span>
            <input
              type="number" min={0} step="any"
              className={styles.formInput}
              value={params.thresholdUsd}
              onChange={(e) => setParams({ ...params, thresholdUsd: e.target.value })}
            />
          </label>
          <p className={styles.formHint}>Must be greater than 0.</p>
        </div>
      )}

      {policyType === 'velocity' && (
        <div className={styles.formRow}>
          <label className={styles.formField}>
            <span className={styles.formLabel}>Window (hours)</span>
            <input
              type="number" min={0} step="any"
              className={styles.formInput}
              value={params.windowHours}
              onChange={(e) => setParams({ ...params, windowHours: e.target.value })}
            />
          </label>
          <label className={styles.formField}>
            <span className={styles.formLabel}>Max tx per window</span>
            <input
              type="number" min={1} step={1}
              className={styles.formInput}
              value={params.maxTxPerWindow}
              onChange={(e) => setParams({ ...params, maxTxPerWindow: e.target.value })}
            />
          </label>
          <p className={styles.formHint}>Both must be greater than 0; max tx per window is a whole number.</p>
        </div>
      )}

      {policyType === 'allowlist_only' && (
        <p className={styles.formHint}>No parameters — evaluated against the allowlist in the section below.</p>
      )}

      {policyType === 'spending_tier' && (
        <div className={styles.formRow}>
          <label className={styles.formField}>
            <span className={styles.formLabel}>Tier upper bound (USD)</span>
            <input
              type="number" min={0} step="any"
              className={styles.formInput}
              value={params.tierUpperUsd}
              onChange={(e) => setParams({ ...params, tierUpperUsd: e.target.value })}
            />
          </label>
          <label className={styles.formField}>
            <span className={styles.formLabel}>Approval threshold (USD)</span>
            <input
              type="number" min={0} step="any"
              className={styles.formInput}
              value={params.thresholdUsd}
              onChange={(e) => setParams({ ...params, thresholdUsd: e.target.value })}
            />
          </label>
          <p className={styles.formHint}>Both must be greater than 0.</p>
        </div>
      )}

      <label className={styles.formCheck}>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Enabled immediately
      </label>

      {err && <p className={styles.formErr} role="alert">{err}</p>}

      <div className={styles.formActions}>
        <button type="submit" className={`${dStyles.actionBtn} ${dStyles['actionBtn--create']}`} disabled={busy}>
          {busy ? 'Creating…' : 'Create policy'}
        </button>
        <button type="button" className={dStyles.actionBtn} onClick={() => { reset(); setOpen(false); }}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function PoliciesSection({
  orgId, apiFetch, canManage, onPoliciesChange,
}: {
  orgId: string;
  apiFetch: ApiFetch;
  canManage: boolean;
  // Approval requests can optionally inherit a policy's quorum (see
  // CreateApprovalRequestForm below) — this lifts the loaded policy list up
  // to the page so that form has options without a second fetch.
  onPoliciesChange: (p: Policy[]) => void;
}) {
  const [policies, setPolicies] = useState<Policy[]>([]);

  useEffect(() => { onPoliciesChange(policies); }, [policies, onPoliciesChange]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportErr, setExportErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await apiFetch(`/enterprise/orgs/${orgId}/policies`);
      if (!res.ok) { setErr('Could not load policies. Please try again.'); return; }
      const body = await res.json();
      setPolicies(Array.isArray(body?.policies) ? body.policies : []);
    } catch (e) {
      setErr('Could not load policies. Check your connection.');
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [apiFetch, orgId]);

  useEffect(() => { load(); }, [load]);

  async function toggleEnabled(policy: Policy) {
    if (!canManage) return;
    setBusyId(policy.id);
    const prev = policies;
    setPolicies((ps) => ps.map((p) => (p.id === policy.id ? { ...p, enabled: !p.enabled } : p)));
    try {
      const res = await apiFetch(`/enterprise/orgs/${orgId}/policies/${policy.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: !policy.enabled }),
      });
      if (!res.ok) setPolicies(prev);
    } catch (e) {
      setPolicies(prev);
      console.error(e);
    } finally {
      setBusyId(null);
    }
  }

  async function deletePolicy(policy: Policy) {
    setBusyId(policy.id);
    const prev = policies;
    setPolicies((ps) => ps.filter((p) => p.id !== policy.id));
    try {
      const res = await apiFetch(`/enterprise/orgs/${orgId}/policies/${policy.id}`, { method: 'DELETE' });
      if (!res.ok) setPolicies(prev);
    } catch (e) {
      setPolicies(prev);
      console.error(e);
    } finally {
      setBusyId(null);
    }
  }

  async function handleExport() {
    setExporting(true);
    setExportErr(null);
    try {
      const res = await apiFetch(`/enterprise/orgs/${orgId}/policies/export`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setExportErr(extractErrorMessage(body, 'Export failed. Please try again.'));
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `org-${orgId}-policy-export.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportErr('Export failed. Check your connection.');
      console.error(e);
    } finally {
      setExporting(false);
    }
  }

  return (
    <section className={dStyles.card} aria-label="Policy rules">
      <div className={dStyles.cardHead}>
        <h2 className={dStyles.cardTitle}>Policy rules</h2>
        <div className={styles.formActions}>
          <button
            type="button"
            className={dStyles.actionBtn}
            onClick={handleExport}
            disabled={exporting || policies.length === 0 || !canManage}
            title={canManage ? 'Download a signed export of policies + allowlist' : 'Owner or admin role required'}
          >
            <DownloadSimple size={14} style={{ marginRight: 5, verticalAlign: -2 }} />
            {exporting ? 'Exporting…' : 'Export'}
          </button>
        </div>
      </div>

      {!canManage && <RoleHint text="Owner or admin role required to create, edit, or export policies." />}
      {exportErr && <p className={styles.formErr} role="alert" style={{ marginTop: 10 }}>{exportErr}</p>}

      {loading ? (
        <div className={dStyles.skel} aria-hidden="true" style={{ marginTop: 14 }}>
          <div className={dStyles.skelLine} style={{ width: '60%' }} />
          <div className={dStyles.skelLine} style={{ width: '100%' }} />
        </div>
      ) : err ? (
        <div className={dStyles.stateBox} style={{ minHeight: 100 }} role="alert">
          <span>{err}</span>
          <button className={dStyles.actionBtn} onClick={load}>Retry</button>
        </div>
      ) : policies.length === 0 ? (
        <p className={styles.policySummary} style={{ margin: '8px 0 16px' }}>
          No policy rules yet. Create one to start gating transfers by limit, velocity, or allowlist.
        </p>
      ) : (
        <div style={{ marginTop: 6 }}>
          {policies.map((p) => (
            <div key={p.id} className={styles.policyRow}>
              <div className={styles.policyMain}>
                <div className={styles.policyNameRow}>
                  <span className={styles.policyName}>{p.name}</span>
                  <span className={styles.typePill} data-type={p.policyType}>{POLICY_TYPE_LABELS[p.policyType] ?? p.policyType}</span>
                  {!p.enabled && <span className={styles.disabledTag}>Disabled</span>}
                </div>
                <span className={styles.policySummary}>{summarizePolicyParams(p.policyType, p.params)}</span>
                <div className={styles.policyMeta}>
                  <span className={dStyles.pill}>{p.requiredApprovals} approval{p.requiredApprovals === 1 ? '' : 's'}</span>
                  <span className={dStyles.pill}>Updated {fmtTimestamp(p.updatedAt)}</span>
                </div>
              </div>
              <div className={styles.policyActions}>
                <Switch
                  on={p.enabled}
                  disabled={!canManage || busyId === p.id}
                  onToggle={() => toggleEnabled(p)}
                  label={p.enabled ? `Disable ${p.name}` : `Enable ${p.name}`}
                />
                <ConfirmDelete
                  label={`Delete ${p.name}`}
                  disabled={!canManage || busyId === p.id}
                  onConfirm={() => deletePolicy(p)}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <hr className={styles.sectionDivider} />

      {canManage ? (
        <CreatePolicyForm orgId={orgId} apiFetch={apiFetch} onCreated={(p) => setPolicies((ps) => [p, ...ps])} />
      ) : (
        <RoleHint text="Ask an org owner or admin to create a policy." />
      )}
    </section>
  );
}

// =============================================================================
// 2. Allowlist
// =============================================================================

function AddAllowlistForm({
  orgId, apiFetch, onCreated,
}: {
  orgId: string;
  apiFetch: ApiFetch;
  onCreated: (e: AllowlistEntry) => void;
}) {
  const [open, setOpen] = useState(false);
  const [chain, setChain] = useState(ALLOWLIST_CHAINS[0].value);
  const [address, setAddress] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!address.trim()) { setErr('Enter a destination address.'); return; }
    setBusy(true);
    setErr(null);
    try {
      const res = await apiFetch(`/enterprise/orgs/${orgId}/allowlist`, {
        method: 'POST',
        body: JSON.stringify({ chain, address: address.trim(), label: label.trim() || undefined }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setErr(extractErrorMessage(body, 'Could not add this address. Please check the format and try again.'));
        return;
      }
      onCreated(body.entry as AllowlistEntry);
      setAddress(''); setLabel(''); setOpen(false);
    } catch (e2) {
      setErr('Could not add this address. Check your connection.');
      console.error(e2);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className={`${dStyles.actionBtn} ${dStyles['actionBtn--create']}`} onClick={() => setOpen(true)}>
        <Plus size={14} style={{ marginRight: 5, verticalAlign: -2 }} />
        Add address
      </button>
    );
  }

  return (
    <form className={styles.createForm} onSubmit={handleSubmit}>
      <div className={styles.formRow}>
        <label className={styles.formField} style={{ maxWidth: 180 }}>
          <span className={styles.formLabel}>Chain</span>
          <select className={styles.formSelect} value={chain} onChange={(e) => setChain(e.target.value)}>
            {ALLOWLIST_CHAINS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </label>
        <label className={styles.formField} style={{ flex: 2 }}>
          <span className={styles.formLabel}>Address</span>
          <input
            className={styles.formInput}
            placeholder="0x… / base58 / felt"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            spellCheck={false}
          />
        </label>
        <label className={styles.formField}>
          <span className={styles.formLabel}>Label (optional)</span>
          <input
            className={styles.formInput}
            placeholder="e.g. Cold storage"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={100}
          />
        </label>
      </div>
      {err && <p className={styles.formErr} role="alert">{err}</p>}
      <div className={styles.formActions}>
        <button type="submit" className={`${dStyles.actionBtn} ${dStyles['actionBtn--create']}`} disabled={busy}>
          {busy ? 'Adding…' : 'Add to allowlist'}
        </button>
        <button type="button" className={dStyles.actionBtn} onClick={() => { setErr(null); setOpen(false); }}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function AllowlistSection({
  orgId, apiFetch, canManage,
}: {
  orgId: string;
  apiFetch: ApiFetch;
  canManage: boolean;
}) {
  const [entries, setEntries] = useState<AllowlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await apiFetch(`/enterprise/orgs/${orgId}/allowlist`);
      if (!res.ok) { setErr('Could not load the allowlist. Please try again.'); return; }
      const body = await res.json();
      setEntries(Array.isArray(body?.allowlist) ? body.allowlist : []);
    } catch (e) {
      setErr('Could not load the allowlist. Check your connection.');
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [apiFetch, orgId]);

  useEffect(() => { load(); }, [load]);

  async function removeEntry(entry: AllowlistEntry) {
    setBusyId(entry.id);
    const prev = entries;
    setEntries((es) => es.filter((e) => e.id !== entry.id));
    try {
      const res = await apiFetch(`/enterprise/orgs/${orgId}/allowlist/${entry.id}`, { method: 'DELETE' });
      if (!res.ok) setEntries(prev);
    } catch (e) {
      setEntries(prev);
      console.error(e);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className={dStyles.card} aria-label="Allowlist">
      <div className={dStyles.cardHead}>
        <h2 className={dStyles.cardTitle}>Allowlist</h2>
      </div>
      {!canManage && <RoleHint text="Owner or admin role required to add or remove addresses." />}

      {loading ? (
        <div className={dStyles.skel} aria-hidden="true" style={{ marginTop: 14 }}>
          <div className={dStyles.skelLine} style={{ width: '50%' }} />
          <div className={dStyles.skelLine} style={{ width: '100%' }} />
        </div>
      ) : err ? (
        <div className={dStyles.stateBox} style={{ minHeight: 100 }} role="alert">
          <span>{err}</span>
          <button className={dStyles.actionBtn} onClick={load}>Retry</button>
        </div>
      ) : entries.length === 0 ? (
        <p className={styles.policySummary} style={{ margin: '8px 0 16px' }}>
          No allowlisted destinations yet.
        </p>
      ) : (
        <table className={dStyles.table} style={{ marginBottom: 16 }}>
          <thead>
            <tr>
              <th>Chain</th>
              <th>Address</th>
              <th>Label</th>
              <th>Added</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td><span className={styles.chainTag}>{e.chain}</span></td>
                <td><CopyChip value={e.address} /></td>
                <td>{e.label || '—'}</td>
                <td className={dStyles.mono}>{fmtTimestamp(e.createdAt)}</td>
                <td>
                  <ConfirmDelete
                    label={`Remove ${e.address}`}
                    disabled={!canManage || busyId === e.id}
                    onConfirm={() => removeEntry(e)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {canManage ? (
        <AddAllowlistForm orgId={orgId} apiFetch={apiFetch} onCreated={(e) => setEntries((es) => [e, ...es])} />
      ) : (
        <RoleHint text="Ask an org owner or admin to add a destination." />
      )}
    </section>
  );
}

// =============================================================================
// 3. Pending approvals queue
// =============================================================================
//
// NOTE on the quorum meter: GET .../approval-requests and the vote response
// both return the request row as stored (requiredApprovals — the TARGET),
// never a live count of votes already cast (no join/aggregate in
// enterprisePoliciesRoutes.ts, and no endpoint to list a request's votes).
// So this section only ever renders the target quorum + the resolved
// status, plus (once the current viewer has voted) their own vote pinned
// locally — it never fabricates a "1 of 3" numerator the API doesn't give.

function CreateApprovalRequestForm({
  orgId, apiFetch, policies, onCreated,
}: {
  orgId: string;
  apiFetch: ApiFetch;
  policies: Policy[];
  onCreated: (r: ApprovalRequest) => void;
}) {
  const [open, setOpen] = useState(false);
  const [requestType, setRequestType] = useState<RequestType>('transaction');
  const [policyId, setPolicyId] = useState('');
  const [requiredApprovals, setRequiredApprovals] = useState('1');
  const [payloadText, setPayloadText] = useState('{\n  \n}');
  const [expiresAt, setExpiresAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(payloadText || '{}');
      if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) throw new Error('not an object');
    } catch {
      setErr('Payload must be valid JSON (an object), e.g. {"note": "quarterly payout"}.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await apiFetch(`/enterprise/orgs/${orgId}/approval-requests`, {
        method: 'POST',
        body: JSON.stringify({
          requestType,
          payload,
          ...(policyId ? { policyId } : { requiredApprovals: Math.max(1, Number(requiredApprovals) || 1) }),
          ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setErr(extractErrorMessage(body, 'Could not create the approval request. Please try again.'));
        return;
      }
      onCreated(body.request as ApprovalRequest);
      setPayloadText('{\n  \n}'); setExpiresAt(''); setPolicyId(''); setOpen(false);
    } catch (e2) {
      setErr('Could not create the approval request. Check your connection.');
      console.error(e2);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className={`${dStyles.actionBtn} ${dStyles['actionBtn--create']}`} onClick={() => setOpen(true)}>
        <Plus size={14} style={{ marginRight: 5, verticalAlign: -2 }} />
        New approval request
      </button>
    );
  }

  return (
    <form className={styles.createForm} onSubmit={handleSubmit}>
      <div className={styles.formRow}>
        <label className={styles.formField}>
          <span className={styles.formLabel}>Request type</span>
          <select className={styles.formSelect} value={requestType} onChange={(e) => setRequestType(e.target.value as RequestType)}>
            {REQUEST_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
          </select>
        </label>
        <label className={styles.formField}>
          <span className={styles.formLabel}>Inherit quorum from policy (optional)</span>
          <select className={styles.formSelect} value={policyId} onChange={(e) => setPolicyId(e.target.value)}>
            <option value="">None — set quorum manually</option>
            {policies.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.requiredApprovals} approval{p.requiredApprovals === 1 ? '' : 's'})</option>)}
          </select>
        </label>
        {!policyId && (
          <label className={styles.formField} style={{ maxWidth: 150 }}>
            <span className={styles.formLabel}>Quorum (approvals)</span>
            <input
              type="number" min={1} max={50}
              className={styles.formInput}
              value={requiredApprovals}
              onChange={(e) => setRequiredApprovals(e.target.value)}
            />
          </label>
        )}
        <label className={styles.formField} style={{ maxWidth: 220 }}>
          <span className={styles.formLabel}>Expires at (optional)</span>
          <input
            type="datetime-local"
            className={styles.formInput}
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
          />
        </label>
      </div>
      <label className={styles.formField}>
        <span className={styles.formLabel}>Payload (JSON)</span>
        <textarea
          className={styles.formTextarea}
          value={payloadText}
          onChange={(e) => setPayloadText(e.target.value)}
          spellCheck={false}
        />
      </label>
      <p className={styles.formHint}>What the approvers are reviewing — e.g. tx details for a &quot;transaction&quot; request, or the proposed diff for a policy/allowlist change.</p>
      {err && <p className={styles.formErr} role="alert">{err}</p>}
      <div className={styles.formActions}>
        <button type="submit" className={`${dStyles.actionBtn} ${dStyles['actionBtn--create']}`} disabled={busy}>
          {busy ? 'Submitting…' : 'Submit request'}
        </button>
        <button type="button" className={dStyles.actionBtn} onClick={() => { setErr(null); setOpen(false); }}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function ApprovalCard({
  request, apiFetch, orgId, canVote, now, onResolved,
}: {
  request: ApprovalRequest;
  apiFetch: ApiFetch;
  orgId: string;
  canVote: boolean;
  now: number;
  onResolved: () => void;
}) {
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [voteErr, setVoteErr] = useState<string | null>(null);
  const [myVote, setMyVote] = useState<'approve' | 'reject' | null>(null);

  async function vote(decision: 'approve' | 'reject') {
    setBusy(true);
    setVoteErr(null);
    try {
      const res = await apiFetch(`/enterprise/orgs/${orgId}/approval-requests/${request.id}/vote`, {
        method: 'POST',
        body: JSON.stringify({ decision, comment: comment.trim() || undefined }),
      });
      const body = await res.json().catch(() => null);
      if (res.status === 403) {
        setVoteErr(extractErrorMessage(body, 'You cannot vote on this request.'));
        return;
      }
      if (res.status === 409) {
        setVoteErr(extractErrorMessage(body, 'This request was already resolved or you already voted.'));
        onResolved();
        return;
      }
      if (res.status === 404) {
        setVoteErr('This approval request no longer exists.');
        onResolved();
        return;
      }
      if (!res.ok) {
        setVoteErr(extractErrorMessage(body, 'Could not record your vote. Please try again.'));
        return;
      }
      setMyVote(decision);
      onResolved();
    } catch (e) {
      setVoteErr('Could not record your vote. Check your connection.');
      console.error(e);
    } finally {
      setBusy(false);
    }
  }

  const pending = request.status === 'pending';
  const countdown = request.expiresAt && pending ? formatCountdown(request.expiresAt, now) : null;

  return (
    <div className={styles.approvalCard}>
      <div className={styles.approvalHead}>
        <div className={styles.approvalHeadLeft}>
          <span className={styles.requestTypePill} data-type={request.requestType}>
            {request.requestType.replace(/_/g, ' ')}
          </span>
          <span className={styles.approvalStatus} data-status={request.status}>{request.status}</span>
          {countdown && (
            <span className={styles.expiryChip} data-urgent={countdown.urgent || undefined}>
              <Clock size={12} weight="bold" /> {countdown.text}
            </span>
          )}
          {myVote && (
            <span className={styles.voteBadge} data-decision={myVote}>
              {myVote === 'approve' ? <CheckCircle size={12} weight="fill" /> : <XCircle size={12} weight="fill" />}
              You {myVote === 'approve' ? 'approved' : 'rejected'}
            </span>
          )}
        </div>
        <div className={styles.quorumWrap}>
          <span className={styles.quorumLabel}>
            <span>Quorum</span>
            <span>{request.requiredApprovals} approval{request.requiredApprovals === 1 ? '' : 's'} required</span>
          </span>
          <div className={dStyles.meterTrack}>
            <div
              className={dStyles.meterFill}
              style={{
                width: request.status === 'approved' ? '100%' : request.status === 'pending' ? '8%' : '0%',
                background: request.status === 'approved'
                  ? 'linear-gradient(90deg, #3fce8a, #1e8449)'
                  : request.status === 'rejected'
                    ? 'linear-gradient(90deg, #e0776b, #c0392b)'
                    : undefined,
              }}
            />
          </div>
        </div>
      </div>

      <p className={styles.approvalPayload}>{summarizePayload(request.payload)}</p>

      <div className={styles.approvalMetaRow}>
        <span>Requester: <span className={dStyles.mono}>{shortId(request.requestedBy)}</span></span>
        <span>Requested: {fmtTimestamp(request.createdAt)}</span>
        {request.resolvedAt && <span>Resolved: {fmtTimestamp(request.resolvedAt)}</span>}
        {request.policyId && <span>Policy: <span className={dStyles.mono}>{shortId(request.policyId)}</span></span>}
      </div>

      {pending && (
        <div className={styles.voteRow}>
          {canVote ? (
            <>
              <textarea
                className={styles.commentInput}
                placeholder="Optional comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                maxLength={500}
                rows={1}
              />
              <div className={styles.voteBtns}>
                <button type="button" className={styles.approveBtn} disabled={busy} onClick={() => vote('approve')}>
                  <CheckCircle size={15} weight="bold" /> Approve
                </button>
                <button type="button" className={styles.rejectBtn} disabled={busy} onClick={() => vote('reject')}>
                  <XCircle size={15} weight="bold" /> Reject
                </button>
              </div>
            </>
          ) : (
            <RoleHint text="Owner or admin role required to vote." />
          )}
          {voteErr && <p className={styles.voteErr} role="alert">{voteErr}</p>}
        </div>
      )}
    </div>
  );
}

function ApprovalsSection({
  orgId, apiFetch, canVote, policies,
}: {
  orgId: string;
  apiFetch: ApiFetch;
  canVote: boolean;
  policies: Policy[];
}) {
  const [status, setStatus] = useState<RequestStatus>('pending');
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  const load = useCallback(async (st: RequestStatus, off: number) => {
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams({ status: st, limit: String(PAGE_SIZE), offset: String(off) });
      const res = await apiFetch(`/enterprise/orgs/${orgId}/approval-requests?${params}`);
      if (!res.ok) { setErr('Could not load approval requests. Please try again.'); return; }
      const body = await res.json();
      setRequests(Array.isArray(body?.requests) ? body.requests : []);
    } catch (e) {
      setErr('Could not load approval requests. Check your connection.');
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [apiFetch, orgId]);

  useEffect(() => { load(status, offset); }, [load, status, offset]);

  function switchStatus(s: RequestStatus) {
    setStatus(s);
    setOffset(0);
  }

  return (
    <section className={dStyles.card} aria-label="Pending approvals">
      <div className={dStyles.cardHead}>
        <h2 className={dStyles.cardTitle}>Approvals queue</h2>
      </div>

      <div className={dStyles.tabs} role="tablist" aria-label="Filter by status">
        {REQUEST_STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            className={dStyles.tab}
            data-active={status === s || undefined}
            aria-selected={status === s}
            onClick={() => switchStatus(s)}
          >
            {s[0].toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className={dStyles.skel} aria-hidden="true">
          <div className={dStyles.skelLine} style={{ width: '55%' }} />
          <div className={dStyles.skelLine} style={{ width: '100%' }} />
        </div>
      ) : err ? (
        <div className={dStyles.stateBox} style={{ minHeight: 100 }} role="alert">
          <span>{err}</span>
          <button className={dStyles.actionBtn} onClick={() => load(status, offset)}>Retry</button>
        </div>
      ) : requests.length === 0 ? (
        <p className={styles.policySummary} style={{ margin: '8px 0 16px' }}>
          No {status} approval requests.
        </p>
      ) : (
        <>
          {requests.map((r) => (
            <ApprovalCard
              key={r.id}
              request={r}
              apiFetch={apiFetch}
              orgId={orgId}
              canVote={canVote}
              now={now}
              onResolved={() => load(status, offset)}
            />
          ))}
          <div className={styles.pagination}>
            <span className={styles.pageMeta}>Showing {offset + 1}–{offset + requests.length}</span>
            <div className={styles.pageBtns}>
              <button
                type="button"
                className={dStyles.actionBtn}
                onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
                disabled={offset === 0 || loading}
              >
                <CaretLeft size={14} style={{ verticalAlign: -2 }} /> Prev
              </button>
              <button
                type="button"
                className={dStyles.actionBtn}
                onClick={() => setOffset((o) => o + PAGE_SIZE)}
                disabled={requests.length < PAGE_SIZE || loading}
              >
                Next <CaretRight size={14} style={{ verticalAlign: -2 }} />
              </button>
            </div>
          </div>
        </>
      )}

      <hr className={styles.sectionDivider} />
      <CreateApprovalRequestForm
        orgId={orgId}
        apiFetch={apiFetch}
        policies={policies}
        onCreated={(r) => { if (r.status === status) setRequests((rs) => [r, ...rs]); }}
      />
    </section>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function PoliciesPage() {
  const { auth, clearToken } = useDashboardAuth();
  const apiFetch = useApiFetch(auth);

  const [org, setOrg] = useState<Org | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [hasOrg, setHasOrg] = useState(true);
  const [loading, setLoading] = useState(true);
  const [fetchErr, setFetchErr] = useState<string | null>(null);
  const [allPolicies, setAllPolicies] = useState<Policy[]>([]);

  // Resolve the org + caller role once — same pattern as ../audit/page.tsx,
  // except /orgs/me here is read as its real shape ({ org, role } — see
  // enterprise.ts:210/239), since this page needs `role` for its
  // owner/admin-only mutation gating.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await apiFetch('/enterprise/orgs/me');
        if (cancelled) return;
        if (res.status === 401) { clearToken(); return; }
        if (!res.ok) { setHasOrg(false); setLoading(false); return; }
        const data: MeResponse = await res.json();
        if (cancelled) return;
        setOrg(data.org);
        setRole(data.role);
        setHasOrg(true);
      } catch (e) {
        if (!cancelled) {
          setFetchErr('Could not load your workspace. Check your connection.');
          console.error(e);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiFetch]);

  const canManage = role === 'owner' || role === 'admin';

  // ── Loading ──
  if (loading) {
    return (
      <div aria-busy="true" aria-live="polite">
        <span className="sr-only">Loading policies</span>
        <div className={`${dStyles.card} ${dStyles.skel}`} aria-hidden="true">
          <div className={dStyles.skelLine} style={{ width: '30%' }} />
          <div className={dStyles.skelLine} style={{ width: '100%' }} />
          <div className={dStyles.skelLine} style={{ width: '100%' }} />
          <div className={dStyles.skelLine} style={{ width: '84%' }} />
        </div>
      </div>
    );
  }

  // ── No organisation yet ──
  if (!hasOrg) {
    return (
      <div className={dStyles.stateBox}>
        <span>Create a workspace to set up policies.</span>
        <Link href="/dashboard" className={dStyles.actionBtn}>Go to Overview</Link>
      </div>
    );
  }

  // ── Error ──
  if (fetchErr || !org) {
    return (
      <div className={dStyles.stateBox} role="alert">
        <span>{fetchErr ?? 'Could not load your workspace.'}</span>
        <button className={dStyles.actionBtn} onClick={() => window.location.reload()}>Retry</button>
      </div>
    );
  }

  return (
    <>
      <PoliciesSection orgId={org.id} apiFetch={apiFetch} canManage={canManage} onPoliciesChange={setAllPolicies} />
      <AllowlistSection orgId={org.id} apiFetch={apiFetch} canManage={canManage} />
      <ApprovalsSection orgId={org.id} apiFetch={apiFetch} canVote={canManage} policies={allPolicies} />
    </>
  );
}
