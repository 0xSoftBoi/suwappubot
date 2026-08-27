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
}

export const DEFAULT_MANDATE: Mandate = {
  perTradeUsdCap: 250,
  dailyUsdCap: 1000,
  allowedChains: ['base', 'arbitrum', 'optimism', 'ethereum'],
  allowedBuyTokens: ['USDC', 'USDT', 'ETH', 'WETH', 'WBTC', 'CBBTC'],
  maxPriceImpactPercent: 1,
  maxSlippagePercent: 1,
};

export interface MandateViolation {
  rule: keyof Mandate;
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
