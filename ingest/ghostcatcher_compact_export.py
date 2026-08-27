"""One-shot compact real-chain snapshot for GhostCatcher.

Exports only normalized Solana RPC facts from Suwappu production tables plus
explicitly marked conservative relations derived from exact token-balance deltas.
The combined JSONL bundle is gzip-compressed before base64 transport through
Railway logs so the committed snapshot is byte-for-byte verifiable.
"""
from __future__ import annotations

import base64
import csv
import gzip
import hashlib
import io
import json
import os

import psycopg2
from psycopg2.extras import RealDictCursor

DATABASE_URL = os.environ["DATABASE_URL"]
N = max(25, min(int(os.getenv("GC_COMPACT_N", "100")), 100))


def q(cur, sql, params=()):
    cur.execute(sql, params)
    return [dict(r) for r in cur.fetchall()]


def csv_bytes(rows):
    if not rows:
        return b""
    b = io.StringIO()
    w = csv.DictWriter(b, fieldnames=list(rows[0]))
    w.writeheader()
    w.writerows(rows)
    return b.getvalue().encode()


def emit_csv(name, rows, meta):
    raw = csv_bytes(rows)
    meta[name] = {
        "rows": len(rows),
        "sha256": hashlib.sha256(raw).hexdigest(),
        "bytes": len(raw),
    }
    print(f"GC_B64_{name.upper()} " + base64.b64encode(raw).decode(), flush=True)


def bundle_bytes(meta, datasets):
    lines = [json.dumps({"record_type": "metadata", **meta}, separators=(",", ":"), sort_keys=True, default=str)]
    for record_type, rows in datasets:
        for row in rows:
            lines.append(json.dumps({"record_type": record_type, **row}, separators=(",", ":"), sort_keys=True, default=str))
    raw = ("\n".join(lines) + "\n").encode()
    return gzip.compress(raw, compresslevel=9, mtime=0), raw


