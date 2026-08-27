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
  getModelContext,
  registerDeskTools,
  registerHandoffTool,
  type DeskController,
  type ModelContextLike,
} from './webmcp';
import styles from './agent-desk.module.css';

// ── Types ───────────────────────────────────────────────────────────

interface Ticket {
  fromChain: string;
  toChain: string;
  fromToken: string;
  toToken: string;
  amount: string;
  slippagePercent: number;
  order: RouteOrder;
}

interface SwapProposalBody extends Ticket {
  preview: SwapPreview | null;
  previewError: string | null;
}

interface AlertProposalBody {
  symbol: string;
  direction: 'above' | 'below';
  targetPrice: number;
  spotAtProposal: number | null;
}

interface Proposal {
  id: string;
  kind: 'swap' | 'alert';
  rationale: string;
  createdAt: number;
  expiresAt: number;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  humanNote: string | null;
  decidedAt: number | null;
  consumedAt: number | null;
  swap?: SwapProposalBody;
  alert?: AlertProposalBody;
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
const STABLES = new Set(['USDC', 'USDT', 'DAI', 'USDS', 'FRAX', 'USDE']);

const DEFAULT_TICKET: Ticket = {
  fromChain: 'base',
  toChain: 'base',
  fromToken: 'ETH',
  toToken: 'USDC',
  amount: '0.25',
  slippagePercent: 0.5,
  order: 'RECOMMENDED',
};

let idSeq = 0;
function nextId(prefix: string): string {
  idSeq += 1;
  return `${prefix}_${Date.now().toString(36)}${idSeq.toString(36)}`;
}

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
  if (seconds < 90) return `${Math.round(seconds)}s`;
  return `${Math.round(seconds / 60)} min`;
}

function clock(at: number): string {
  return new Date(at).toLocaleTimeString('en-US', { hour12: false });
}

/**
 * The signing handoff. Suwappu never signs from this page — these are the two
 * real surfaces that own the user's keys, pre-filled with the approved trade.
 * `/alert-swap` prefills the terminal's ticket and still requires the human to
 * tap Buy/Sell; the bot command is copy-ready for Telegram.
 */
function buildHandoff(swap: SwapProposalBody) {
  const side = STABLES.has(swap.toToken.toUpperCase()) ? 'sell' : 'buy';
  const terminalUrl = `${TERMINAL_URL}/alert-swap?${new URLSearchParams({
    token: swap.fromToken,
    chain: swap.fromChain,
    side,
    amount: swap.amount,
    ref: 'webmcp-desk',
  })}`;
  const sameChain = swap.fromChain === swap.toChain;
  const telegramCommand = sameChain
    ? `/s ${swap.amount} ${swap.fromToken} ${swap.toToken}`
    : `/s ${swap.amount} ${swap.fromToken} ${swap.fromChain} ${swap.toToken} ${swap.toChain}`;
  return { terminalUrl, telegramCommand, telegramUrl: TELEGRAM_URL };
}

// ── Component ───────────────────────────────────────────────────────

