"""Signer-aware patch layer for pump_research_pipeline_v2.

Pump/PumpSwap user identity is represented by transaction signer(s), while fee
payer may be a relayer or other account. We therefore classify signed token
flow only from token accounts whose owner is present in the transaction's
signer set. The rest of v2 (watermarks, scoring, outcomes, live signal table)
is reused unchanged.
"""
from __future__ import annotations

import json
import time

import pump_research_pipeline_v2 as v2


def directional_events(cur, cutoff, watermark):
    cur.execute("""
      SELECT d.mint,
             t.block_time,
             t.signature,
             d.owner AS participant,
             t.source_program,
             COALESCE(SUM(d.delta),0) AS user_delta,
             COALESCE(t.fee_lamports,0),
             COALESCE(t.compute_units,0),
             t.success
      FROM pump_ingest_token_deltas d
      JOIN pump_ingest_transactions t USING(signature)
      WHERE t.block_time BETWEEN %s AND %s
        AND d.delta <> 0
        AND d.owner <> ''
        AND t.signers ? d.owner
      GROUP BY d.mint,t.block_time,t.signature,d.owner,t.source_program,
               t.fee_lamports,t.compute_units,t.success
      HAVING COALESCE(SUM(d.delta),0) <> 0
      ORDER BY d.mint,t.block_time,t.signature,d.owner
    """, (cutoff, watermark))
    return cur.fetchall()


def print_top_signals(limit=8):
    with v2.conn() as c, c.cursor() as q:
        q.execute("""
          SELECT mint,stage,signal_score,signal_tier,evidence
          FROM pump_live_signals_v2
          WHERE expires_at > now()
          ORDER BY signal_score DESC, observed_block_time DESC
          LIMIT %s
        """, (limit,))
        rows = q.fetchall()
    for mint, stage, score, tier, evidence in rows:
        if isinstance(evidence, str):
            try:
                evidence = json.loads(evidence)
            except Exception:
                evidence = {"raw": evidence}
        compact = {
            "tx30": evidence.get("tx_30s"),
            "buys30": evidence.get("buy_tx_30s"),
            "sells30": evidence.get("sell_tx_30s"),
            "buyers30": evidence.get("buyers_30s"),
            "sellers30": evidence.get("sellers_30s"),
            "imb30": evidence.get("signed_flow_imbalance_30s"),
            "burst": evidence.get("burst_ratio_30s_120s"),
            "largest": evidence.get("largest_user_flow_share_30s"),
            "failed30": evidence.get("failed_tx_30s"),
        }
        print(
            f"live_candidate mint={mint} stage={stage} score={score:.2f} tier={tier} evidence={json.dumps(compact,separators=(',',':'))}",
            flush=True,
        )


# Patch the module global used by v2.observe().
v2.directional_events = directional_events


if __name__ == "__main__":
    v2.init()
    while True:
        try:
            w, o, l, s = v2.cycle()
            print(
                f"research_signers watermark={w} observations={o} outcomes={l} live_signals={s}",
                flush=True,
            )
            print_top_signals()
        except Exception as e:
            print(f"research_signers error={e}", flush=True)
        time.sleep(v2.INTERVAL)
