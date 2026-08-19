"""Direction-aware Pump/PumpSwap signal research pipeline.

This pipeline is intentionally conservative:
- point-in-time on-chain facts only
- uses the fee payer's own token balance delta to infer buy/sell direction
- never sums all token-account deltas as directional flow (token transfers conserve)
- observes both Pump bonding-curve and PumpSwap lifecycle stages
- labels future order-flow continuation only after an ingest watermark has passed
- publishes heuristic live candidates separately from validated model outputs

The live score is an UNVALIDATED ranking heuristic, not a profitability claim.
It exists to give traders auditable evidence while forward labels accumulate.
"""
from __future__ import annotations

import math
import os
import statistics
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone

import psycopg2
from psycopg2.extras import Json, execute_values

DB = os.environ["DATABASE_URL"]
INTERVAL = int(os.getenv("PUMP_RESEARCH_INTERVAL_SECONDS", "20"))
LOOKBACK_MINUTES = int(os.getenv("PUMP_RESEARCH_LOOKBACK_MINUTES", "10"))
MAX_MINTS = int(os.getenv("PUMP_RESEARCH_MAX_MINTS", "1500"))
SAFETY_LAG_SECONDS = int(os.getenv("PUMP_RESEARCH_SAFETY_LAG_SECONDS", "8"))
MIN_TX_30S = int(os.getenv("PUMP_SIGNAL_MIN_TX_30S", "4"))
MIN_BUYERS_30S = int(os.getenv("PUMP_SIGNAL_MIN_BUYERS_30S", "3"))

DDL = """
CREATE TABLE IF NOT EXISTS pump_research_observations_v2 (
  mint TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  observed_block_time BIGINT NOT NULL,
  feature_version TEXT NOT NULL DEFAULT 'chain-v2-directional',
  stage TEXT NOT NULL,
  tx_10s INTEGER NOT NULL,
  tx_30s INTEGER NOT NULL,
  tx_120s INTEGER NOT NULL,
  buy_tx_30s INTEGER NOT NULL,
  sell_tx_30s INTEGER NOT NULL,
  buy_tx_120s INTEGER NOT NULL,
  sell_tx_120s INTEGER NOT NULL,
  buyers_30s INTEGER NOT NULL,
  sellers_30s INTEGER NOT NULL,
  participants_120s INTEGER NOT NULL,
  repeat_participants_120s INTEGER NOT NULL,
  buy_token_volume_30s NUMERIC(78,0) NOT NULL,
  sell_token_volume_30s NUMERIC(78,0) NOT NULL,
  signed_flow_imbalance_30s DOUBLE PRECISION NOT NULL,
  buyer_share_30s DOUBLE PRECISION NOT NULL,
  largest_user_flow_share_30s DOUBLE PRECISION NOT NULL,
  participant_entropy_120s DOUBLE PRECISION NOT NULL,
  mean_interarrival_ms_120s DOUBLE PRECISION,
  interarrival_cv_120s DOUBLE PRECISION,
  burst_ratio_30s_120s DOUBLE PRECISION NOT NULL,
  failed_tx_30s INTEGER NOT NULL,
  mean_fee_lamports_30s DOUBLE PRECISION NOT NULL,
  mean_compute_units_30s DOUBLE PRECISION NOT NULL,
  signal_score DOUBLE PRECISION NOT NULL,
  signal_tier TEXT NOT NULL,
  features JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY(mint, observed_block_time)
);
CREATE INDEX IF NOT EXISTS ix_pump_research_v2_time
  ON pump_research_observations_v2(observed_block_time DESC);
CREATE INDEX IF NOT EXISTS ix_pump_research_v2_score
  ON pump_research_observations_v2(signal_score DESC, observed_block_time DESC);

CREATE TABLE IF NOT EXISTS pump_research_outcomes_v2 (
  mint TEXT NOT NULL,
  observed_block_time BIGINT NOT NULL,
  horizon_seconds INTEGER NOT NULL,
  future_tx_count INTEGER NOT NULL,
  future_buy_tx INTEGER NOT NULL,
  future_sell_tx INTEGER NOT NULL,
  future_buyer_count INTEGER NOT NULL,
  future_seller_count INTEGER NOT NULL,
  future_buy_token_volume NUMERIC(78,0) NOT NULL,
  future_sell_token_volume NUMERIC(78,0) NOT NULL,
  future_signed_flow_imbalance DOUBLE PRECISION NOT NULL,
  labeled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(mint, observed_block_time, horizon_seconds),
  FOREIGN KEY(mint, observed_block_time)
    REFERENCES pump_research_observations_v2(mint, observed_block_time) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pump_live_signals_v2 (
  mint TEXT PRIMARY KEY,
  observed_at TIMESTAMPTZ NOT NULL,
  observed_block_time BIGINT NOT NULL,
  stage TEXT NOT NULL,
  signal_score DOUBLE PRECISION NOT NULL,
  signal_tier TEXT NOT NULL,
  model_state TEXT NOT NULL DEFAULT 'heuristic-v2-unvalidated',
  evidence JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_pump_live_signals_v2_rank
  ON pump_live_signals_v2(signal_score DESC, observed_block_time DESC);

CREATE TABLE IF NOT EXISTS pump_research_runs_v2 (
  started_at TIMESTAMPTZ PRIMARY KEY,
  completed_at TIMESTAMPTZ,
  watermark BIGINT,
  observations_written INTEGER NOT NULL DEFAULT 0,
  outcomes_written INTEGER NOT NULL DEFAULT 0,
  live_signals_written INTEGER NOT NULL DEFAULT 0,
  error TEXT
);
"""


