"""Temporary read-only HTTP snapshot service for GhostCatcher.

All exported records are derived from canonical Solana RPC observations stored by
Suwappu's pump_ingest_* collector. No strategy scores, outcomes, user records, or
private application data are exposed.
"""
from __future__ import annotations

import csv
import io
import json
import os
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import psycopg2
from psycopg2.extras import RealDictCursor

DATABASE_URL = os.environ["DATABASE_URL"]
PORT = int(os.getenv("PORT", "8080"))
FLOW_LIMIT = max(1000, min(int(os.getenv("GC_FLOW_LIMIT", "20000")), 30000))
EDGE_LIMIT = max(1000, min(int(os.getenv("GC_EDGE_LIMIT", "20000")), 30000))


def query(sql: str, params=()):
    conn = psycopg2.connect(DATABASE_URL, connect_timeout=10, cursor_factory=RealDictCursor)
    try:
        with conn, conn.cursor() as cur:
            cur.execute(sql, params)
            return [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()


def as_json(obj) -> bytes:
    return json.dumps(obj, separators=(",", ":"), default=str).encode()


def as_csv(rows: list[dict]) -> bytes:
    if not rows:
        return b""
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=list(rows[0]))
    w.writeheader(); w.writerows(rows)
    return buf.getvalue().encode()


def metadata():
    tx = query("""
      SELECT count(*)::bigint AS transactions,min(block_time)::bigint AS min_block_time,
             max(block_time)::bigint AS max_block_time,count(DISTINCT fee_payer)::bigint AS fee_payers,
             count(*) FILTER (WHERE success)::bigint AS successful,
             count(*) FILTER (WHERE token_delta_count>0)::bigint AS tx_with_token_deltas,
             count(*) FILTER (WHERE sol_delta_count>0)::bigint AS tx_with_sol_deltas
      FROM pump_ingest_transactions
    """)[0]
    token = query("SELECT count(*)::bigint AS rows,count(DISTINCT mint)::bigint AS mints,count(DISTINCT owner)::bigint AS owners FROM pump_ingest_token_deltas WHERE owner<>''")[0]
    sol = query("SELECT count(*)::bigint AS rows,count(DISTINCT account)::bigint AS accounts FROM pump_ingest_sol_deltas")[0]
    ix = query("SELECT count(*)::bigint AS rows,count(DISTINCT program_id)::bigint AS program_ids FROM pump_ingest_instructions")[0]
    return {
      "source":"Suwappu production pump_ingest_* tables",
      "provenance":"Solana RPC normalized facts only",
      "generated_at":datetime.now(timezone.utc).isoformat(),
      "transactions":tx,"token_deltas":token,"sol_deltas":sol,"instructions":ix,
      "exports":{"balanced_token_flows_limit":FLOW_LIMIT,"signer_mint_edges_limit":EDGE_LIMIT,
                 "signer_program_edges_limit":EDGE_LIMIT},
      "attribution_warning":"Behavioral linkage is not attribution. No DPRK labels are assigned from these records."
    }


def wallets():
    return query("""
    WITH roles AS (
      SELECT fee_payer AS address,'fee_payer' AS role,count(*)::bigint AS observations,
             min(block_time)::bigint AS first_block_time,max(block_time)::bigint AS last_block_time
        FROM pump_ingest_transactions WHERE fee_payer<>'' GROUP BY fee_payer
      UNION ALL
      SELECT s.value,'signer',count(*)::bigint,min(t.block_time)::bigint,max(t.block_time)::bigint
        FROM pump_ingest_transactions t CROSS JOIN LATERAL jsonb_array_elements_text(t.signers) s(value)
       WHERE s.value<>'' GROUP BY s.value
      UNION ALL
      SELECT d.owner,'token_owner',count(*)::bigint,min(t.block_time)::bigint,max(t.block_time)::bigint
        FROM pump_ingest_token_deltas d JOIN pump_ingest_transactions t USING(signature)
       WHERE d.owner<>'' GROUP BY d.owner
      UNION ALL
      SELECT d.account,'sol_account',count(*)::bigint,min(t.block_time)::bigint,max(t.block_time)::bigint
        FROM pump_ingest_sol_deltas d JOIN pump_ingest_transactions t USING(signature)
       WHERE d.account<>'' GROUP BY d.account
    )
    SELECT address,role,observations,first_block_time,last_block_time FROM roles
    ORDER BY observations DESC,address,role
    """)


