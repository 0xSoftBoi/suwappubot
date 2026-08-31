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
export function describeMandate(mandate: Mandate, spentTodayUsd: number) {
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
      'To ask for that override, call request_override — it only exists while a blocked proposal is on the desk.',
    notEnforcement:
      'The desk does not execute trades, so this cannot physically cap spending. Binding limits live in Suwappu ' +
      'wallet spending policies server-side. Treat this as the human’s stated intent, and respect it.',
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

export interface WalletPolicyPayload {
  type: 'spending_limit' | 'whitelist';
  /** The mandate.version this payload was compiled from — see Mandate.version. */
  mandateVersion: number;
  params: {
    maxAmountWei?: string;
    timeWindowSeconds?: number;
    allowedAddresses?: string[];
  };
}

/**
 * Compiles the browser-side mandate into the request bodies Suwappu's
 * `POST /v1/agent/wallet/policy` accepts — the endpoint that creates real
 * Turnkey policies gating managed execution.
 *
 * This is the bridge between the envelope the human negotiated here and
 * enforcement that actually binds. It produces the payloads; installing them
 * needs an agent key, which this page deliberately never holds.
 */
export function compileToWalletPolicies(
  mandate: Mandate,
  ethUsd: number,
  tokenAddresses: string[] = [],
): { policies: WalletPolicyPayload[]; notes: string[] } {
  const notes: string[] = [];
  const policies: WalletPolicyPayload[] = [];

  if (!Number.isFinite(ethUsd) || ethUsd <= 0) {
    notes.push(
      'No ETH price was available, so the USD caps could not be converted to wei. Re-run once get_prices succeeds.',
    );
  } else {
    // Turnkey conditions are denominated in wei against the native asset, so a
    // USD cap only exists as a policy once it is priced.
    const toWei = (usd: number) =>
      BigInt(Math.floor((usd / ethUsd) * 1e18)).toString();

    policies.push({
      type: 'spending_limit',
      mandateVersion: mandate.version,
      params: { maxAmountWei: toWei(mandate.dailyUsdCap), timeWindowSeconds: 86_400 },
    });
    notes.push(
      `Daily cap ${mandate.dailyUsdCap} USD converted at ${ethUsd} USD/ETH. Re-compile when the price moves materially — the policy is fixed in wei, the cap you meant is in dollars.`,
    );
  }

  if (tokenAddresses.length > 0) {
    policies.push({
      type: 'whitelist',
      mandateVersion: mandate.version,
      params: { allowedAddresses: tokenAddresses.map((a) => a.toLowerCase()) },
    });
  } else if (mandate.allowedBuyTokens.length > 0) {
    notes.push(
      'The token allow-list could not be compiled: a whitelist policy needs contract addresses, and only symbols were on the mandate. Resolve them with find_token first.',
    );
  }

  notes.push(
    'Installing these policies needs an agent key this page never holds. An agent without a subscription can still act under them: the API meters pay-per-call over HTTP 402 (x402), so the compiled envelope and the payment rail are both agent-native.',
  );

  notes.push(
    `Compiled from mandate version ${mandate.version}. Approving a later amendment increments the version and does not rewrite this bundle — recompile after any amendment so the installed policy and the negotiated envelope stay the same version.`,
  );

  if (mandate.perTradeUsdCap < mandate.dailyUsdCap) {
    notes.push(
      `Per-trade cap (${mandate.perTradeUsdCap} USD) has no direct Turnkey equivalent — Turnkey limits per transaction, and a time-windowed daily limit is the closest primitive. The per-trade rule stays enforced by the desk only.`,
    );
  }

  return { policies, notes };
}
