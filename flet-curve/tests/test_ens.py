"""Reading a name from Ethereum, and waiting for the gateways to catch up."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from tools import ens
from tools import warm_ipfs as warm

CID = "bafybeiajz4q4ah7wqvuungjl2buwieb3zsr4nxp3kcnxuxjd2nosgl7wm4"
OLD = "bafybeibjbq2qgn7ow4fiojwvnc6qtyvvzsvqw2pvi52ul6oframqjoqcye"


def contenthash_bytes(cid: str) -> bytes:
    """The `ipfs-ns` contenthash a resolver would return for this CID."""
    import base64

    body = cid[1:].upper()
    return ens.IPFS_NS + base64.b32decode(body + "=" * (-len(body) % 8))


def test_namehash_matches_the_published_vectors() -> None:
    """EIP-137's own examples. Everything else here is built on these."""
    assert ens.namehash("") == b"\x00" * 32
    assert ens.namehash("eth").hex() == (
        "93cdeb708b7545dc668eb9280176169d1c33cfd8ed6f04690a0bcc88a93fc4ae"
    )
    assert ens.namehash("foo.eth").hex() == (
        "de9b09fd7c5f901e23a3f19fecc54828e9c848539801e86591bd9801b019f84f"
    )


def test_a_contenthash_reads_back_as_the_cid_that_went_in() -> None:
    assert ens.cid_from_contenthash(contenthash_bytes(CID)) == CID


def test_a_name_pointed_somewhere_that_is_not_ipfs_is_not_a_cid() -> None:
    """IPNS, Swarm, Arweave -- all valid contenthashes, none of them
    something a warm of this build could mean.
    """
    assert ens.cid_from_contenthash(b"\xe5\x01\x01\x72\x00") == ""  # ipns-ns
    assert ens.cid_from_contenthash(b"") == ""
    assert ens.cid_from_contenthash(ens.IPFS_NS) == ""


