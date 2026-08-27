"""Read-only one-shot exporter for GhostCatcher research.

Exports only canonical Solana RPC-derived facts from the pump_ingest_* tables.
No strategy scores, labels, outcomes, or private application data are included.
Each stdout line is compact JSON prefixed with GC_, which makes Railway logs a
bounded transport for an analyst snapshot without exposing Postgres publicly.
"""
from __future__ import annotations

import json
import os

import psycopg2
from psycopg2.extras import RealDictCursor

DATABASE_URL = os.environ["DATABASE_URL"]
TX_LIMIT = max(25, min(int(os.getenv("GC_TX_LIMIT", "140")), 180))
TOKEN_LIMIT = max(50, min(int(os.getenv("GC_TOKEN_LIMIT", "190")), 220))
SOL_LIMIT = max(25, min(int(os.getenv("GC_SOL_LIMIT", "70")), 100))
IX_LIMIT = max(25, min(int(os.getenv("GC_IX_LIMIT", "60")), 80))


def emit(kind: str, row: dict) -> None:
    def default(v):
        if hasattr(v, "isoformat"):
            return v.isoformat()
        return str(v)
    print(f"GC_{kind} " + json.dumps(row, separators=(",", ":"), default=default), flush=True)


def main() -> None:
    conn = psycopg2.connect(DATABASE_URL, connect_timeout=10, cursor_factory=RealDictCursor)
    with conn, conn.cursor() as cur:
        cur.execute("""
          SELECT count(*)::bigint AS transactions,
                 min(block_time)::bigint AS min_block_time,
                 max(block_time)::bigint AS max_block_time,
                 count(DISTINCT fee_payer)::bigint AS fee_payers,
                 count(*) FILTER (WHERE success)::bigint AS successful,
                 count(*) FILTER (WHERE token_delta_count>0)::bigint AS tx_with_token_deltas,
                 count(*) FILTER (WHERE sol_delta_count>0)::bigint AS tx_with_sol_deltas
          FROM pump_ingest_transactions
        """)
        meta = dict(cur.fetchone())
        cur.execute("SELECT count(*)::bigint AS rows, count(DISTINCT mint)::bigint AS mints, count(DISTINCT owner)::bigint AS owners FROM pump_ingest_token_deltas WHERE owner<>''")
        meta["token_deltas"] = dict(cur.fetchone())
        cur.execute("SELECT count(*)::bigint AS rows, count(DISTINCT account)::bigint AS accounts FROM pump_ingest_sol_deltas")
        meta["sol_deltas"] = dict(cur.fetchone())
        cur.execute("SELECT count(*)::bigint AS rows, count(DISTINCT program_id)::bigint AS program_ids FROM pump_ingest_instructions")
        meta["instructions"] = dict(cur.fetchone())
        emit("META", meta)

        cur.execute("""
          SELECT signature,source_program,program_id,slot,block_time,fee_payer,
                 success,fee_lamports,compute_units,account_keys,signers,programs,
                 instruction_count,sol_delta_count,token_delta_count
          FROM pump_ingest_transactions
          WHERE block_time IS NOT NULL
          ORDER BY block_time DESC, slot DESC
          LIMIT %s
        """, (TX_LIMIT,))
        txs = [dict(r) for r in cur.fetchall()]
        signatures = [r["signature"] for r in txs]
        for row in txs:
            emit("TX", row)

        if signatures:
            cur.execute("""
              SELECT d.signature,d.account_index,d.mint,d.owner,d.decimals,
                     d.pre_amount::text,d.post_amount::text,d.delta::text,
                     t.block_time,t.slot,t.source_program,t.signers
              FROM pump_ingest_token_deltas d
              JOIN pump_ingest_transactions t USING(signature)
              WHERE d.signature = ANY(%s) AND d.delta<>0
              ORDER BY t.block_time DESC,d.signature,d.account_index
              LIMIT %s
            """, (signatures, TOKEN_LIMIT))
            for row in cur.fetchall():
                emit("TOKEN", dict(row))

            cur.execute("""
              SELECT d.signature,d.account_index,d.account,d.delta_lamports,
                     t.block_time,t.slot,t.source_program,t.signers
              FROM pump_ingest_sol_deltas d
              JOIN pump_ingest_transactions t USING(signature)
              WHERE d.signature = ANY(%s) AND d.delta_lamports<>0
              ORDER BY t.block_time DESC,d.signature,d.account_index
              LIMIT %s
            """, (signatures, SOL_LIMIT))
            for row in cur.fetchall():
                emit("SOL", dict(row))

            cur.execute("""
              SELECT i.signature,i.ordinal,i.inner_instruction,i.parent_index,
                     i.program_id,i.instruction_type,i.accounts,
                     t.block_time,t.slot,t.source_program
              FROM pump_ingest_instructions i
              JOIN pump_ingest_transactions t USING(signature)
              WHERE i.signature = ANY(%s)
              ORDER BY t.block_time DESC,i.signature,i.ordinal
              LIMIT %s
            """, (signatures, IX_LIMIT))
            for row in cur.fetchall():
                emit("IX", dict(row))

        emit("DONE", {"tx": len(txs), "token_limit": TOKEN_LIMIT, "sol_limit": SOL_LIMIT, "ix_limit": IX_LIMIT})


if __name__ == "__main__":
    main()
