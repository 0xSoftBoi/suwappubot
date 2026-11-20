/**
 * The mandate: a machine-readable envelope the human writes and the agent can
 * read *before* it spends anyone's attention.
 *
 * HONEST SCOPE — read this before trusting it with anything.
 * The desk does not execute, so a mandate cannot *enforce* a spend limit; a
 * user who ignores the desk and signs in their wallet is outside its reach.
 * What it does is narrower and still useful:
 *   - it is a contract the agent can query (`check_mandate`) so it stops
 *     proposing trades it already knows you will refuse;
 *   - it governs what this page will put in front of you and how loudly;
 *   - it forces an out-of-envelope trade through a visible, separate
 *     negotiation (`request_override`) instead of a quiet Approve click.
 * Binding enforcement lives server-side in Suwappu's wallet spending policies
 * (`POST /v1/agent/wallet/policy`), which gate managed execution. The mandate
 * here is the browser-side sibling of that idea, not a replacement for it.
 */

export interface Mandate {
  perTradeUsdCap: number;
  dailyUsdCap: number;
  /** Empty means "any chain Suwappu supports". */
  allowedChains: string[];
  /** Empty means "any token". Symbols, upper-cased. */
  allowedBuyTokens: string[];
  maxPriceImpactPercent: number;
  maxSlippagePercent: number;
  /**
   * Monotonically increasing. Starts at 1 and increments only when an
   * approved `amend_mandate` rewrites the envelope (see `applyAmendment`) —
   * never on a read, a manual field edit, or a rejected/pending amendment.
   * Lets a compiled policy or an exported receipt name exactly which version
   * of the envelope produced it, so a later amendment can't orphan the audit
   * chain (South et al., arXiv:2501.09674).
   */
  version: number;
}

export const DEFAULT_MANDATE: Mandate = {
  perTradeUsdCap: 250,
  dailyUsdCap: 1000,
  allowedChains: ['base', 'arbitrum', 'optimism', 'ethereum'],
  allowedBuyTokens: ['USDC', 'USDT', 'ETH', 'WETH', 'WBTC', 'CBBTC'],
  maxPriceImpactPercent: 1,
  maxSlippagePercent: 1,
  version: 1,
};

/**
 * The fields a trade can actually be judged against. `version` is metadata
 * about the envelope, not a limit — it can never be the `rule` a proposal
 * breaks, so it is excluded here rather than left for callers to remember.
 */
export type MandateRuleKey = Exclude<keyof Mandate, 'version'>;

export interface MandateViolation {
  rule: MandateRuleKey;
  message: string;
  limit: string;
  actual: string;
}

/**
 * Each rule's glyph and heading — the mandate's own iconography, shared by
 * every surface that renders a verdict (breach cards, the route dossier).
 * Anderson et al., CHI 2015: habituation to a repeated identical warning
 * collapses by the second exposure; per-rule visual variation restores
 * attention, so the same rule must look the same everywhere and different
 * rules must look different.
 */
export const RULE_META: Record<MandateRuleKey, { glyph: string; heading: string }> = {
  perTradeUsdCap: { glyph: '$', heading: 'Over your per-trade cap' },
  dailyUsdCap: { glyph: 'Σ', heading: "Over today's budget" },
  allowedChains: { glyph: '⇄', heading: "Chain isn't on your allow-list" },
  allowedBuyTokens: { glyph: '◈', heading: "Token isn't on your allow-list" },
  maxPriceImpactPercent: { glyph: '▲', heading: 'Price impact is too high' },
  maxSlippagePercent: { glyph: '≈', heading: 'Slippage tolerance is too high' },
};

export interface MandateVerdict {
  withinMandate: boolean;
  violations: MandateViolation[];
  headroom: {
    perTradeUsdCap: number;
    dailyUsdCap: number;
    spentTodayUsd: number;
    dailyRemainingUsd: number;
  };
}

export interface TradeShape {
  /** Notional in USD. Null when the desk could not price it. */
  notionalUsd: number | null;
  fromChain: string;
  toChain: string;
  toToken: string;
  priceImpactPercent: number | null;
  slippagePercent: number;
}

const money = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

/**
 * Pure — no React, no fetch. Kept that way so the rules are readable in one
 * screen and unit-testable without a browser.
 */
