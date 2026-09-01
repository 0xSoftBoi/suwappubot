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
  type MandateRuleKey,
  type MandateVerdict,
} from './mandate';
import {
  getModelContext,
  registerDeskTools,
  registerHandoffTool,
  registerOverrideTool,
  webmcpAttrs,
  type DeskController,
  type ModelContextLike,
  type WebMCPSubmitEvent,
} from './webmcp';

/** Agent-authored free text is untrusted — it always renders quoted and labeled. */
function AgentQuote({ text }: { text: string }) {
  return (
    <blockquote className={styles.rationale}>
      <span className={styles.agentText}>agent-written, unverified</span>
      {text}
    </blockquote>
  );
}

/**
 * The tool-*result* sibling of `AgentQuote`: whenever a rationale or override
 * argument the agent wrote earlier is re-fed to the model (via read_desk,
 * check_approval, or export_receipt), it is wrapped in this shape instead of
 * handed back as a bare string, so the model can't mistake its own earlier
 * persuasive text for a new instruction (Hines et al., arXiv:2403.14720;
 * Wu et al., IsolateGPT arXiv:2403.04960). The human-facing render above is
 * unaffected — it always worked from the raw string in component state.
 */
interface AgentWrittenText {
  agentWritten: true;
  unverified: true;
  text: string;
}
const agentWritten = (text: string): AgentWrittenText => ({
  agentWritten: true,
  unverified: true,
  text,
});
import styles from './agent-desk.module.css';
import DeskFlow from './DeskFlow';
import { fmtAmount, fmtDuration, fmtUsd, hopChainLabel, num } from './format';
import RouteDossier, {
  CompactFlow,
  specFromPlanLegs,
  specFromPreview,
} from './RouteDossier';

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
  /** True when this leg sells the previous swap leg's estimated output
      (`amount: "@prev"`) — a chained relay, not new money entering the plan. */
  chainedFromPrevious?: boolean;
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
  /** Envelope version this proposal was judged under, captured at creation. */
  mandateVersion: number;
  humanNote: string | null;
  decidedAt: number | null;
  consumedAt: number | null;
  /** Swap legs the human has marked signed, in order. Plans hand off one leg
      at a time: the next leg's link does not exist until this advances. */
  legsSigned?: number;
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
const SESSION_KEY = 'suwappu.desk.session.v1';
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


/** How many legs the routed quote really is. 1 when the API predates hops. */
const hopCountOf = (p: SwapPreview | null | undefined): number =>
  p ? (p.hopCount ?? p.hops?.length ?? 1) : 0;

/**
 * One compact line per route leg, for tool results and the receipt. Most
 * cross-chain routes are more than one transaction — a swap, a bridge relay,
 * another swap — and an agent sizing or explaining a trade needs each leg,
 * not a flattened tool-name string.
 */
function hopLines(p: SwapPreview | null | undefined): string[] {
  if (!p) return [];
  if (!Array.isArray(p.hops) || p.hops.length === 0) return [p.route];
  return p.hops.map((h) => {
    const verb = h.type === 'cross' ? 'relay' : h.type === 'swap' ? 'swap' : h.type;
    const where =
      h.fromChain && h.toChain && h.fromChain !== h.toChain
        ? ` (${hopChainLabel(h.fromChain, h.toChain)})`
        : h.fromChain
          ? ` on ${h.fromChain}`
          : '';
    const sold = h.fromToken
      ? `${h.fromAmount ? `${fmtAmount(h.fromAmount)} ` : ''}${h.fromToken}`
      : '';
    const bought = h.toToken
      ? `${h.toAmount ? `${fmtAmount(h.toAmount)} ` : ''}${h.toToken}`
      : '';
    const tokens = sold && bought ? `: ${sold} → ${bought}` : '';
    return `${h.index + 1}. ${verb} via ${h.toolName || h.tool}${where}${tokens}`;
  });
}

const clock = (at: number) =>
  new Date(at).toLocaleTimeString('en-US', { hour12: false });

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
 * Groups a plan's swap legs into relays: each non-chained leg starts a
 * sequence, each chained leg extends the current one. Only multi-leg
 * sequences are returned; a lone leg has no chain to draw. Derived on
 * render (never stored) so rehydrated sessions can't drift.
 */
function chainedPlanSequences(steps: PlanStep[]): PlanStep[][] {
  const sequences: PlanStep[][] = [];
  for (const s of steps) {
    if (!s.swap) continue;
    if (s.chainedFromPrevious && sequences.length > 0) {
      sequences[sequences.length - 1].push(s);
    } else {
      sequences.push([s]);
    }
  }
  return sequences.filter((seq) => seq.length > 1);
}