def conn():
    return psycopg2.connect(DB, connect_timeout=10)


def init():
    with conn() as c, c.cursor() as q:
        q.execute(DDL)


def clamp(x, lo, hi):
    return max(lo, min(hi, x))


def entropy_from_counts(counts):
    total = sum(counts)
    if total <= 0:
        return 0.0
    return -sum((x / total) * math.log(x / total) for x in counts if x > 0)


def ingest_watermark(cur):
    """Use the slowest active source as the point-in-time boundary.

    A wall-clock timestamp is unsafe because labels may run ahead of ingestion.
    Taking the minimum of each active source's latest chain block time gives a
    conservative cross-source watermark, then we subtract a small safety lag.
    """
    cur.execute("""
      SELECT MIN(max_bt) FROM (
        SELECT source_program, MAX(block_time) AS max_bt
        FROM pump_ingest_transactions
        WHERE block_time IS NOT NULL
          AND ingested_at > now() - interval '10 minutes'
        GROUP BY source_program
      ) s
    """)
    row = cur.fetchone()
    if not row or row[0] is None:
        return int(time.time()) - SAFETY_LAG_SECONDS
    return int(row[0]) - SAFETY_LAG_SECONDS


def directional_events(cur, cutoff, watermark):
    """Collapse transaction/mint facts to the user's own signed token delta.

    user_delta > 0 => fee payer acquired the mint (buy-like)
    user_delta < 0 => fee payer disposed of the mint (sell-like)

    Pool/vault counterpart deltas are deliberately excluded from the signed
    flow measure because summing all token accounts for a mint is conserved.
    """
    cur.execute("""
      SELECT d.mint,
             t.block_time,
             t.signature,
             COALESCE(t.fee_payer,''),
             t.source_program,
             COALESCE(SUM(CASE WHEN d.owner=t.fee_payer THEN d.delta ELSE 0 END),0) AS user_delta,
             COALESCE(t.fee_lamports,0),
             COALESCE(t.compute_units,0),
             t.success
      FROM pump_ingest_token_deltas d
      JOIN pump_ingest_transactions t USING(signature)
      WHERE t.block_time BETWEEN %s AND %s
        AND d.delta <> 0
      GROUP BY d.mint,t.block_time,t.signature,t.fee_payer,t.source_program,
               t.fee_lamports,t.compute_units,t.success
      HAVING COALESCE(SUM(CASE WHEN d.owner=t.fee_payer THEN d.delta ELSE 0 END),0) <> 0
      ORDER BY d.mint,t.block_time,t.signature
    """, (cutoff, watermark))
    return cur.fetchall()


