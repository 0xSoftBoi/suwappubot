/**
 * The vocabulary of the bridge flow.
 *
 * Route list and tracker both read from here so a rail is described the same
 * way when you pick it and while you wait on it. If the words drift between
 * those two moments, the user has to re-learn the interface mid-transfer.
 *
 * Naming rule: say who holds the value, not which protocol moves it. "Circle
 * mints 1:1 on arrival" is checkable by the reader; "CCTP v2 attestation" is
 * our implementation detail.
 */

import type {
  BridgeRoute,
  BridgeSettlement,
  BridgeTransferState,
  BridgeTrustModel,
} from "../../types/bridge";

/** Tones available in the terminal design system. `up`/`down` are reserved
 *  for PnL and price direction, so custody states never use them. */
export type CustodyTone = "neutral" | "warm" | "sky" | "accent";

export interface TrustCopy {
  /** Short label for a pill. */
  label: string;
  /** One line: who you are trusting, in the gap. */
  summary: string;
  tone: CustodyTone;
}

export const TRUST_COPY: Record<BridgeTrustModel, TrustCopy> = {
  canonical: {
    label: "No third party",
    summary: "The chain's own bridge holds your funds. No outside operator.",
    tone: "accent",
  },
  liquidity: {
    label: "Pool + relayer",
    summary: "A liquidity pool fronts the funds and a relayer delivers them.",
    tone: "neutral",
  },
  solver: {
    label: "Solver fills",
    summary: "A solver sends you funds on the far side once your deposit lands.",
    tone: "sky",
  },
};

export const SETTLEMENT_COPY: Record<BridgeSettlement, string> = {
  tx: "You sign one transaction on the source chain.",
  deposit_address: "You send funds to an address we generate for this transfer.",
  canonical: "You sign a deposit into the chain's own bridge contract.",
};

export interface StateCopy {
  /** What is true right now. */
  label: string;
  /** Where the value physically is — the honest version. */
  detail: string;
  tone: CustodyTone;
  /** Whether this state is expected to move on its own. */
  settled: boolean;
}

/**
 * `source_confirmed` and `attesting` deliberately say the funds have left the
 * source chain and are not yet on the destination. That is the real position,
 * and it is the state where transfers get stuck — softening it into
 * "processing" would hide the only thing worth watching.
 */
export const STATE_COPY: Record<BridgeTransferState, StateCopy> = {
  awaiting_deposit: {
    label: "Waiting for your deposit",
    detail: "Nothing has moved yet. Send funds to the address below to start.",
    tone: "warm",
    settled: false,
  },
  pending_broadcast: {
    label: "Preparing",
    detail: "Recorded, not yet sent. Your funds are still in your wallet.",
    tone: "neutral",
    settled: false,
  },
  source_pending: {
    label: "Sending",
    detail: "Your transaction is confirming. Funds are still on the source chain.",
    tone: "neutral",
    settled: false,
  },
  source_confirmed: {
    label: "In transit",
    detail: "Funds have left the source chain and have not arrived yet.",
    tone: "warm",
    settled: false,
  },
  attesting: {
    label: "Awaiting confirmation",
    detail:
      "Funds have left the source chain. Waiting for the proof that releases them on the far side.",
    tone: "warm",
    settled: false,
  },
  destination_pending: {
    label: "Arriving",
    detail: "The delivery transaction is confirming on the destination chain.",
    tone: "sky",
    settled: false,
  },
  complete: {
    label: "Arrived",
    detail: "Funds are on the destination chain.",
    tone: "accent",
    settled: true,
  },
  stalled: {
    label: "Stalled",
    detail:
      "Not progressing. Your funds are safe and this will retry automatically.",
    tone: "warm",
    settled: false,
  },
  failed: {
    label: "Needs attention",
    detail: "This transfer stopped and will not retry on its own.",
    tone: "warm",
    settled: true,
  },
};

/** Ordered spine of a transfer. Deposit-address rails start a step earlier. */
export function custodySteps(
  settlement: BridgeSettlement,
): Array<{ key: string; label: string }> {
  const core = [
    { key: "source", label: "Source chain" },
    { key: "transit", label: "In transit" },
    { key: "destination", label: "Destination chain" },
  ];
  if (settlement === "deposit_address") {
    return [{ key: "deposit", label: "Your deposit" }, ...core];
  }
  return core;
}

/** Which step of the spine a state sits on. */
export function stepForState(state: BridgeTransferState): string {
  switch (state) {
    case "awaiting_deposit":
      return "deposit";
    case "pending_broadcast":
    case "source_pending":
      return "source";
    case "source_confirmed":
    case "attesting":
    case "stalled":
    case "failed":
      return "transit";
    case "destination_pending":
    case "complete":
      return "destination";
  }
}

/** "45s" / "12m" / "1h 5m" — compact enough for a table cell. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/**
 * Rank routes the way the backend does: on what actually arrives, net of
 * cost. A pooled route quoting a higher nominal output can still lose to a
 * 1:1 rail once its spread and fees are counted, so never sort on
 * `toAmountHuman` alone.
 */
export function netValueUsd(route: BridgeRoute, tokenPriceUsd: number): number {
  return route.toAmountHuman * tokenPriceUsd - route.totalCostUsd;
}

/** Worst case the user is guaranteed, in token terms. */
export function guaranteedShortfall(route: BridgeRoute): number {
  const out = Number(route.toAmount);
  const min = Number(route.toAmountMin);
  if (!Number.isFinite(out) || !Number.isFinite(min) || out <= 0) return 0;
  return (out - min) / out;
}