/**
 * Anderson et al., CHI 2015: habituation to a repeated identical warning
 * collapses by the second exposure — visual variation restores attention.
 * Each mandate rule gets its own glyph/heading; the rule/limit/actual detail
 * rows stay exactly as they are (that density is load-bearing).
 */
const BREACH_META: Record<MandateRuleKey, { glyph: string; heading: string }> = {
  perTradeUsdCap: { glyph: '$', heading: 'Over your per-trade cap' },
  dailyUsdCap: { glyph: 'Σ', heading: "Over today's budget" },
  allowedChains: { glyph: '⇄', heading: "Chain isn't on your allow-list" },
  allowedBuyTokens: { glyph: '◈', heading: "Token isn't on your allow-list" },
  maxPriceImpactPercent: { glyph: '▲', heading: 'Price impact is too high' },
  maxSlippagePercent: { glyph: '≈', heading: 'Slippage tolerance is too high' },
};

/**
 * evaluateMandate() pushes violations in priority order (caps, then chain,
 * then token, then impact, then slippage), so the first entry is already the
 * most severe rule broken — that one leads the card; every violation still
 * lists below, unchanged.
 */
const primaryBreach = (verdict: MandateVerdict | null) => {
  const rule = verdict?.violations[0]?.rule;
  return rule ? { rule, ...BREACH_META[rule] } : null;
};

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
    state: 'checking' | 'connected' | 'unsupported' | 'paused';
    tools: string[];
  }>({ state: 'checking', tools: [] });
  /** The take-control switch: pausing withdraws EVERY tool from
      document.modelContext (one abort), so a paused agent has nothing left
      to call — not even reads. The page keeps working by hand. */
  const [paused, setPaused] = useState(false);
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [mandateOpen, setMandateOpen] = useState(false);
  const [lastTool, setLastTool] = useState<string | null>(null);

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
    (patch: Partial<Mandate> | ((prev: Mandate) => Mandate)) => {
      setMandate((prev) => {
        const next = typeof patch === 'function' ? patch(prev) : { ...prev, ...patch };
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

  // The session survives a reload: proposals and the activity log rehydrate
  // from this browser's storage, so a refresh never silently eats the
  // receipt. Pending proposals past their TTL are expired by the existing
  // sweep; decided ones persist as history.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SESSION_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { proposals?: Proposal[]; activity?: ActivityEntry[] };
      const restoredProposals = Array.isArray(parsed.proposals)
        ? parsed.proposals.filter((p) => p && typeof p.id === 'string')
        : [];
      const restoredActivity = Array.isArray(parsed.activity)
        ? parsed.activity.filter((a) => a && typeof a.id === 'string').slice(0, 80)
        : [];
      if (restoredProposals.length === 0 && restoredActivity.length === 0) return;
      proposalsRef.current = restoredProposals;
      setProposals(restoredProposals);
      setActivity([
        {
          id: nextId('act'),
          at: Date.now(),
          actor: 'human' as const,
          label: 'Session restored',
          detail: `${restoredProposals.length} proposals and ${restoredActivity.length} log entries survived the reload`,
          isError: false,
        },
        ...restoredActivity,
      ]);
    } catch {
      /* private mode, blocked storage — start fresh */
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(SESSION_KEY, JSON.stringify({ proposals, activity }));
    } catch {
      /* private mode — the session just won't survive a reload */
    }
  }, [proposals, activity]);

  // Mandate persists per browser so a returning human keeps their envelope.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(MANDATE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Mandate>;
        if (!Number.isInteger(parsed.version) || (parsed.version as number) < 1) {
          delete parsed.version;
        }
        setMandate({ ...DEFAULT_MANDATE, ...parsed });
      }
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
          const prevVersion = mandateRef.current.version;
          const nextMandate = applyAmendment(mandateRef.current, decided.amendment.changes);
          // Write from the updater's own prev so a concurrent panel edit can
          // never be clobbered by a stale ref snapshot.
          const changes = decided.amendment.changes;
          updateMandate((prev) => applyAmendment(prev, changes));
          log(
            'human',
            'Mandate amended',
            `v${prevVersion} → v${nextMandate.version}; ` +
              decided.amendment.diffs
                .map((d) => `${d.field}: ${d.from} → ${d.to} (${d.direction})`)
                .join('; '),
          );
        }
        settle(decided);
        log(
          'human',
          status === 'approved' ? 'Approved proposal' : 'Rejected proposal',
          `${decided.id}${decided.humanNote ? `: "${decided.humanNote}"` : ''}`,
        );
      }
    },
    [commitProposals, log, noteDraft, settle, updateMandate],
  );

  /** The human confirms a plan leg was signed; only then does the next leg's
      handoff link come into existence. Marking the final leg retires the
      approval, exactly like a spent single-swap handoff. */
  const markLegSigned = useCallback(
    (id: string) => {
      const current = proposalsRef.current.find((p) => p.id === id);
      if (!current || current.status !== 'approved' || current.consumedAt !== null) return;
      const legTotal = (current.plan?.steps ?? []).filter((s) => s.swap).length;
      const signed = (current.legsSigned ?? 0) + 1;
      commitProposals((prev) =>
        prev.map((p) =>
          p.id === id
            ? {
                ...p,
                legsSigned: signed,
                consumedAt: signed >= legTotal ? Date.now() : p.consumedAt,
              }
            : p,
        ),
      );
      log(
        'human',
        `Leg ${signed} of ${legTotal} signed`,
        signed >= legTotal
          ? `${id}: plan fully signed; the handoff is spent`
          : `${id}: leg ${signed + 1} is now unlocked`,
      );
    },
    [commitProposals, log],
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
        `${id}: mandate exception ${granted ? 'allowed once' : 'refused'}`,
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
        mandateVersion: p.mandateVersion,
        agentRationale: agentWritten(p.rationale),
        notionalUsd: notionalOf(p),
        mandate: p.verdict
          ? {
              withinMandate: p.verdict.withinMandate,
              violations: p.verdict.violations,
            }
          : null,
        override: p.override ? { ...p.override, argument: agentWritten(p.override.argument) } : null,
        humanDecision: p.status,
        humanNote: p.humanNote,
        decidedAt: p.decidedAt ? new Date(p.decidedAt).toISOString() : null,
        handedOffAt: p.consumedAt ? new Date(p.consumedAt).toISOString() : null,
      })),
      toolCalls: activityRef.current
        .filter((a) => a.actor === 'agent')
        // detail serializes agent-supplied arguments, so it is agent-authored
        // by construction and re-feeds wrapped, like every other echo.
        .map((a) => ({ at: new Date(a.at).toISOString(), entry: a.label, detail: agentWritten(a.detail) }))
        .reverse(),
      humanActivity: activityRef.current
        .filter((a) => a.actor === 'human')
        .map((a) => ({ at: new Date(a.at).toISOString(), entry: a.label, detail: a.detail }))
        .reverse(),
    };
  }, [spentToday]);

  /**
   * P1.1: the `format:"json"` shape for `export_receipt` — a schemaVersion-
   * stamped, machine-parseable object (Chan et al., "Visibility into AI
   * Agents", arXiv:2401.13138) built from the same state as `buildReceipt`
   * above rather than new tracking. Every agent-written field is wrapped
   * per P1.2 (`agentWritten`, above).
   */
  const buildReceiptJson = useCallback(() => {
    const list = proposalsRef.current;
    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      surface: 'Suwappu Agent Desk (WebMCP)',
      custody:
        'This desk never signs. Every entry below is a proposal and a human decision, not an onchain action.',
      mandate: describeMandate(mandateRef.current, spentToday(list)),
      proposals: list.map((p) => ({
        id: p.id,
        kind: p.kind,
        status: p.status,
        createdAt: new Date(p.createdAt).toISOString(),
        expiresAt: new Date(p.expiresAt).toISOString(),
        decidedAt: p.decidedAt ? new Date(p.decidedAt).toISOString() : null,
        consumedAt: p.consumedAt ? new Date(p.consumedAt).toISOString() : null,
        mandateVersion: p.mandateVersion,
        rationale: agentWritten(p.rationale),
        notionalUsd: notionalOf(p),
        ...(p.swap
          ? {
              swap: {
                sell: `${p.swap.amount} ${p.swap.fromToken} on ${p.swap.fromChain}`,
                buy: `${p.swap.toToken} on ${p.swap.toChain}`,
                slippagePercent: p.swap.slippagePercent ?? null,
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
                  note: s.note ? agentWritten(s.note) : null,
                  chainedFromPrevious: s.chainedFromPrevious ?? false,
                  summary: s.swap
                    ? `${s.chainedFromPrevious ? '↳ ' : ''}${s.swap.amount} ${s.swap.fromToken} (${s.swap.fromChain}) → ${s.swap.toToken} (${s.swap.toChain})`
                    : s.alert
                      ? `${s.alert.symbol} ${s.alert.direction} ${fmtUsd(s.alert.targetPrice)}`
                      : null,
                })),
              },
            }
          : {}),
        mandateVerdict: p.verdict
          ? { withinMandate: p.verdict.withinMandate, violations: p.verdict.violations }
          : null,
        humanDecision: { decision: p.status, note: p.humanNote },
        override: p.override
          ? {
              argument: agentWritten(p.override.argument),
              askedAt: new Date(p.override.askedAt).toISOString(),
              outcome:
                p.override.granted === true
                  ? 'granted'
                  : p.override.granted === false
                    ? 'denied'
                    : 'pending',
            }
          : null,
        amendment: p.amendment
          ? {
              diffs: p.amendment.diffs,
              loosenedFields: p.amendment.diffs
                .filter((d) => d.direction === 'looser')
                .map((d) => d.field),
            }
          : null,
      })),
      toolCallActivity: activityRef.current
        .filter((a) => a.actor === 'agent')
        // detail serializes agent-supplied arguments — wrapped like every echo.
        .map((a) => ({ at: new Date(a.at).toISOString(), entry: a.label, detail: agentWritten(a.detail) }))
        .reverse(),
      humanActivity: activityRef.current
        .filter((a) => a.actor === 'human')
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
      rationale: agentWritten(p.rationale),
      humanNote: p.humanNote,
      notionalUsd: notionalOf(p),
      mandate: describeVerdict(p.verdict),
      blocked: isBlocked(p),
      override: p.override ? { ...p.override, argument: agentWritten(p.override.argument) } : null,
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
              hopCount: p.swap.preview ? hopCountOf(p.swap.preview) : null,
              hops: p.swap.preview ? hopLines(p.swap.preview) : null,
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
                chainedFromPrevious: s.chainedFromPrevious ?? false,
                summary: s.swap
                  ? `${s.chainedFromPrevious ? '↳ ' : ''}${s.swap.amount} ${s.swap.fromToken} (${s.swap.fromChain}) → ${s.swap.toToken} (${s.swap.toChain})`
                  : s.alert
                    ? `${s.alert.symbol} ${s.alert.direction} ${fmtUsd(s.alert.targetPrice)}`
                    : null,
                hopCount: s.swap?.preview ? hopCountOf(s.swap.preview) : null,
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
          ? 'Approve is LOCKED: this breaks the human\'s mandate. Either propose something inside the envelope, or call request_override with your argument for bending the named rule.'
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
          hopCount: hopCountOf(p),
          hops: hopLines(p),
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
            hopCount: r.preview ? hopCountOf(r.preview) : null,
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
                hopCount: hopCountOf(p),
                hops: hopLines(p),
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
            'rationale is required: you are asking to change the rules the human set.',
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
          mandateVersion: mandateRef.current.version,
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
            'The human sees a before/after diff with every loosened rule flagged. If they approve, the mandate changes here and persists. This is the one thing on the desk that completes in place. Poll check_approval.',
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
          source: 'Suwappu Agent Desk (WebMCP): negotiated mandate',
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
            : 'Outside the envelope. Adjust size, chain or token and check again, or propose it anyway and argue for an override.',
          silent: true,
        };
      },

      async proposeSwap(args) {
        if (!args.rationale.trim()) {
          throw new Error(
            'rationale is required: the human has to read why you want this trade.',
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
          mandateVersion: mandateRef.current.version,
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
        // The last priced swap leg, so `amount: "@prev"` can chain: leg N
        // sells what leg N-1 is estimated to deliver. This is what makes a
        // plan a real multi-hop relay instead of N unrelated tickets.
        let prevSwap: SwapBody | null = null;
        for (const raw of args.steps) {
          const kind = String(raw.kind ?? 'swap') === 'alert' ? 'alert' : 'swap';
          const note = raw.note ? String(raw.note) : null;
          if (kind === 'swap') {
            const rawAmount = String(raw.amount ?? '').trim();
            const chained = /^@?prev(ious)?$/i.test(rawAmount);
            if (chained) {
              if (!prevSwap) {
                throw new Error('amount "@prev" needs an earlier swap step to chain from');
              }
              if (!prevSwap.preview) {
                throw new Error(
                  `cannot chain from the previous swap step: it failed to price (${prevSwap.previewError ?? 'no quote'})`,
                );
              }
            }
            const prevOut = chained ? prevSwap!.preview! : null;
            const t: Ticket = {
              fromChain: String(
                raw.fromChain ?? (chained ? prevSwap!.toChain : ticketRef.current.fromChain),
              ),
              toChain: String(
                raw.toChain ??
                  raw.fromChain ??
                  (chained ? prevSwap!.toChain : ticketRef.current.toChain),
              ),
              fromToken: String(raw.fromToken ?? (prevOut ? prevOut.toToken.symbol : '')),
              toToken: String(raw.toToken ?? ''),
              amount: chained ? prevOut!.toAmount : rawAmount,
              slippagePercent:
                typeof raw.slippagePercent === 'number'
                  ? raw.slippagePercent
                  : ticketRef.current.slippagePercent,
              order: 'RECOMMENDED',
            };
            if (!t.fromToken || !t.toToken || !t.amount) {
              throw new Error('every swap step needs fromToken, toToken and amount');
            }
            // A chained leg must actually pick up where the last one lands —
            // otherwise "@prev" would quietly price a trade that can't follow.
            if (chained && prevOut) {
              if (t.fromToken.toLowerCase() !== prevOut.toToken.symbol.toLowerCase()) {
                throw new Error(
                  `chained step sells ${t.fromToken} but the previous leg delivers ${prevOut.toToken.symbol}`,
                );
              }
              if (t.fromChain !== prevSwap!.toChain) {
                throw new Error(
                  `chained step starts on ${t.fromChain} but the previous leg lands on ${prevSwap!.toChain}`,
                );
              }
            }
            const body = await priceOne(t);
            steps.push({ kind, note, swap: body, verdict: judge(body), chainedFromPrevious: chained });
            prevSwap = body;
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

        // Combined notional counts NEW money only: a chained leg re-trades
        // value an earlier leg already brought in, so summing it again would
        // double-charge the daily cap for a single multi-hop relay.
        const priced = steps
          .filter((s) => !s.chainedFromPrevious)
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
          mandateVersion: mandateRef.current.version,
          humanNote: null,
          decidedAt: null,
          consumedAt: null,
          plan: { steps, combinedUsd },
          verdict: rollup,
          override: null,
        };
        const chainedLegs = steps.filter((s) => s.chainedFromPrevious).length;
        return {
          ...addProposal(proposal),
          shownToHuman: {
            steps: steps.length,
            combinedUsd,
            legs: steps.map((s) =>
              s.swap
                ? `${s.chainedFromPrevious ? '↳ ' : ''}${s.swap.amount} ${s.swap.fromToken} → ${s.swap.toToken}`
                : `alert ${s.alert?.symbol} ${s.alert?.direction} ${s.alert?.targetPrice}`,
            ),
          },
          ...(chainedLegs > 0
            ? {
                chaining:
                  `${chainedLegs} leg(s) sell the previous leg's estimated output. ` +
                  'Amounts are indicative: what a later leg really trades is what the earlier leg actually delivers at signing, and the human signs one leg at a time in order.',
              }
            : {}),
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
          mandateVersion: mandateRef.current.version,
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
            'That proposal is not blocked by the mandate; no override is needed.',
          );
        }
        if (proposal.override) {
          throw new Error(
            'You already asked for an override on this proposal. Wait for the human, or propose something inside the envelope.',
          );
        }
        if (!argument.trim()) {
          throw new Error('argument is required: say why the rule should be bent.');
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
          next: 'The human sees your argument beside the rule you broke. Poll check_approval. If they deny the override, Approve stays locked and you should propose something that fits instead.',
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
        if (proposal.kind === 'plan') {
          // Plans are SEQUENCED: one leg at a time, in order. The next leg's
          // link does not exist until the human marks the current one signed
          // on the desk, and marking the final leg spends the approval.
          const signed = proposal.legsSigned ?? 0;
          const current = legs[signed];
          return {
            proposalId,
            plan: {
              legTotal: legs.length,
              legIndex: signed + 1,
              legsSigned: signed,
              sequencing:
                'One leg at a time, in order. This call is idempotent for the current leg; the next link exists only after the human marks this leg signed on the desk.',
            },
            handoff: [buildHandoff(current)],
            custody:
              'Suwappu does not sign from this page. The link opens a surface the human controls, pre-filled with this leg; they still confirm and sign there.',
          };
        }
        commitProposals((prev) =>
          prev.map((p) => (p.id === proposalId ? { ...p, consumedAt: Date.now() } : p)),
        );
        return {
          proposalId,
          handoff: legs.map(buildHandoff),
          custody:
            'Suwappu does not sign from this page. Each link opens a surface the human controls, pre-filled with the approved trade; they still confirm and sign there.',
        };
      },

      exportReceipt({ download, format }) {
        const useJson = format === 'json';
        const receipt = useJson ? buildReceiptJson() : buildReceipt();
        if (download) {
          downloadJson(receipt, useJson ? 'suwappu-agent-desk-receipt-json' : 'suwappu-agent-desk-receipt');
          log(
            'agent',
            'Receipt downloaded',
            `agent handed the human a copy of the session (${useJson ? 'json' : 'default'} format)`,
          );
        }
        return receipt;
      },

      onToolCall(name, args) {
        setLastTool(name);
        log('agent', `→ ${name}`, JSON.stringify(args));
      },

      onToolResult(name, summary, isError) {
        log('agent', `← ${name}`, summary, isError);
      },
    };
  }, [
    buildReceipt,
    buildReceiptJson,
    commitProposals,
    downloadJson,
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
    if (paused) {
      setMcp({ state: 'paused', tools: [] });
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
  }, [controller, log, paused]);

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

  useDynamicTool(ctxRef, controller, hasUnlockedHandoff && !paused, registerHandoffTool, 'open_signing_handoff', setMcp);
  useDynamicTool(ctxRef, controller, hasBlockedProposal && !paused, registerOverrideTool, 'request_override', setMcp);

  const togglePause = useCallback(() => {
    setPaused((was) => {
      log(
        'human',
        was ? 'Agent resumed' : 'AGENT PAUSED',
        was
          ? 'tools re-registering on document.modelContext'
          : 'every tool withdrawn from document.modelContext; the desk still works by hand',
      );
      return !was;
    });
  }, [log]);

  // ── Manual controls ──────────────────────────────────────────────

  const onTicketSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const read = (key: string, fallback: string) => {
      const v = fd.get(key);
      return typeof v === 'string' && v.trim() !== '' ? v.trim() : fallback;
    };
    const t: Ticket = {
      ...ticketRef.current,
      fromChain: read('fromChain', ticketRef.current.fromChain),
      toChain: read('toChain', ticketRef.current.toChain),
      fromToken: read('fromToken', ticketRef.current.fromToken).toUpperCase(),
      toToken: read('toToken', ticketRef.current.toToken).toUpperCase(),
      amount: read('amount', ticketRef.current.amount),
      slippagePercent:
        Number.parseFloat(read('slippagePercent', '')) || ticketRef.current.slippagePercent,
    };
    setTicket(t);
    log('human', 'Manual quote', `${t.amount} ${t.fromToken} → ${t.toToken}`);
    // On failure the human sees previewError, and the agent that drove the
    // submit gets the same structured { error } shape every other tool returns.
    const pricing = runPreview(t).catch((e: unknown) => ({
      error: e instanceof Error ? e.message : String(e),
    }));
    // Declarative WebMCP: when an engine drove this submit, hand the priced
    // ticket back as the tool result instead of making it scrape the DOM.
    const native = e.nativeEvent as WebMCPSubmitEvent;
    if (typeof native.respondWith === 'function') native.respondWith(pricing);
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
                : mcp.state === 'paused'
                  ? styles.pillPaused
                  : styles.pillOff
          }`}
        >
          {mcp.state === 'connected'
            ? `WebMCP connected · ${mcp.tools.length} site tools`
            : mcp.state === 'checking'
              ? 'Looking for an agent…'
              : mcp.state === 'paused'
                ? 'AGENT PAUSED · 0 tools'
                : 'No WebMCP in this browser'}
        </span>
        <p className={styles.statusCopy}>
          {mcp.state === 'connected'
            ? 'An agent in this browser can read your mandate, price routes and propose trades against it. It cannot sign, and it cannot approve.'
            : mcp.state === 'paused'
              ? 'You took control. Every tool has been withdrawn from document.modelContext; a paused agent has nothing left to call, not even reads. The desk still works by hand.'
              : 'Open this page in ChatGPT Atlas (or Chrome with WebMCP enabled) to let an agent drive it. Everything below still works by hand.'}
        </p>
        {(mcp.state === 'connected' || mcp.state === 'paused') && (
          <button
            type="button"
            className={paused ? styles.primary : styles.ghost}
            onClick={togglePause}
          >
            {paused ? 'Resume agent' : 'Pause agent'}
          </button>
        )}
      </section>

      <DeskFlow
        lastTool={lastTool}
        status={{
          state: mcp.state,
          tools: mcp.tools.length,
          pending: pending.length,
          calls: activity.filter((a) => a.actor === 'agent' && a.label.startsWith('→')).length,
        }}
      />

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
            <div className={styles.mandateActions}>
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
                className={styles.primary}
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
              <span>
                <strong>{fmtUsd(remaining)}</strong> of {fmtUsd(mandate.dailyUsdCap)} left today
              </span>
              <span>max {fmtUsd(mandate.perTradeUsdCap)} per trade</span>
              <span>impact ≤ {mandate.maxPriceImpactPercent}%</span>
              <span>slippage ≤ {mandate.maxSlippagePercent}%</span>
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
                  {mandate.allowedChains.length ? mandate.allowedChains.join(', ') : 'any'}
                </strong>
              </li>
              <li>
                <span>May buy</span>
                <strong>
                  {mandate.allowedBuyTokens.length
                    ? mandate.allowedBuyTokens.join(', ')
                    : 'any token'}
                </strong>
              </li>
            </ul>
          )}

          <p className={styles.finePrint}>
            This desk never executes, so the mandate cannot physically cap spending. It governs
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
          <form
            onSubmit={onTicketSubmit}
            {...webmcpAttrs({
              toolname: 'fill_and_price_ticket',
              tooldescription:
                'Fill the shared swap ticket and price it against the live cross-chain routing engine. Pricing attaches the mandate verdict; it proposes nothing and spends nothing.',
            })}
          >
            <div className={styles.ticketGrid}>
              <label className={styles.field}>
                <span>Sell</span>
                <input
                  name="amount"
                  value={ticket.amount}
                  inputMode="decimal"
                  onChange={(e) => setTicket((t) => ({ ...t, amount: e.target.value }))}
                  {...webmcpAttrs({
                    toolparamdescription: 'Human-readable amount of the token being sold.',
                  })}
                />
              </label>
              <label className={styles.field}>
                <span>Token</span>
                <input
                  name="fromToken"
                  value={ticket.fromToken}
                  onChange={(e) =>
                    setTicket((t) => ({ ...t, fromToken: e.target.value.toUpperCase() }))
                  }
                  {...webmcpAttrs({
                    toolparamdescription: 'Ticker of the token being sold, e.g. ETH.',
                  })}
                />
              </label>
              <label className={styles.field}>
                <span>From chain</span>
                <select
                  name="fromChain"
                  value={ticket.fromChain}
                  onChange={(e) => setTicket((t) => ({ ...t, fromChain: e.target.value }))}
                  {...webmcpAttrs({
                    toolparamdescription: 'Source chain key.',
                  })}
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
                  name="toToken"
                  value={ticket.toToken}
                  onChange={(e) =>
                    setTicket((t) => ({ ...t, toToken: e.target.value.toUpperCase() }))
                  }
                  {...webmcpAttrs({
                    toolparamdescription: 'Ticker of the token being bought.',
                  })}
                />
              </label>
              <label className={styles.field}>
                <span>To chain</span>
                <select
                  name="toChain"
                  value={ticket.toChain}
                  onChange={(e) => setTicket((t) => ({ ...t, toChain: e.target.value }))}
                  {...webmcpAttrs({
                    toolparamdescription: 'Destination chain key.',
                  })}
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
                  name="slippagePercent"
                  value={String(ticket.slippagePercent)}
                  inputMode="decimal"
                  onChange={(e) =>
                    setTicket((t) => ({
                      ...t,
                      slippagePercent: Number.parseFloat(e.target.value) || t.slippagePercent,
                    }))
                  }
                  {...webmcpAttrs({
                    toolparamdescription: 'Maximum slippage in percent.',
                  })}
                />
              </label>
            </div>
            <div className={styles.actions}>
            <button
              type="submit"
              className={styles.primary}
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
          </form>

          {previewError && <p className={styles.error}>{previewError}</p>}

          {comparison && (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Preference</th>
                    <th>Out</th>
                    <th>Gas</th>
                    <th>Time</th>
                    <th>Legs</th>
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
                          : '-'}
                      </td>
                      <td>{row.preview ? fmtUsd(row.preview.estimatedGasUsd) : '-'}</td>
                      <td>
                        {row.preview ? fmtDuration(row.preview.estimatedDurationSeconds) : '-'}
                      </td>
                      <td>{row.preview ? hopCountOf(row.preview) : '-'}</td>
                      <td>{row.preview?.route ?? row.error ?? '-'}</td>
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

        {/* ── The priced route, full width: the dossier needs the whole
              canvas the way the flow instrument above does. ── */}
        {preview && !comparison && (
          <div className={styles.fullRow}>
            <RouteDossier
              preview={preview}
              verdict={judge({ ...ticket, preview, previewError: null })}
              slippagePercent={ticket.slippagePercent}
            />
          </div>
        )}

        {/* ── Approvals ──────────────────────────────────────────── */}
        <section id="desk-approvals" className={`${styles.panel} ${styles.fullRow}`}>
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
              const breach = primaryBreach(p.verdict);
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

                  {p.swap?.preview && (
                    <p className={styles.impactStrip}>
                      <span>
                        floor ≥ {fmtAmount(p.swap.preview.toAmountMin)}{' '}
                        {p.swap.preview.toToken.symbol}
                      </span>
                      <span>impact {p.swap.preview.priceImpact}%</span>
                      <span>gas {fmtUsd(p.swap.preview.estimatedGasUsd)}</span>
                      <span>settles in {fmtDuration(p.swap.preview.estimatedDurationSeconds)}</span>
                    </p>
                  )}

                  {/* A cross-chain trade is usually more than one transaction;
                      the card the human approves must show every leg — drawn
                      as the same value-flow instrument the quote uses. */}
                  {p.swap?.preview && hopCountOf(p.swap.preview) > 1 && (
                    <CompactFlow
                      spec={specFromPreview(p.swap.preview)}
                      ariaLabel="The route this proposal takes, leg by leg, with the fees each leg costs."
                    />
                  )}

                  {/* Chained legs form a relay: draw each multi-leg sequence
                      as a value flow, so the human sees leg 2 selling what
                      leg 1 delivers before approving the whole thing. */}
                  {p.plan &&
                    chainedPlanSequences(p.plan.steps).map((seq, si) => {
                      const spec = specFromPlanLegs(
                        seq.map((s) => ({
                          fromChain: s.swap!.fromChain,
                          toChain: s.swap!.toChain,
                          fromToken: s.swap!.fromToken,
                          toToken: s.swap!.toToken,
                          amount: s.swap!.amount,
                          preview: s.swap!.preview,
                        })),
                      );
                      return (
                        spec && (
                          <CompactFlow
                            key={`${p.id}-seq-${si}`}
                            spec={spec}
                            ariaLabel={`Chained relay ${si + 1}: ${seq.length} legs, each selling the previous leg's estimated output.`}
                            laneHeader={
                              <>
                                <b>RELAY {String(si + 1).padStart(2, '0')}</b>
                                <span>
                                  {seq.length} CHAINED LEGS · LATER LEGS SELL WHAT EARLIER LEGS
                                  DELIVER
                                </span>
                              </>
                            }
                          />
                        )
                      );
                    })}

                  {p.plan && (
                    <ol className={styles.planSteps}>
                      {p.plan.steps.map((s, i) => {
                        const legIdx = s.swap
                          ? p.plan!.steps.slice(0, i + 1).filter((x) => x.swap).length - 1
                          : -1;
                        const signedCount = p.legsSigned ?? 0;
                        const approved = p.status === 'approved';
                        const state = !s.swap
                          ? approved
                            ? 'arm'
                            : undefined
                          : !approved
                            ? undefined
                            : legIdx < signedCount
                              ? 'signed'
                              : legIdx === signedCount
                                ? 'active'
                                : 'locked';
                        return (
                          <li key={`${p.id}-${i}`} data-state={state}>
                            <span className={styles.planIndex}>
                              {state === 'signed' ? '✓' : i + 1}
                            </span>
                            <span className={styles.planStepBody}>
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
                              {s.note && <em className={styles.planNote}> ({s.note})</em>}
                              {s.chainedFromPrevious && (
                                <span className={styles.planTag}>
                                  chained · sells the previous leg&apos;s output
                                </span>
                              )}
                              {state === 'signed' && (
                                <span className={styles.planTag}>signed</span>
                              )}
                              {state === 'locked' && (
                                <span className={styles.planTag}>
                                  locked until leg {legIdx} is signed
                                </span>
                              )}
                              {state === 'active' && s.swap && (
                                <span className={styles.actions}>
                                  <a
                                    className={styles.primary}
                                    href={buildHandoff(s.swap).terminalUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    Sign leg {legIdx + 1} in Terminal
                                  </a>
                                  <button
                                    type="button"
                                    className={styles.ghost}
                                    onClick={() => markLegSigned(p.id)}
                                  >
                                    Mark leg {legIdx + 1} signed
                                  </button>
                                </span>
                              )}
                              {state === 'arm' && (
                                <span className={styles.actions}>
                                  <a
                                    className={styles.ghost}
                                    href={TELEGRAM_URL}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    Arm in the bot
                                  </a>
                                </span>
                              )}
                            </span>
                          </li>
                        );
                      })}
                      {p.plan.combinedUsd !== null && (
                        <li className={styles.planTotal}>
                          <span className={styles.planIndex}>Σ</span>
                          <span>
                            Combined notional <strong>{fmtUsd(p.plan.combinedUsd)}</strong>
                            {p.plan.steps.some((s) => s.chainedFromPrevious) && (
                              <> · chained legs re-trade earlier output, counted once</>
                            )}
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

                  <AgentQuote text={p.rationale} />

                  {p.verdict && !p.verdict.withinMandate && breach && (
                    <div className={styles.violations} data-breach={breach.rule}>
                      <p className={styles.violationsTitle}>
                        <span className={styles.breachGlyph} aria-hidden="true">
                          {breach.glyph}
                        </span>
                        {breach.heading}
                        {p.override?.granted === true ? ', but you allowed it once' : ''}
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
                    <div className={styles.overrideCard} data-breach={breach?.rule}>
                      <p className={styles.overrideTitle}>
                        Your agent is asking you to bend a rule
                      </p>
                      <AgentQuote text={p.override.argument} />
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

                  {p.status === 'approved' && p.kind !== 'plan' && legs.length > 0 && (
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
        <section id="desk-activity" className={`${styles.panel} ${styles.fullRow}`}>
          <div className={styles.mandateHead}>
            <div>
              <h2 className={styles.panelTitle}>Activity</h2>
              <p className={styles.panelNote}>
                Every tool call the agent makes on this page, in the open.
              </p>
            </div>
            {(proposals.length > 0 || activity.length > 0) && (
              <button
                type="button"
                className={styles.ghost}
                onClick={() => {
                  downloadReceipt();
                  log('human', 'Receipt downloaded', 'session exported');
                }}
              >
                Download receipt
              </button>
            )}
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
    React.SetStateAction<{
      state: 'checking' | 'connected' | 'unsupported' | 'paused';
      tools: string[];
    }>
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
