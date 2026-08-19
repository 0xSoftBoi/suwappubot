"""Point-in-time Pump/PumpSwap research pipeline.

Consumes only normalized on-chain facts already captured by pump_ingest.
No social/vendor labels. No execution. No random train/test split.

Materializes reproducible token observations and delayed outcomes so models can
be trained without looking into the future. Designed to run cheaply on the
existing Railway Postgres instance.
"""
from __future__ import annotations

import math
import os
import time
from datetime import datetime, timezone

import psycopg2
from psycopg2.extras import Json, execute_values

DB = os.environ["DATABASE_URL"]
INTERVAL = int(os.getenv("PUMP_RESEARCH_INTERVAL_SECONDS", "30"))
LOOKBACK_MINUTES = int(os.getenv("PUMP_RESEARCH_LOOKBACK_MINUTES", "10"))
MAX_MINTS = int(os.getenv("PUMP_RESEARCH_MAX_MINTS", "1000"))

DDL = """
CREATE TABLE IF NOT EXISTS pump_research_observations (
  mint TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  observed_block_time BIGINT NOT NULL,
  feature_version TEXT NOT NULL DEFAULT 'chain-v1',
  tx_10s INTEGER NOT NULL,
  tx_30s INTEGER NOT NULL,
  tx_120s INTEGER NOT NULL,
  wallets_30s INTEGER NOT NULL,
  wallets_120s INTEGER NOT NULL,
  receivers_30s INTEGER NOT NULL,
  senders_30s INTEGER NOT NULL,
  repeat_wallets_120s INTEGER NOT NULL,
  net_token_flow_30s NUMERIC(78,0) NOT NULL,
  gross_token_flow_30s NUMERIC(78,0) NOT NULL,
  flow_imbalance_30s DOUBLE PRECISION NOT NULL,
  largest_abs_flow_share_30s DOUBLE PRECISION NOT NULL,
  wallet_entropy_120s DOUBLE PRECISION NOT NULL,
  mean_interarrival_ms_120s DOUBLE PRECISION,
  interarrival_cv_120s DOUBLE PRECISION,
  burst_ratio_30s_120s DOUBLE PRECISION NOT NULL,
  fee_lamports_30s BIGINT NOT NULL,
  compute_units_30s BIGINT NOT NULL,
  failed_tx_30s INTEGER NOT NULL,
  features JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY(mint, observed_block_time)
);
CREATE INDEX IF NOT EXISTS ix_pump_research_obs_time ON pump_research_observations(observed_block_time DESC);

CREATE TABLE IF NOT EXISTS pump_research_outcomes (
  mint TEXT NOT NULL,
  observed_block_time BIGINT NOT NULL,
  horizon_seconds INTEGER NOT NULL,
  future_tx_count INTEGER NOT NULL,
  future_wallet_count INTEGER NOT NULL,
  future_net_token_flow NUMERIC(78,0) NOT NULL,
  future_gross_token_flow NUMERIC(78,0) NOT NULL,
  future_flow_imbalance DOUBLE PRECISION NOT NULL,
  labeled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(mint, observed_block_time, horizon_seconds),
  FOREIGN KEY(mint, observed_block_time)
    REFERENCES pump_research_observations(mint, observed_block_time) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pump_research_runs (
  started_at TIMESTAMPTZ PRIMARY KEY,
  completed_at TIMESTAMPTZ,
  observations_written INTEGER NOT NULL DEFAULT 0,
  outcomes_written INTEGER NOT NULL DEFAULT 0,
  error TEXT
);
"""


def conn():
    return psycopg2.connect(DB, connect_timeout=10)


def init():
    with conn() as c, c.cursor() as q:
        q.execute(DDL)


def entropy(counts):
    total = sum(counts)
    if total <= 0: return 0.0
    return -sum((x/total) * math.log(x/total) for x in counts if x > 0)