def score_features(f):
    activity = f["buy_tx_30s"] + f["sell_tx_30s"]
    if activity <= 0:
        return 0.0, "none"

    imbalance = f["signed_flow_imbalance_30s"]
    buyer_share = f["buyer_share_30s"]
    accel = f["burst_ratio_30s_120s"]
    breadth = min(1.0, f["buyers_30s"] / 8.0)
    concentration = f["largest_user_flow_share_30s"]
    fail_rate = f["failed_tx_30s"] / max(1, f["tx_30s"])
    repeat_rate = f["repeat_participants_120s"] / max(1, f["participants_120s"])

    # Intentionally simple and monotonic so traders can audit every component.
    score = 50.0
    score += 22.0 * imbalance
    score += 12.0 * (2.0 * buyer_share - 1.0)
    score += 9.0 * clamp((accel - 1.0) / 2.0, -1.0, 1.0)
    score += 8.0 * breadth
    score -= 15.0 * concentration
    score -= 10.0 * fail_rate
    score -= 8.0 * max(0.0, repeat_rate - 0.60)
    score = clamp(score, 0.0, 100.0)

    if (
        score >= 78
        and f["tx_30s"] >= max(MIN_TX_30S, 6)
        and f["buyers_30s"] >= max(MIN_BUYERS_30S, 5)
        and imbalance >= 0.20
        and concentration <= 0.45
    ):
        tier = "strong_candidate"
    elif (
        score >= 66
        and f["tx_30s"] >= MIN_TX_30S
        and f["buyers_30s"] >= MIN_BUYERS_30S
        and imbalance > 0
    ):
        tier = "candidate"
    elif score >= 55:
        tier = "watch"
    else:
        tier = "avoid"
    return score, tier