class Chain:
    """One Ethereum endpoint, answering the two calls this makes."""

    def __init__(self, *, resolver: str = "0x" + "11" * 20, cid: str = CID) -> None:
        self.resolver = resolver
        self.cid = cid
        self.calls: list[str] = []

    def post(self, url, json, timeout=20.0, headers=None):
        self.calls.append(url)
        data = json["params"][0]["data"]
        if data.startswith(ens.RESOLVER_SELECTOR):
            word = self.resolver[2:].rjust(64, "0")
            return SimpleNamespace(json=lambda: {"result": "0x" + word})
        raw = contenthash_bytes(self.cid) if self.cid else b""
        body = (
            (32).to_bytes(32, "big")
            + len(raw).to_bytes(32, "big")
            + raw.ljust((len(raw) + 31) // 32 * 32, b"\x00")
        )
        return SimpleNamespace(json=lambda: {"result": "0x" + body.hex()})


def test_the_registry_answers_what_the_name_points_at() -> None:
    chain = Chain()

    assert ens.contenthash("curve.eth", client=chain, rpcs=("https://one",)) == CID
    assert len(chain.calls) == 2, "the resolver, then the contenthash"


def test_a_name_with_no_resolver_is_empty_rather_than_an_error() -> None:
    chain = Chain(resolver="0x" + "00" * 20)

    assert ens.contenthash("curve.eth", client=chain, rpcs=("https://one",)) == ""


def test_a_dead_endpoint_is_stepped_over() -> None:
    class Dead(Chain):
        def post(self, url, json, timeout=20.0, headers=None):
            if "dead" in url:
                raise ens.EnsError("no route")
            return super().post(url, json, timeout, headers)

    chain = Dead()

    found = ens.contenthash(
        "curve.eth", client=chain, rpcs=("https://dead", "https://live")
    )

    assert found == CID
    assert chain.calls[0] == "https://live", "the dead one never got as far as a call"


def test_every_endpoint_failing_says_so() -> None:
    class Dead(Chain):
        def post(self, *_a, **_kw):
            raise ens.EnsError("no route")

    with pytest.raises(ens.EnsError) as raised:
        ens.contenthash("curve.eth", client=Dead(), rpcs=("https://a", "https://b"))

    assert "https://a" in str(raised.value) and "https://b" in str(raised.value)


@pytest.mark.parametrize(
    ("host", "name"),
    [
        ("https://curve.eth.limo", "curve.eth"),
        ("https://curve.eth.link/", "curve.eth"),
        ("https://ipfs.io/ipfs/bafy", ""),
        ("https://example.com", ""),
    ],
)
def test_the_name_behind_a_gateway(host: str, name: str) -> None:
    assert ens.name_behind(host) == name


# -- waiting for the gateway to catch up -----------------------------------


def options(**kw):
    return SimpleNamespace(**{"cid": "", "no_wait": False, "flip_deadline": 900.0, **kw})


def test_it_stops_waiting_at_the_deadline(monkeypatch) -> None:
    monkeypatch.setattr(warm, "resolved_cid", lambda _client, _host: OLD)
    said: list[str] = []
    clock = [0.0]

    flipped = warm.wait_for_flip(
        "https://curve.eth.limo",
        CID,
        options(flip_deadline=60.0),
        client=object(),
        now=lambda: clock[0],
        sleep=lambda s: clock.__setitem__(0, clock[0] + s),
        say=said.append,
    )

    assert flipped is False
    assert any("warming what it" in line for line in said), "it warms anyway"


def test_it_waits_for_the_gateway_to_serve_what_the_name_says(monkeypatch) -> None:
    """Their ENS lookups are cached for minutes. A warm started the moment
    the transaction lands warms the build being replaced, and looks from
    the outside like a warm that did nothing.
    """
    answers = [OLD, OLD, CID]
    monkeypatch.setattr(warm, "resolved_cid", lambda _c, _h: answers.pop(0))
    said: list[str] = []
    clock = [0.0]

    flipped = warm.wait_for_flip(
        "https://curve.eth.limo",
        CID,
        options(),
        client=object(),
        now=lambda: clock[0],
        sleep=lambda s: clock.__setitem__(0, clock[0] + s),
        say=said.append,
    )

    assert flipped is True
    assert len(said) == 3, "it says what it is still seeing, then that it moved"
    assert OLD in said[0]


def test_it_returns_as_soon_as_the_gateway_has_it(monkeypatch) -> None:
    answers = [OLD, CID]
    monkeypatch.setattr(warm, "resolved_cid", lambda _c, _h: answers.pop(0))
    clock = [0.0]

    flipped = warm.wait_for_flip(
        "https://curve.eth.limo",
        CID,
        options(),
        client=object(),
        now=lambda: clock[0],
        sleep=lambda s: clock.__setitem__(0, clock[0] + s),
        say=lambda _line: None,
    )

    assert flipped is True
    assert answers == []


def test_a_named_cid_is_not_looked_up(monkeypatch) -> None:
    monkeypatch.setattr(
        ens, "contenthash", lambda *_a, **_kw: pytest.fail("asked the chain")
    )

    assert warm.wanted_cid("https://curve.eth.limo", options(cid=OLD)) == OLD


def test_no_wait_asks_nothing_and_warms_what_is_there(monkeypatch) -> None:
    monkeypatch.setattr(
        warm, "contenthash", lambda *_a, **_kw: pytest.fail("asked the chain")
    )

    assert warm.wanted_cid("https://curve.eth.limo", options(no_wait=True)) == ""


def test_a_chain_that_cannot_be_read_does_not_stop_the_warm(monkeypatch) -> None:
    """The point of the run is to warm. A registry nobody can reach is a
    reason to skip the wait, not to skip the work.
    """
    def unreachable(*_a, **_kw):
        raise ens.EnsError("no endpoint answered")

    monkeypatch.setattr(warm, "contenthash", unreachable)
    said: list[str] = []

    assert warm.wanted_cid("https://curve.eth.limo", options(), say=said.append) == ""
    assert any("warming anyway" in line for line in said)
