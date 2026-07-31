/**
 * Bridge types — mirrors bot/services/bridge/base.py's BridgeQuote.
 *
 * The two fields that matter most here, and that most bridge UIs throw away,
 * are `settlement` and `trustModel`. A bridge is a custody hand-off: for a
 * few seconds to a few minutes your value is not on either chain, and who you
 * are trusting during that gap differs enormously between routes. Price and
 * ETA alone cannot express that, so they are surfaced as first-class.
 */

/** How the transfer is actually settled. */
export type BridgeSettlement =
  /** We build a transaction you sign on the source chain. */
  | "tx"
  /** You send funds to a generated address; a solver fills the order. */
  | "deposit_address"
  /** The chain's own canonical bridge contract. */
  | "canonical";

/** Who you are trusting while the value is in flight. */
export type BridgeTrustModel =
  /** Pooled liquidity + a relayer. */
  | "liquidity"
  /** The rollup's own bridge — no third party. */
  | "canonical"
  /** A solver network fills against your deposit. */
  | "solver";

export interface BridgeRoute {
  provider: string;
  fromChain: string;
  toChain: string;
  token: string;

  /** Raw base units, as strings — never parse these into floats for math. */
  fromAmount: string;
  toAmount: string;
  toAmountMin: string;
  /** Display-only, already scaled by the server. */
  toAmountHuman: number;

  gasCostUsd: number;
  feeCostUsd: number;
  totalCostUsd: number;
  /** Seconds. */
  estimatedTime: number;

  settlement: BridgeSettlement;
  trustModel: BridgeTrustModel;
  /**
   * True for 1:1 mint/burn rails (CCTP, USDT0/OFT). These have no price
   * impact by construction — the cost is a flat/bps protocol fee rather than
   * spread against a pool.
   */
  zeroSlippage: boolean;

  /** Only set when settlement is "deposit_address". */
  depositAddress?: string | null;
}

/**
 * Where the value is right now.
 *
 * These map onto the server's own lifecycle (see
 * bot/services/cctp_generic_relayer.py): pending_broadcast -> burned ->
 * attested -> minted, plus the stall/failure branches.
 */
export type BridgeTransferState =
  /** Deposit-address rails: we are waiting for the user to send funds. */
  | "awaiting_deposit"
  /** Recorded, not yet broadcast. */
  | "pending_broadcast"
  /** Source transaction submitted, not yet confirmed. */
  | "source_pending"
  /** Funds have left the source chain. This is the exposed window. */
  | "source_confirmed"
  /** Waiting on the attestation/message that authorises the destination side. */
  | "attesting"
  /** Destination transaction submitted. */
  | "destination_pending"
  /** Value is on the destination chain. */
  | "complete"
  /** Not progressing, but still retryable. */
  | "stalled"
  /** Terminal. Needs a human. */
  | "failed";

export interface BridgeTransfer {
  id: string;
  state: BridgeTransferState;
  provider: string;
  fromChain: string;
  toChain: string;
  token: string;
  amountHuman: number;

  trustModel: BridgeTrustModel;
  settlement: BridgeSettlement;

  sourceTxHash?: string | null;
  destinationTxHash?: string | null;
  depositAddress?: string | null;

  /** ISO 8601. */
  startedAt: string;
  updatedAt: string;
  /** Seconds; server's estimate for the whole transfer. */
  estimatedTime: number;

  /** Present when stalled or failed — plain-language, already user-facing. */
  statusDetail?: string | null;
}

export interface BridgeRoutesRequest {
  fromChain: string;
  toChain: string;
  token: string;
  amount: string;
  fromAddress?: string;
  toAddress?: string;
  slippageBps?: number;
}

export interface BridgeRoutesResponse {
  routes: BridgeRoute[];
  /** Chains/tokens the server could not quote, so the UI can say why. */
  unavailable?: Array<{ provider: string; reason: string }>;
}
