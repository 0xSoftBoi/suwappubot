'use client';

/**
 * The bot factory.
 *
 * A meme-coin team should be able to describe the bot they want in a sentence
 * and have it answering in their group ten minutes later. That is the whole
 * design brief for this page, and it dictates the shape: one textarea, a
 * blueprint you can read and correct in words, then three concrete steps to
 * live.
 *
 * The page deliberately shows the operator what the composer decided *before*
 * anything is created — including the automations it proposed and the caps it
 * chose. A tool that silently configures spending on someone's treasury is not
 * a tool anyone should trust, however good the model is.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { API_BASE_URL } from '@/lib/links';
import { type AuthState, useDashboardAuth } from '../auth-context';
import styles from './bots.module.css';

// ── Types (mirror api-ts routes/tenantBots.ts responses) ────────────────────

type BotStatus = 'draft' | 'provisioning' | 'live' | 'paused' | 'error';

interface Branding {
  displayName?: string;
  tagline?: string;
  mark?: string;
  footer?: string;
  voice?: string;
}

interface Skill { key: string; enabled: boolean }

interface Automation {
  id: string;
  kind: string;
  name: string;
  mode: 'simulate' | 'live';
  enabled: boolean;
  cron: string | null;
  config: Record<string, unknown>;
  max_usd_per_run: number;
  max_usd_per_day: number;
  last_run_at: string | null;
  next_run_at?: string | null;
}

interface Run {
  id: string;
  status: 'simulated' | 'succeeded' | 'failed' | 'skipped';
  reason: string | null;
  spend_usd: number;
  token_amount: string | null;
  tx_hash: string | null;
  started_at: string;
}

interface WebhookHealth {
  url: string | null;
  pending_update_count: number;
  last_error_message: string | null;
  last_error_at: string | null;
  healthy: boolean;
  summary: string;
}

interface RunResult {
  status: 'simulated' | 'succeeded' | 'failed' | 'skipped';
  reason: string | null;
  spendUsd: number;
  txHash: string | null;
  tokenAmount: string | null;
}

interface Bot {
  id: string;
  name: string;
  slug: string;
  status: BotStatus;
  telegram_username: string | null;
  token_symbol: string | null;
  token_chain: string | null;
  token_address: string | null;
  branding: Branding;
  skills: Skill[];
  brief: string | null;
  last_error: string | null;
  messages_handled: number;
  treasury_address?: string | null;
  can_execute_live?: boolean;
  funding_source?: 'revenue' | 'treasury' | 'undisclosed';
  funding_note?: string | null;
  proof_public?: boolean;
  provisioned_at: string | null;
  created_at: string;
  automations?: Automation[];
  runs?: Run[];
}

interface BlueprintAutomation {
  kind: string;
  name: string;
  cron: string | null;
  mode: string;
  enabled: boolean;
  maxUsdPerRun: number;
  maxUsdPerDay: number;
  config: Record<string, unknown>;
  rationale?: string;
}

interface Blueprint {
  name: string;
  branding: Branding;
  skills: Skill[];
  automations: BlueprintAutomation[];
  commands: { command: string; description: string }[];
  summary: string;
  source: 'llm' | 'heuristic';
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<BotStatus, string> = {
  draft: 'Not connected',
  provisioning: 'Connecting',
  live: 'Live',
  paused: 'Paused',
  error: 'Needs attention',
};

const STATUS_DOT: Record<BotStatus, string> = {
  draft: styles.dotDraft,
  provisioning: styles.dotPaused,
  live: styles.dotLive,
  paused: styles.dotPaused,
  error: styles.dotError,
};

const EXAMPLES = [
  'A buy-and-burn bot for our token that burns every hour and posts the receipt to the group',
  'Price, chart and one-tap buy for our community, plus a daily recap post',
  'Welcome new members, show holder stats, and run a weekly top-buyer leaderboard',
];

function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch { return '—'; }
}


/** Cron in words.
 *
 * The audience for this page is a meme-coin team, not an SRE. "0 * * * *" is
 * accurate and useless to them; the schedule is the single most consequential
 * thing about a spending automation, so it is spelled out. Anything the small
 * table doesn't recognise falls back to the raw expression rather than a wrong
 * guess — a schedule described incorrectly is worse than one left cryptic.
 */
