"""Backfill re-attempts Turnkey backup exports only for wallets still missing one."""

import os
from contextlib import contextmanager
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")

from bot.services.backup_export_backfill import BackupExportBackfill  # noqa: E402


class _Query:
    def __init__(self, rows):
        self._rows = rows
        self._id = None

    def filter(self, *criteria):
        # The real filters are SQLAlchemy expressions; the fake keeps every row
        # and lets the "by id" lookup be resolved in first().
        for c in criteria:
            right = getattr(c, "right", None)
            if getattr(getattr(c, "left", None), "key", None) == "id" and right is not None:
                self._id = getattr(right, "value", None)
        return self

    def order_by(self, *_):
        return self

    def limit(self, n):
        self._rows = self._rows[:n]
        return self

    def all(self):
        return [r for r in self._rows if r.backup_key_exported_at is None]

    def first(self):
        for r in self._rows:
            if r.id == self._id:
                return r
        return None


class _Session:
    def __init__(self, rows):
        self.rows = rows
        self.committed = 0

    def query(self, _model):
        return _Query(list(self.rows))

    def commit(self):
        self.committed += 1


def _wallet(i, exported=None):
    return SimpleNamespace(
        id=i,
        wallet_provider="turnkey",
        turnkey_wallet_id=f"tk-{i}",
        turnkey_sub_org_id=f"org-{i}",
        backup_key_exported_at=exported,
        is_active=True,
    )


def _make(rows, exporter, client_factory=lambda: object()):
    session = _Session(rows)

    @contextmanager
    def session_factory():
        yield session

    svc = BackupExportBackfill(
        batch_size=10,
        per_wallet_pause_seconds=0,
        session_factory=session_factory,
        client_factory=client_factory,
        exporter=exporter,
    )
    return svc, session


async def test_exports_only_wallets_without_backup():
    rows = [_wallet(1), _wallet(2, exported=datetime.now(timezone.utc)), _wallet(3)]
    touched = []

    async def exporter(wallet, client, session):
        touched.append(wallet.id)
        wallet.backup_key_exported_at = datetime.now(timezone.utc)
        return True

    svc, session = _make(rows, exporter)
    summary = await svc.run_once()

    assert touched == [1, 3]
    assert summary == {"attempted": 2, "succeeded": 2, "failed": 0}
    assert session.committed == 2


async def test_failures_are_counted_and_do_not_stop_the_pass():
    rows = [_wallet(1), _wallet(2)]

    async def exporter(wallet, client, session):
        if wallet.id == 1:
            raise RuntimeError("Turnkey API error 400")
        wallet.backup_key_exported_at = datetime.now(timezone.utc)
        return True

    svc, _ = _make(rows, exporter)
    summary = await svc.run_once()
    assert summary == {"attempted": 2, "succeeded": 1, "failed": 1}


async def test_idle_when_turnkey_is_not_configured():
    async def exporter(*_):
        raise AssertionError("must not export")

    def no_client():
        raise ValueError("Turnkey not configured")

    svc, _ = _make([_wallet(1)], exporter, client_factory=no_client)
    summary = await svc.run_once()
    assert summary["skipped"] == "unconfigured"
    assert summary["attempted"] == 0