def observe():
    with conn() as c, c.cursor() as q:
        watermark = ingest_watermark(q)
        cutoff = watermark - LOOKBACK_MINUTES * 60
        rows = directional_events(q, cutoff, watermark)

    by_mint = defaultdict(list)
    for row in rows:
        by_mint[row[0]].append(row[1:])

    ranked = sorted(by_mint.items(), key=lambda kv: len(kv[1]), reverse=True)[:MAX_MINTS]
    inserts = []
    live = []

    for mint, events in ranked:
        def window(sec):
            return [e for e in events if int(e[0]) >= watermark - sec]

        w10, w30, w120 = window(10), window(30), window(120)
        if not w30:
            continue

        buys30 = [e for e in w30 if int(e[4]) > 0]
        sells30 = [e for e in w30 if int(e[4]) < 0]
        buys120 = [e for e in w120 if int(e[4]) > 0]
        sells120 = [e for e in w120 if int(e[4]) < 0]

        buyers30 = {e[2] for e in buys30 if e[2]}
        sellers30 = {e[2] for e in sells30 if e[2]}
        participants120 = [e[2] for e in w120 if e[2]]
        participant_counts = Counter(participants120)
        unique120 = set(participants120)
        repeat120 = sum(1 for n in participant_counts.values() if n > 1)

        buy_vol = sum(int(e[4]) for e in buys30)
        sell_vol = sum(abs(int(e[4])) for e in sells30)
        gross = buy_vol + sell_vol
        imbalance = (buy_vol - sell_vol) / gross if gross else 0.0
        buyer_share = len(buys30) / max(1, len(buys30) + len(sells30))
        largest = max((abs(int(e[4])) for e in w30), default=0) / gross if gross else 0.0

        times = sorted({int(e[0]) for e in w120})
        gaps = [(b - a) * 1000.0 for a, b in zip(times, times[1:])]
        mean_gap = statistics.fmean(gaps) if gaps else None
        cv = None
        if mean_gap and len(gaps) > 1:
            cv = statistics.pstdev(gaps) / mean_gap

        # tx_30s divided by the 30s-equivalent rate of the 120s window.
        baseline = max(1.0, len(w120) / 4.0)
        burst = len(w30) / baseline
        failed = sum(1 for e in w30 if not e[7])
        mean_fee = statistics.fmean([int(e[5]) for e in w30]) if w30 else 0.0
        mean_cu = statistics.fmean([int(e[6]) for e in w30]) if w30 else 0.0

        sources = {e[3] for e in events}
        recent_sources = {e[3] for e in w120}
        if "pump" in recent_sources and "pumpswap" in recent_sources:
            stage = "migration"
        elif "pump" in recent_sources:
            stage = "bonding_curve"
        elif "pumpswap" in recent_sources:
            stage = "pumpswap"
        else:
            stage = "unknown"

        f = {
            "tx_10s": len(w10),
            "tx_30s": len(w30),
            "tx_120s": len(w120),
            "buy_tx_30s": len(buys30),
            "sell_tx_30s": len(sells30),
            "buy_tx_120s": len(buys120),
            "sell_tx_120s": len(sells120),
            "buyers_30s": len(buyers30),
            "sellers_30s": len(sellers30),
            "participants_120s": len(unique120),
            "repeat_participants_120s": repeat120,
            "buy_token_volume_30s": buy_vol,
            "sell_token_volume_30s": sell_vol,
            "signed_flow_imbalance_30s": imbalance,
            "buyer_share_30s": buyer_share,
            "largest_user_flow_share_30s": largest,
            "participant_entropy_120s": entropy_from_counts(list(participant_counts.values())),
            "mean_interarrival_ms_120s": mean_gap,
            "interarrival_cv_120s": cv,
            "burst_ratio_30s_120s": burst,
            "failed_tx_30s": failed,
            "mean_fee_lamports_30s": mean_fee,
            "mean_compute_units_30s": mean_cu,
        }
        score, tier = score_features(f)

        extra = {
            "source": "onchain-only",
            "direction_method": "fee_payer_owned_token_delta",
            "all_sources_seen": sorted(sources),
            "recent_sources": sorted(recent_sources),
            "watermark": watermark,
            "model_state": "heuristic-v2-unvalidated",
        }

        inserts.append((
            mint, datetime.now(timezone.utc), watermark, "chain-v2-directional", stage,
            f["tx_10s"], f["tx_30s"], f["tx_120s"], f["buy_tx_30s"], f["sell_tx_30s"],
            f["buy_tx_120s"], f["sell_tx_120s"], f["buyers_30s"], f["sellers_30s"],
            f["participants_120s"], f["repeat_participants_120s"], buy_vol, sell_vol,
            imbalance, buyer_share, largest, f["participant_entropy_120s"], mean_gap, cv,
            burst, failed, mean_fee, mean_cu, score, tier, Json(extra)
        ))

        if tier in {"strong_candidate", "candidate", "watch"}:
            evidence = dict(extra)
            evidence.update({
                "tx_10s": f["tx_10s"],
                "tx_30s": f["tx_30s"],
                "tx_120s": f["tx_120s"],
                "buy_tx_30s": f["buy_tx_30s"],
                "sell_tx_30s": f["sell_tx_30s"],
                "buyers_30s": f["buyers_30s"],
                "sellers_30s": f["sellers_30s"],
                "signed_flow_imbalance_30s": round(imbalance, 6),
                "buyer_share_30s": round(buyer_share, 6),
                "burst_ratio_30s_120s": round(burst, 6),
                "largest_user_flow_share_30s": round(largest, 6),
                "failed_tx_30s": failed,
            })
            live.append((
                mint, datetime.now(timezone.utc), watermark, stage, score, tier,
                "heuristic-v2-unvalidated", Json(evidence),
                datetime.fromtimestamp(watermark + 90, tz=timezone.utc),
            ))

    if not inserts:
        return watermark, 0, 0

    with conn() as c, c.cursor() as q:
        execute_values(q, """
          INSERT INTO pump_research_observations_v2(
            mint,observed_at,observed_block_time,feature_version,stage,
            tx_10s,tx_30s,tx_120s,buy_tx_30s,sell_tx_30s,buy_tx_120s,sell_tx_120s,
            buyers_30s,sellers_30s,participants_120s,repeat_participants_120s,
            buy_token_volume_30s,sell_token_volume_30s,signed_flow_imbalance_30s,
            buyer_share_30s,largest_user_flow_share_30s,participant_entropy_120s,
            mean_interarrival_ms_120s,interarrival_cv_120s,burst_ratio_30s_120s,
            failed_tx_30s,mean_fee_lamports_30s,mean_compute_units_30s,
            signal_score,signal_tier,features
          ) VALUES %s ON CONFLICT DO NOTHING
        """, inserts, page_size=250)
        obs_written = max(q.rowcount, 0)

        q.execute("DELETE FROM pump_live_signals_v2 WHERE expires_at < now()")
        if live:
            execute_values(q, """
              INSERT INTO pump_live_signals_v2(
                mint,observed_at,observed_block_time,stage,signal_score,signal_tier,
                model_state,evidence,expires_at
              ) VALUES %s
              ON CONFLICT(mint) DO UPDATE SET
                observed_at=EXCLUDED.observed_at,
                observed_block_time=EXCLUDED.observed_block_time,
                stage=EXCLUDED.stage,
                signal_score=EXCLUDED.signal_score,
                signal_tier=EXCLUDED.signal_tier,
                model_state=EXCLUDED.model_state,
                evidence=EXCLUDED.evidence,
                expires_at=EXCLUDED.expires_at
            """, live, page_size=250)
        return watermark, obs_written, len(live)


