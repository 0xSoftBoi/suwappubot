"""Live Solana program transaction ingestor.

This service deliberately does one thing: get raw on-chain data into SuwappuDB.
It does not score tokens, trade, backtest, or depend on off-chain metadata.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import signal
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional, Tuple

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
        label = label.strip().lower()
        program_id = program_id.strip()
        if label and program_id:
            targets.append(ProgramTarget(label=label, program_id=program_id))
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
        elif isinstance(key, dict):
            pubkey = key.get("pubkey")
            if pubkey:
                keys.append(str(pubkey))
    return keys


def _transaction_row(target: ProgramTarget, signature: str, result: Dict[str, Any]) -> SolanaProgramTransaction:
    tx = result.get("transaction") or {}
    message = tx.get("message") or {}
    meta = result.get("meta") or {}
    account_keys = _account_key_strings(message)

    return SolanaProgramTransaction(
        signature=signature,
        source_program=target.label,
        program_id=target.program_id,
        slot=int(result.get("slot") or 0),
        block_time=result.get("blockTime"),
        fee_payer=account_keys[0] if account_keys else None,
        success=meta.get("err") is None,
        fee_lamports=meta.get("fee"),
        compute_units_consumed=meta.get("computeUnitsConsumed"),
        account_keys_json=_json(account_keys),
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
        self._running = False
        self._rpc_index = 0
        self._semaphore = asyncio.Semaphore(self.concurrency)

    def _next_rpc(self) -> str:
        if not self.rpc_urls:
            raise RuntimeError("No Solana RPC URL configured")
        url = self.rpc_urls[self._rpc_index % len(self.rpc_urls)]
        self._rpc_index += 1
        return url

    async def _rpc(self, method: str, params: List[Any]) -> Any:
        last_error: Optional[Exception] = None
        attempts = max(1, len(self.rpc_urls))
        for _ in range(attempts):
            url = self._next_rpc()
            try:
                session = await get_http_session()
                payload = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
                async with session.post(url, json=payload) as response:
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
        result = await self._rpc(
            "getSignaturesForAddress",
            [target.program_id, {"limit": self.signature_limit, "commitment": self.commitment}],
        )
        return result or []

    async def _get_transaction(self, signature: str) -> Optional[Dict[str, Any]]:
        async with self._semaphore:
            return await self._rpc(
                "getTransaction",
                [signature, {"encoding": "jsonParsed", "commitment": self.commitment, "maxSupportedTransactionVersion": 0}],
            )

    def _existing_signatures(self, signatures: Iterable[str]) -> set[str]:
        values = list(signatures)
        if not values or database.SessionLocal is None:
            return set()
        existing: set[str] = set()
        with database.SessionLocal() as session:
            for i in range(0, len(values), 500):
                batch = values[i : i + 500]
                rows = session.query(SolanaProgramTransaction.signature).filter(SolanaProgramTransaction.signature.in_(batch)).all()
                existing.update(row[0] for row in rows)
        return existing

    def _insert(self, row: SolanaProgramTransaction) -> bool:
        if database.SessionLocal is None:
            raise RuntimeError("Database is not initialized")
        with database.SessionLocal() as session:
            try:
                session.add(row)
                session.commit()
                return True
            except IntegrityError:
                session.rollback()
                return False

    async def ingest_target_once(self, target: ProgramTarget) -> Tuple[int, int]:
        signatures = await self._recent_signatures(target)
        if not signatures:
            return 0, 0
        signature_values = [item.get("signature") for item in signatures if item.get("signature")]
        existing = await asyncio.to_thread(self._existing_signatures, signature_values)
        missing = [sig for sig in signature_values if sig not in existing]
        if not missing:
            return len(signature_values), 0
        missing.reverse()
        results = await asyncio.gather(*(self._get_transaction(signature) for signature in missing), return_exceptions=True)
        inserted = 0
        for signature, result in zip(missing, results):
            if isinstance(result, Exception):
                logger.warning("Failed transaction fetch signature=%s error=%s", signature, result)
                continue
            if not result:
                continue
            row = _transaction_row(target, signature, result)
            if await asyncio.to_thread(self._insert, row):
                inserted += 1
        return len(signature_values), inserted

    async def run(self) -> None:
        if not self.enabled:
            logger.info("Pump on-chain ingestion disabled")
            return
        if not self.targets:
            raise RuntimeError("PUMP_INGEST_PROGRAMS resolved to zero programs")
        if not self.rpc_urls:
            raise RuntimeError("No Solana RPCs configured")
        self._running = True
        logger.info("Starting raw Solana ingestion programs=%s poll=%ss limit=%s concurrency=%s", {t.label: t.program_id for t in self.targets}, self.poll_seconds, self.signature_limit, self.concurrency)
        while self._running:
            inserted_total = 0
            for target in self.targets:
                try:
                    seen, inserted = await self.ingest_target_once(target)
                    inserted_total += inserted
                    if inserted:
                        logger.info("On-chain ingest program=%s scanned=%s inserted=%s", target.label, seen, inserted)
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
