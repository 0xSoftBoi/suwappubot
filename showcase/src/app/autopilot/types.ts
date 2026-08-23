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
