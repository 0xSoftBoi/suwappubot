"""The transport re-asks an unanswered request, and never halves one."""

import json
import urllib.error

import pytest

from erouter.dev.rpc import JsonRpcTransport, RpcError, RpcStalled


def transport(**kw) -> JsonRpcTransport:
    # chain_id given so construction does not reach the network.
    return JsonRpcTransport("http://node.invalid", block=1, chain_id=1, **kw)


class Reply:
    """What `urlopen` hands back: a context manager over the body."""

    def __init__(self, body: bytes):
        self.body = body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def read(self) -> bytes:
        return self.body


class Endpoint:
    """Stalls for the first `stalls` requests, then answers."""

    def __init__(self, stalls: int, error=None):
        self.stalls = stalls
        self.error = error or TimeoutError("timed out")
        self.calls = 0

    def __call__(self, request, **kw):
        self.calls += 1
        if self.calls <= self.stalls:
            raise self.error
        body = json.loads(request.data)
        answers = ([{"jsonrpc": "2.0", "id": r["id"], "result": "0x1"} for r in body]
                   if isinstance(body, list)
                   else {"jsonrpc": "2.0", "id": body["id"], "result": "0x1"})
        return Reply(json.dumps(answers).encode())


def test_a_stalled_request_is_re_asked(monkeypatch):
    rpc, node = transport(), Endpoint(stalls=2)
    monkeypatch.setattr("urllib.request.urlopen", node)
    monkeypatch.setattr("time.sleep", lambda _: None)
    assert rpc.fetch("eth_blockNumber", []) == "0x1"
    assert (node.calls, rpc.stats.stalls) == (3, 2)


def test_a_request_that_never_answers_raises_stalled(monkeypatch):
    rpc, node = transport(attempts=2), Endpoint(stalls=99)
    monkeypatch.setattr("urllib.request.urlopen", node)
    monkeypatch.setattr("time.sleep", lambda _: None)
    with pytest.raises(RpcStalled):
        rpc.fetch("eth_blockNumber", [])
    assert node.calls == 2


def test_a_dropped_connection_counts_as_a_stall(monkeypatch):
    rpc = transport()
    node = Endpoint(stalls=1, error=ConnectionResetError("reset by peer"))
    monkeypatch.setattr("urllib.request.urlopen", node)
    monkeypatch.setattr("time.sleep", lambda _: None)
    assert rpc.fetch("eth_blockNumber", []) == "0x1"
    assert node.calls == 2


def test_a_client_status_is_an_answer_and_is_not_retried(monkeypatch):
    rpc = transport()
    calls = []

    def refuse(*a, **kw):
        calls.append(1)
        raise urllib.error.HTTPError(rpc.url, 403, "Forbidden", {}, None)

    monkeypatch.setattr("urllib.request.urlopen", refuse)
    with pytest.raises(RpcError) as caught:
        rpc.fetch("eth_blockNumber", [])
    assert not isinstance(caught.value, RpcStalled)
    assert len(calls) == 1


def test_a_server_status_is_retried(monkeypatch):
    rpc = transport(attempts=3)
    calls = []

    def refuse(*a, **kw):
        calls.append(1)
        raise urllib.error.HTTPError(rpc.url, 502, "Bad Gateway", {}, None)

    monkeypatch.setattr("urllib.request.urlopen", refuse)
    monkeypatch.setattr("time.sleep", lambda _: None)
    with pytest.raises(RpcStalled):
        rpc.fetch("eth_blockNumber", [])
    assert len(calls) == 3


def test_a_stalled_batch_is_not_halved(monkeypatch):
    """The whole point: halving spreads one stall over two more chances to stall."""
    rpc = transport(attempts=1)
    sizes = []

    def stall(self, payload):
        sizes.append(len(json.loads(payload)))
        raise RpcStalled("no answer")

    monkeypatch.setattr(JsonRpcTransport, "_post_inner", stall)
    out = rpc.fetch_multi([("eth_blockNumber", [])] * 8)
    assert sizes == [8]                       # asked once, at full size
    assert all(isinstance(entry, RpcStalled) for entry in out)


def test_an_oversized_batch_is_still_halved(monkeypatch):
    rpc = transport(attempts=1)
    sizes = []

    def refuse(self, payload):
        body = json.loads(payload)
        sizes.append(len(body))
        if len(body) > 2:
            raise RpcError("batch limit 2 exceeded")
        return [{"jsonrpc": "2.0", "id": r["id"], "result": "0x1"} for r in body]

    monkeypatch.setattr(JsonRpcTransport, "_post_inner", refuse)
    out = rpc.fetch_multi([("eth_blockNumber", [])] * 4)
    assert sizes[0] == 4 and max(sizes[1:]) <= 2
    assert out == ["0x1"] * 4
