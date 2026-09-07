"""A coin's `decimals()` must survive whatever else the cache learns about it.

The Curve API omits `decimals` on its newer registries -- every `twocryptong`
and `stableswapng` entry measured, on Ethereum, BSC and gnosis alike -- and a
missing value defaults to 18.  `read_balances` corrects that from the token
itself, and caches it because decimals never change.

Three passes write to that cache about the same address: this one, the LP-token
pass, and the ERC4626 `asset()` pass.  Merging at the file level replaces an
address's whole entry, so only the last writer survived -- across 20 cached
chains, 674 Ethereum entries and not one still held a `decimals`.  A reader that
tests *address membership* rather than the fact it wants then concludes the
answer is known, never asks, and finds nothing to use.

On gnosis that made USDC.e 18 decimals in the one pool whose API entry omitted
them.  Every amount through it was out by 1e12: `EURe -> USDC.e` calibrated to
`eps = +10000 bp`, a diode dropping the entire value, and the reverse had `B`
inflated by 1e24 so the arc fell under the dust floor and was dropped.  The pool
held $173k and the solver could not see it at all.
"""

from __future__ import annotations

from erouter.chain.cache import Cache, TokenFactsCache
from erouter.core.pools import Coin, PoolSpec
from erouter.core.transport import Answer, Status
from erouter.dev.universe import read_balances

DECIMALS = bytes.fromhex("313ce567")   # decimals()
USDCE = "0x2a22f9c3b484c3629090FeED35F17Ff8F88f76F0"
EURE = "0x420CA0f9B9b604cE0fd9C18EF134C705e5Fa3430"


def pool() -> PoolSpec:
    """The gnosis USDCe/EURe entry as the API serves it: no decimals at all."""
    return PoolSpec(
        address="0x0eCEC6F5276d2Ec6bB864F063D2b76393d6A1A74",
        name="USDCe/EURe",
        pool_type="twocryptong",
        # `Coin.from_api` turns the API's missing value into 18.
        coins=(Coin(USDCE, "USDC.e", 18, 0), Coin(EURE, "EURe", 18, 1)),
    )


class Tokens:
    """Answers `decimals()` with `says`; records every call it is handed."""

    def __init__(self, says: int = 6) -> None:
        self.says = says
        self.asked: list[str] = []

    def raw(self, calls):
        out = []
        for call in calls:
            if call.data[:4] == DECIMALS:
                self.asked.append(call.to.lower())
                out.append(Answer(Status.VALUE, self.says.to_bytes(32, "big")))
            elif call.data:
                out.append(Answer(Status.VALUE, (10**6).to_bytes(32, "big")))
            else:
                out.append(Answer(Status.WRONG_ABI, b""))  # the stride placeholder
        return out


class Pools:
    def raw(self, calls):
        return [Answer(Status.VALUE, (10**6).to_bytes(32, "big")) for _ in calls]


def facts_at(tmp_path) -> TokenFactsCache:
    return TokenFactsCache(Cache(tmp_path))


def test_facts_about_one_address_do_not_overwrite_each_other(tmp_path):
    facts = facts_at(tmp_path)
    facts.save(100, {USDCE.lower(): {"decimals": 6}})
    facts.save(100, {USDCE.lower(): {"asset": ""}})

    entry = facts.load(100)[USDCE.lower()]
    assert entry == {"decimals": 6, "asset": ""}, (
        f"the wrapper pass destroyed the decimals it never wrote: {entry}")


def test_a_later_writer_still_wins_on_its_own_key(tmp_path):
    """Merging must update, not freeze: a re-read has to be able to correct."""
    facts = facts_at(tmp_path)
    facts.save(1, {USDCE.lower(): {"lp_decimals": 18}})
    facts.save(1, {USDCE.lower(): {"lp_decimals": 6}})

    assert facts.load(1)[USDCE.lower()]["lp_decimals"] == 6


def test_decimals_are_read_when_the_cache_knows_the_address_for_something_else(
    tmp_path, monkeypatch
):
    monkeypatch.setattr("erouter.chain.cache.DEFAULT_ROOT", tmp_path)
    # Exactly the poisoned shape: present, but holding the wrapper pass's fact.
    facts_at(tmp_path).save(100, {USDCE.lower(): {"asset": ""},
                                  EURE.lower(): {"asset": ""}})

    spec, tokens = pool(), Tokens(says=6)
    read_balances([spec], Pools(), None, 100, token_client=tokens)

    assert USDCE.lower() in tokens.asked, (
        "an address present for another reason was taken as decimals known")
    assert spec.coins[0].decimals == 6, (
        f"USDC.e kept the API's default: {spec.coins[0].decimals}")


def test_a_cached_decimals_is_believed_without_a_call(tmp_path, monkeypatch):
    monkeypatch.setattr("erouter.chain.cache.DEFAULT_ROOT", tmp_path)
    facts_at(tmp_path).save(100, {USDCE.lower(): {"decimals": 6},
                                  EURE.lower(): {"decimals": 18}})

    spec, tokens = pool(), Tokens(says=6)
    read_balances([spec], Pools(), None, 100, token_client=tokens)

    assert not tokens.asked, f"decimals were re-read despite being cached: {tokens.asked}"
    assert spec.coins[0].decimals == 6


def test_the_correction_is_reported_and_cached(tmp_path, monkeypatch):
    monkeypatch.setattr("erouter.chain.cache.DEFAULT_ROOT", tmp_path)
    spec, report = pool(), []
    read_balances([spec], Pools(), report, 100, token_client=Tokens(says=6))

    assert any("6 decimals, not the 18" in line for line in report), report
    assert facts_at(tmp_path).load(100)[USDCE.lower()]["decimals"] == 6


def test_a_zero_decimals_read_is_neither_applied_nor_cached(tmp_path, monkeypatch):
    """The local EVM answers an unloaded account's every getter with zero.

    Believed here it would be indistinguishable from a real fact and would
    stick for good, so the API's guess -- which gets re-checked -- is better.
    """
    monkeypatch.setattr("erouter.chain.cache.DEFAULT_ROOT", tmp_path)
    spec = pool()
    read_balances([spec], Pools(), None, 100, token_client=Tokens(says=0))

    assert spec.coins[0].decimals == 18, "a zero from an unloaded account was believed"
    assert "decimals" not in facts_at(tmp_path).load(100).get(USDCE.lower(), {})