export default function AgentDesk() {
  const [ticket, setTicket] = useState<Ticket>(DEFAULT_TICKET);
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

  // Live mirrors so the tool handlers (registered once) always read fresh state.
  const ticketRef = useRef(ticket);
  const previewRef = useRef(preview);
  const comparisonRef = useRef(comparison);
  const proposalsRef = useRef(proposals);
  const activityRef = useRef(activity);
  useEffect(() => {
    ticketRef.current = ticket;
  }, [ticket]);
  useEffect(() => {
    previewRef.current = preview;
  }, [preview]);
  useEffect(() => {
    comparisonRef.current = comparison;
  }, [comparison]);
  useEffect(() => {
    activityRef.current = activity;
  }, [activity]);

  // proposalId -> resolvers waiting inside check_approval(waitSeconds)
  const waiters = useRef(new Map<string, Set<(p: Proposal) => void>>());

  /**
   * Proposals are the one piece of state a tool call reads *and* writes inside
   * a single turn (propose -> approve -> hand off), so the ref is updated
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
        [
          { id: nextId('act'), at: Date.now(), actor, label, detail, isError },
          ...prev,
        ].slice(0, 60),
      );
    },
    [],
  );

  const settle = useCallback((proposal: Proposal) => {
    const set = waiters.current.get(proposal.id);
    if (!set) return;
    for (const resolve of set) resolve(proposal);
    waiters.current.delete(proposal.id);
  }, []);

  // ── Data helpers shared by the UI and the tools ───────────────────

  const runPreview = useCallback(
    async (t: Ticket, signal?: AbortSignal): Promise<SwapPreview> => {
      setPreviewBusy(true);
      setPreviewError(null);
      try {
        const result = await previewSwap(
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
        setPreview(result);
        setComparison(null);
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setPreview(null);
        setPreviewError(message);
        throw error;
      } finally {
        setPreviewBusy(false);
      }
    },
    [],
  );

  const runComparison = useCallback(
    async (t: Ticket, signal?: AbortSignal) => {
      const orders: RouteOrder[] = ['RECOMMENDED', 'FASTEST', 'CHEAPEST', 'SAFEST'];
      setPreviewBusy(true);
      setPreviewError(null);
      try {
        const rows = await Promise.all(
          orders.map(async (order) => {
            try {
              const p = await previewSwap(
                {
                  fromChain: t.fromChain,
                  toChain: t.toChain,
                  fromToken: t.fromToken,
                  toToken: t.toToken,
                  fromAmount: t.amount,
                  slippage: t.slippagePercent / 100,
                  order,
                },
                signal,
              );
              return { order, preview: p, error: null };
            } catch (error) {
              return {
                order,
                preview: null,
                error: error instanceof Error ? error.message : String(error),
              };
            }
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
    [],
  );

  // ── Human actions ────────────────────────────────────────────────

  const decide = useCallback(
    (id: string, status: 'approved' | 'rejected') => {
      const next = commitProposals((prev) =>
        prev.map((p) =>
          p.id === id && p.status === 'pending'
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
      if (decided && decided.status === status) {
        settle(decided);
        log(
          'human',
          status === 'approved' ? 'Approved proposal' : 'Rejected proposal',
          `${decided.id}${decided.humanNote ? ` — "${decided.humanNote}"` : ''}`,
        );
      }
    },
    [commitProposals, log, noteDraft, settle],
  );

  // Expire stale pending proposals so an agent waiting on one is never stuck.
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
    let alive = true;
    listChains()
      .then((r) => alive && setChains(r.chains ?? []))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // ── The controller the WebMCP tools drive ────────────────────────

  const controller = useMemo<DeskController>(() => {
    const describeProposal = (p: Proposal) => ({
      proposalId: p.id,
      kind: p.kind,
      status: p.status,
      rationale: p.rationale,
      humanNote: p.humanNote,
      createdAt: new Date(p.createdAt).toISOString(),
      expiresAt: new Date(p.expiresAt).toISOString(),
      ...(p.swap
        ? {
            swap: {
              sell: `${p.swap.amount} ${p.swap.fromToken} on ${p.swap.fromChain}`,
              buy: `${p.swap.toToken} on ${p.swap.toChain}`,
              slippagePercent: p.swap.slippagePercent,
              order: p.swap.order,
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
              spotAtProposal: p.alert.spotAtProposal,
            },
          }
        : {}),
    });

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
        };
      },

      async getPrices({ symbols }, signal) {
        const prices = await getPrices(symbols, signal);
        const missing = symbols.filter((s) => prices[s.toLowerCase()] === undefined);
        return { prices, unavailable: missing };
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
          note: 'Shown on the page. To act on it, call propose_swap — the human approves before anything is signed.',
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
              out: r.preview ? `${fmtAmount(r.preview.toAmount)} ${r.preview.toToken.symbol}` : null,
            })) ?? null,
          proposals: proposalsRef.current.map(describeProposal),
          recentActivity: activityRef.current.slice(0, 12).map((a) => ({
            at: new Date(a.at).toISOString(),
            actor: a.actor,
            label: a.label,
          })),
        };
      },

      async proposeSwap(args) {
        if (!args.rationale.trim()) {
          throw new Error('rationale is required — the human has to read why you want this trade.');
        }
        const body: Ticket = {
          fromChain: args.fromChain,
          toChain: args.toChain || args.fromChain,
          fromToken: args.fromToken,
          toToken: args.toToken,
          amount: args.amount,
          slippagePercent: args.slippagePercent ?? ticketRef.current.slippagePercent,
          order: (args.order as RouteOrder) ?? 'RECOMMENDED',
        };
        setTicket(body);

        let priced: SwapPreview | null = null;
        let pricingError: string | null = null;
        try {
          priced = await runPreview(body);
        } catch (error) {
          pricingError = error instanceof Error ? error.message : String(error);
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
          swap: { ...body, preview: priced, previewError: pricingError },
        };
        commitProposals((prev) => [proposal, ...prev]);
        return {
          proposalId: proposal.id,
          status: 'awaiting_human_approval',
          expiresAt: new Date(proposal.expiresAt).toISOString(),
          shownToHuman: {
            sell: `${body.amount} ${body.fromToken} on ${body.fromChain}`,
            buy: `${body.toToken} on ${body.toChain}`,
            indicativeOut: priced
              ? `${fmtAmount(priced.toAmount)} ${priced.toToken.symbol}`
              : null,
            pricingError,
          },
          next: 'Call check_approval with this proposalId (waitSeconds up to 120) to learn what the human decided. Nothing has been signed or sent.',
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
        };
        commitProposals((prev) => [proposal, ...prev]);
        return {
          proposalId: proposal.id,
          status: 'awaiting_human_approval',
          shownToHuman: {
            watch: proposal.alert?.symbol,
            fires: `${args.direction} ${fmtUsd(args.targetPrice)}`,
            spotNow: spot,
          },
          next: 'Call check_approval with this proposalId.',
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
          canHandOff: p.status === 'approved' && p.consumedAt === null,
        });
        if (current.status !== 'pending' || waitSeconds <= 0) {
          return Promise.resolve(describe(current));
        }

        const waitMs = Math.min(Math.max(waitSeconds, 1), MAX_WAIT_SECONDS) * 1000;
        return new Promise((resolve) => {
          let done = false;
          const finish = (p: Proposal) => {
            if (done) return;
            done = true;
            window.clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
            waiters.current.get(proposalId)?.delete(finish);
            resolve(describe(p));
          };
          const onAbort = () => finish(find() ?? current);
          const timer = window.setTimeout(() => {
            const latest = find() ?? current;
            if (done) return;
            done = true;
            signal?.removeEventListener('abort', onAbort);
            waiters.current.get(proposalId)?.delete(finish);
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
        if (!proposal.swap) throw new Error('Only swap proposals have a signing handoff.');
        if (proposal.consumedAt !== null) {
          throw new Error('That approval was already handed off. Propose the trade again.');
        }
        commitProposals((prev) =>
          prev.map((p) => (p.id === proposalId ? { ...p, consumedAt: Date.now() } : p)),
        );
        const handoff = buildHandoff(proposal.swap);
        return {
          proposalId,
          handoff,
          custody:
            'Suwappu does not sign from this page. Both links open a surface the human controls, pre-filled with the approved trade; they still confirm and sign there.',
        };
      },

      onToolCall(name, args) {
        log('agent', `→ ${name}`, JSON.stringify(args));
      },

      onToolResult(name, summary, isError) {
        log('agent', `← ${name}`, summary, isError);
      },
    };
  }, [commitProposals, log, runComparison, runPreview]);

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

  // The signing handoff tool only exists while an approved, unspent swap
  // proposal is on the desk — dynamic registration is the point: an agent
  // cannot reach for a tool the human has not unlocked.
  const hasUnlockedHandoff = proposals.some(
    (p) => p.kind === 'swap' && p.status === 'approved' && p.consumedAt === null,
  );
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx || !hasUnlockedHandoff) return;
    let dispose: (() => void) | null = null;
    let cancelled = false;
    registerHandoffTool(ctx, controller)
      .then((d) => {
        if (cancelled) {
          d();
          return;
        }
        dispose = d;
        setMcp((prev) =>
          prev.tools.includes('open_signing_handoff')
            ? prev
            : { ...prev, tools: [...prev.tools, 'open_signing_handoff'] },
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      dispose?.();
      setMcp((prev) => ({
        ...prev,
        tools: prev.tools.filter((t) => t !== 'open_signing_handoff'),
      }));
    };
  }, [controller, hasUnlockedHandoff]);

  // ── Manual (no-agent) controls — the page works without WebMCP ────

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

  const chainKeys = chains.length > 0 ? chains.map((c) => c.key) : ['base', 'ethereum', 'arbitrum'];
  const pending = proposals.filter((p) => p.status === 'pending');

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
            ? 'An agent in this browser can research and propose trades here. It cannot sign anything — you approve every proposal below.'
            : 'Open this page in the ChatGPT desktop app’s browser (or Chrome with WebMCP enabled) to let an agent drive it. Everything below still works by hand.'}
        </p>
      </section>

      <div className={styles.grid}>
        {/* ── Ticket ─────────────────────────────────────────────── */}
        <section className={styles.panel}>
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
            <button type="button" className={styles.primary} onClick={onManualQuote} disabled={previewBusy}>
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
            Quotes here are indicative and not executable. Nothing on this page can sign a
            transaction.
          </p>
        </section>

        {/* ── Approvals ──────────────────────────────────────────── */}
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>
            Approvals{pending.length > 0 ? ` · ${pending.length} waiting` : ''}
          </h2>
          <p className={styles.panelNote}>
            The agent proposes. You decide. Nothing is signed until you hand it to a wallet
            surface you control.
          </p>
          {proposals.length === 0 && (
            <p className={styles.empty}>
              No proposals yet. Ask your agent something like{' '}
              <em>“compare routes for 0.5 ETH on Base into USDC on Arbitrum, then propose the
              best one.”</em>
            </p>
          )}
          <ul className={styles.proposalList}>
            {proposals.map((p) => {
              const handoff = p.swap ? buildHandoff(p.swap) : null;
              return (
                <li key={p.id} className={`${styles.proposal} ${styles[`s_${p.status}`]}`}>
                  <header className={styles.proposalHead}>
                    <span className={styles.proposalKind}>
                      {p.kind === 'swap' ? 'Swap proposal' : 'Alert proposal'}
                    </span>
                    <span className={styles.proposalStatus}>{p.status}</span>
                  </header>
                  {p.swap && (
                    <p className={styles.proposalLine}>
                      Sell <strong>{p.swap.amount} {p.swap.fromToken}</strong> on {p.swap.fromChain} →{' '}
                      <strong>{p.swap.toToken}</strong> on {p.swap.toChain}
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
                  {p.alert && (
                    <p className={styles.proposalLine}>
                      Alert on <strong>{p.alert.symbol}</strong> when it goes {p.alert.direction}{' '}
                      <strong>{fmtUsd(p.alert.targetPrice)}</strong>
                      {p.alert.spotAtProposal !== null && (
                        <> · spot {fmtUsd(p.alert.spotAtProposal)}</>
                      )}
                    </p>
                  )}
                  <blockquote className={styles.rationale}>{p.rationale}</blockquote>
                  {p.swap?.previewError && (
                    <p className={styles.error}>Could not price it: {p.swap.previewError}</p>
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
                        >
                          Approve
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

                  {p.status === 'approved' && p.kind === 'swap' && handoff && (
                    <div className={styles.handoff}>
                      <p className={styles.handoffTitle}>Sign it where you keep your keys</p>
                      <div className={styles.actions}>
                        <a
                          className={styles.primary}
                          href={handoff.terminalUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Open in Terminal
                        </a>
                        <a
                          className={styles.ghost}
                          href={handoff.telegramUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Open Telegram bot
                        </a>
                        <button
                          type="button"
                          className={styles.ghost}
                          onClick={() => copy(p.id, handoff.telegramCommand)}
                        >
                          {copied === p.id ? 'Copied' : `Copy ${handoff.telegramCommand}`}
                        </button>
                      </div>
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
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Activity</h2>
          <p className={styles.panelNote}>
            Every tool call the agent makes on this page, in the open.
          </p>
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