export function evaluateMandate(
  mandate: Mandate,
  trade: TradeShape,
  spentTodayUsd: number,
): MandateVerdict {
  const violations: MandateViolation[] = [];
  const dailyRemainingUsd = Math.max(0, mandate.dailyUsdCap - spentTodayUsd);

  if (trade.notionalUsd === null) {
    violations.push({
      rule: 'perTradeUsdCap',
      message:
        'The desk could not price this trade, so it cannot be checked against your caps.',
      limit: money(mandate.perTradeUsdCap),
      actual: 'unpriced',
    });
  } else {
    if (trade.notionalUsd > mandate.perTradeUsdCap) {
      violations.push({
        rule: 'perTradeUsdCap',
        message: 'Bigger than your per-trade cap.',
        limit: money(mandate.perTradeUsdCap),
        actual: money(trade.notionalUsd),
      });
    }
    if (trade.notionalUsd > dailyRemainingUsd) {
      violations.push({
        rule: 'dailyUsdCap',
        message: `Would exceed today's remaining budget (${money(spentTodayUsd)} of ${money(
          mandate.dailyUsdCap,
        )} already approved).`,
        limit: money(dailyRemainingUsd),
        actual: money(trade.notionalUsd),
      });
    }
  }

  const chains = mandate.allowedChains.map((c) => c.toLowerCase());
  if (chains.length > 0) {
    for (const [label, chain] of [
      ['fromChain', trade.fromChain],
      ['toChain', trade.toChain],
    ] as const) {
      if (chain && !chains.includes(chain.toLowerCase())) {
        violations.push({
          rule: 'allowedChains',
          message: `${label === 'fromChain' ? 'Source' : 'Destination'} chain is not on your allow-list.`,
          limit: chains.join(', '),
          actual: chain,
        });
      }
    }
  }

  const tokens = mandate.allowedBuyTokens.map((t) => t.toUpperCase());
  if (tokens.length > 0 && trade.toToken && !tokens.includes(trade.toToken.toUpperCase())) {
    violations.push({
      rule: 'allowedBuyTokens',
      message: 'Buying a token that is not on your allow-list.',
      limit: tokens.join(', '),
      actual: trade.toToken.toUpperCase(),
    });
  }

  if (trade.priceImpactPercent !== null && trade.priceImpactPercent > mandate.maxPriceImpactPercent) {
    violations.push({
      rule: 'maxPriceImpactPercent',
      message: 'Price impact is above your ceiling.',
      limit: `${mandate.maxPriceImpactPercent}%`,
      actual: `${trade.priceImpactPercent}%`,
    });
  }

  if (trade.slippagePercent > mandate.maxSlippagePercent) {
    violations.push({
      rule: 'maxSlippagePercent',
      message: 'Slippage tolerance is above your ceiling.',
      limit: `${mandate.maxSlippagePercent}%`,
      actual: `${trade.slippagePercent}%`,
    });
  }

  return {
    withinMandate: violations.length === 0,
    violations,
    headroom: {
      perTradeUsdCap: mandate.perTradeUsdCap,
      dailyUsdCap: mandate.dailyUsdCap,
      spentTodayUsd,
      dailyRemainingUsd,
    },
  };
}

/** What the agent reads. Deliberately verbose — it is a contract, not a blob. */
/** What the desk knows about the server-side copy of this mandate. */
export interface EnforcementSummary {
  /** none: never applied. enforced: the installed policy matches this version. stale: a newer version is on the desk. */
  status: 'none' | 'enforced' | 'stale';
  policyId: string | null;
  enforcedVersion: number | null;
  since: string | null;
}

export function describeMandate(
  mandate: Mandate,
  spentTodayUsd: number,
  enforcement: EnforcementSummary = { status: 'none', policyId: null, enforcedVersion: null, since: null },
) {
  return {
    version: mandate.version,
    perTradeUsdCap: mandate.perTradeUsdCap,
    dailyUsdCap: mandate.dailyUsdCap,
    approvedTodayUsd: spentTodayUsd,
    dailyRemainingUsd: Math.max(0, mandate.dailyUsdCap - spentTodayUsd),
    allowedChains: mandate.allowedChains.length ? mandate.allowedChains : 'any',
    allowedBuyTokens: mandate.allowedBuyTokens.length ? mandate.allowedBuyTokens : 'any',
    maxPriceImpactPercent: mandate.maxPriceImpactPercent,
    maxSlippagePercent: mandate.maxSlippagePercent,
    howItBinds:
      'This is the envelope the human wrote for you. Check a trade with check_mandate before proposing it. ' +
      'A proposal outside the envelope is not blocked outright, but it is shown to the human in red with the exact ' +
      'rule it breaks, and Approve stays locked until they either edit the mandate or grant a one-time override. ' +
      'To ask for that override, call request_override; it only exists while a blocked proposal is on the desk.',
    enforcement: {
      ...enforcement,
      meaning:
        enforcement.status === 'enforced'
          ? 'This version of the mandate is installed as a spend policy on the agent. The API evaluates it on every execute by the agent, before a transaction is built: the caps, slippage ceiling and chain list bind there, not only here.'
          : enforcement.status === 'stale'
            ? `Version ${enforcement.enforcedVersion} is installed server-side but the desk is on version ${mandate.version}. Ask the human to re-apply from the mandate panel so the two match.`
            : 'Not installed server-side. The desk does not execute trades, so by itself this cannot physically cap spending: treat it as the human’s stated intent. The human can apply it as a spend policy from the mandate panel (Enforce); compile_mandate_to_policy shows exactly what would be installed.',
    },
  };
}

// ── Amendment ───────────────────────────────────────────────────────

export interface MandateAmendment {
  perTradeUsdCap?: number;
  dailyUsdCap?: number;
  allowedChains?: string[];
  allowedBuyTokens?: string[];
  maxPriceImpactPercent?: number;
  maxSlippagePercent?: number;
}

