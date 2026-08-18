"""Live Solana program ingestor with bounded storage.

Hot: full decoded payloads for a short TTL.
Warm: compact facts retained for analysis.
Cold: gzip-compressed raw payloads for a bounded recovery window.
"""

from __future__ import annotations

import asyncio
import gzip
import json
import logging
import os
import signal
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Dict, Iterable, List, Optional, Tuple

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from bot.config.settings import settings
from bot.models.onchain_ingest import SolanaProgramTransaction
from bot.utils.http_client import get_session as get_http_session
from database import db as database

logger = logging.getLogger(__name__)

DEFAULT_PROGRAMS = {
    "pumpswap": "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
}


@dataclass(frozen=True)
class ProgramTarget:
    label: str
    program_id: str


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() not in {"0", "false", "no", "off"}


def _program_targets() -> List[ProgramTarget]:
    raw = os.getenv("PUMP_INGEST_PROGRAMS", "").strip()
    if not raw:
        return [ProgramTarget(k, v) for k, v in DEFAULT_PROGRAMS.items()]
    targets: List[ProgramTarget] = []
    for item in raw.split(","):
        item = item.strip()
        if not item:
            continue
        if "=" in item:
            label, program_id = item.split("=", 1)
        elif ":" in item:
            label, program_id = item.split(":", 1)
        else:
            label, program_id = "program", item
        if label.strip() and program_id.strip():
            targets.append(ProgramTarget(label.strip().lower(), program_id.strip()))
    return targets


def _rpc_urls() -> List[str]:
    raw = os.getenv("PUMP_INGEST_RPC_URLS") or settings.solana_rpc_url
    return [part.strip() for part in raw.split(",") if part.strip()]


def _json(value: Any) -> Optional[str]:
    if value is None:
        return None
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False)


def _account_key_strings(message: Dict[str, Any]) -> List[str]:
    keys: List[str] = []
    for key in message.get("accountKeys") or []:
        if isinstance(key, str):
            keys.append(key)
        elif isinstance(key, dict) and key.get("pubkey"):
            keys.append(str(key["pubkey"]))
    return keys


def _token_delta_facts(meta: Dict[str, Any]) -> List[Dict[str, Any]]:
    pre = {(b.get("accountIndex"), b.get("mint"), b.get("owner")): b for b in meta.get("preTokenBalances") or []}
    post = {(b.get("accountIndex"), b.get("mint"), b.get("owner")): b for b in meta.get("postTokenBalances") or []}
    out: List[Dict[str, Any]] = []
    for key in set(pre) | set(post):
        a = pre.get(key) or {}
        b = post.get(key) or {}
        def amount(x: Dict[str, Any]) -> int:
            try:
                return int(((x.get("uiTokenAmount") or {}).get("amount")) or 0)
            except Exception:
                return 0
        before, after = amount(a), amount(b)
        if before != after:
            out.append({"account_index": key[0], "mint": key[1], "owner": key[2], "pre": before, "post": after, "delta": after - before})
    return out


def _compact_facts(target: ProgramTarget, signature: str, result: Dict[str, Any]) -> Dict[str, Any]:
    tx = result.get("transaction") or {}
    message = tx.get("message") or {}
    meta = result.get("meta") or {}
    keys = _account_key_strings(message)
    pre_sol = meta.get("preBalances") or []
    post_sol = meta.get("postBalances") or []
    sol_deltas = []
    for idx in range(min(len(pre_sol), len(post_sol), len(keys))):
        delta = int(post_sol[idx]) - int(pre_sol[idx])
        if delta:
            sol_deltas.append({"account": keys[idx], "delta_lamports": delta})
    instruction_programs: List[str] = []
    for ix in message.get("instructions") or []:
        if isinstance(ix, dict):
            pid = ix.get("programId") or ix.get("program")
            if pid:
                instruction_programs.append(str(pid))
    return {
        "signature": signature,
        "source_program": target.label,
        "program_id": target.program_id,
        "slot": int(result.get("slot") or 0),
        "block_time": result.get("blockTime"),
        "fee_payer": keys[0] if keys else None,
        "success": meta.get("err") is None,
        "fee_lamports": meta.get("fee"),
        "compute_units_consumed": meta.get("computeUnitsConsumed"),
        "account_keys": keys,
        "instruction_programs": instruction_programs,
        "sol_deltas": sol_deltas,
        "token_deltas": _token_delta_facts(meta),
    }


