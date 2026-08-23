/** Shapes returned by the public autopilot API (api-ts src/routes/autopilot.ts). */

export type AutopilotAgentSummary = {
  slug: string;
  name: string;
  description: string | null;
  mode: 'paper' | 'live';
  status: 'active' | 'paused' | 'stopped';
  chain: string;
  wallet_address: string | null;
  thesis_engine: string;
  starting_equity_usd: number;
  equity_usd: number;
  deployed_usd: number;
  open_positions: number;
  pnl_usd: number;
  last_cycle_at: string | null;
};

export type GateResult = {
  rule: string;
  passed: boolean;
  detail: string;
};

export type AutopilotDecision = {
  id: number;
  action: 'buy' | 'sell' | 'hold';
  chain: string;
  symbol: string;
  token_address: string;
  size_usd: number;
  confidence: number | null;
  headline: string | null;
  status: string;
  seal_algo: string;
  commitment: string;
  seal_memo: string;
  seal_tx_hash: string | null;
  seal_chain: string | null;
  sealed_at: string;
  gate_passed: boolean;
  gates: GateResult[];
  rejection_reason: string | null;
  tx_hash: string | null;
  executed_at: string | null;
  fill_price_usd: number | null;
  nonce?: string;
  thesis?: { reasoning?: string; evidence?: Record<string, unknown> } | null;
  revealed_at?: string;
};

export type AutopilotPosition = {
  id: number;
  chain: string;
  token_address: string;
  symbol: string;
  status: string;
  amount: string;
  cost_basis_usd: number;
  avg_entry_price_usd: number | null;
  last_price_usd: number | null;
  unrealized_pnl_usd: number | null;
  realized_pnl_usd: number;
  take_profit_pct: number | null;
  stop_loss_pct: number | null;
  invalidation: string | null;
  entry_decision_id: number | null;
  exit_decision_id: number | null;
  opened_at: string;
  closed_at: string | null;
};

export type AutopilotCycle = {
  id: number;
  status: string;
  stage: string;
  candidates_scanned: number;
  theses_formed: number;
  decisions_sealed: number;
  decisions_executed: number;
  equity_usd: number | null;
  started_at: string;
  finished_at: string | null;
  error: string | null;
};

/** GET /v1/autopilot/:slug/stats — the honesty panel. */
export type TrackRecordVerdict = {
  trades: number;
  sharpe: number | null;
  psr: number | null;
  minTrackRecordLength: number | null;
  tradesRemaining: number | null;
  significant: boolean;
  skew: number | null;
  kurtosis: number | null;
  summary: string;
};

export type ReliabilityBucket = {
  from: number;
  to: number;
  count: number;
  statedConfidence: number;
  realizedWinRate: number;
  gap: number;
};

export type CalibrationReport = {
  samples: number;
  buckets: ReliabilityBucket[];
  brierScore: number | null;
  expectedCalibrationError: number | null;
  bias: number | null;
  summary: string;
};

export type BenchmarkComparison = {
  strategyReturnPct: number;
  benchmarkReturnPct: number;
  excessReturnPct: number;
  beatsBenchmark: boolean;
  label: string;
  summary: string;
};

export type AgentStats = {
  closed_trades: number;
  track_record: TrackRecordVerdict;
  calibration: CalibrationReport;
  benchmark: BenchmarkComparison | null;
  costs: { paper_fee_bps_per_side: number; impact_model: string };
};
