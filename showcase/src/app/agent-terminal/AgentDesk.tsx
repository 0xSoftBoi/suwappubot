'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TELEGRAM_URL, TERMINAL_URL } from '@/lib/links';
import {
  findTokens,
  getPrices,
  listChains,
  previewSwap,
  type ChainInfo,
  type RouteOrder,
  type SwapPreview,
} from './deskApi';
import {
  applyAmendment,
  compileToWalletPolicies,
  DEFAULT_MANDATE,
  describeMandate,
  diffAmendment,
  evaluateMandate,
  type AmendmentDiff,
  type Mandate,
  type MandateAmendment,
  type MandateVerdict,
} from './mandate';
import {
  getModelContext,
  registerDeskTools,
  registerHandoffTool,
  registerOverrideTool,
  type DeskController,
  type ModelContextLike,
} from './webmcp';
import styles from './agent-desk.module.css';

// ── Model ───────────────────────────────────────────────────────────

interface Ticket {
  fromChain: string;
  toChain: string;
  fromToken: string;
  toToken: string;
  amount: string;
  slippagePercent: number;
  order: RouteOrder;
}

interface SwapBody extends Ticket {
  preview: SwapPreview | null;
  previewError: string | null;
}

interface AlertBody {
  symbol: string;
  direction: 'above' | 'below';
  targetPrice: number;
  spotAtProposal: number | null;
}

interface PlanStep {
  kind: 'swap' | 'alert';
  note: string | null;
  swap?: SwapBody;
  alert?: AlertBody;
  verdict: MandateVerdict | null;
}

interface Override {
  argument: string;
  askedAt: number;
  granted: boolean | null;
}

interface Amendment {
  changes: MandateAmendment;
  diffs: AmendmentDiff[];
}

interface Proposal {
  id: string;
  kind: 'swap' | 'alert' | 'plan' | 'mandate';
  rationale: string;
  createdAt: number;
  expiresAt: number;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  humanNote: string | null;
  decidedAt: number | null;
  consumedAt: number | null;
  swap?: SwapBody;
  alert?: AlertBody;
  plan?: { steps: PlanStep[]; combinedUsd: number | null };
  amendment?: Amendment;
  verdict: MandateVerdict | null;
  override: Override | null;
}

interface ActivityEntry {
  id: string;
  at: number;
  actor: 'agent' | 'human';
  label: string;
  detail: string;
  isError: boolean;
}

const PROPOSAL_TTL_MS = 10 * 60 * 1000;
const MAX_WAIT_SECONDS = 120;
const MANDATE_KEY = 'suwappu.desk.mandate.v1';
const STABLES = new Set(['USDC', 'USDT', 'DAI', 'USDS', 'FRAX', 'USDE']);

const DEFAULT_TICKET: Ticket = {
  fromChain: 'base',
  toChain: 'base',
  fromToken: 'ETH',
  toToken: 'USDC',
  amount: '0.05',
  slippagePercent: 0.5,
  order: 'RECOMMENDED',
};

let idSeq = 0;
const nextId = (prefix: string) => {
  idSeq += 1;
  return `${prefix}_${Date.now().toString(36)}${idSeq.toString(36)}`;
};