def _transaction_row(target: ProgramTarget, signature: str, result: Dict[str, Any]) -> SolanaProgramTransaction:
    tx = result.get("transaction") or {}
    message = tx.get("message") or {}
    meta = result.get("meta") or {}
    keys = _account_key_strings(message)
    return SolanaProgramTransaction(
        signature=signature,
        source_program=target.label,
        program_id=target.program_id,
        slot=int(result.get("slot") or 0),
        block_time=result.get("blockTime"),
        fee_payer=keys[0] if keys else None,
        success=meta.get("err") is None,
        fee_lamports=meta.get("fee"),
        compute_units_consumed=meta.get("computeUnitsConsumed"),
        compact_json=_json(_compact_facts(target, signature, result)),
        account_keys_json=_json(keys),
        instructions_json=_json(message.get("instructions")),
        inner_instructions_json=_json(meta.get("innerInstructions")),
        pre_balances_json=_json(meta.get("preBalances")),
        post_balances_json=_json(meta.get("postBalances")),
        pre_token_balances_json=_json(meta.get("preTokenBalances")),
        post_token_balances_json=_json(meta.get("postTokenBalances")),
        log_messages_json=_json(meta.get("logMessages")),
        error_json=_json(meta.get("err")),
        raw_transaction_json=_json(result) or "{}",
    )


