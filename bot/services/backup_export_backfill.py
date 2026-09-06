"""Retry Turnkey backup-key exports for wallets that never got one.

Wallet creation attempts the export twice and then gives up (see
bot/services/wallet.py). From 2026-08-31 every attempt failed with
`400 invalid request` because the client sent no ``targetPublicKey``
(fixed in turnkey_client.export_wallet), so a run of wallets exists with
``backup_key_exported_at IS NULL`` and no fallback signing path. Nothing
re-tried them. This service does, slowly and idempotently: a small batch
per pass, one wallet at a time, skipping any row that already has a backup.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Awaitable, Callable, Optional

logger = logging.getLogger(__name__)


class BackupExportBackfill:
    def __init__(
        self,
        interval_seconds: int = 3600,
        initial_delay_seconds: int = 120,
        batch_size: int = 25,
        per_wallet_pause_seconds: float = 1.0,
        session_factory: Optional[Callable] = None,
        client_factory: Optional[Callable] = None,
        exporter: Optional[Callable[..., Awaitable[bool]]] = None,
    ):
        self._running = False
        self._task: Optional[asyncio.Task] = None
        self._interval = interval_seconds
        self._initial_delay = initial_delay_seconds
        self._batch_size = batch_size
        self._pause = per_wallet_pause_seconds
        # Injection points for tests; production resolves the real ones lazily
        # so importing this module never pulls DB/Turnkey config at import time.
        self._session_factory = session_factory
        self._client_factory = client_factory
        self._exporter = exporter
        self._warned_unconfigured = False

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._loop())
        logger.info(
            "Backup export backfill started (interval=%ss, batch=%s)",
            self._interval,
            self._batch_size,
        )

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("Backup export backfill stopped")

    async def _loop(self) -> None:
        await asyncio.sleep(self._initial_delay)
        while self._running:
            try:
                summary = await self.run_once()
                if summary.get("attempted"):
                    logger.info("Backup export backfill pass: %s", summary)
                try:
                    from bot.utils.redis_cache import redis_cache

                    await redis_cache.set(
                        "service:backup_export_backfill:heartbeat",
                        time.time(),
                        ttl_seconds=self._interval * 2,
                    )
                except Exception:
                    pass
            except Exception:
                logger.exception("Backup export backfill loop error")
            await asyncio.sleep(self._interval)

    # --- one pass -----------------------------------------------------------

    def _resolve(self):
        session_factory = self._session_factory
        if session_factory is None:
            from database.db import get_session

            session_factory = get_session
        client_factory = self._client_factory
        if client_factory is None:
            from bot.services.turnkey_client import get_turnkey_client

            client_factory = get_turnkey_client
        exporter = self._exporter
        if exporter is None:
            from bot.services.turnkey_export import export_and_backup_wallet

            exporter = export_and_backup_wallet
        return session_factory, client_factory, exporter

    async def run_once(self) -> dict:
        """Export backups for up to ``batch_size`` wallets that lack one.

        Idempotent: a wallet is only touched while ``backup_key_exported_at``
        is NULL, and the exporter stamps that column on success.
        """
        session_factory, client_factory, exporter = self._resolve()
        try:
            client = client_factory()
        except ValueError as exc:
            if not self._warned_unconfigured:
                logger.info("Backup export backfill idle: %s", exc)
                self._warned_unconfigured = True
            return {"attempted": 0, "succeeded": 0, "failed": 0, "skipped": "unconfigured"}

        from bot.models.user import Wallet

        with session_factory() as session:
            rows = (
                session.query(Wallet)
                .filter(
                    Wallet.wallet_provider == "turnkey",
                    Wallet.turnkey_wallet_id.isnot(None),
                    Wallet.backup_key_exported_at.is_(None),
                    Wallet.is_active.is_(True),
                )
                .order_by(Wallet.id)
                .limit(self._batch_size)
                .all()
            )
            wallet_ids = [row.id for row in rows]

        succeeded = failed = 0
        for wallet_id in wallet_ids:
            if not self._running and self._task is not None:
                break
            try:
                with session_factory() as session:
                    wallet = session.query(Wallet).filter(Wallet.id == wallet_id).first()
                    if wallet is None or wallet.backup_key_exported_at is not None:
                        continue
                    await exporter(wallet, client, session)
                    session.commit()
                succeeded += 1
            except Exception as exc:
                failed += 1
                logger.warning("Backup export backfill failed for wallet %s: %s", wallet_id, exc)
            await asyncio.sleep(self._pause)

        return {"attempted": len(wallet_ids), "succeeded": succeeded, "failed": failed}


backup_export_backfill = BackupExportBackfill()