function fmtUsd(value: string | number | null | undefined): string {
  const n = typeof value === 'string' ? Number.parseFloat(value) : value;
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n >= 1000
    ? `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
    : `$${n.toLocaleString('en-US', { maximumFractionDigits: n < 1 ? 4 : 2 })}`;
}

function fmtAmount(value: string | undefined): string {
  const n = Number.parseFloat(value ?? '');
  if (!Number.isFinite(n)) return value ?? '—';
  return n.toLocaleString('en-US', { maximumFractionDigits: 6 });
}

function fmtDuration(seconds: number | undefined): string {
  if (!seconds || !Number.isFinite(seconds)) return '—';
  return seconds < 90 ? `${Math.round(seconds)}s` : `${Math.round(seconds / 60)} min`;
}

const clock = (at: number) =>
  new Date(at).toLocaleTimeString('en-US', { hour12: false });

const num = (v: string | null | undefined): number | null => {
  const n = Number.parseFloat(v ?? '');
  return Number.isFinite(n) ? n : null;
};

const dayKey = (at: number) => new Date(at).toISOString().slice(0, 10);

/** Notional of a proposal in USD, or null when nothing could be priced. */
function notionalOf(p: Proposal): number | null {
  if (p.kind === 'swap') return num(p.swap?.preview?.fromAmountUsd);
  if (p.kind === 'plan') return p.plan?.combinedUsd ?? null;
  return 0; // alerts and mandate amendments move no money
}

/** A proposal the desk will not let the human approve as things stand. */
const isBlocked = (p: Proposal) =>
  Boolean(p.verdict && !p.verdict.withinMandate && p.override?.granted !== true);

/**
 * The signing handoff. Nothing here signs — these are the surfaces that own
 * the user's keys, pre-filled with the approved trade.
 */
function buildHandoff(swap: SwapBody) {
  const side = STABLES.has(swap.toToken.toUpperCase()) ? 'sell' : 'buy';
  const terminalUrl = `${TERMINAL_URL}/alert-swap?${new URLSearchParams({
    token: swap.fromToken,
    chain: swap.fromChain,
    side,
    amount: swap.amount,
    ref: 'webmcp-desk',
  })}`;
  const telegramCommand =
    swap.fromChain === swap.toChain
      ? `/s ${swap.amount} ${swap.fromToken} ${swap.toToken}`
      : `/s ${swap.amount} ${swap.fromToken} ${swap.fromChain} ${swap.toToken} ${swap.toChain}`;
  return { terminalUrl, telegramCommand, telegramUrl: TELEGRAM_URL };
}

// ── Component ───────────────────────────────────────────────────────

export default function AgentDesk() {
  const [ticket, setTicket] = useState<Ticket>(DEFAULT_TICKET);
  const [mandate, setMandate] = useState<Mandate>(DEFAULT_MANDATE);
  const [preview, setPreview] = useState<SwapPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [comparison, setComparison] = useState<
    { order: RouteOrder; preview: SwapPreview | null; error: string | null }[] | null
  >(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [chains, setChains] = useState<ChainInfo[]>([]);
  const [mcp, setMcp] = useState<{
    state: 'checking' | 'connected' | 'unsupported';
    tools: string[];
  }>({ state: 'checking', tools: [] });
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [mandateOpen, setMandateOpen] = useState(false);

  const ticketRef = useRef(ticket);
  const mandateRef = useRef(mandate);
  const previewRef = useRef(preview);
  const comparisonRef = useRef(comparison);
  const proposalsRef = useRef(proposals);
  const activityRef = useRef(activity);
  useEffect(() => {
    ticketRef.current = ticket;
  }, [ticket]);
  useEffect(() => {
    mandateRef.current = mandate;
  }, [mandate]);
  useEffect(() => {
    previewRef.current = preview;
  }, [preview]);
  useEffect(() => {
    comparisonRef.current = comparison;
  }, [comparison]);
  useEffect(() => {
    activityRef.current = activity;
  }, [activity]);

  const waiters = useRef(new Map<string, Set<(p: Proposal) => void>>());

  /**
   * Proposals are the one piece of state a tool call reads *and* writes within
   * a single turn (propose → approve → hand off), so the ref is updated
   * synchronously on commit rather than from an effect. An effect-lagged ref
   * let a replayed open_signing_handoff see an unconsumed approval.
   */
  const commitProposals = useCallback(
    (updater: (prev: Proposal[]) => Proposal[]): Proposal[] => {
      const next = updater(proposalsRef.current);
      proposalsRef.current = next;
      setProposals(next);
      return next;
    },
    [],
  );

  const log = useCallback(
    (actor: ActivityEntry['actor'], label: string, detail: string, isError = false) => {
      setActivity((prev) =>
        [{ id: nextId('act'), at: Date.now(), actor, label, detail, isError }, ...prev].slice(
          0,
          80,
        ),
      );
    },
    [],
  );

  const updateMandate = useCallback(
    (patch: Partial<Mandate>) => {
      setMandate((prev) => {
        const next = { ...prev, ...patch };
        mandateRef.current = next;
        try {
          window.localStorage.setItem(MANDATE_KEY, JSON.stringify(next));
        } catch {
          /* not fatal */
        }
        return next;
      });
    },
    [],
  );

  const settle = useCallback((proposal: Proposal) => {
    const set = waiters.current.get(proposal.id);
    if (!set) return;
    for (const resolve of set) resolve(proposal);
    waiters.current.delete(proposal.id);
  }, []);

  // Mandate persists per browser so a returning human keeps their envelope.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(MANDATE_KEY);
      if (raw) setMandate({ ...DEFAULT_MANDATE, ...(JSON.parse(raw) as Partial<Mandate>) });
    } catch {
      /* private mode, blocked storage — the default mandate is fine */
    }
  }, []);

  /** USD approved today. Drives the daily-cap headroom the agent reads. */
  const spentToday = useCallback((list: Proposal[] = proposalsRef.current): number => {
    const today = dayKey(Date.now());
    return list
      .filter((p) => p.status === 'approved' && dayKey(p.decidedAt ?? p.createdAt) === today)
      .reduce((sum, p) => sum + (notionalOf(p) ?? 0), 0);
  }, []);

  const judge = useCallback(
    (body: SwapBody): MandateVerdict =>
      evaluateMandate(
        mandateRef.current,
        {
          notionalUsd: num(body.preview?.fromAmountUsd),
          fromChain: body.fromChain,
          toChain: body.toChain,
          toToken: body.toToken,
          priceImpactPercent: num(body.preview?.priceImpact),
          slippagePercent: body.slippagePercent,
        },
        spentToday(),
      ),
    [spentToday],
  );

  // ── Pricing ──────────────────────────────────────────────────────

  const priceOne = useCallback(
    async (t: Ticket, signal?: AbortSignal): Promise<SwapBody> => {
      try {
        const p = await previewSwap(
          {
            fromChain: t.fromChain,
            toChain: t.toChain,
            fromToken: t.fromToken,
            toToken: t.toToken,
            fromAmount: t.amount,
            slippage: t.slippagePercent / 100,
            order: t.order,
          },
          signal,
        );
        return { ...t, preview: p, previewError: null };
      } catch (error) {
        return {
          ...t,
          preview: null,
          previewError: error instanceof Error ? error.message : String(error),
        };
      }
    },
    [],
  );

  const runPreview = useCallback(
    async (t: Ticket, signal?: AbortSignal): Promise<SwapPreview> => {
      setPreviewBusy(true);
      setPreviewError(null);
      try {
        const body = await priceOne(t, signal);
        if (!body.preview) {
          setPreview(null);
          setPreviewError(body.previewError);
          throw new Error(body.previewError ?? 'Could not price this trade');
        }
        setPreview(body.preview);
        setComparison(null);
        return body.preview;
      } finally {
        setPreviewBusy(false);
      }
    },
    [priceOne],
  );

  const runComparison = useCallback(
    async (t: Ticket, signal?: AbortSignal) => {
      const orders: RouteOrder[] = ['RECOMMENDED', 'FASTEST', 'CHEAPEST', 'SAFEST'];
      setPreviewBusy(true);
      setPreviewError(null);
      try {
        const rows = await Promise.all(
          orders.map(async (order) => {
            const body = await priceOne({ ...t, order }, signal);
            return { order, preview: body.preview, error: body.previewError };
          }),
        );
        setComparison(rows);
        const best = rows.find((r) => r.preview);
        if (best?.preview) setPreview(best.preview);
        return rows;
      } finally {
        setPreviewBusy(false);
      }
    },
    [priceOne],
  );

  // ── Human actions ────────────────────────────────────────────────

  const decide = useCallback(
    (id: string, status: 'approved' | 'rejected') => {
      const current = proposalsRef.current.find((p) => p.id === id);
      if (!current || current.status !== 'pending') return;
      if (status === 'approved' && isBlocked(current)) return;

      const next = commitProposals((prev) =>
        prev.map((p) =>
          p.id === id
            ? {
                ...p,
                status,
                decidedAt: Date.now(),
                humanNote: (noteDraft[id] ?? '').trim() || null,
              }
            : p,
        ),
      );
      const decided = next.find((p) => p.id === id);
      if (decided) {
        // The one thing on this desk that completes in place: an approved
        // amendment rewrites the envelope, here, now, and it persists.
        if (status === 'approved' && decided.kind === 'mandate' && decided.amendment) {
          updateMandate(decided.amendment.changes);
          log(
            'human',
            'Mandate amended',
            decided.amendment.diffs
              .map((d) => `${d.field}: ${d.from} → ${d.to} (${d.direction})`)
              .join('; '),
          );
        }
        settle(decided);
        log(
          'human',
          status === 'approved' ? 'Approved proposal' : 'Rejected proposal',
          `${decided.id}${decided.humanNote ? ` — "${decided.humanNote}"` : ''}`,
        );
      }
    },
    [commitProposals, log, noteDraft, settle, updateMandate],
  );

  const decideOverride = useCallback(
    (id: string, granted: boolean) => {
      commitProposals((prev) =>
        prev.map((p) =>
          p.id === id && p.override
            ? { ...p, override: { ...p.override, granted } }
            : p,
        ),
      );
      log(
        'human',
        granted ? 'Granted override' : 'Denied override',
        `${id} — mandate exception ${granted ? 'allowed once' : 'refused'}`,
      );
    },
    [commitProposals, log],
  );

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      commitProposals((prev) => {
        let changed = false;
        const next = prev.map((p) => {
          if (p.status === 'pending' && now > p.expiresAt) {
            changed = true;
            const expired: Proposal = { ...p, status: 'expired', decidedAt: now };
            settle(expired);
            return expired;
          }
          return p;
        });
        return changed ? next : prev;
      });
    }, 5000);
    return () => window.clearInterval(timer);
  }, [commitProposals, settle]);

  useEffect(() => {
    const ac = new AbortController();
    listChains(ac.signal)
      .then((r) => setChains(r.chains ?? []))
      .catch(() => undefined);
    return () => ac.abort();
  }, []);

  // ── Receipt ──────────────────────────────────────────────────────

  const buildReceipt = useCallback(() => {
    const list = proposalsRef.current;
    return {
      generatedAt: new Date().toISOString(),
      surface: 'Suwappu Agent Desk (WebMCP)',
      custody:
        'This desk never signs. Every entry below is a proposal and a human decision, not an onchain action.',
      mandate: describeMandate(mandateRef.current, spentToday(list)),
      proposals: list.map((p) => ({
        id: p.id,
        kind: p.kind,
        createdAt: new Date(p.createdAt).toISOString(),
        agentRationale: p.rationale,
        notionalUsd: notionalOf(p),
        mandate: p.verdict
          ? {
              withinMandate: p.verdict.withinMandate,
              violations: p.verdict.violations,
            }
          : null,
        override: p.override,
        humanDecision: p.status,
        humanNote: p.humanNote,
        decidedAt: p.decidedAt ? new Date(p.decidedAt).toISOString() : null,
        handedOffAt: p.consumedAt ? new Date(p.consumedAt).toISOString() : null,
      })),
      toolCalls: activityRef.current
        .filter((a) => a.actor === 'agent')
        .map((a) => ({ at: new Date(a.at).toISOString(), entry: a.label, detail: a.detail }))
        .reverse(),
    };
  }, [spentToday]);

  const downloadReceipt = useCallback(() => {
    const blob = new Blob([JSON.stringify(buildReceipt(), null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `suwappu-agent-desk-receipt-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [buildReceipt]);

  const downloadJson = useCallback((data: unknown, prefix: string) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${prefix}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, []);

  // ── Controller ───────────────────────────────────────────────────

  const controller = useMemo<DeskController>(() => {
    const describeVerdict = (v: MandateVerdict | null) =>
      v
        ? {
            withinMandate: v.withinMandate,
            violations: v.violations.map((x) => ({
              rule: x.rule,
              why: x.message,
              limit: x.limit,
              actual: x.actual,
            })),
            dailyRemainingUsd: v.headroom.dailyRemainingUsd,
          }
        : null;

    const describeProposal = (p: Proposal) => ({
      proposalId: p.id,
      kind: p.kind,
      status: p.status,
      rationale: p.rationale,
      humanNote: p.humanNote,
      notionalUsd: notionalOf(p),
      mandate: describeVerdict(p.verdict),
      blocked: isBlocked(p),
      override: p.override,
      createdAt: new Date(p.createdAt).toISOString(),
      expiresAt: new Date(p.expiresAt).toISOString(),
      ...(p.swap
        ? {
            swap: {
              sell: `${p.swap.amount} ${p.swap.fromToken} on ${p.swap.fromChain}`,
              buy: `${p.swap.toToken} on ${p.swap.toChain}`,
              indicativeOut: p.swap.preview
                ? `${fmtAmount(p.swap.preview.toAmount)} ${p.swap.preview.toToken.symbol}`
                : null,
              pricingError: p.swap.previewError,
            },
          }
        : {}),
      ...(p.alert
        ? {
            alert: {
              watch: p.alert.symbol,
              fires: `${p.alert.direction} ${fmtUsd(p.alert.targetPrice)}`,
            },
          }
        : {}),
      ...(p.plan
        ? {
            plan: {
              combinedUsd: p.plan.combinedUsd,
              steps: p.plan.steps.map((s, i) => ({
                step: i + 1,
                kind: s.kind,
                note: s.note,
                summary: s.swap
                  ? `${s.swap.amount} ${s.swap.fromToken} (${s.swap.fromChain}) → ${s.swap.toToken} (${s.swap.toChain})`
                  : s.alert
                    ? `${s.alert.symbol} ${s.alert.direction} ${fmtUsd(s.alert.targetPrice)}`
                    : null,
                mandate: describeVerdict(s.verdict),
              })),
            },
          }
        : {}),
    });

    const addProposal = (proposal: Proposal) => {
      commitProposals((prev) => [proposal, ...prev]);
      return {
        proposalId: proposal.id,
        status: isBlocked(proposal)
          ? 'blocked_by_mandate_awaiting_human'
          : 'awaiting_human_approval',
        mandate: describeVerdict(proposal.verdict),
        expiresAt: new Date(proposal.expiresAt).toISOString(),
        next: isBlocked(proposal)
          ? 'Approve is LOCKED — this breaks the human\'s mandate. Either propose something inside the envelope, or call request_override with your argument for bending the named rule.'
          : 'Call check_approval with this proposalId (waitSeconds up to 120). Nothing has been signed or sent.',
      };
    };

    return {
      async listChains(signal) {
        const r = await listChains(signal);
        setChains(r.chains ?? []);
        return {
          chains: (r.chains ?? []).map((c) => ({ key: c.key, id: c.id, name: c.name })),
        };
      },

      async findToken({ query, chain }, signal) {
        if (!query || !chain) throw new Error('query and chain are both required');
        const rows = await findTokens(query, chain, signal);
        if (rows.length === 0) {
          return { matches: [], hint: `No token matching "${query}" on ${chain}.` };
        }
        return {
          matches: rows.slice(0, 8).map((t) => ({
            symbol: t.symbol,
            name: t.name,
            address: t.address,
            chain: t.chain,
            decimals: t.decimals,
          })),
          caution:
            'Tickers are not unique. Confirm the address with the human before proposing a trade into an unfamiliar token.',
        };
      },

      async getPrices({ symbols }, signal) {
        const prices = await getPrices(symbols, signal);
        return {
          prices,
          unavailable: symbols.filter((s) => prices[s.toLowerCase()] === undefined),
        };
      },

      async previewSwap(args, signal) {
        const next: Ticket = {
          fromChain: args.fromChain,
          toChain: args.toChain || args.fromChain,
          fromToken: args.fromToken,
          toToken: args.toToken,
          amount: args.amount,
          slippagePercent: args.slippagePercent ?? ticketRef.current.slippagePercent,
          order: (args.order as RouteOrder) ?? 'RECOMMENDED',
        };
        setTicket(next);
        const p = await runPreview(next, signal);
        const verdict = judge({ ...next, preview: p, previewError: null });
        return {
          sold: `${fmtAmount(p.fromAmount)} ${p.fromToken.symbol} (${fmtUsd(p.fromAmountUsd)})`,
          received: `${fmtAmount(p.toAmount)} ${p.toToken.symbol} (${fmtUsd(p.toAmountUsd)})`,
          minimumReceived: fmtAmount(p.toAmountMin),
          exchangeRate: p.exchangeRate,
          priceImpactPercent: p.priceImpact,
          bridgeFeeUsd: p.bridgeFeeUsd,
          estimatedGasUsd: p.estimatedGasUsd,
          estimatedDuration: fmtDuration(p.estimatedDurationSeconds),
          route: p.route,
          order: p.order,
          slippagePercent: p.slippage * 100,
          executable: false,
          mandate: describeVerdict(verdict),
        };
      },

      async compareRoutes(args, signal) {
        const next: Ticket = {
          ...ticketRef.current,
          fromChain: args.fromChain,
          toChain: args.toChain || args.fromChain,
          fromToken: args.fromToken,
          toToken: args.toToken,
          amount: args.amount,
        };
        setTicket(next);
        const rows = await runComparison(next, signal);
        return {
          comparison: rows.map((r) => ({
            order: r.order,
            out: r.preview
              ? `${fmtAmount(r.preview.toAmount)} ${r.preview.toToken.symbol}`
              : null,
            outUsd: r.preview?.toAmountUsd ?? null,
            gasUsd: r.preview?.estimatedGasUsd ?? null,
            bridgeFeeUsd: r.preview?.bridgeFeeUsd ?? null,
            duration: r.preview ? fmtDuration(r.preview.estimatedDurationSeconds) : null,
            route: r.preview?.route ?? null,
            error: r.error,
          })),
          note: 'Rendered as a comparison table on the page for the human.',
        };
      },

      readDesk() {
        const t = ticketRef.current;
        const p = previewRef.current;
        return {
          ticket: t,
          mandate: describeMandate(mandateRef.current, spentToday()),
          latestQuote: p
            ? {
                out: `${fmtAmount(p.toAmount)} ${p.toToken.symbol}`,
                outUsd: p.toAmountUsd,
                route: p.route,
                order: p.order,
              }
            : null,
          routeComparison:
            comparisonRef.current?.map((r) => ({
              order: r.order,
              out: r.preview
                ? `${fmtAmount(r.preview.toAmount)} ${r.preview.toToken.symbol}`
                : null,
            })) ?? null,
          proposals: proposalsRef.current.map(describeProposal),
          recentActivity: activityRef.current.slice(0, 12).map((a) => ({
            at: new Date(a.at).toISOString(),
            actor: a.actor,
            label: a.label,
          })),
        };
      },

      readMandate() {
        return describeMandate(mandateRef.current, spentToday());
      },

      navigateDesk({ section }) {
        const SECTIONS: Record<string, { id: string; purpose: string; tools: string[] }> = {
          mandate: {
            id: 'desk-mandate',
            purpose: "The human's standing envelope and how much of today's budget is left.",
            tools: ['read_mandate', 'check_mandate', 'amend_mandate', 'compile_mandate_to_policy'],
          },
          ticket: {
            id: 'desk-ticket',
            purpose: 'The trade form you and the human share, plus the live quote.',
            tools: ['preview_swap', 'compare_routes', 'find_token', 'get_prices', 'list_chains'],
          },
          approvals: {
            id: 'desk-approvals',
            purpose: 'Proposals waiting on a human decision, with their mandate verdicts.',
            tools: ['propose_swap', 'propose_plan', 'propose_price_alert', 'check_approval', 'request_override'],
          },
          activity: {
            id: 'desk-activity',
            purpose: 'The visible log of every tool call you have made here.',
            tools: ['read_desk', 'export_receipt'],
          },
          'how-it-works': {
            id: 'how-it-works',
            purpose: 'The explainer for how a mandate becomes a trade.',
            tools: [],
          },
          tools: { id: 'tools', purpose: 'The full catalogue of tools this page registers.', tools: [] },
        };
        const target = SECTIONS[section];
        if (!target) {
          return {
            error: `Unknown section "${section}".`,
            sections: Object.keys(SECTIONS),
          };
        }
        const el = typeof document !== 'undefined' ? document.getElementById(target.id) : null;
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return {
          movedTo: section,
          purpose: target.purpose,
          toolsForThisSection: target.tools,
          visible: Boolean(el),
        };
      },

      async amendMandate({ rationale, ...changes }) {
        if (!rationale.trim()) {
          throw new Error(
            'rationale is required — you are asking to change the rules the human set.',
          );
        }
        const diffs = diffAmendment(mandateRef.current, changes);
        if (diffs.length === 0) {
          throw new Error('That amendment would not change anything about the mandate.');
        }
        const proposal: Proposal = {
          id: nextId('amend'),
          kind: 'mandate',
          rationale: rationale.trim(),
          createdAt: Date.now(),
          expiresAt: Date.now() + PROPOSAL_TTL_MS,
          status: 'pending',
          humanNote: null,
          decidedAt: null,
          consumedAt: null,
          amendment: { changes, diffs },
          verdict: null,
          override: null,
        };
        commitProposals((prev) => [proposal, ...prev]);
        return {
          proposalId: proposal.id,
          status: 'awaiting_human_approval',
          changes: diffs.map((d) => ({
            field: d.field,
            from: d.from,
            to: d.to,
            direction: d.direction,
          })),
          loosens: diffs.filter((d) => d.direction === 'looser').map((d) => d.field),
          next:
            'The human sees a before/after diff with every loosened rule flagged. If they approve, the mandate changes here and persists — this is the one thing on the desk that completes in place. Poll check_approval.',
        };
      },

      async compileMandateToPolicy({ download }) {
        const mandateNow = mandateRef.current;
        let ethUsd = 0;
        try {
          const prices = await getPrices(['ETH']);
          ethUsd = prices.eth ?? 0;
        } catch {
          ethUsd = 0;
        }

        // A whitelist policy needs contract addresses, so resolve the symbols
        // the human allowed into real addresses on their allowed chains.
        const addresses: string[] = [];
        const unresolved: string[] = [];
        for (const symbol of mandateNow.allowedBuyTokens.slice(0, 8)) {
          const chain = mandateNow.allowedChains[0] ?? 'base';
          try {
            const rows = await findTokens(symbol, chain);
            const hit = rows.find((t) => t.symbol.toUpperCase() === symbol.toUpperCase());
            if (hit?.address && /^0x[a-fA-F0-9]{40}$/.test(hit.address)) addresses.push(hit.address);
            else unresolved.push(symbol);
          } catch {
            unresolved.push(symbol);
          }
        }

        const { policies, notes } = compileToWalletPolicies(mandateNow, ethUsd, addresses);
        if (unresolved.length > 0) {
          notes.push(`Could not resolve an address for: ${unresolved.join(', ')}.`);
        }

        const bundle = {
          generatedAt: new Date().toISOString(),
          source: 'Suwappu Agent Desk (WebMCP) — negotiated mandate',
          endpoint: 'POST /v1/agent/wallet/policy',
          authentication:
            'Requires a Suwappu agent API key. This page never holds one, by design.',
          mandate: describeMandate(mandateNow, spentToday()),
          policies,
          notes,
        };
        if (download) downloadJson(bundle, 'suwappu-wallet-policy');
        return bundle;
      },

      async checkMandate(args, signal) {
        const t: Ticket = {
          fromChain: args.fromChain,
          toChain: args.toChain || args.fromChain,
          fromToken: args.fromToken,
          toToken: args.toToken,
          amount: args.amount,
          slippagePercent: args.slippagePercent ?? ticketRef.current.slippagePercent,
          order: 'RECOMMENDED',
        };
        const body = await priceOne(t, signal);
        const verdict = judge(body);
        return {
          checked: `${t.amount} ${t.fromToken} (${t.fromChain}) → ${t.toToken} (${t.toChain})`,
          notionalUsd: num(body.preview?.fromAmountUsd),
          pricingError: body.previewError,
          ...describeVerdict(verdict),
          advice: verdict.withinMandate
            ? 'Inside the envelope. Safe to propose.'
            : 'Outside the envelope. Adjust size, chain or token and check again — or propose it anyway and argue for an override.',
          silent: true,
        };
      },

      async proposeSwap(args) {
        if (!args.rationale.trim()) {
          throw new Error(
            'rationale is required — the human has to read why you want this trade.',
          );
        }
        const t: Ticket = {
          fromChain: args.fromChain,
          toChain: args.toChain || args.fromChain,
          fromToken: args.fromToken,
          toToken: args.toToken,
          amount: args.amount,
          slippagePercent: args.slippagePercent ?? ticketRef.current.slippagePercent,
          order: (args.order as RouteOrder) ?? 'RECOMMENDED',
        };
        setTicket(t);
        const body = await priceOne(t);
        if (body.preview) {
          setPreview(body.preview);
          setComparison(null);
          setPreviewError(null);
        } else {
          setPreviewError(body.previewError);
        }
        const proposal: Proposal = {
          id: nextId('prop'),
          kind: 'swap',
          rationale: args.rationale.trim(),
          createdAt: Date.now(),
          expiresAt: Date.now() + PROPOSAL_TTL_MS,
          status: 'pending',
          humanNote: null,
          decidedAt: null,
          consumedAt: null,
          swap: body,
          verdict: judge(body),
          override: null,
        };
        return {
          ...addProposal(proposal),
          shownToHuman: {
            sell: `${t.amount} ${t.fromToken} on ${t.fromChain}`,
            buy: `${t.toToken} on ${t.toChain}`,
            indicativeOut: body.preview
              ? `${fmtAmount(body.preview.toAmount)} ${body.preview.toToken.symbol}`
              : null,
            pricingError: body.previewError,
          },
        };
      },

      async proposePlan(args) {
        if (!args.rationale.trim()) throw new Error('rationale is required');
        if (args.steps.length === 0) throw new Error('a plan needs at least one step');
        if (args.steps.length > 5) throw new Error('a plan is capped at 5 steps');

        const steps: PlanStep[] = [];
        for (const raw of args.steps) {
          const kind = String(raw.kind ?? 'swap') === 'alert' ? 'alert' : 'swap';
          const note = raw.note ? String(raw.note) : null;
          if (kind === 'swap') {
            const t: Ticket = {
              fromChain: String(raw.fromChain ?? ticketRef.current.fromChain),
              toChain: String(raw.toChain ?? raw.fromChain ?? ticketRef.current.toChain),
              fromToken: String(raw.fromToken ?? ''),
              toToken: String(raw.toToken ?? ''),
              amount: String(raw.amount ?? ''),
              slippagePercent:
                typeof raw.slippagePercent === 'number'
                  ? raw.slippagePercent
                  : ticketRef.current.slippagePercent,
              order: 'RECOMMENDED',
            };
            if (!t.fromToken || !t.toToken || !t.amount) {
              throw new Error('every swap step needs fromToken, toToken and amount');
            }
            const body = await priceOne(t);
            steps.push({ kind, note, swap: body, verdict: judge(body) });
          } else {
            const symbol = String(raw.symbol ?? '').toUpperCase();
            const direction = String(raw.direction ?? 'above');
            const targetPrice = Number(raw.targetPrice);
            if (!symbol || !Number.isFinite(targetPrice)) {
              throw new Error('every alert step needs symbol and targetPrice');
            }
            steps.push({
              kind,
              note,
              alert: {
                symbol,
                direction: direction === 'below' ? 'below' : 'above',
                targetPrice,
                spotAtProposal: null,
              },
              verdict: null,
            });
          }
        }

        const priced = steps
          .map((s) => num(s.swap?.preview?.fromAmountUsd))
          .filter((n): n is number => n !== null);
        const combinedUsd = priced.length > 0 ? priced.reduce((a, b) => a + b, 0) : null;

        // The plan is judged as one trade: the human approves the whole thing,
        // so the daily cap has to see the combined notional, not each leg.
        const rollup = evaluateMandate(
          mandateRef.current,
          {
            notionalUsd: combinedUsd,
            fromChain: steps.find((s) => s.swap)?.swap?.fromChain ?? '',
            toChain: steps.find((s) => s.swap)?.swap?.toChain ?? '',
            toToken: steps.find((s) => s.swap)?.swap?.toToken ?? '',
            priceImpactPercent: Math.max(
              ...steps.map((s) => num(s.swap?.preview?.priceImpact) ?? 0),
              0,
            ),
            slippagePercent: Math.max(
              ...steps.map((s) => s.swap?.slippagePercent ?? 0),
              0,
            ),
          },
          spentToday(),
        );
        // Any step that fails on its own fails the plan.
        for (const s of steps) {
          if (s.verdict && !s.verdict.withinMandate) {
            for (const v of s.verdict.violations) {
              if (!rollup.violations.some((x) => x.rule === v.rule && x.actual === v.actual)) {
                rollup.violations.push(v);
              }
            }
          }
        }
        rollup.withinMandate = rollup.violations.length === 0;

        const proposal: Proposal = {
          id: nextId('plan'),
          kind: 'plan',
          rationale: args.rationale.trim(),
          createdAt: Date.now(),
          expiresAt: Date.now() + PROPOSAL_TTL_MS,
          status: 'pending',
          humanNote: null,
          decidedAt: null,
          consumedAt: null,
          plan: { steps, combinedUsd },
          verdict: rollup,
          override: null,
        };
        return {
          ...addProposal(proposal),
          shownToHuman: {
            steps: steps.length,
            combinedUsd,
            legs: steps.map((s) =>
              s.swap
                ? `${s.swap.amount} ${s.swap.fromToken} → ${s.swap.toToken}`
                : `alert ${s.alert?.symbol} ${s.alert?.direction} ${s.alert?.targetPrice}`,
            ),
          },
        };
      },

      async proposePriceAlert(args) {
        if (!args.rationale.trim()) throw new Error('rationale is required');
        if (args.direction !== 'above' && args.direction !== 'below') {
          throw new Error('direction must be "above" or "below"');
        }
        if (!Number.isFinite(args.targetPrice) || args.targetPrice <= 0) {
          throw new Error('targetPrice must be a positive number');
        }
        let spot: number | null = null;
        try {
          const prices = await getPrices([args.symbol]);
          spot = prices[args.symbol.toLowerCase()] ?? null;
        } catch {
          spot = null;
        }
        const proposal: Proposal = {
          id: nextId('prop'),
          kind: 'alert',
          rationale: args.rationale.trim(),
          createdAt: Date.now(),
          expiresAt: Date.now() + PROPOSAL_TTL_MS,
          status: 'pending',
          humanNote: null,
          decidedAt: null,
          consumedAt: null,
          alert: {
            symbol: args.symbol.toUpperCase(),
            direction: args.direction,
            targetPrice: args.targetPrice,
            spotAtProposal: spot,
          },
          verdict: null,
          override: null,
        };
        return {
          ...addProposal(proposal),
          shownToHuman: {
            watch: proposal.alert?.symbol,
            fires: `${args.direction} ${fmtUsd(args.targetPrice)}`,
            spotNow: spot,
          },
        };
      },

      async requestOverride({ proposalId, argument }) {
        const proposal = proposalsRef.current.find((p) => p.id === proposalId);
        if (!proposal) throw new Error(`No proposal with id ${proposalId}`);
        if (!isBlocked(proposal)) {
          throw new Error(
            'That proposal is not blocked by the mandate — no override is needed.',
          );
        }
        if (proposal.override) {
          throw new Error(
            'You already asked for an override on this proposal. Wait for the human, or propose something inside the envelope.',
          );
        }
        if (!argument.trim()) {
          throw new Error('argument is required — say why the rule should be bent.');
        }
        commitProposals((prev) =>
          prev.map((p) =>
            p.id === proposalId
              ? { ...p, override: { argument: argument.trim(), askedAt: Date.now(), granted: null } }
              : p,
          ),
        );
        return {
          proposalId,
          status: 'override_requested',
          brokenRules: proposal.verdict?.violations.map((v) => v.rule) ?? [],
          next: 'The human sees your argument beside the rule you broke. Poll check_approval — if they deny the override, Approve stays locked and you should propose something that fits instead.',
        };
      },

      checkApproval({ proposalId, waitSeconds = 0 }, signal) {
        const find = () => proposalsRef.current.find((p) => p.id === proposalId);
        const current = find();
        if (!current) {
          return Promise.reject(new Error(`No proposal with id ${proposalId}`));
        }
        const describe = (p: Proposal) => ({
          ...describeProposal(p),
          decision: p.status,
          canHandOff: p.status === 'approved' && p.consumedAt === null && p.kind !== 'alert',
        });
        if (current.status !== 'pending' || waitSeconds <= 0) {
          return Promise.resolve(describe(current));
        }

        const waitMs = Math.min(Math.max(waitSeconds, 1), MAX_WAIT_SECONDS) * 1000;
        return new Promise((resolve) => {
          let done = false;
          const cleanup = () => {
            window.clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
            waiters.current.get(proposalId)?.delete(finish);
          };
          const finish = (p: Proposal) => {
            if (done) return;
            done = true;
            cleanup();
            resolve(describe(p));
          };
          const onAbort = () => finish(find() ?? current);
          const timer = window.setTimeout(() => {
            if (done) return;
            done = true;
            cleanup();
            const latest = find() ?? current;
            resolve({
              ...describe(latest),
              timedOut: latest.status === 'pending',
              hint:
                latest.status === 'pending'
                  ? 'The human has not decided yet. Tell them what you are waiting on, then call check_approval again.'
                  : undefined,
            });
          }, waitMs);

          const set = waiters.current.get(proposalId) ?? new Set<(p: Proposal) => void>();
          set.add(finish);
          waiters.current.set(proposalId, set);
          signal?.addEventListener('abort', onAbort);
        });
      },

      async openSigningHandoff({ proposalId }) {
        const proposal = proposalsRef.current.find((p) => p.id === proposalId);
        if (!proposal) throw new Error(`No proposal with id ${proposalId}`);
        if (proposal.status !== 'approved') {
          throw new Error(
            `Proposal ${proposalId} is ${proposal.status}, not approved. A human must approve it first.`,
          );
        }
        if (proposal.consumedAt !== null) {
          throw new Error('That approval was already handed off. Propose the trade again.');
        }
        const legs =
          proposal.kind === 'plan'
            ? (proposal.plan?.steps ?? []).filter((s) => s.swap).map((s) => s.swap as SwapBody)
            : proposal.swap
              ? [proposal.swap]
              : [];
        if (legs.length === 0) {
          throw new Error('Only swap proposals and plans containing a swap have a handoff.');
        }
        commitProposals((prev) =>
          prev.map((p) => (p.id === proposalId ? { ...p, consumedAt: Date.now() } : p)),
        );
        return {
          proposalId,
          handoff: legs.map(buildHandoff),
          custody:
            'Suwappu does not sign from this page. Each link opens a surface the human controls, pre-filled with the approved trade; they still confirm and sign there. A plan hands off one link per leg, in order.',
        };
      },

      exportReceipt({ download }) {
        const receipt = buildReceipt();
        if (download) {
          downloadReceipt();
          log('agent', 'Receipt downloaded', 'agent handed the human a copy of the session');
        }
        return receipt;
      },

      onToolCall(name, args) {
        log('agent', `→ ${name}`, JSON.stringify(args));
      },

      onToolResult(name, summary, isError) {
        log('agent', `← ${name}`, summary, isError);
      },
    };
  }, [
    buildReceipt,
    commitProposals,
    downloadJson,
    downloadReceipt,
    judge,
    log,
    priceOne,
    runComparison,
    runPreview,
    spentToday,
  ]);

  // ── Registration ─────────────────────────────────────────────────

  const ctxRef = useRef<ModelContextLike | null>(null);

  useEffect(() => {
    const ctx = getModelContext();
    ctxRef.current = ctx;
    if (!ctx) {
      setMcp({ state: 'unsupported', tools: [] });
      return;
    }
    let disposer: (() => void) | null = null;
    let cancelled = false;
    registerDeskTools(ctx, controller)
      .then((registration) => {
        if (cancelled) {
          registration.dispose();
          return;
        }
        disposer = registration.dispose;
        setMcp({ state: 'connected', tools: registration.toolNames });
        log('human', 'Desk online', `${registration.toolNames.length} site tools registered`);
      })
      .catch((error) => {
        setMcp({ state: 'unsupported', tools: [] });
        log(
          'human',
          'Tool registration failed',
          error instanceof Error ? error.message : String(error),
          true,
        );
      });
    return () => {
      cancelled = true;
      disposer?.();
    };
  }, [controller, log]);

  /**
   * Two tools exist only when the human's state makes them meaningful. This is
   * the point of dynamic registration: the agent's options narrow and widen
   * with what the human has actually allowed.
   */
  const hasUnlockedHandoff = proposals.some(
    (p) =>
      p.kind !== 'alert' && p.status === 'approved' && p.consumedAt === null,
  );
  const hasBlockedProposal = proposals.some(
    (p) => p.status === 'pending' && isBlocked(p) && !p.override,
  );

  useDynamicTool(ctxRef, controller, hasUnlockedHandoff, registerHandoffTool, 'open_signing_handoff', setMcp);
  useDynamicTool(ctxRef, controller, hasBlockedProposal, registerOverrideTool, 'request_override', setMcp);

  // ── Manual controls ──────────────────────────────────────────────

  const onManualQuote = async () => {
    log('human', 'Manual quote', `${ticket.amount} ${ticket.fromToken} → ${ticket.toToken}`);
    try {
      await runPreview(ticket);
    } catch {
      /* surfaced in previewError */
    }
  };

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 1800);
    } catch {
      setCopied(null);
    }
  };

  const chainKeys =
    chains.length > 0 ? chains.map((c) => c.key) : ['base', 'ethereum', 'arbitrum'];
  const pending = proposals.filter((p) => p.status === 'pending');
  const spent = spentToday(proposals);
  const remaining = Math.max(0, mandate.dailyUsdCap - spent);
  const usedPct = Math.min(100, mandate.dailyUsdCap > 0 ? (spent / mandate.dailyUsdCap) * 100 : 0);

  return (
    <div className={styles.desk}>
      <section className={styles.statusBar} aria-live="polite">
        <span
          className={`${styles.pill} ${
            mcp.state === 'connected'
              ? styles.pillOn
              : mcp.state === 'checking'
                ? styles.pillWait
                : styles.pillOff
          }`}
        >
          {mcp.state === 'connected'
            ? `WebMCP connected · ${mcp.tools.length} site tools`
            : mcp.state === 'checking'
              ? 'Looking for an agent…'
              : 'No WebMCP in this browser'}
        </span>
        <p className={styles.statusCopy}>
          {mcp.state === 'connected'
            ? 'An agent in this browser can read your mandate, price routes and propose trades against it. It cannot sign, and it cannot approve.'
            : 'Open this page in the ChatGPT desktop app’s browser (or Chrome with WebMCP enabled) to let an agent drive it. Everything below still works by hand.'}
        </p>
      </section>

      <div className={styles.grid}>
        {/* ── Mandate ────────────────────────────────────────────── */}
        <section id="desk-mandate" className={`${styles.panel} ${styles.mandatePanel}`}>
          <div className={styles.mandateHead}>
            <div>
              <h2 className={styles.panelTitle}>Your mandate</h2>
              <p className={styles.panelNote}>
                The envelope you write and the agent reads before it proposes anything.
              </p>
            </div>
            <div className={styles.actions} style={{ marginTop: 0 }}>
              <button
                type="button"
                className={styles.ghost}
                onClick={() => setMandateOpen((v) => !v)}
                aria-expanded={mandateOpen}
              >
                {mandateOpen ? 'Done' : 'Edit'}
              </button>
              <button
                type="button"
                className={styles.ghost}
                onClick={async () => {
                  log('human', 'Compile mandate', 'to Suwappu wallet spending policies');
                  await controller.compileMandateToPolicy({ download: true });
                }}
              >
                Compile to policy
              </button>
            </div>
          </div>

          <div className={styles.budget}>
            <div className={styles.budgetBar}>
              <span style={{ width: `${usedPct}%` }} />
            </div>
            <p className={styles.budgetCopy}>
              <strong>{fmtUsd(remaining)}</strong> of {fmtUsd(mandate.dailyUsdCap)} left today ·
              max {fmtUsd(mandate.perTradeUsdCap)} per trade · impact ≤{' '}
              {mandate.maxPriceImpactPercent}% · slippage ≤ {mandate.maxSlippagePercent}%
            </p>
          </div>

          {mandateOpen ? (
            <div className={styles.ticketGrid}>
              <label className={styles.field}>
                <span>Per trade $</span>
                <input
                  value={String(mandate.perTradeUsdCap)}
                  inputMode="decimal"
                  onChange={(e) =>
                    updateMandate({ perTradeUsdCap: Number.parseFloat(e.target.value) || 0 })
                  }
                />
              </label>
              <label className={styles.field}>
                <span>Per day $</span>
                <input
                  value={String(mandate.dailyUsdCap)}
                  inputMode="decimal"
                  onChange={(e) =>
                    updateMandate({ dailyUsdCap: Number.parseFloat(e.target.value) || 0 })
                  }
                />
              </label>
              <label className={styles.field}>
                <span>Max impact %</span>
                <input
                  value={String(mandate.maxPriceImpactPercent)}
                  inputMode="decimal"
                  onChange={(e) =>
                    updateMandate({
                      maxPriceImpactPercent: Number.parseFloat(e.target.value) || 0,
                    })
                  }
                />
              </label>
              <label className={styles.field}>
                <span>Max slippage %</span>
                <input
                  value={String(mandate.maxSlippagePercent)}
                  inputMode="decimal"
                  onChange={(e) =>
                    updateMandate({
                      maxSlippagePercent: Number.parseFloat(e.target.value) || 0,
                    })
                  }
                />
              </label>
              <label className={`${styles.field} ${styles.fieldWide}`}>
                <span>Chains it may touch (blank = any)</span>
                <input
                  value={mandate.allowedChains.join(', ')}
                  onChange={(e) =>
                    updateMandate({
                      allowedChains: e.target.value
                        .split(',')
                        .map((x) => x.trim().toLowerCase())
                        .filter(Boolean),
                    })
                  }
                />
              </label>
              <label className={`${styles.field} ${styles.fieldWide}`}>
                <span>Tokens it may buy (blank = any)</span>
                <input
                  value={mandate.allowedBuyTokens.join(', ')}
                  onChange={(e) =>
                    updateMandate({
                      allowedBuyTokens: e.target.value
                        .split(',')
                        .map((x) => x.trim().toUpperCase())
                        .filter(Boolean),
                    })
                  }
                />
              </label>
            </div>
          ) : (
            <ul className={styles.mandateList}>
              <li>
                <span>Chains</span>
                <strong>
                  {mandate.allowedChains.length ? mandate.allowedChains.join(' · ') : 'any'}
                </strong>
              </li>
              <li>
                <span>May buy</span>
                <strong>
                  {mandate.allowedBuyTokens.length
                    ? mandate.allowedBuyTokens.join(' · ')
                    : 'any token'}
                </strong>
              </li>
            </ul>
          )}

          <p className={styles.finePrint}>
            This desk never executes, so the mandate cannot physically cap spending — it governs
            what the page will put in front of you and what the agent is told before it asks.
            Binding limits live in Suwappu’s server-side wallet spending policies. Stored in this
            browser only.
          </p>
        </section>

        {/* ── Ticket ─────────────────────────────────────────────── */}
        <section id="desk-ticket" className={styles.panel}>
          <h2 className={styles.panelTitle}>Ticket</h2>
          <p className={styles.panelNote}>
            Shared surface: you and the agent are editing the same ticket.
          </p>
          <div className={styles.ticketGrid}>
            <label className={styles.field}>
              <span>Sell</span>
              <input
                value={ticket.amount}
                inputMode="decimal"
                onChange={(e) => setTicket((t) => ({ ...t, amount: e.target.value }))}
              />
            </label>
            <label className={styles.field}>
              <span>Token</span>
              <input
                value={ticket.fromToken}
                onChange={(e) =>
                  setTicket((t) => ({ ...t, fromToken: e.target.value.toUpperCase() }))
                }
              />
            </label>
            <label className={styles.field}>
              <span>From chain</span>
              <select
                value={ticket.fromChain}
                onChange={(e) => setTicket((t) => ({ ...t, fromChain: e.target.value }))}
              >
                {chainKeys.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span>Buy</span>
              <input
                value={ticket.toToken}
                onChange={(e) =>
                  setTicket((t) => ({ ...t, toToken: e.target.value.toUpperCase() }))
                }
              />
            </label>
            <label className={styles.field}>
              <span>To chain</span>
              <select
                value={ticket.toChain}
                onChange={(e) => setTicket((t) => ({ ...t, toChain: e.target.value }))}
              >
                {chainKeys.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span>Slippage %</span>
              <input
                value={String(ticket.slippagePercent)}
                inputMode="decimal"
                onChange={(e) =>
                  setTicket((t) => ({
                    ...t,
                    slippagePercent: Number.parseFloat(e.target.value) || t.slippagePercent,
                  }))
                }
              />
            </label>
          </div>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primary}
              onClick={onManualQuote}
              disabled={previewBusy}
            >
              {previewBusy ? 'Pricing…' : 'Price it'}
            </button>
            <button
              type="button"
              className={styles.ghost}
              onClick={() => {
                log('human', 'Manual compare', `${ticket.fromToken} → ${ticket.toToken}`);
                void runComparison(ticket);
              }}
              disabled={previewBusy}
            >
              Compare routes
            </button>
          </div>

          {previewError && <p className={styles.error}>{previewError}</p>}

          {preview && !comparison && (
            <dl className={styles.quote}>
              <div>
                <dt>You receive</dt>
                <dd className={styles.big}>
                  {fmtAmount(preview.toAmount)} {preview.toToken.symbol}
                </dd>
              </div>
              <div>
                <dt>Value</dt>
                <dd>{fmtUsd(preview.toAmountUsd)}</dd>
              </div>
              <div>
                <dt>Minimum received</dt>
                <dd>{fmtAmount(preview.toAmountMin)}</dd>
              </div>
              <div>
                <dt>Price impact</dt>
                <dd>{preview.priceImpact}%</dd>
              </div>
              <div>
                <dt>Gas</dt>
                <dd>{fmtUsd(preview.estimatedGasUsd)}</dd>
              </div>
              <div>
                <dt>Bridge fee</dt>
                <dd>{fmtUsd(preview.bridgeFeeUsd)}</dd>
              </div>
              <div>
                <dt>Settles in</dt>
                <dd>{fmtDuration(preview.estimatedDurationSeconds)}</dd>
              </div>
              <div>
                <dt>Route</dt>
                <dd>{preview.route}</dd>
              </div>
            </dl>
          )}

          {comparison && (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Preference</th>
                    <th>Out</th>
                    <th>Gas</th>
                    <th>Time</th>
                    <th>Route</th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.map((row) => (
                    <tr key={row.order}>
                      <th scope="row">{row.order}</th>
                      <td>
                        {row.preview
                          ? `${fmtAmount(row.preview.toAmount)} ${row.preview.toToken.symbol}`
                          : '—'}
                      </td>
                      <td>{row.preview ? fmtUsd(row.preview.estimatedGasUsd) : '—'}</td>
                      <td>
                        {row.preview ? fmtDuration(row.preview.estimatedDurationSeconds) : '—'}
                      </td>
                      <td>{row.preview?.route ?? row.error ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className={styles.finePrint}>
            Quotes are indicative and not executable. Nothing on this page can sign a
            transaction.
          </p>
        </section>

        {/* ── Approvals ──────────────────────────────────────────── */}
        <section id="desk-approvals" className={styles.panel}>
          <h2 className={styles.panelTitle}>
            Approvals{pending.length > 0 ? ` · ${pending.length} waiting` : ''}
          </h2>
          <p className={styles.panelNote}>
            The agent proposes. You decide. A proposal outside your mandate cannot be approved
            until you grant an exception.
          </p>
          {proposals.length === 0 && (
            <p className={styles.empty}>
              No proposals yet. Ask your agent something like{' '}
              <em>
                “read my mandate, then build me a plan to move some ETH into USDC on Arbitrum
                without breaking it.”
              </em>
            </p>
          )}
          <ul className={styles.proposalList}>
            {proposals.map((p) => {
              const blocked = isBlocked(p);
              const legs =
                p.kind === 'plan'
                  ? (p.plan?.steps ?? []).filter((s) => s.swap).map((s) => s.swap as SwapBody)
                  : p.swap
                    ? [p.swap]
                    : [];
              return (
                <li
                  key={p.id}
                  className={`${styles.proposal} ${
                    blocked && p.status === 'pending' ? styles.s_blocked : styles[`s_${p.status}`]
                  }`}
                >
                  <header className={styles.proposalHead}>
                    <span className={styles.proposalKind}>
                      {p.kind === 'plan'
                        ? `Plan · ${p.plan?.steps.length} steps`
                        : p.kind === 'swap'
                          ? 'Swap proposal'
                          : p.kind === 'mandate'
                            ? 'Mandate amendment'
                            : 'Alert proposal'}
                    </span>
                    <span className={styles.proposalStatus}>
                      {blocked && p.status === 'pending' ? 'blocked' : p.status}
                    </span>
                  </header>

                  {p.swap && (
                    <p className={styles.proposalLine}>
                      Sell{' '}
                      <strong>
                        {p.swap.amount} {p.swap.fromToken}
                      </strong>{' '}
                      on {p.swap.fromChain} → <strong>{p.swap.toToken}</strong> on {p.swap.toChain}
                      {p.swap.preview && (
                        <>
                          {' '}
                          · ≈{' '}
                          <strong>
                            {fmtAmount(p.swap.preview.toAmount)} {p.swap.preview.toToken.symbol}
                          </strong>{' '}
                          ({fmtUsd(p.swap.preview.toAmountUsd)})
                        </>
                      )}
                    </p>
                  )}

                  {p.plan && (
                    <ol className={styles.planSteps}>
                      {p.plan.steps.map((s, i) => (
                        <li key={`${p.id}-${i}`}>
                          <span className={styles.planIndex}>{i + 1}</span>
                          <span>
                            {s.swap ? (
                              <>
                                Sell{' '}
                                <strong>
                                  {s.swap.amount} {s.swap.fromToken}
                                </strong>{' '}
                                on {s.swap.fromChain} → <strong>{s.swap.toToken}</strong> on{' '}
                                {s.swap.toChain}
                                {s.swap.preview && (
                                  <> · ≈ {fmtUsd(s.swap.preview.toAmountUsd)}</>
                                )}
                              </>
                            ) : (
                              <>
                                Alert <strong>{s.alert?.symbol}</strong> {s.alert?.direction}{' '}
                                <strong>{fmtUsd(s.alert?.targetPrice)}</strong>
                              </>
                            )}
                            {s.note && <em className={styles.planNote}> — {s.note}</em>}
                          </span>
                        </li>
                      ))}
                      {p.plan.combinedUsd !== null && (
                        <li className={styles.planTotal}>
                          <span className={styles.planIndex}>Σ</span>
                          <span>
                            Combined notional <strong>{fmtUsd(p.plan.combinedUsd)}</strong>
                          </span>
                        </li>
                      )}
                    </ol>
                  )}

                  {p.alert && !p.plan && (
                    <p className={styles.proposalLine}>
                      Alert on <strong>{p.alert.symbol}</strong> when it goes {p.alert.direction}{' '}
                      <strong>{fmtUsd(p.alert.targetPrice)}</strong>
                      {p.alert.spotAtProposal !== null && (
                        <> · spot {fmtUsd(p.alert.spotAtProposal)}</>
                      )}
                    </p>
                  )}

                  {p.amendment && (
                    <ul className={styles.diffList}>
                      {p.amendment.diffs.map((d) => (
                        <li key={`${p.id}-${d.field}`} data-direction={d.direction}>
                          <span className={styles.diffField}>{d.field}</span>
                          <span className={styles.diffFrom}>{d.from}</span>
                          <span aria-hidden="true">→</span>
                          <span className={styles.diffTo}>{d.to}</span>
                          <span className={styles.diffTag}>{d.direction}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  <blockquote className={styles.rationale}>{p.rationale}</blockquote>

                  {p.verdict && !p.verdict.withinMandate && (
                    <div className={styles.violations}>
                      <p className={styles.violationsTitle}>
                        Breaks your mandate
                        {p.override?.granted === true ? ' — you allowed it once' : ''}
                      </p>
                      <ul>
                        {p.verdict.violations.map((v, i) => (
                          <li key={`${p.id}-v-${i}`}>
                            {v.message} <span>limit {v.limit}</span>{' '}
                            <span>actual {v.actual}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {p.override && p.override.granted === null && (
                    <div className={styles.overrideCard}>
                      <p className={styles.overrideTitle}>
                        Your agent is asking you to bend a rule
                      </p>
                      <blockquote className={styles.rationale}>{p.override.argument}</blockquote>
                      <div className={styles.actions}>
                        <button
                          type="button"
                          className={styles.primary}
                          onClick={() => decideOverride(p.id, true)}
                        >
                          Allow once
                        </button>
                        <button
                          type="button"
                          className={styles.ghost}
                          onClick={() => decideOverride(p.id, false)}
                        >
                          Keep the rule
                        </button>
                      </div>
                    </div>
                  )}

                  {p.status === 'pending' && (
                    <div className={styles.decide}>
                      <input
                        className={styles.note}
                        placeholder="Note back to the agent (optional)"
                        value={noteDraft[p.id] ?? ''}
                        onChange={(e) =>
                          setNoteDraft((d) => ({ ...d, [p.id]: e.target.value }))
                        }
                      />
                      <div className={styles.actions}>
                        <button
                          type="button"
                          className={styles.primary}
                          onClick={() => decide(p.id, 'approved')}
                          disabled={blocked}
                          title={
                            blocked
                              ? 'Locked: this proposal breaks your mandate. Allow the override, or edit your mandate.'
                              : undefined
                          }
                        >
                          {blocked ? 'Approve (locked)' : 'Approve'}
                        </button>
                        <button
                          type="button"
                          className={styles.ghost}
                          onClick={() => decide(p.id, 'rejected')}
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  )}

                  {p.humanNote && <p className={styles.humanNote}>You said: “{p.humanNote}”</p>}

                  {p.status === 'approved' && legs.length > 0 && (
                    <div className={styles.handoff}>
                      <p className={styles.handoffTitle}>
                        Sign it where you keep your keys
                        {legs.length > 1 ? ` · ${legs.length} legs, in order` : ''}
                      </p>
                      {legs.map((leg, i) => {
                        const h = buildHandoff(leg);
                        return (
                          <div className={styles.actions} key={`${p.id}-h-${i}`}>
                            <a
                              className={styles.primary}
                              href={h.terminalUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {legs.length > 1 ? `Leg ${i + 1} in Terminal` : 'Open in Terminal'}
                            </a>
                            <button
                              type="button"
                              className={styles.ghost}
                              onClick={() => copy(`${p.id}-${i}`, h.telegramCommand)}
                            >
                              {copied === `${p.id}-${i}` ? 'Copied' : `Copy ${h.telegramCommand}`}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {p.status === 'approved' && p.kind === 'alert' && (
                    <div className={styles.handoff}>
                      <p className={styles.handoffTitle}>Arm it in the bot</p>
                      <div className={styles.actions}>
                        <a
                          className={styles.primary}
                          href={TELEGRAM_URL}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Open Telegram bot
                        </a>
                        <button
                          type="button"
                          className={styles.ghost}
                          onClick={() =>
                            copy(
                              p.id,
                              `/a ${p.alert?.symbol} ${p.alert?.direction} ${p.alert?.targetPrice}`,
                            )
                          }
                        >
                          {copied === p.id ? 'Copied' : 'Copy alert command'}
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        {/* ── Activity ───────────────────────────────────────────── */}
        <section id="desk-activity" className={styles.panel}>
          <div className={styles.mandateHead}>
            <div>
              <h2 className={styles.panelTitle}>Activity</h2>
              <p className={styles.panelNote}>
                Every tool call the agent makes on this page, in the open.
              </p>
            </div>
            <button
              type="button"
              className={styles.ghost}
              onClick={() => {
                downloadReceipt();
                log('human', 'Receipt downloaded', 'session exported');
              }}
              disabled={proposals.length === 0 && activity.length === 0}
            >
              Download receipt
            </button>
          </div>
          {mcp.tools.length > 0 && (
            <ul className={styles.toolChips}>
              {mcp.tools.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          )}
          {activity.length === 0 && <p className={styles.empty}>Nothing yet.</p>}
          <ol className={styles.log}>
            {activity.map((a) => (
              <li key={a.id} className={a.isError ? styles.logError : undefined}>
                <span className={styles.logTime}>{clock(a.at)}</span>
                <span className={styles.logActor} data-actor={a.actor}>
                  {a.actor}
                </span>
                <span className={styles.logLabel}>{a.label}</span>
                <span className={styles.logDetail}>{a.detail}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}

/**
 * Register one tool for exactly as long as `active` holds. Extracted because
 * the desk does this twice and the teardown ordering is easy to get wrong.
 */
function useDynamicTool(
  ctxRef: React.RefObject<ModelContextLike | null>,
  controller: DeskController,
  active: boolean,
  register: (ctx: ModelContextLike, ctrl: DeskController) => Promise<() => void>,
  toolName: string,
  setMcp: React.Dispatch<
    React.SetStateAction<{ state: 'checking' | 'connected' | 'unsupported'; tools: string[] }>
  >,
) {
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx || !active) return;
    let dispose: (() => void) | null = null;
    let cancelled = false;
    register(ctx, controller)
      .then((d) => {
        if (cancelled) {
          d();
          return;
        }
        dispose = d;
        setMcp((prev) =>
          prev.tools.includes(toolName) ? prev : { ...prev, tools: [...prev.tools, toolName] },
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      dispose?.();
      setMcp((prev) => ({ ...prev, tools: prev.tools.filter((t) => t !== toolName) }));
    };
  }, [active, controller, ctxRef, register, setMcp, toolName]);
}