class SolanaProgramIngestor:
    def __init__(self) -> None:
        self.enabled = _env_bool("PUMP_INGEST_ENABLED", True)
        self.targets = _program_targets()
        self.rpc_urls = _rpc_urls()
        self.poll_seconds = max(0.25, float(os.getenv("PUMP_INGEST_POLL_SECONDS", "2")))
        self.signature_limit = min(1000, max(1, int(os.getenv("PUMP_INGEST_SIGNATURE_LIMIT", "250"))))
        self.concurrency = max(1, int(os.getenv("PUMP_INGEST_CONCURRENCY", "12")))
        self.commitment = os.getenv("PUMP_INGEST_COMMITMENT", "confirmed")
        self.hot_hours = max(1, int(os.getenv("PUMP_INGEST_HOT_HOURS", "24")))
        self.cold_days = max(1, int(os.getenv("PUMP_INGEST_COLD_DAYS", "30")))
        self.max_db_gb = max(0.5, float(os.getenv("PUMP_INGEST_MAX_DB_GB", "5")))
        self.compact_interval = max(30, int(os.getenv("PUMP_INGEST_COMPACT_INTERVAL_SECONDS", "300")))
        self.batch_size = max(1, min(500, int(os.getenv("PUMP_INGEST_BATCH_SIZE", "100"))))
        self._running = False
        self._rpc_index = 0
        self._semaphore = asyncio.Semaphore(self.concurrency)
        self._last_compact = datetime.min

    def _next_rpc(self) -> str:
        if not self.rpc_urls:
            raise RuntimeError("No Solana RPC URL configured")
        url = self.rpc_urls[self._rpc_index % len(self.rpc_urls)]
        self._rpc_index += 1
        return url

    async def _rpc(self, method: str, params: List[Any]) -> Any:
        last_error: Optional[Exception] = None
        for _ in range(max(1, len(self.rpc_urls))):
            url = self._next_rpc()
            try:
                session = await get_http_session()
                async with session.post(url, json={"jsonrpc":"2.0","id":1,"method":method,"params":params}) as response:
                    if response.status != 200:
                        raise RuntimeError(f"RPC HTTP {response.status} for {method}")
                    body = await response.json(content_type=None)
                    if body.get("error"):
                        raise RuntimeError(f"RPC {method} error: {body['error']}")
                    return body.get("result")
            except Exception as exc:
                last_error = exc
                logger.warning("Solana RPC failed method=%s url=%s error=%s", method, url, exc)
        raise RuntimeError(f"All Solana RPCs failed for {method}: {last_error}")

    async def _recent_signatures(self, target: ProgramTarget) -> List[Dict[str, Any]]:
        return (await self._rpc("getSignaturesForAddress", [target.program_id, {"limit": self.signature_limit, "commitment": self.commitment}])) or []

    async def _get_transaction(self, signature: str) -> Optional[Dict[str, Any]]:
        async with self._semaphore:
            return await self._rpc("getTransaction", [signature, {"encoding":"jsonParsed","commitment":self.commitment,"maxSupportedTransactionVersion":0}])

    def _ensure_schema(self) -> None:
        if database.engine is None:
            return
        dialect = database.engine.dialect.name
        with database.engine.begin() as conn:
            if dialect == "postgresql":
                conn.execute(text("ALTER TABLE solana_program_transactions ADD COLUMN IF NOT EXISTS compact_json TEXT"))
                conn.execute(text("ALTER TABLE solana_program_transactions ADD COLUMN IF NOT EXISTS raw_gzip BYTEA"))
                conn.execute(text("ALTER TABLE solana_program_transactions ADD COLUMN IF NOT EXISTS raw_archived_at TIMESTAMP"))
                conn.execute(text("ALTER TABLE solana_program_transactions ALTER COLUMN raw_transaction_json DROP NOT NULL"))
            elif dialect == "sqlite":
                cols = {r[1] for r in conn.execute(text("PRAGMA table_info(solana_program_transactions)"))}
                if "compact_json" not in cols:
                    conn.execute(text("ALTER TABLE solana_program_transactions ADD COLUMN compact_json TEXT"))
                if "raw_gzip" not in cols:
                    conn.execute(text("ALTER TABLE solana_program_transactions ADD COLUMN raw_gzip BLOB"))
                if "raw_archived_at" not in cols:
                    conn.execute(text("ALTER TABLE solana_program_transactions ADD COLUMN raw_archived_at TIMESTAMP"))

    def _db_size_gb(self) -> float:
        if database.engine is None or database.engine.dialect.name != "postgresql":
            return 0.0
        with database.engine.connect() as conn:
            size = conn.execute(text("SELECT pg_database_size(current_database())")).scalar() or 0
        return float(size) / (1024 ** 3)

    def _existing_signatures(self, signatures: Iterable[str]) -> set[str]:
        values = list(signatures)
        if not values or database.SessionLocal is None:
            return set()
        existing: set[str] = set()
        with database.SessionLocal() as session:
            for i in range(0, len(values), 500):
                rows = session.query(SolanaProgramTransaction.signature).filter(SolanaProgramTransaction.signature.in_(values[i:i+500])).all()
                existing.update(row[0] for row in rows)
        return existing

    def _insert_batch(self, rows: List[SolanaProgramTransaction]) -> int:
        if not rows or database.SessionLocal is None:
            return 0
        inserted = 0
        for i in range(0, len(rows), self.batch_size):
            batch = rows[i:i+self.batch_size]
            with database.SessionLocal() as session:
                try:
                    session.add_all(batch)
                    session.commit()
                    inserted += len(batch)
                except IntegrityError:
                    session.rollback()
                    for row in batch:
                        try:
                            session.add(row)
                            session.commit()
                            inserted += 1
                        except IntegrityError:
                            session.rollback()
        return inserted

    def _compact_and_expire(self) -> Tuple[int, int]:
        if database.SessionLocal is None:
            return 0, 0
        now = datetime.utcnow()
        hot_cutoff = now - timedelta(hours=self.hot_hours)
        cold_cutoff = now - timedelta(days=self.cold_days)
        archived = expired = 0
        with database.SessionLocal() as session:
            hot_rows = session.query(SolanaProgramTransaction).filter(
                SolanaProgramTransaction.ingested_at < hot_cutoff,
                SolanaProgramTransaction.raw_transaction_json.isnot(None),
                SolanaProgramTransaction.raw_archived_at.is_(None),
            ).limit(1000).all()
            for row in hot_rows:
                raw = (row.raw_transaction_json or "{}").encode("utf-8")
                row.raw_gzip = gzip.compress(raw, compresslevel=6)
                row.raw_archived_at = now
                row.account_keys_json = None
                row.instructions_json = None
                row.inner_instructions_json = None
                row.pre_balances_json = None
                row.post_balances_json = None
                row.pre_token_balances_json = None
                row.post_token_balances_json = None
                row.log_messages_json = None
                row.error_json = None
                row.raw_transaction_json = None
                archived += 1
            expired_rows = session.query(SolanaProgramTransaction).filter(
                SolanaProgramTransaction.raw_archived_at.isnot(None),
                SolanaProgramTransaction.raw_archived_at < cold_cutoff,
                SolanaProgramTransaction.raw_gzip.isnot(None),
            ).limit(5000).all()
            for row in expired_rows:
                row.raw_gzip = None
                expired += 1
            session.commit()
        return archived, expired

    async def ingest_target_once(self, target: ProgramTarget) -> Tuple[int, int]:
        signatures = await self._recent_signatures(target)
        signature_values = [item.get("signature") for item in signatures if item.get("signature")]
        if not signature_values:
            return 0, 0
        existing = await asyncio.to_thread(self._existing_signatures, signature_values)
        missing = [sig for sig in signature_values if sig not in existing]
        if not missing:
            return len(signature_values), 0
        missing.reverse()
        results = await asyncio.gather(*(self._get_transaction(sig) for sig in missing), return_exceptions=True)
        rows: List[SolanaProgramTransaction] = []
        for signature, result in zip(missing, results):
            if isinstance(result, Exception):
                logger.warning("Failed transaction fetch signature=%s error=%s", signature, result)
            elif result:
                rows.append(_transaction_row(target, signature, result))
        inserted = await asyncio.to_thread(self._insert_batch, rows)
        return len(signature_values), inserted

    async def run(self) -> None:
        if not self.enabled:
            return
        self._ensure_schema()
        self._running = True
        logger.info("Starting bounded Solana ingest hot=%sh cold=%sd max_db=%.2fGB", self.hot_hours, self.cold_days, self.max_db_gb)
        while self._running:
            now = datetime.utcnow()
            if (now - self._last_compact).total_seconds() >= self.compact_interval:
                archived, expired = await asyncio.to_thread(self._compact_and_expire)
                self._last_compact = now
                size_gb = await asyncio.to_thread(self._db_size_gb)
                logger.info("Ingest storage archived=%s expired=%s db_size_gb=%.3f", archived, expired, size_gb)
                if size_gb and size_gb >= self.max_db_gb:
                    logger.error("INGEST PAUSED: database %.3fGB reached guardrail %.3fGB", size_gb, self.max_db_gb)
                    await asyncio.sleep(self.compact_interval)
                    continue
            inserted_total = 0
            for target in self.targets:
                try:
                    _, inserted = await self.ingest_target_once(target)
                    inserted_total += inserted
                except asyncio.CancelledError:
                    raise
                except Exception:
                    logger.exception("On-chain ingest cycle failed program=%s", target.label)
            await asyncio.sleep(self.poll_seconds if inserted_total else max(self.poll_seconds, 3.0))

    def stop(self) -> None:
        self._running = False


async def main() -> None:
    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s %(message)s")
    ingestor = SolanaProgramIngestor()
    if not ingestor.enabled:
        logger.info("PUMP_INGEST_ENABLED=false; exiting")
        return
    if not database.init_db(settings.database_url):
        raise RuntimeError("Database initialization failed")
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, ingestor.stop)
        except NotImplementedError:
            pass
    await ingestor.run()


if __name__ == "__main__":
    asyncio.run(main())
