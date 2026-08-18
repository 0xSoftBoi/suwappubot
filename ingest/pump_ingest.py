"""Pump/PumpSwap Solana ledger collector.

Design goals:
- source of truth is Solana RPC only
- no full uncompressed transaction JSON is ever persisted
- durable query layer is normalized transaction / SOL delta / token delta / instruction facts
- raw RPC payload is gzip-compressed immediately and retained only briefly
- hard raw-byte and table-size budgets prevent silent storage runaway
- cursor pagination avoids missing bursts between polling intervals

No strategy logic lives here.
"""

from __future__ import annotations

import asyncio
import gzip
import json
import logging
import os
import signal
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import aiohttp
import psycopg2
from psycopg2.extras import Json, execute_values

LOG = logging.getLogger("pump_ingest")

DEFAULT_PROGRAMS = {
    "pumpswap": "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
}


def env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() not in {"0", "false", "no", "off"}


def env_int(name: str, default: int, lo: int, hi: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError:
        value = default
    return max(lo, min(hi, value))


def env_float(name: str, default: float, lo: float, hi: float) -> float:
    try:
        value = float(os.getenv(name, str(default)))
    except ValueError:
        value = default
    return max(lo, min(hi, value))


@dataclass(frozen=True)
class Target:
    label: str
    program_id: str


def parse_targets() -> List[Target]:
    raw = os.getenv("PUMP_INGEST_PROGRAMS", "").strip()
    if not raw:
        return [Target(k, v) for k, v in DEFAULT_PROGRAMS.items()]
    out: List[Target] = []
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        if "=" in part:
            label, program_id = part.split("=", 1)
        elif ":" in part:
            label, program_id = part.split(":", 1)
        else:
            label, program_id = "program", part
        label, program_id = label.strip().lower(), program_id.strip()
        if label and program_id:
            out.append(Target(label, program_id))
    return out


class Store:
    def __init__(self, database_url: str) -> None:
        self.database_url = database_url

    def connect(self):
        return psycopg2.connect(self.database_url, connect_timeout=10)

    def init_schema(self) -> None:
        ddl = """
        CREATE TABLE IF NOT EXISTS pump_ingest_transactions (
            signature TEXT PRIMARY KEY,
            source_program TEXT NOT NULL,
            program_id TEXT NOT NULL,
            slot BIGINT NOT NULL,
            block_time BIGINT,
            fee_payer TEXT,
            success BOOLEAN NOT NULL,
            fee_lamports BIGINT,
            compute_units BIGINT,
            account_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
            signers JSONB NOT NULL DEFAULT '[]'::jsonb,
            programs JSONB NOT NULL DEFAULT '[]'::jsonb,
            instruction_count INTEGER NOT NULL DEFAULT 0,
            sol_delta_count INTEGER NOT NULL DEFAULT 0,
            token_delta_count INTEGER NOT NULL DEFAULT 0,
            raw_gzip BYTEA,
            raw_uncompressed_bytes INTEGER NOT NULL DEFAULT 0,
            raw_compressed_bytes INTEGER NOT NULL DEFAULT 0,
            raw_expires_at TIMESTAMPTZ,
            ingested_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS ix_pump_tx_program_slot
            ON pump_ingest_transactions(source_program, slot DESC);
        CREATE INDEX IF NOT EXISTS ix_pump_tx_fee_payer_slot
            ON pump_ingest_transactions(fee_payer, slot DESC);
        CREATE INDEX IF NOT EXISTS ix_pump_tx_block_time
            ON pump_ingest_transactions(block_time DESC);
        CREATE INDEX IF NOT EXISTS ix_pump_tx_raw_expiry
            ON pump_ingest_transactions(raw_expires_at)
            WHERE raw_gzip IS NOT NULL;

        CREATE TABLE IF NOT EXISTS pump_ingest_sol_deltas (
            signature TEXT NOT NULL REFERENCES pump_ingest_transactions(signature) ON DELETE CASCADE,
            account_index INTEGER NOT NULL,
            account TEXT NOT NULL,
            delta_lamports BIGINT NOT NULL,
            PRIMARY KEY(signature, account_index)
        );
        CREATE INDEX IF NOT EXISTS ix_pump_sol_account_sig
            ON pump_ingest_sol_deltas(account, signature);

        CREATE TABLE IF NOT EXISTS pump_ingest_token_deltas (
            signature TEXT NOT NULL REFERENCES pump_ingest_transactions(signature) ON DELETE CASCADE,
            account_index INTEGER NOT NULL,
            mint TEXT NOT NULL,
            owner TEXT NOT NULL DEFAULT '',
            decimals SMALLINT,
            pre_amount NUMERIC(78,0) NOT NULL,
            post_amount NUMERIC(78,0) NOT NULL,
            delta NUMERIC(78,0) NOT NULL,
            PRIMARY KEY(signature, account_index, mint, owner)
        );
        CREATE INDEX IF NOT EXISTS ix_pump_token_owner_mint_sig
            ON pump_ingest_token_deltas(owner, mint, signature);
        CREATE INDEX IF NOT EXISTS ix_pump_token_mint_sig
            ON pump_ingest_token_deltas(mint, signature);

        CREATE TABLE IF NOT EXISTS pump_ingest_instructions (
            signature TEXT NOT NULL REFERENCES pump_ingest_transactions(signature) ON DELETE CASCADE,
            ordinal INTEGER NOT NULL,
            inner_instruction BOOLEAN NOT NULL DEFAULT FALSE,
            parent_index INTEGER,
            program_id TEXT,
            instruction_type TEXT,
            accounts JSONB NOT NULL DEFAULT '[]'::jsonb,
            data TEXT,
            parsed JSONB,
            PRIMARY KEY(signature, ordinal)
        );
        CREATE INDEX IF NOT EXISTS ix_pump_ix_program_sig
            ON pump_ingest_instructions(program_id, signature);

        CREATE TABLE IF NOT EXISTS pump_ingest_cursor (
            source_program TEXT PRIMARY KEY,
            program_id TEXT NOT NULL,
            newest_signature TEXT,
            newest_slot BIGINT,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS pump_ingest_metrics (
            minute TIMESTAMPTZ PRIMARY KEY,
            rows_inserted BIGINT NOT NULL DEFAULT 0,
            rpc_transactions BIGINT NOT NULL DEFAULT 0,
            raw_uncompressed_bytes BIGINT NOT NULL DEFAULT 0,
            raw_compressed_bytes BIGINT NOT NULL DEFAULT 0,
            errors BIGINT NOT NULL DEFAULT 0
        );
        """
        with self.connect() as conn, conn.cursor() as cur:
            cur.execute(ddl)

    def existing(self, signatures: Sequence[str]) -> set[str]:
        if not signatures:
            return set()
        with self.connect() as conn, conn.cursor() as cur:
            cur.execute("SELECT signature FROM pump_ingest_transactions WHERE signature = ANY(%s)", (list(signatures),))
            return {row[0] for row in cur.fetchall()}

    def get_cursor(self, target: Target) -> Optional[str]:
        with self.connect() as conn, conn.cursor() as cur:
            cur.execute("SELECT newest_signature FROM pump_ingest_cursor WHERE source_program=%s", (target.label,))
            row = cur.fetchone()
            return row[0] if row else None

    def set_cursor(self, target: Target, signature: str, slot: Optional[int]) -> None:
        with self.connect() as conn, conn.cursor() as cur:
            cur.execute(
                """INSERT INTO pump_ingest_cursor(source_program,program_id,newest_signature,newest_slot,updated_at)
                   VALUES(%s,%s,%s,%s,now())
                   ON CONFLICT(source_program) DO UPDATE SET
                     program_id=EXCLUDED.program_id,newest_signature=EXCLUDED.newest_signature,
                     newest_slot=EXCLUDED.newest_slot,updated_at=now()""",
                (target.label, target.program_id, signature, slot),
            )

    def insert_batch(self, bundles: Sequence[Dict[str, Any]]) -> int:
        if not bundles:
            return 0
        tx_rows, sol_rows, token_rows, ix_rows = [], [], [], []
        for b in bundles:
            t = b["tx"]
            tx_rows.append((
                t["signature"], t["source_program"], t["program_id"], t["slot"], t["block_time"],
                t["fee_payer"], t["success"], t["fee_lamports"], t["compute_units"],
                Json(t["account_keys"]), Json(t["signers"]), Json(t["programs"]),
                t["instruction_count"], len(b["sol"]), len(b["token"]),
                psycopg2.Binary(t["raw_gzip"]) if t["raw_gzip"] is not None else None,
                t["raw_uncompressed_bytes"], t["raw_compressed_bytes"], t["raw_expires_at"],
            ))
            sol_rows.extend((t["signature"], *r) for r in b["sol"])
            token_rows.extend((t["signature"], *r) for r in b["token"])
            ix_rows.extend((t["signature"], *r) for r in b["ix"])

        with self.connect() as conn, conn.cursor() as cur:
            execute_values(cur, """
                INSERT INTO pump_ingest_transactions(
                    signature,source_program,program_id,slot,block_time,fee_payer,success,
                    fee_lamports,compute_units,account_keys,signers,programs,instruction_count,
                    sol_delta_count,token_delta_count,raw_gzip,raw_uncompressed_bytes,
                    raw_compressed_bytes,raw_expires_at)
                VALUES %s ON CONFLICT(signature) DO NOTHING
            """, tx_rows, page_size=250)
            inserted = cur.rowcount
            if sol_rows:
                execute_values(cur, """INSERT INTO pump_ingest_sol_deltas(signature,account_index,account,delta_lamports)
                    VALUES %s ON CONFLICT DO NOTHING""", sol_rows, page_size=1000)
            if token_rows:
                execute_values(cur, """INSERT INTO pump_ingest_token_deltas(
                    signature,account_index,mint,owner,decimals,pre_amount,post_amount,delta)
                    VALUES %s ON CONFLICT DO NOTHING""", token_rows, page_size=1000)
            if ix_rows:
                execute_values(cur, """INSERT INTO pump_ingest_instructions(
                    signature,ordinal,inner_instruction,parent_index,program_id,instruction_type,accounts,data,parsed)
                    VALUES %s ON CONFLICT DO NOTHING""", ix_rows, page_size=1000)
        return max(0, inserted)

    def expire_raw(self, raw_budget_bytes: int) -> Tuple[int, int]:
        """Expire by TTL first, then enforce a hard byte budget by oldest-first deletion."""
        with self.connect() as conn, conn.cursor() as cur:
            cur.execute("""UPDATE pump_ingest_transactions
                           SET raw_gzip=NULL, raw_compressed_bytes=0
                           WHERE raw_gzip IS NOT NULL AND raw_expires_at <= now()""")
            ttl_deleted = cur.rowcount
            cur.execute("SELECT COALESCE(sum(raw_compressed_bytes),0) FROM pump_ingest_transactions WHERE raw_gzip IS NOT NULL")
            raw_bytes = int(cur.fetchone()[0] or 0)
            budget_deleted = 0
            while raw_bytes > raw_budget_bytes:
                cur.execute("""WITH victims AS (
                                SELECT signature, raw_compressed_bytes
                                FROM pump_ingest_transactions
                                WHERE raw_gzip IS NOT NULL
                                ORDER BY ingested_at ASC
                                LIMIT 1000
                              )
                              UPDATE pump_ingest_transactions t
                              SET raw_gzip=NULL, raw_compressed_bytes=0
                              FROM victims v WHERE t.signature=v.signature
                              RETURNING v.raw_compressed_bytes""")
                freed = sum(int(r[0] or 0) for r in cur.fetchall())
                budget_deleted += cur.rowcount
                if freed <= 0:
                    break
                raw_bytes -= freed
            return ttl_deleted + budget_deleted, max(0, raw_bytes)

    def relation_bytes(self) -> int:
        names = ["pump_ingest_transactions", "pump_ingest_sol_deltas", "pump_ingest_token_deltas", "pump_ingest_instructions"]
        with self.connect() as conn, conn.cursor() as cur:
            cur.execute("SELECT COALESCE(sum(pg_total_relation_size(x::regclass)),0) FROM unnest(%s::text[]) x", (names,))
            return int(cur.fetchone()[0] or 0)

    def record_metric(self, rows: int, rpc_txs: int, raw_in: int, raw_gz: int, errors: int) -> None:
        minute = datetime.now(timezone.utc).replace(second=0, microsecond=0)
        with self.connect() as conn, conn.cursor() as cur:
            cur.execute("""INSERT INTO pump_ingest_metrics(minute,rows_inserted,rpc_transactions,raw_uncompressed_bytes,raw_compressed_bytes,errors)
                           VALUES(%s,%s,%s,%s,%s,%s)
                           ON CONFLICT(minute) DO UPDATE SET
                             rows_inserted=pump_ingest_metrics.rows_inserted+EXCLUDED.rows_inserted,
                             rpc_transactions=pump_ingest_metrics.rpc_transactions+EXCLUDED.rpc_transactions,
                             raw_uncompressed_bytes=pump_ingest_metrics.raw_uncompressed_bytes+EXCLUDED.raw_uncompressed_bytes,
                             raw_compressed_bytes=pump_ingest_metrics.raw_compressed_bytes+EXCLUDED.raw_compressed_bytes,
                             errors=pump_ingest_metrics.errors+EXCLUDED.errors""",
                        (minute, rows, rpc_txs, raw_in, raw_gz, errors))

    def projection(self) -> Dict[str, float]:
        with self.connect() as conn, conn.cursor() as cur:
            cur.execute("""SELECT COALESCE(sum(rows_inserted),0), COALESCE(sum(raw_compressed_bytes),0),
                                  GREATEST(EXTRACT(EPOCH FROM (max(minute)-min(minute)))/3600.0, 1.0)
                           FROM pump_ingest_metrics WHERE minute > now() - interval '24 hours'""")
            rows, raw, hours = cur.fetchone()
        hours = float(hours or 1.0)
        return {
            "rows_per_hour": float(rows or 0) / hours,
            "raw_mb_per_hour": float(raw or 0) / hours / (1024 * 1024),
            "projected_rows_30d": float(rows or 0) / hours * 24 * 30,
        }


class Collector:
    def __init__(self) -> None:
        self.database_url = os.environ["DATABASE_URL"]
        self.targets = parse_targets()
        self.rpc_urls = [x.strip() for x in os.getenv(
            "PUMP_INGEST_RPC_URLS",
            "https://api.mainnet-beta.solana.com,https://solana-mainnet.rpc.extrnode.com",
        ).split(",") if x.strip()]
        self.poll_seconds = env_float("PUMP_INGEST_POLL_SECONDS", 2.0, 0.5, 60.0)
        self.concurrency = env_int("PUMP_INGEST_CONCURRENCY", 8, 1, 32)
        self.page_limit = env_int("PUMP_INGEST_SIGNATURE_LIMIT", 1000, 100, 1000)
        self.max_catchup_pages = env_int("PUMP_INGEST_MAX_CATCHUP_PAGES", 100, 1, 500)
        self.bootstrap_limit = env_int("PUMP_INGEST_BOOTSTRAP_LIMIT", 1000, 100, 10000)
        self.raw_ttl_minutes = env_int("PUMP_INGEST_RAW_TTL_MINUTES", 60, 0, 1440)
        self.raw_budget_mb = env_int("PUMP_INGEST_RAW_BUDGET_MB", 256, 0, 4096)
        self.max_table_gb = env_float("PUMP_INGEST_MAX_TABLE_GB", 2.0, 0.25, 50.0)
        self.cleanup_seconds = env_int("PUMP_INGEST_CLEANUP_SECONDS", 60, 15, 3600)
        self.store = Store(self.database_url)
        self.session: Optional[aiohttp.ClientSession] = None
        self.sem = asyncio.Semaphore(self.concurrency)
        self.running = True
        self.rpc_index = 0
        self.last_cleanup = 0.0

    def next_rpc(self) -> str:
        if not self.rpc_urls:
            raise RuntimeError("No Solana RPC endpoints configured")
        url = self.rpc_urls[self.rpc_index % len(self.rpc_urls)]
        self.rpc_index += 1
        return url

    async def rpc(self, method: str, params: List[Any]) -> Any:
        assert self.session is not None
        last_error: Optional[Exception] = None
        for _ in range(max(1, len(self.rpc_urls))):
            url = self.next_rpc()
            try:
                async with self.session.post(url, json={"jsonrpc":"2.0","id":1,"method":method,"params":params}, timeout=20) as resp:
                    if resp.status != 200:
                        raise RuntimeError(f"HTTP {resp.status}")
                    body = await resp.json(content_type=None)
                    if body.get("error"):
                        raise RuntimeError(str(body["error"]))
                    return body.get("result")
            except Exception as exc:
                last_error = exc
                LOG.warning("rpc failed method=%s url=%s error=%s", method, url, exc)
        raise RuntimeError(f"all RPC endpoints failed for {method}: {last_error}")

    async def signatures_since(self, target: Target, cursor: Optional[str]) -> List[Dict[str, Any]]:
        if cursor is None:
            result = await self.rpc("getSignaturesForAddress", [target.program_id, {"limit": min(self.page_limit, self.bootstrap_limit), "commitment":"confirmed"}])
            return result or []

        collected: List[Dict[str, Any]] = []
        before: Optional[str] = None
        found = False
        for _ in range(self.max_catchup_pages):
            opts: Dict[str, Any] = {"limit": self.page_limit, "commitment":"confirmed"}
            if before:
                opts["before"] = before
            page = await self.rpc("getSignaturesForAddress", [target.program_id, opts]) or []
            if not page:
                break
            for item in page:
                if item.get("signature") == cursor:
                    found = True
                    break
                collected.append(item)
            if found:
                break
            before = page[-1].get("signature")
            if len(page) < self.page_limit:
                break
        if not found and collected:
            LOG.warning("cursor not reached program=%s pages=%s collected=%s; not advancing cursor until gap is closed",
                        target.label, self.max_catchup_pages, len(collected))
            raise RuntimeError("catchup window exhausted before cursor; increase PUMP_INGEST_MAX_CATCHUP_PAGES")
        return collected

    async def get_transaction(self, signature: str) -> Optional[Dict[str, Any]]:
        async with self.sem:
            return await self.rpc("getTransaction", [signature, {"encoding":"jsonParsed","commitment":"confirmed","maxSupportedTransactionVersion":0}])

    @staticmethod
    def account_keys(message: Dict[str, Any]) -> Tuple[List[str], List[str]]:
        keys, signers = [], []
        for item in message.get("accountKeys") or []:
            if isinstance(item, str):
                keys.append(item)
            elif isinstance(item, dict):
                pk = str(item.get("pubkey") or "")
                if pk:
                    keys.append(pk)
                    if item.get("signer"):
                        signers.append(pk)
        return keys, signers

    @staticmethod
    def resolve_program(ix: Dict[str, Any], keys: Sequence[str]) -> Optional[str]:
        if ix.get("programId"):
            return str(ix["programId"])
        idx = ix.get("programIdIndex")
        if isinstance(idx, int) and 0 <= idx < len(keys):
            return keys[idx]
        if ix.get("program"):
            return str(ix["program"])
        return None

    def bundle(self, target: Target, signature: str, result: Dict[str, Any]) -> Dict[str, Any]:
        tx = result.get("transaction") or {}
        message = tx.get("message") or {}
        meta = result.get("meta") or {}
        keys, signers = self.account_keys(message)
        pre_sol = meta.get("preBalances") or []
        post_sol = meta.get("postBalances") or []

        sol_rows: List[Tuple[Any, ...]] = []
        for idx in range(min(len(keys), len(pre_sol), len(post_sol))):
            delta = int(post_sol[idx]) - int(pre_sol[idx])
            if delta:
                sol_rows.append((idx, keys[idx], delta))

        def token_map(values: Iterable[Dict[str, Any]]) -> Dict[Tuple[int, str, str], Dict[str, Any]]:
            out = {}
            for b in values:
                idx = int(b.get("accountIndex", -1))
                mint = str(b.get("mint") or "")
                owner = str(b.get("owner") or "")
                if idx >= 0 and mint:
                    out[(idx, mint, owner)] = b
            return out

        pre_t = token_map(meta.get("preTokenBalances") or [])
        post_t = token_map(meta.get("postTokenBalances") or [])
        token_rows: List[Tuple[Any, ...]] = []
        for key in set(pre_t) | set(post_t):
            before = pre_t.get(key) or {}
            after = post_t.get(key) or {}
            before_ui = before.get("uiTokenAmount") or {}
            after_ui = after.get("uiTokenAmount") or {}
            pre_amt = int(before_ui.get("amount") or 0)
            post_amt = int(after_ui.get("amount") or 0)
            if pre_amt == post_amt:
                continue
            decimals = after_ui.get("decimals", before_ui.get("decimals"))
            token_rows.append((key[0], key[1], key[2], decimals, pre_amt, post_amt, post_amt - pre_amt))

        ix_rows: List[Tuple[Any, ...]] = []
        programs: set[str] = set()
        ordinal = 0

        def add_ix(ix: Dict[str, Any], inner: bool, parent_index: Optional[int]) -> None:
            nonlocal ordinal
            pid = self.resolve_program(ix, keys)
            if pid:
                programs.add(pid)
            parsed = ix.get("parsed")
            ix_type = None
            if isinstance(parsed, dict):
                ix_type = parsed.get("type")
            accounts = ix.get("accounts") or []
            data = ix.get("data")
            ix_rows.append((ordinal, inner, parent_index, pid, ix_type, Json(accounts), data, Json(parsed) if parsed is not None else None))
            ordinal += 1

        for ix in message.get("instructions") or []:
            if isinstance(ix, dict):
                add_ix(ix, False, None)
        for group in meta.get("innerInstructions") or []:
            parent = group.get("index")
            for ix in group.get("instructions") or []:
                if isinstance(ix, dict):
                    add_ix(ix, True, parent)

        raw = json.dumps(result, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        if self.raw_ttl_minutes > 0 and self.raw_budget_mb > 0:
            raw_gz = gzip.compress(raw, compresslevel=5)
            expires = datetime.now(timezone.utc).timestamp() + self.raw_ttl_minutes * 60
            expires_at = datetime.fromtimestamp(expires, tz=timezone.utc)
        else:
            raw_gz, expires_at = None, None

        fee_payer = keys[0] if keys else None
        return {
            "tx": {
                "signature": signature,
                "source_program": target.label,
                "program_id": target.program_id,
                "slot": int(result.get("slot") or 0),
                "block_time": result.get("blockTime"),
                "fee_payer": fee_payer,
                "success": meta.get("err") is None,
                "fee_lamports": meta.get("fee"),
                "compute_units": meta.get("computeUnitsConsumed"),
                "account_keys": keys,
                "signers": signers,
                "programs": sorted(programs),
                "instruction_count": len(ix_rows),
                "raw_gzip": raw_gz,
                "raw_uncompressed_bytes": len(raw),
                "raw_compressed_bytes": len(raw_gz) if raw_gz else 0,
                "raw_expires_at": expires_at,
            },
            "sol": sol_rows,
            "token": token_rows,
            "ix": ix_rows,
        }

    async def ingest_target(self, target: Target) -> Tuple[int, int, int, int]:
        cursor = await asyncio.to_thread(self.store.get_cursor, target)
        sig_rows = await self.signatures_since(target, cursor)
        if not sig_rows:
            return 0, 0, 0, 0
        signatures = [x["signature"] for x in sig_rows if x.get("signature")]
        existing = await asyncio.to_thread(self.store.existing, signatures)
        missing = [s for s in signatures if s not in existing]
        results = await asyncio.gather(*(self.get_transaction(s) for s in reversed(missing)), return_exceptions=True)
        bundles, errors = [], 0
        for sig, result in zip(reversed(missing), results):
            if isinstance(result, Exception):
                errors += 1
                LOG.warning("tx fetch failed signature=%s error=%s", sig, result)
            elif result:
                bundles.append(self.bundle(target, sig, result))
        inserted = await asyncio.to_thread(self.store.insert_batch, bundles)
        if sig_rows:
            newest = sig_rows[0]
            await asyncio.to_thread(self.store.set_cursor, target, newest["signature"], newest.get("slot"))
        raw_in = sum(b["tx"]["raw_uncompressed_bytes"] for b in bundles)
        raw_gz = sum(b["tx"]["raw_compressed_bytes"] for b in bundles)
        return inserted, len(bundles), raw_in, raw_gz + errors * 0

    async def maintenance(self) -> bool:
        now = time.monotonic()
        if now - self.last_cleanup < self.cleanup_seconds:
            return True
        self.last_cleanup = now
        budget = self.raw_budget_mb * 1024 * 1024
        expired, raw_bytes = await asyncio.to_thread(self.store.expire_raw, budget)
        relation = await asyncio.to_thread(self.store.relation_bytes)
        projection = await asyncio.to_thread(self.store.projection)
        LOG.info("storage relation_mb=%.1f raw_mb=%.1f expired=%s rows_h=%.1f projected_rows_30d=%.0f",
                 relation / 1048576, raw_bytes / 1048576, expired,
                 projection["rows_per_hour"], projection["projected_rows_30d"])
        if relation > self.max_table_gb * (1024 ** 3):
            LOG.error("HARD STORAGE BUDGET HIT relation=%.3fGB max=%.3fGB; ingestion paused",
                      relation / (1024 ** 3), self.max_table_gb)
            return False
        return True

    async def run(self) -> None:
        self.store.init_schema()
        timeout = aiohttp.ClientTimeout(total=25, connect=5)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            self.session = session
            LOG.info("collector start targets=%s poll=%ss raw_ttl=%sm raw_budget=%sMB table_budget=%.2fGB",
                     {t.label:t.program_id for t in self.targets}, self.poll_seconds,
                     self.raw_ttl_minutes, self.raw_budget_mb, self.max_table_gb)
            while self.running:
                if not await self.maintenance():
                    await asyncio.sleep(60)
                    continue
                cycle_rows = cycle_rpc = cycle_raw = cycle_gz = cycle_errors = 0
                for target in self.targets:
                    try:
                        inserted, rpc_txs, raw_in, raw_gz = await self.ingest_target(target)
                        cycle_rows += inserted
                        cycle_rpc += rpc_txs
                        cycle_raw += raw_in
                        cycle_gz += raw_gz
                        if inserted:
                            LOG.info("ingested program=%s rows=%s fetched=%s", target.label, inserted, rpc_txs)
                    except asyncio.CancelledError:
                        raise
                    except Exception:
                        cycle_errors += 1
                        LOG.exception("ingest cycle failed program=%s", target.label)
                await asyncio.to_thread(self.store.record_metric, cycle_rows, cycle_rpc, cycle_raw, cycle_gz, cycle_errors)
                await asyncio.sleep(self.poll_seconds if cycle_rows else max(3.0, self.poll_seconds))


def main() -> None:
    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s %(message)s")
    collector = Collector()
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, setattr, collector, "running", False)
        except NotImplementedError:
            pass
    try:
        loop.run_until_complete(collector.run())
    finally:
        loop.close()


if __name__ == "__main__":
    main()