def main():
    conn = psycopg2.connect(DATABASE_URL, connect_timeout=10, cursor_factory=RealDictCursor)
    meta = {
        "source": "Suwappu production pump_ingest_* tables",
        "provenance": "Solana RPC normalized facts only",
        "selection": "latest canonical transactions; highest-frequency aggregate relations; exact-balanced token flows",
        "rows_per_export": N,
        "attribution_warning": "Behavioral linkage is not attribution. No DPRK labels are assigned from these records.",
    }
    with conn, conn.cursor() as cur:
        corpus = q(cur, """SELECT count(*)::bigint transactions,min(block_time)::bigint min_block_time,max(block_time)::bigint max_block_time,count(DISTINCT fee_payer)::bigint fee_payers,count(*) FILTER(WHERE success)::bigint successful FROM pump_ingest_transactions""")[0]
        corpus["token_deltas"] = q(cur, "SELECT count(*)::bigint rows,count(DISTINCT mint)::bigint mints,count(DISTINCT owner)::bigint owners FROM pump_ingest_token_deltas WHERE owner<>''")[0]
        corpus["sol_deltas"] = q(cur, "SELECT count(*)::bigint rows,count(DISTINCT account)::bigint accounts FROM pump_ingest_sol_deltas")[0]
        corpus["instructions"] = q(cur, "SELECT count(*)::bigint rows,count(DISTINCT program_id)::bigint program_ids FROM pump_ingest_instructions")[0]
        meta["corpus"] = corpus

        tx = q(cur, """SELECT signature,source_program,program_id,slot,block_time,fee_payer,success,fee_lamports,compute_units,instruction_count,sol_delta_count,token_delta_count FROM pump_ingest_transactions WHERE block_time IS NOT NULL ORDER BY block_time DESC,slot DESC,signature LIMIT %s""", (N,))
        flows = q(cur, """WITH g AS (SELECT signature,mint,count(*) FILTER(WHERE delta<0 AND owner<>'') negatives,count(*) FILTER(WHERE delta>0 AND owner<>'') positives,max(owner) FILTER(WHERE delta<0 AND owner<>'') src,max(owner) FILTER(WHERE delta>0 AND owner<>'') dst,max((-delta)::text) FILTER(WHERE delta<0 AND owner<>'') amount,sum(delta) net_delta FROM pump_ingest_token_deltas WHERE delta<>0 GROUP BY signature,mint) SELECT g.signature,t.slot,t.block_time,t.source_program,g.mint,g.src,g.dst,g.amount,'balanced_delta_exact' inference FROM g JOIN pump_ingest_transactions t USING(signature) WHERE g.negatives=1 AND g.positives=1 AND g.net_delta=0 AND g.src<>g.dst ORDER BY t.block_time DESC,t.slot DESC,g.signature LIMIT %s""", (N,))
        sm = q(cur, """WITH pairs AS (SELECT DISTINCT t.signature,t.block_time,s.value signer,d.mint FROM pump_ingest_transactions t CROSS JOIN LATERAL jsonb_array_elements_text(t.signers) s(value) JOIN pump_ingest_token_deltas d USING(signature) WHERE s.value<>'' AND d.mint<>'') SELECT signer,mint,count(*)::bigint tx_count,min(block_time)::bigint first_block_time,max(block_time)::bigint last_block_time FROM pairs GROUP BY signer,mint ORDER BY tx_count DESC,last_block_time DESC,signer,mint LIMIT %s""", (N,))
        sp = q(cur, """WITH pairs AS (SELECT DISTINCT t.signature,t.block_time,s.value signer,i.program_id FROM pump_ingest_transactions t CROSS JOIN LATERAL jsonb_array_elements_text(t.signers) s(value) JOIN pump_ingest_instructions i USING(signature) WHERE s.value<>'' AND i.program_id<>'') SELECT signer,program_id,count(*)::bigint tx_count,min(block_time)::bigint first_block_time,max(block_time)::bigint last_block_time FROM pairs GROUP BY signer,program_id ORDER BY tx_count DESC,last_block_time DESC,signer,program_id LIMIT %s""", (N,))
        wallets = q(cur, """WITH roles AS (SELECT fee_payer address,'fee_payer' role,count(*)::bigint observations,min(block_time)::bigint first_block_time,max(block_time)::bigint last_block_time FROM pump_ingest_transactions WHERE fee_payer<>'' GROUP BY fee_payer UNION ALL SELECT s.value,'signer',count(*)::bigint,min(t.block_time)::bigint,max(t.block_time)::bigint FROM pump_ingest_transactions t CROSS JOIN LATERAL jsonb_array_elements_text(t.signers) s(value) WHERE s.value<>'' GROUP BY s.value UNION ALL SELECT d.owner,'token_owner',count(*)::bigint,min(t.block_time)::bigint,max(t.block_time)::bigint FROM pump_ingest_token_deltas d JOIN pump_ingest_transactions t USING(signature) WHERE d.owner<>'' GROUP BY d.owner), ranked AS (SELECT address,role,observations,first_block_time,last_block_time FROM roles) SELECT * FROM ranked ORDER BY observations DESC,last_block_time DESC,address,role LIMIT %s""", (N,))

    datasets = [
        ("transaction", tx),
        ("token_flow", flows),
        ("signer_mint_edge", sm),
        ("signer_program_edge", sp),
        ("wallet_role", wallets),
    ]
    for name, rows in [("transactions", tx), ("token_flows", flows), ("signer_mint_edges", sm), ("signer_program_edges", sp), ("wallet_roles", wallets)]:
        emit_csv(name, rows, meta)

    gz, raw_jsonl = bundle_bytes(meta, datasets)
    meta["bundle"] = {
        "records": 1 + sum(len(rows) for _, rows in datasets),
        "jsonl_sha256": hashlib.sha256(raw_jsonl).hexdigest(),
        "jsonl_bytes": len(raw_jsonl),
        "gzip_sha256": hashlib.sha256(gz).hexdigest(),
        "gzip_bytes": len(gz),
        "format": "gzip-compressed JSON Lines",
    }
    print("GC_B64_SNAPSHOT_GZ " + base64.b64encode(gz).decode(), flush=True)
    print("GC_COMPACT_META " + json.dumps(meta, separators=(",", ":"), default=str), flush=True)


if __name__ == "__main__":
    main()
