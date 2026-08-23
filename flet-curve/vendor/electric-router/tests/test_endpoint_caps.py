"""The endpoint's batch ceiling, remembered between runs.

Measuring it costs 1.2 s of a cold start -- a 2,000-request batch, then the
ladder down -- and the answer is a property of the endpoint rather than of the
block, so it survives the process.
"""

from __future__ import annotations

import json

import pytest

from erouter.dev import rpc


@pytest.fixture(autouse=True)
def _a_scratch_cache(tmp_path, monkeypatch):
    monkeypatch.setattr(rpc, "CAPS_PATH", tmp_path / "endpoints.json")


URL = "https://lb.drpc.live/ethereum/A-REAL-LOOKING-API-KEY-000"


def test_the_url_never_reaches_disk():
    """It carries the API key, so only a digest of it is stored."""
    rpc._remember_ceiling(URL, 2000)
    raw = rpc.CAPS_PATH.read_text()
    assert "A-REAL-LOOKING-API-KEY-000" not in raw
    assert "drpc" not in raw
    assert rpc._endpoint_key(URL) in raw


def test_a_ceiling_survives_the_process():
    rpc._remember_ceiling(URL, 1000)
    assert rpc._remembered_ceiling(URL) == 1000


def test_two_endpoints_do_not_share_a_ceiling():
    rpc._remember_ceiling(URL, 2000)
    rpc._remember_ceiling(URL + "-other", 100)
    assert rpc._remembered_ceiling(URL) == 2000
    assert rpc._remembered_ceiling(URL + "-other") == 100


def test_learning_a_lower_cap_forgets_what_was_remembered():
    """A remembered ceiling that is too high must not be paid for twice.

    The batch is rejected, the real cap is read out of the error, and the
    entry goes -- so the next run measures rather than repeating the mistake.
    """
    from threading import Lock

    rpc._remember_ceiling(URL, 2000)
    # Built without a constructor: that one pins the block over the network,
    # and this is a test about bookkeeping.
    transport = object.__new__(rpc.JsonRpcTransport)
    transport.url = URL
    transport.batch_size = 2000
    transport._id_lock = Lock()

    transport._learn_batch_limit(rpc.RpcError("batch limit 100 exceeded"))
    assert transport.batch_size == 100
    assert rpc._remembered_ceiling(URL) is None


def test_an_unwritable_cache_is_not_an_error(monkeypatch, tmp_path):
    monkeypatch.setattr(rpc, "CAPS_PATH", tmp_path / "no" / "such" / "dir" / "x.json")
    monkeypatch.setattr(rpc.Path, "mkdir",
                        lambda *a, **k: (_ for _ in ()).throw(OSError("read-only")))
    rpc._remember_ceiling(URL, 500)          # must not raise
    assert rpc._remembered_ceiling(URL) is None


def test_a_corrupt_cache_is_ignored():
    rpc.CAPS_PATH.parent.mkdir(parents=True, exist_ok=True)
    rpc.CAPS_PATH.write_text("{not json")
    assert rpc._remembered_ceiling(URL) is None
    rpc._remember_ceiling(URL, 250)
    assert json.loads(rpc.CAPS_PATH.read_text())[rpc._endpoint_key(URL)]["batch"] == 250
