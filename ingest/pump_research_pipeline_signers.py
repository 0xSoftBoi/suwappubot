"""Signer-aware patch layer for pump_research_pipeline_v2.

Pump/PumpSwap user identity is represented by transaction signer(s), while fee
payer may be a relayer or other account. We therefore classify signed token
flow only from token accounts whose owner is present in the transaction's
signer set. The rest of v2 (watermarks, scoring, outcomes, live signal table)
is reused unchanged.
"""
from __future__ import annotations

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
        except Exception as e:
            print(f"research_signers error={e}", flush=True)
        time.sleep(v2.INTERVAL)
