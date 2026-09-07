"""A stalled fork read is re-asked on a fresh socket."""

import pytest

from erouter.dev.executor import _with_retries, reads_only


class Stalled(Exception):
    pass


class FakeSession:
    def __init__(self):
        self.closed = 0

    def close(self):
        self.closed += 1


class FakeRPC:
    def __init__(self, stalls: int):
        self._session = FakeSession()
        self.stalls = stalls
        self.calls = 0

    def fetch(self, method, params):
        self.calls += 1
        if self.calls <= self.stalls:
            raise Stalled(method)
        return f"{method}:{params}"

    def fetch_multi(self, payloads):
        self.calls += 1
        if self.calls <= self.stalls:
            raise Stalled(payloads[0][0])
        return [f"{m}:{p}" for m, p in payloads]


def wrap(attempts=4):
    return _with_retries(FakeRPC.fetch, attempts, (Stalled,))


def wrap_multi(attempts=4):
    return _with_retries(FakeRPC.fetch_multi, attempts, (Stalled,))


def test_a_healthy_read_is_asked_once():
    rpc = FakeRPC(stalls=0)
    assert wrap()(rpc, "eth_getStorageAt", [1]) == "eth_getStorageAt:[1]"
    assert (rpc.calls, rpc._session.closed) == (1, 0)


def test_a_stall_is_retried_and_the_socket_dropped():
    rpc = FakeRPC(stalls=2)
    assert wrap()(rpc, "eth_getBalance", [2]) == "eth_getBalance:[2]"
    assert (rpc.calls, rpc._session.closed) == (3, 2)


def test_the_last_attempt_raises_rather_than_returning_none():
    rpc = FakeRPC(stalls=99)
    with pytest.raises(Stalled):
        wrap()(rpc, "eth_getCode", [3])
    # The socket is not closed after the final attempt: nothing will reuse it.
    assert (rpc.calls, rpc._session.closed) == (4, 3)


def test_attempts_is_honoured():
    rpc = FakeRPC(stalls=99)
    with pytest.raises(Stalled):
        wrap(attempts=2)(rpc, "eth_getCode", [3])
    assert rpc.calls == 2


def test_an_unrelated_error_is_not_retried():
    rpc = FakeRPC(stalls=0)

    def boom(self, method, params):
        rpc.calls += 1
        raise ValueError("bad params")

    with pytest.raises(ValueError):
        _with_retries(boom, 4, (Stalled,))(rpc, "eth_call", [])
    assert rpc.calls == 1


def test_a_broadcast_is_never_re_sent():
    rpc = FakeRPC(stalls=99)
    with pytest.raises(Stalled):
        wrap()(rpc, "eth_sendRawTransaction", ["0xf86b"])
    assert (rpc.calls, rpc._session.closed) == (1, 0)


def test_a_batch_carrying_a_broadcast_is_not_retried():
    rpc = FakeRPC(stalls=99)
    with pytest.raises(Stalled):
        wrap_multi()(rpc, [("eth_getBalance", []),
                           ("eth_sendRawTransaction", [])])
    assert rpc.calls == 1


def test_a_batch_of_reads_is_retried():
    rpc = FakeRPC(stalls=1)
    wrap_multi()(rpc, [("eth_getBalance", []), ("eth_getStorageAt", [])])
    assert (rpc.calls, rpc._session.closed) == (2, 1)


def test_an_unrecognised_shape_is_not_retried():
    assert not reads_only(())
    assert not reads_only((7,))