export interface AmendmentDiff {
  field: MandateRuleKey;
  from: string;
  to: string;
  direction: 'looser' | 'tighter' | 'changed';
}

const asText = (v: unknown) => (Array.isArray(v) ? (v.length ? v.join(', ') : 'any') : String(v));

/**
 * Describes what an amendment would change, and — the part the human actually
 * needs — whether each change *loosens* their guard rails or tightens them.
 * An agent asking for more rope should never be able to phrase it as a tidy-up.
 */
export function diffAmendment(current: Mandate, amendment: MandateAmendment): AmendmentDiff[] {
  const diffs: AmendmentDiff[] = [];
  const numericLooserWhenHigher: MandateRuleKey[] = [
    'perTradeUsdCap',
    'dailyUsdCap',
    'maxPriceImpactPercent',
    'maxSlippagePercent',
  ];

  for (const key of numericLooserWhenHigher) {
    const next = amendment[key] as number | undefined;
    if (next === undefined) continue;
    const prev = current[key] as number;
    if (next === prev) continue;
    diffs.push({
      field: key,
      from: String(prev),
      to: String(next),
      direction: next > prev ? 'looser' : 'tighter',
    });
  }

  for (const key of ['allowedChains', 'allowedBuyTokens'] as const) {
    const next = amendment[key];
    if (next === undefined) continue;
    const prev = current[key];
    if (asText(prev) === asText(next)) continue;
    // An empty list means "no restriction", which is the loosest possible state.
    const loosened = next.length === 0 || (prev.length > 0 && next.length > prev.length);
    diffs.push({
      field: key,
      from: asText(prev),
      to: asText(next),
      direction: loosened ? 'looser' : next.length < prev.length ? 'tighter' : 'changed',
    });
  }

  return diffs;
}

/**
 * The only place `version` is allowed to move. Called once, after the human
 * clicks Approve on a mandate-amendment proposal — never from a rejection, an
 * expiry, or a manual field edit in the mandate panel (those go through
 * `updateMandate`'s plain patch and leave `version` untouched).
 */
export function applyAmendment(current: Mandate, amendment: MandateAmendment): Mandate {
  return {
    ...current,
    ...Object.fromEntries(Object.entries(amendment).filter(([, v]) => v !== undefined)),
    version: current.version + 1,
  };
}

// ── Compilation to enforceable policy ───────────────────────────────

/** Request body for `POST /v1/agent/policies` (snake_case, as the API takes it). */
export interface SpendPolicyBody {
  name: string;
  max_tx_usd?: number;
  daily_cap_usd?: number;
  max_slippage_bps?: number;
  allowed_chains?: string[];
  approval_mode?: 'always_ask' | 'above_limit' | 'autonomous';
  replaces?: string[];
}

/**
 * Compiles the browser-side mandate into the one request body Suwappu's
 * `POST /v1/agent/policies` accepts. That endpoint writes the row the API's
 * policy gate evaluates on every swap execute by the agent, before the
 * transaction is built: a per-trade cap, a rolling daily cap, a slippage
 * ceiling and a chain allow-list, each a server-side control with the same
 * meaning the desk gives it.
 *
 * Two rules stay desk-only and are listed as such: the price-impact ceiling
 * (the API has no such control) and the buy-token allow-list (the API's token
 * allow-list binds BOTH sides of a trade and takes contract addresses, so
 * installing the buy list alone would block every sale of a token not on it).
 */
export function compileToSpendPolicy(
  mandate: Mandate,
  replaces: string[] = [],
): { body: SpendPolicyBody; notes: string[]; deskOnly: string[] } {
  const body: SpendPolicyBody = {
    name: `Agent Desk mandate v${mandate.version}`,
    max_tx_usd: mandate.perTradeUsdCap,
    daily_cap_usd: mandate.dailyUsdCap,
    max_slippage_bps: Math.round(mandate.maxSlippagePercent * 100),
    approval_mode: 'above_limit',
  };
  if (mandate.allowedChains.length > 0) {
    body.allowed_chains = mandate.allowedChains.map((c) => c.toLowerCase());
  }
  if (replaces.length > 0) body.replaces = replaces;

  const notes = [
    `Compiled from mandate version ${mandate.version}. Approving a later amendment increments the version; re-apply so the installed policy and the negotiated envelope stay the same version.`,
    'The daily cap is a rolling 24-hour sum over the API\'s own decision log, so it counts every execute by this agent, not only trades proposed on this desk.',
    'Inside the envelope the agent executes without a server-side approval step; the desk is still where it must propose first. Set approval_mode to always_ask on the policy if you want the API itself to hold every trade for you.',
  ];
  const deskOnly = [
    `Price impact ≤ ${mandate.maxPriceImpactPercent}%: the API has no price-impact control, so this stays a desk rule.`,
  ];
  if (mandate.allowedBuyTokens.length > 0) {
    deskOnly.push(
      `Buy-token allow-list (${mandate.allowedBuyTokens.join(', ')}): the API\'s token allow-list binds both sides of a trade and takes contract addresses, so it is not installed from here.`,
    );
  }
  return { body, notes, deskOnly };
}