def label(horizon):
    with conn() as c, c.cursor() as q:
        watermark = ingest_watermark(q)
        q.execute("""
          SELECT o.mint,o.observed_block_time
          FROM pump_research_observations_v2 o
          LEFT JOIN pump_research_outcomes_v2 z
            ON z.mint=o.mint
           AND z.observed_block_time=o.observed_block_time
           AND z.horizon_seconds=%s
          WHERE z.mint IS NULL
            AND o.observed_block_time + %s <= %s
          ORDER BY o.observed_block_time
          LIMIT 3000
        """, (horizon, horizon, watermark))
        pending = q.fetchall()
        out = []

        for mint, t0 in pending:
            q.execute("""
              SELECT t.signature,
                     COALESCE(t.fee_payer,''),
                     COALESCE(SUM(CASE WHEN d.owner=t.fee_payer THEN d.delta ELSE 0 END),0) AS user_delta
              FROM pump_ingest_token_deltas d
              JOIN pump_ingest_transactions t USING(signature)
              WHERE d.mint=%s
                AND t.block_time > %s
                AND t.block_time <= %s
              GROUP BY t.signature,t.fee_payer
              HAVING COALESCE(SUM(CASE WHEN d.owner=t.fee_payer THEN d.delta ELSE 0 END),0) <> 0
            """, (mint, t0, t0 + horizon))
            ev = q.fetchall()
            buys = [e for e in ev if int(e[2]) > 0]
            sells = [e for e in ev if int(e[2]) < 0]
            buy_vol = sum(int(e[2]) for e in buys)
            sell_vol = sum(abs(int(e[2])) for e in sells)
            gross = buy_vol + sell_vol
            imb = (buy_vol - sell_vol) / gross if gross else 0.0
            out.append((
                mint, t0, horizon, len(ev), len(buys), len(sells),
                len({e[1] for e in buys if e[1]}),
                len({e[1] for e in sells if e[1]}),
                buy_vol, sell_vol, imb,
            ))

        if out:
            execute_values(q, """
              INSERT INTO pump_research_outcomes_v2(
                mint,observed_block_time,horizon_seconds,future_tx_count,
                future_buy_tx,future_sell_tx,future_buyer_count,future_seller_count,
                future_buy_token_volume,future_sell_token_volume,future_signed_flow_imbalance
              ) VALUES %s ON CONFLICT DO NOTHING
            """, out, page_size=500)
        return len(out)


def cycle():
    started = datetime.now(timezone.utc)
    watermark = None
    obs = outs = signals = 0
    err = None
    try:
        watermark, obs, signals = observe()
        for h in (30, 120, 300, 900):
            outs += label(h)
    except Exception as e:
        err = str(e)[:1000]
        raise
    finally:
        with conn() as c, c.cursor() as q:
            q.execute("""
              INSERT INTO pump_research_runs_v2(
                started_at,completed_at,watermark,observations_written,outcomes_written,
                live_signals_written,error
              ) VALUES(%s,now(),%s,%s,%s,%s,%s)
              ON CONFLICT DO NOTHING
            """, (started, watermark, obs, outs, signals, err))
    return watermark, obs, outs, signals


if __name__ == "__main__":
    init()
    while True:
        try:
            w, o, l, s = cycle()
            print(
                f"research_v2 watermark={w} observations={o} outcomes={l} live_signals={s}",
                flush=True,
            )
        except Exception as e:
            print(f"research_v2 error={e}", flush=True)
        time.sleep(INTERVAL)