function describeCron(cron: string | null): string {
  if (!cron) return 'on demand';
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;
  const [min, hour, dom, mon, dow] = parts;
  const anyDate = dom === '*' && mon === '*' && dow === '*';
  if (anyDate && hour === '*' && min === '0') return 'every hour';
  if (anyDate && hour === '*' && /^\*\/(\d+)$/.test(min)) {
    return `every ${min.slice(2)} minutes`;
  }
  const everyNHours = /^\*\/(\d+)$/.exec(hour);
  if (anyDate && everyNHours && min === '0') return `every ${everyNHours[1]} hours`;
  if (anyDate && /^\d+$/.test(hour) && /^\d+$/.test(min)) {
    return `daily at ${hour.padStart(2, '0')}:${min.padStart(2, '0')} UTC`;
  }
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  if (dom === '*' && mon === '*' && /^[0-6]$/.test(dow) && /^\d+$/.test(hour) && /^\d+$/.test(min)) {
    return `every ${DAYS[Number(dow)]} at ${hour.padStart(2, '0')}:${min.padStart(2, '0')} UTC`;
  }
  return cron;
}

function StatusPill({ status }: { status: BotStatus }) {
  return (
    <span className={styles.status}>
      <span className={`${styles.dot} ${STATUS_DOT[status]}`} />
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Same contract as the dashboard's helper: never ends the session on a 401.
 *  A feature endpoint refusing one request is not evidence the session died. */
function useApiFetch(auth: AuthState) {
  return useCallback(
    async (path: string, opts: RequestInit = {}): Promise<Response> =>
      fetch(`${API_BASE_URL}${path}`, {
        ...opts,
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(auth.kind === 'token' ? { Authorization: `Bearer ${auth.value}` } : {}),
          ...(opts.headers ?? {}),
        },
      }),
    [auth]
  );
}

// ── Composer ────────────────────────────────────────────────────────────────

function Composer({
  orgId, apiFetch, onCreated,
}: {
  orgId: string;
  apiFetch: ReturnType<typeof useApiFetch>;
  onCreated: (bot: Bot) => void;
}) {
  const [brief, setBrief] = useState('');
  const [symbol, setSymbol] = useState('');
  const [chain, setChain] = useState('');
  const [address, setAddress] = useState('');
  const [blueprint, setBlueprint] = useState<Blueprint | null>(null);
  const [busy, setBusy] = useState<'compose' | 'create' | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function compose() {
    if (!brief.trim()) { setErr('Describe what the bot should do first.'); return; }
    setBusy('compose'); setErr(null);
    try {
      const res = await apiFetch(`/v1/orgs/${orgId}/bots/compose`, {
        method: 'POST',
        body: JSON.stringify({
          brief,
          token_symbol: symbol || undefined,
          token_chain: chain || undefined,
          token_address: address || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || 'Could not design the bot.');
      setBlueprint(data.blueprint);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not design the bot.');
    } finally { setBusy(null); }
  }

  async function create() {
    if (!blueprint) return;
    setBusy('create'); setErr(null);
    try {
      const res = await apiFetch(`/v1/orgs/${orgId}/bots`, {
        method: 'POST',
        body: JSON.stringify({
          name: blueprint.name,
          brief,
          blueprint,
          token_symbol: symbol || undefined,
          token_chain: chain || undefined,
          token_address: address || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || 'Could not create the bot.');
      onCreated(data.bot);
      setBlueprint(null); setBrief('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not create the bot.');
    } finally { setBusy(null); }
  }

  return (
    <div className={styles.composer}>
      <div>
        <div className={styles.composerLabel}>Describe the bot you want</div>
        <div className={styles.composerHint}>
          Plain English. Mention what it should do for your community and how often —
          the details you leave out get sensible defaults you can change afterwards.
        </div>
      </div>

      <textarea
        className={styles.brief}
        value={brief}
        onChange={(e) => setBrief(e.target.value)}
        placeholder="e.g. A bot for our community that shows the price, lets people buy in one tap, and buys back and burns $50 of our token every hour."
      />

      <div className={styles.examples}>
        {EXAMPLES.map((ex) => (
          <button key={ex} type="button" className={styles.example} onClick={() => setBrief(ex)}>
            {ex.length > 58 ? `${ex.slice(0, 58)}…` : ex}
          </button>
        ))}
      </div>

      <div className={styles.fieldRow}>
        <label className={styles.field}>
          <span className={styles.fieldName}>Token symbol</span>
          <input className={styles.input} value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="PEPE" />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldName}>Chain</span>
          <input className={styles.input} value={chain} onChange={(e) => setChain(e.target.value)} placeholder="base" />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldName}>Token address</span>
          <input className={styles.input} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="0x…" />
        </label>
      </div>

      {err && <div className={styles.error}>{err}</div>}

      <div className={styles.actions}>
        <button className={styles.primary} onClick={compose} disabled={busy !== null}>
          {busy === 'compose' ? 'Designing…' : blueprint ? 'Redesign' : 'Design my bot'}
        </button>
        {blueprint && (
          <button className={styles.ghost} onClick={() => setBlueprint(null)} disabled={busy !== null}>
            Discard
          </button>
        )}
      </div>

      {blueprint && (
        <div className={styles.blueprint}>
          <div className={styles.blueprintHead}>
            <div>
              <div className={styles.blueprintName}>
                {blueprint.branding.mark ? `${blueprint.branding.mark} ` : ''}{blueprint.name}
              </div>
              {blueprint.branding.tagline && (
                <div className={styles.composerHint}>{blueprint.branding.tagline}</div>
              )}
            </div>
            <span className={styles.sourceTag}>
              {blueprint.source === 'llm' ? 'Designed' : 'Matched from keywords'}
            </span>
          </div>

          <p className={styles.blueprintSummary}>{blueprint.summary}</p>

          <div>
            <div className={styles.sectionTitle}>Commands your members get</div>
            <div className={styles.chips} style={{ marginTop: 8 }}>
              {blueprint.commands.length === 0
                ? <span className={styles.composerHint}>None yet — add more detail to your brief.</span>
                : blueprint.commands.map((c) => (
                    <span key={c.command} className={styles.chip} title={c.description}>{c.command}</span>
                  ))}
            </div>
          </div>

          {blueprint.automations.length > 0 && (
            <div>
              <div className={styles.sectionTitle}>Automations it proposed</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                {blueprint.automations.map((a, i) => (
                  <div key={`${a.kind}-${i}`} className={styles.autoRow}>
                    <div className={styles.autoTop}>
                      <span className={styles.autoName}>{a.name}</span>
                      <span className={`${styles.modeBadge} ${styles.modeSimulate}`}>Simulate</span>
                    </div>
                    <div className={styles.autoMeta}>
                      <span>{describeCron(a.cron)}</span>
                      {a.maxUsdPerRun > 0 && <span>up to ${a.maxUsdPerRun}/run · ${a.maxUsdPerDay}/day</span>}
                    </div>
                    {a.rationale && <p className={styles.autoRationale}>{a.rationale}</p>}
                  </div>
                ))}
              </div>
              <div className={styles.notice} style={{ marginTop: 10 }}>
                Nothing here can spend yet. Automations are created in simulate mode and
                switched off — they journal what they <em>would</em> have done so you can
                read the runs before putting real funds behind them.
              </div>
            </div>
          )}

          <div className={styles.actions}>
            <button className={styles.primary} onClick={create} disabled={busy !== null}>
              {busy === 'create' ? 'Creating…' : 'Create this bot'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}


/**
 * One automation, with the two controls that matter.
 *
 * "Dry run" is the important one. Nothing about a scheduled treasury spend is
 * obvious from a cron expression and a dollar cap — you find out what it does
 * by running it and reading the result. It works on a switched-off automation
 * precisely because that is when you most need to know.
 *
 * "Arm" is deliberately harder to reach than the dry run, states the caps in
 * the confirmation, and is refused by the server until a simulated run exists.
 */
function AutomationRow({
  orgId, botId, automation, apiFetch, onChanged,
}: {
  orgId: string;
  botId: string;
  automation: Automation;
  apiFetch: ReturnType<typeof useApiFetch>;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<'run' | 'arm' | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const a = automation;
  const spends = a.max_usd_per_run > 0;
  const armed = a.mode === 'live' && a.enabled;

  async function dryRun() {
    setBusy('run'); setErr(null); setResult(null);
    try {
      const res = await apiFetch(
        `/v1/orgs/${orgId}/bots/${botId}/automations/${a.id}/run`,
        { method: 'POST' }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || data?.error || 'The run could not start.');
      setResult(data.run as RunResult);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'The run could not start.');
    } finally { setBusy(null); }
  }

  async function setArmed(live: boolean) {
    if (live && spends) {
      const ok = window.confirm(
        `Arm "${a.name}" with real funds?\n\n` +
        `It will spend up to $${a.max_usd_per_run} per run, ` +
        `at most $${a.max_usd_per_day} per day, ${describeCron(a.cron)}.\n\n` +
        `Funds come from this bot's treasury wallet.`
      );
      if (!ok) return;
    }
    setBusy('arm'); setErr(null);
    try {
      const res = await apiFetch(
        `/v1/orgs/${orgId}/bots/${botId}/automations/${a.id}/arm`,
        { method: 'POST', body: JSON.stringify({ live }) }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || data?.error || 'Could not change the mode.');
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not change the mode.');
    } finally { setBusy(null); }
  }

  return (
    <div className={styles.autoRow}>
      <div className={styles.autoTop}>
        <span className={styles.autoName}>{a.name}</span>
        <span className={`${styles.modeBadge} ${armed ? styles.modeLive : styles.modeSimulate}`}>
          {armed ? 'Live' : a.mode === 'live' ? 'Live · off' : 'Simulate'}
        </span>
      </div>
      <div className={styles.autoMeta}>
        <span>{describeCron(a.cron)}</span>
        {spends && <span>${a.max_usd_per_run}/run · ${a.max_usd_per_day}/day</span>}
        <span>last run {fmtDate(a.last_run_at)}</span>
        {armed && a.next_run_at && <span>next {fmtDate(a.next_run_at)}</span>}
      </div>

      {result && (
        <div className={result.status === 'failed' ? styles.error : styles.runResult}>
          {result.status === 'simulated' && (
            <>
              Dry run: would have spent <strong>${result.spendUsd}</strong>
              {result.tokenAmount ? <> for <strong>{result.tokenAmount}</strong> tokens</> : null}. Nothing moved.
            </>
          )}
          {result.status === 'succeeded' && (
            <>Spent <strong>${result.spendUsd}</strong>{result.tokenAmount ? <> for {result.tokenAmount} tokens</> : null}.</>
          )}
          {result.status === 'skipped' && <>Skipped — {result.reason}</>}
          {result.status === 'failed' && <>Failed — {result.reason}</>}
        </div>
      )}
      {err && <div className={styles.error}>{err}</div>}

      <div className={styles.autoActions}>
        <button className={styles.smallGhost} onClick={dryRun} disabled={busy !== null}>
          {busy === 'run' ? 'Running…' : 'Dry run'}
        </button>
        {spends && (
          armed ? (
            <button className={styles.smallGhost} onClick={() => void setArmed(false)} disabled={busy !== null}>
              {busy === 'arm' ? 'Working…' : 'Disarm'}
            </button>
          ) : (
            <button className={`${styles.smallGhost} ${styles.armBtn}`} onClick={() => void setArmed(true)} disabled={busy !== null}>
              {busy === 'arm' ? 'Working…' : 'Arm with real funds'}
            </button>
          )
        )}
      </div>
    </div>
  );
}


/**
 * Publishing the public record.
 *
 * This is the feature the research says decides whether anyone believes the
 * burn at all — across ~$19B of tracked buyback programs, the ones that were
 * credible were the ones a stranger could check. So it is presented as an
 * upgrade to offer, not a setting buried in a panel, and the copy says what
 * gets published *before* the operator commits: the refusals and the failures,
 * not just the wins.
 */
function ProofPanel({
  orgId, bot, apiFetch, onChanged,
}: {
  orgId: string;
  bot: Bot;
  apiFetch: ReturnType<typeof useApiFetch>;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [funding, setFunding] = useState(bot.funding_source ?? 'undisclosed');

  const published = bot.proof_public === true;
  const proofUrl = bot.telegram_username
    ? `${API_BASE_URL}/v1/bots/proof/${bot.telegram_username}`
    : null;

  async function save(next: { proof_public?: boolean; funding_source?: string }) {
    setBusy(true); setErr(null);
    try {
      const res = await apiFetch(`/v1/orgs/${orgId}/bots/${bot.id}/disclosure`, {
        method: 'POST',
        body: JSON.stringify(next),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || data?.error || 'Could not save that.');
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save that.');
    } finally { setBusy(false); }
  }

  return (
    <div>
      <div className={styles.sectionTitle}>Public record</div>

      <p className={styles.composerHint} style={{ marginTop: 8 }}>
        {published
          ? 'Anyone can check this bot\u2019s treasury activity without asking you. Holders reach it with /proof.'
          : 'Most buyback programs are not believed because nobody can verify them. Publishing a record that includes your refused and failed runs \u2014 not just the wins \u2014 is what makes the rest of it credible.'}
      </p>

      <label className={styles.field} style={{ marginTop: 12, maxWidth: 380 }}>
        <span className={styles.fieldName}>Where the money comes from</span>
        <select
          className={styles.input}
          value={funding}
          disabled={busy}
          onChange={(e) => {
            setFunding(e.target.value as typeof funding);
            void save({ funding_source: e.target.value });
          }}
        >
          <option value="undisclosed">Not stated</option>
          <option value="revenue">Recurring revenue or fees</option>
          <option value="treasury">Treasury reserves</option>
        </select>
      </label>
      <div className={styles.composerHint} style={{ marginTop: 6 }}>
        {funding === 'revenue' && 'Shown as revenue-funded, which readers treat as durable.'}
        {funding === 'treasury' && 'Shown as treasury-funded, with a note that it continues only while the treasury lasts.'}
        {funding === 'undisclosed' && 'The record will say you have not stated this. Readers assume the worse answer when a program stays quiet about funding.'}
      </div>

      {err && <div className={styles.error} style={{ marginTop: 10 }}>{err}</div>}

      {published && proofUrl && (
        <div className={styles.runResult} style={{ marginTop: 12 }}>
          Live at <a href={proofUrl} target="_blank" rel="noreferrer">{proofUrl}</a>
        </div>
      )}

      <div className={styles.autoActions} style={{ marginTop: 12 }}>
        {published ? (
          <button className={styles.smallGhost} onClick={() => void save({ proof_public: false })} disabled={busy}>
            {busy ? 'Working\u2026' : 'Unpublish'}
          </button>
        ) : (
          <button
            className={styles.primary}
            onClick={() => void save({ proof_public: true })}
            disabled={busy || !bot.telegram_username}
          >
            {busy ? 'Publishing\u2026' : 'Publish the record'}
          </button>
        )}
      </div>
      {!bot.telegram_username && (
        <div className={styles.composerHint} style={{ marginTop: 8 }}>
          Connect the bot to Telegram first \u2014 the record is published at its @handle.
        </div>
      )}
    </div>
  );
}

// ── Bot detail ──────────────────────────────────────────────────────────────

function BotDetail({
  orgId, bot, apiFetch, onChanged, onDeleted, onRefresh,
}: {
  orgId: string;
  bot: Bot;
  apiFetch: ReturnType<typeof useApiFetch>;
  onChanged: (bot: Bot) => void;
  onDeleted: (id: string) => void;
  /** Re-pull the bot after a run so the run log and counters reflect it. */
  onRefresh: () => void;
}) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [health, setHealth] = useState<WebhookHealth | null>(null);

  // Ask Telegram whether it can actually reach us. Without this a bot whose
  // webhook is failing reads "Live" here indefinitely while its community gets
  // silence, and the team finds out from a member complaining.
  useEffect(() => {
    let alive = true;
    setHealth(null);
    if (bot.status === 'draft') return;
    apiFetch(`/v1/orgs/${orgId}/bots/${bot.id}/health`)
      .then((r) => r.json())
      .then((d) => { if (alive && d?.health) setHealth(d.health as WebhookHealth); })
      .catch(() => { /* health is advisory; never break the panel over it */ });
    return () => { alive = false; };
  }, [apiFetch, orgId, bot.id, bot.status]);

  async function act(label: string, path: string, opts: RequestInit, key: 'bot' | 'result') {
    setBusy(label); setErr(null);
    try {
      const res = await apiFetch(path, opts);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || data?.error || 'That did not work.');
      return key === 'bot' ? (data.bot as Bot) : null;
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'That did not work.');
      return null;
    } finally { setBusy(null); }
  }

  async function provision() {
    if (!token.trim()) { setErr('Paste the token BotFather gave you.'); return; }
    const updated = await act('provision', `/v1/orgs/${orgId}/bots/${bot.id}/provision`,
      { method: 'POST', body: JSON.stringify({ token: token.trim() }) }, 'bot');
    if (updated) { setToken(''); onChanged(updated); }
  }

  async function togglePause() {
    const resume = bot.status === 'paused';
    const updated = await act('pause',
      `/v1/orgs/${orgId}/bots/${bot.id}/pause${resume ? '?resume=true' : ''}`,
      { method: 'POST' }, 'bot');
    if (updated) onChanged(updated);
  }

  async function remove() {
    if (!window.confirm(`Delete ${bot.name}? Its Telegram webhook is removed and the config is gone for good.`)) return;
    await act('delete', `/v1/orgs/${orgId}/bots/${bot.id}`, { method: 'DELETE' }, 'result');
    onDeleted(bot.id);
  }

  const connected = bot.status !== 'draft';

  return (
    <div className={styles.detail}>
      <div className={styles.detailHead}>
        <div>
          <div className={styles.blueprintName}>
            {bot.branding.mark ? `${bot.branding.mark} ` : ''}{bot.name}
          </div>
          <div className={styles.botHandle}>
            {bot.telegram_username ? `@${bot.telegram_username}` : 'No Telegram account connected yet'}
            {bot.token_symbol ? ` · ${bot.token_symbol}` : ''}
          </div>
        </div>
        <StatusPill status={bot.status} />
      </div>

      {bot.last_error && <div className={styles.error}>{bot.last_error}</div>}
      {err && <div className={styles.error}>{err}</div>}

      {health && (
        <div className={health.healthy ? styles.runResult : styles.notice}>
          <strong>Telegram delivery:</strong> {health.summary}
          {health.pending_update_count > 0 && (
            <> ({health.pending_update_count} waiting)</>
          )}
        </div>
      )}

      {!connected && (
        <div>
          <div className={styles.sectionTitle}>Connect it to Telegram</div>
          <div className={styles.steps} style={{ marginTop: 10 }}>
            <div className={styles.step}>
              <span className={styles.stepNum}>1</span>
              <span>
                Open <a href="https://t.me/BotFather" target="_blank" rel="noreferrer">@BotFather</a> and
                send <code className={styles.mono}>/newbot</code>. Pick the name and @handle your
                community will see — they are yours, not ours.
              </span>
            </div>
            <div className={styles.step}>
              <span className={styles.stepNum}>2</span>
              <span>BotFather replies with a token that looks like <code className={styles.mono}>123456:AAH…</code>. Paste it below.</span>
            </div>
            <div className={styles.step}>
              <span className={styles.stepNum}>3</span>
              <span>Add the bot to your group. It answers immediately — there is no deploy step.</span>
            </div>
          </div>

          <div className={styles.actions} style={{ marginTop: 12 }}>
            <input
              className={styles.input}
              style={{ flex: 1, minWidth: 240 }}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="123456789:AAH-your-bot-token"
              type="password"
              autoComplete="off"
            />
            <button className={styles.primary} onClick={provision} disabled={busy !== null}>
              {busy === 'provision' ? 'Connecting…' : 'Connect'}
            </button>
          </div>
          <div className={styles.composerHint} style={{ marginTop: 8 }}>
            The token is encrypted before it is stored and is never shown again — not even to you.
            Revoke it in BotFather at any time and the bot stops instantly.
          </div>
        </div>
      )}

      <div>
        <div className={styles.sectionTitle}>Skills</div>
        <div className={styles.chips} style={{ marginTop: 8 }}>
          {bot.skills.filter((s) => s.enabled).length === 0
            ? <span className={styles.composerHint}>No skills enabled.</span>
            : bot.skills.filter((s) => s.enabled).map((s) => (
                <span key={s.key} className={styles.chip}>{s.key.replace(/_/g, ' ')}</span>
              ))}
        </div>
      </div>

      {(bot.automations ?? []).some((a) => a.max_usd_per_run > 0) && !bot.treasury_address && (
        <div className={styles.notice}>
          These automations spend from a treasury wallet, and this bot does not have one yet.
          Dry runs work without it — they quote and journal without moving anything — but arming
          needs a funded wallet connected first.
        </div>
      )}

      <div>
        <div className={styles.sectionTitle}>Automations</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
          {(bot.automations ?? []).length === 0
            ? <span className={styles.composerHint}>None configured.</span>
            : bot.automations!.map((a) => (
                <AutomationRow
                  key={a.id}
                  orgId={orgId}
                  botId={bot.id}
                  automation={a}
                  apiFetch={apiFetch}
                  onChanged={onRefresh}
                />
              ))}
        </div>
      </div>

      {(bot.runs ?? []).length > 0 && (
        <div>
          <div className={styles.sectionTitle}>Recent runs</div>
          <div className={styles.tableWrap}>
            <table className={styles.runTable}>
              <thead>
                <tr><th>When</th><th>Result</th><th>Spend</th><th>Detail</th></tr>
              </thead>
              <tbody>
                {bot.runs!.map((r) => (
                  <tr key={r.id}>
                    <td>{fmtDate(r.started_at)}</td>
                    <td>{r.status}</td>
                    <td>{r.spend_usd ? `$${r.spend_usd}` : '—'}</td>
                    <td className={styles.mono}>
                      {r.tx_hash ? `${r.tx_hash.slice(0, 10)}…` : (r.reason ?? '—')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ProofPanel orgId={orgId} bot={bot} apiFetch={apiFetch} onChanged={onRefresh} />

      <div className={styles.actions}>
        {connected && (
          <button className={styles.ghost} onClick={togglePause} disabled={busy !== null}>
            {busy === 'pause' ? 'Working…' : bot.status === 'paused' ? 'Resume' : 'Pause'}
          </button>
        )}
        <button className={`${styles.ghost} ${styles.danger}`} onClick={remove} disabled={busy !== null}>
          {busy === 'delete' ? 'Deleting…' : 'Delete'}
        </button>
        <span className={styles.botStats} style={{ marginLeft: 'auto' }}>
          {bot.messages_handled.toLocaleString()} messages handled
        </span>
      </div>
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function BotsPage() {
  const { auth } = useDashboardAuth();
  const apiFetch = useApiFetch(auth);

  const [orgId, setOrgId] = useState<string | null>(null);
  const [bots, setBots] = useState<Bot[]>([]);
  const [selected, setSelected] = useState<Bot | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Resolve the caller's org first — every bot route is org-scoped, and a user
  // with no org gets the "create one" path rather than a wall of 403s.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await apiFetch('/enterprise/orgs/me');
        const data = await res.json();
        if (!alive) return;
        const id = data?.org?.id ?? null;
        setOrgId(id);
        if (!id) { setLoading(false); return; }
        const listRes = await apiFetch(`/v1/orgs/${id}/bots`);
        const listData = await listRes.json();
        if (!alive) return;
        if (listRes.ok) setBots(listData.bots ?? []);
        else setErr(listData?.message || 'Could not load your bots.');
      } catch {
        if (alive) setErr('Could not load your bots.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [apiFetch]);

  const openBot = useCallback(async (bot: Bot) => {
    setSelected(bot);
    if (!orgId) return;
    // The list response is a summary; the detail response carries automations
    // and runs. Fetch it on open so the list stays cheap.
    try {
      const res = await apiFetch(`/v1/orgs/${orgId}/bots/${bot.id}`);
      const data = await res.json();
      if (res.ok) setSelected(data.bot);
    } catch { /* the summary is already on screen; leave it */ }
  }, [apiFetch, orgId]);

  function replaceBot(updated: Bot) {
    setBots((prev) => prev.map((b) => (b.id === updated.id ? { ...b, ...updated } : b)));
    setSelected((prev) => (prev && prev.id === updated.id ? { ...prev, ...updated } : prev));
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.intro}>
        <h1 className={styles.introTitle}>Your bots</h1>
        <p className={styles.introLead}>
          Spin up a Telegram bot under your own name and handle, running on your token.
          Describe what it should do and it gets built — buy-and-burn, price and charts,
          one-tap buys, holder stats. No deploy, no server, no code.
        </p>
      </div>

      {loading && <div className={styles.empty}>Loading…</div>}

      {!loading && !orgId && (
        <div className={styles.notice}>
          Bots belong to an organisation. <Link href="/dashboard">Create one from the dashboard</Link> first —
          it takes a moment and gives you shared access, API keys and billing in the same place.
        </div>
      )}

      {err && <div className={styles.error}>{err}</div>}

      {!loading && orgId && (
        <>
          <Composer
            orgId={orgId}
            apiFetch={apiFetch}
            onCreated={(bot) => { setBots((p) => [bot, ...p]); void openBot(bot); }}
          />

          {bots.length > 0 && (
            <div className={styles.botGrid}>
              {bots.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  className={`${styles.botCard} ${selected?.id === b.id ? styles.botCardActive : ''}`}
                  onClick={() => void openBot(b)}
                >
                  <div className={styles.botCardTop}>
                    <div>
                      <div className={styles.botName}>
                        {b.branding?.mark ? `${b.branding.mark} ` : ''}{b.name}
                      </div>
                      <div className={styles.botHandle}>
                        {/* The status pill already says "Not connected"; repeating
                            it here wasted the line. Point at the next action. */}
                        {b.telegram_username
                          ? `@${b.telegram_username}`
                          : 'Add your BotFather token to go live'}
                      </div>
                    </div>
                    <StatusPill status={b.status} />
                  </div>
                  <div className={styles.botStats}>
                    {b.token_symbol ? `${b.token_symbol} · ` : ''}
                    {b.messages_handled.toLocaleString()} messages
                  </div>
                </button>
              ))}
            </div>
          )}

          {selected && (
            <BotDetail
              orgId={orgId}
              bot={selected}
              apiFetch={apiFetch}
              onChanged={replaceBot}
              onRefresh={() => void openBot(selected)}
              onDeleted={(id) => {
                setBots((p) => p.filter((b) => b.id !== id));
                setSelected(null);
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