def observe():
    now_epoch = int(time.time())
    cutoff = now_epoch - LOOKBACK_MINUTES * 60
    sql = """
    SELECT d.mint, t.block_time, t.signature, COALESCE(d.owner,''), d.delta,
           COALESCE(t.fee_lamports,0), COALESCE(t.compute_units,0), t.success
    FROM pump_ingest_token_deltas d
    JOIN pump_ingest_transactions t USING(signature)
    WHERE t.block_time BETWEEN %s AND %s AND d.delta <> 0
    ORDER BY d.mint, t.block_time, t.signature
    """
    with conn() as c, c.cursor() as q:
        q.execute(sql, (cutoff, now_epoch))
        rows = q.fetchall()

    by_mint = {}
    for row in rows:
        by_mint.setdefault(row[0], []).append(row[1:])
    ranked = sorted(by_mint.items(), key=lambda kv: len(kv[1]), reverse=True)[:MAX_MINTS]
    out = []
    for mint, events in ranked:
        def window(sec): return [e for e in events if e[0] >= now_epoch-sec]
        w10,w30,w120 = window(10),window(30),window(120)
        if not w30: continue
        wallets30={e[2] for e in w30 if e[2]}; wallets120={e[2] for e in w120 if e[2]}
        wc={w:0 for w in wallets120}
        for e in w120:
            if e[2]: wc[e[2]] = wc.get(e[2],0)+1
        vals=[int(e[3]) for e in w30]
        gross=sum(abs(x) for x in vals); net=sum(vals)
        times=sorted({int(e[0]) for e in w120})
        gaps=[(b-a)*1000.0 for a,b in zip(times,times[1:])]
        mean_gap=sum(gaps)/len(gaps) if gaps else None
        cv=None
        if mean_gap and len(gaps)>1:
            var=sum((x-mean_gap)**2 for x in gaps)/len(gaps)
            cv=math.sqrt(var)/mean_gap
        imbalance=net/gross if gross else 0.0
        largest=max((abs(x) for x in vals), default=0)/gross if gross else 0.0
        baseline=max(1.0, len(w120)/4.0)
        features={"source":"onchain-only","asof":now_epoch,"event_count_120s":len(w120)}
        out.append((mint,datetime.now(timezone.utc),now_epoch,"chain-v1",len(w10),len(w30),len(w120),
                    len(wallets30),len(wallets120),len({e[2] for e in w30 if e[2] and int(e[3])>0}),
                    len({e[2] for e in w30 if e[2] and int(e[3])<0}),sum(1 for x in wc.values() if x>1),
                    net,gross,imbalance,largest,entropy(list(wc.values())),mean_gap,cv,len(w30)/baseline,
                    sum(int(e[4]) for e in w30),sum(int(e[5]) for e in w30),sum(1 for e in w30 if not e[6]),Json(features)))
    if not out: return 0
    with conn() as c, c.cursor() as q:
        execute_values(q,"""INSERT INTO pump_research_observations(
        mint,observed_at,observed_block_time,feature_version,tx_10s,tx_30s,tx_120s,wallets_30s,wallets_120s,
        receivers_30s,senders_30s,repeat_wallets_120s,net_token_flow_30s,gross_token_flow_30s,flow_imbalance_30s,
        largest_abs_flow_share_30s,wallet_entropy_120s,mean_interarrival_ms_120s,interarrival_cv_120s,burst_ratio_30s_120s,
        fee_lamports_30s,compute_units_30s,failed_tx_30s,features) VALUES %s ON CONFLICT DO NOTHING""",out,page_size=250)
        return max(q.rowcount,0)


def label(horizon):
    now_epoch=int(time.time())
    with conn() as c, c.cursor() as q:
        q.execute("""SELECT o.mint,o.observed_block_time FROM pump_research_observations o
        LEFT JOIN pump_research_outcomes z ON z.mint=o.mint AND z.observed_block_time=o.observed_block_time AND z.horizon_seconds=%s
        WHERE z.mint IS NULL AND o.observed_block_time <= %s ORDER BY o.observed_block_time LIMIT 5000""",(horizon,now_epoch-horizon))
        pending=q.fetchall()
        rows=[]
        for mint,t0 in pending:
            q.execute("""SELECT COUNT(DISTINCT t.signature),COUNT(DISTINCT NULLIF(d.owner,'')),COALESCE(SUM(d.delta),0),COALESCE(SUM(ABS(d.delta)),0)
            FROM pump_ingest_token_deltas d JOIN pump_ingest_transactions t USING(signature)
            WHERE d.mint=%s AND t.block_time > %s AND t.block_time <= %s""",(mint,t0,t0+horizon))
            txs,wallets,net,gross=q.fetchone(); gross=int(gross or 0); net=int(net or 0)
            rows.append((mint,t0,horizon,int(txs or 0),int(wallets or 0),net,gross,(net/gross if gross else 0.0)))
        if rows:
            execute_values(q,"""INSERT INTO pump_research_outcomes(mint,observed_block_time,horizon_seconds,future_tx_count,future_wallet_count,future_net_token_flow,future_gross_token_flow,future_flow_imbalance) VALUES %s ON CONFLICT DO NOTHING""",rows,page_size=500)
        return len(rows)


def cycle():
    started=datetime.now(timezone.utc); obs=outs=0; err=None
    try:
        obs=observe()
        for h in (30,120,300,900): outs += label(h)
    except Exception as e:
        err=str(e)[:1000]
        raise
    finally:
        with conn() as c, c.cursor() as q:
            q.execute("INSERT INTO pump_research_runs(started_at,completed_at,observations_written,outcomes_written,error) VALUES(%s,now(),%s,%s,%s) ON CONFLICT DO NOTHING",(started,obs,outs,err))
    return obs,outs

if __name__ == "__main__":
    init()
    while True:
        try:
            o,l=cycle(); print(f"research_pipeline observations={o} outcomes={l}",flush=True)
        except Exception as e:
            print(f"research_pipeline error={e}",flush=True)
        time.sleep(INTERVAL)