def balanced_token_flows():
    return query("""
    WITH g AS (
      SELECT signature,mint,
             count(*) FILTER (WHERE delta<0 AND owner<>'') AS negatives,
             count(*) FILTER (WHERE delta>0 AND owner<>'') AS positives,
             max(owner) FILTER (WHERE delta<0 AND owner<>'') AS src,
             max(owner) FILTER (WHERE delta>0 AND owner<>'') AS dst,
             max((-delta)::text) FILTER (WHERE delta<0 AND owner<>'') AS amount,
             sum(delta) AS net_delta
      FROM pump_ingest_token_deltas
      WHERE delta<>0 GROUP BY signature,mint
    )
    SELECT g.signature,t.slot,t.block_time,t.source_program,g.mint,g.src,g.dst,g.amount,
           'balanced_delta_exact' AS inference
      FROM g JOIN pump_ingest_transactions t USING(signature)
     WHERE g.negatives=1 AND g.positives=1 AND g.net_delta=0 AND g.src<>g.dst
     ORDER BY t.block_time DESC,t.slot DESC
     LIMIT %s
    """, (FLOW_LIMIT,))


def signer_mint_edges():
    return query("""
    WITH pairs AS (
      SELECT DISTINCT t.signature,t.block_time,s.value AS signer,d.mint
        FROM pump_ingest_transactions t
        CROSS JOIN LATERAL jsonb_array_elements_text(t.signers) s(value)
        JOIN pump_ingest_token_deltas d USING(signature)
       WHERE s.value<>'' AND d.mint<>''
    )
    SELECT signer,mint,count(*)::bigint AS tx_count,min(block_time)::bigint AS first_block_time,
           max(block_time)::bigint AS last_block_time
      FROM pairs GROUP BY signer,mint
     ORDER BY tx_count DESC,last_block_time DESC
     LIMIT %s
    """, (EDGE_LIMIT,))


def signer_program_edges():
    return query("""
    WITH pairs AS (
      SELECT DISTINCT t.signature,t.block_time,s.value AS signer,i.program_id
        FROM pump_ingest_transactions t
        CROSS JOIN LATERAL jsonb_array_elements_text(t.signers) s(value)
        JOIN pump_ingest_instructions i USING(signature)
       WHERE s.value<>'' AND i.program_id<>''
    )
    SELECT signer,program_id,count(*)::bigint AS tx_count,min(block_time)::bigint AS first_block_time,
           max(block_time)::bigint AS last_block_time
      FROM pairs GROUP BY signer,program_id
     ORDER BY tx_count DESC,last_block_time DESC
     LIMIT %s
    """, (EDGE_LIMIT,))


ROUTES = {
  "/metadata.json": ("application/json", lambda: as_json(metadata())),
  "/wallets.csv": ("text/csv", lambda: as_csv(wallets())),
  "/balanced_token_flows.csv": ("text/csv", lambda: as_csv(balanced_token_flows())),
  "/signer_mint_edges.csv": ("text/csv", lambda: as_csv(signer_mint_edges())),
  "/signer_program_edges.csv": ("text/csv", lambda: as_csv(signer_program_edges())),
}

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            body=b"ok\n"; ctype="text/plain"
        elif self.path in ROUTES:
            ctype, fn = ROUTES[self.path]
            try: body = fn()
            except Exception as exc:
                body=as_json({"error":type(exc).__name__,"message":str(exc)}); ctype="application/json"
                self.send_response(500); self.send_header("Content-Type",ctype); self.send_header("Content-Length",str(len(body))); self.end_headers(); self.wfile.write(body); return
        else:
            body=as_json({"paths":list(ROUTES)+["/health"]}); ctype="application/json"
        self.send_response(200); self.send_header("Content-Type",ctype); self.send_header("Content-Length",str(len(body))); self.end_headers(); self.wfile.write(body)
    def log_message(self, fmt, *args):
        print("HTTP", fmt % args, flush=True)

if __name__ == "__main__":
    print(f"GhostCatcher snapshot server listening on {PORT}", flush=True)
    ThreadingHTTPServer(("0.0.0.0",PORT), Handler).serve_forever()
