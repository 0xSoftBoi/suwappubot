"""Two third-party sources on the pool list's critical path."""

from __future__ import annotations

import pytest

from curve import api as api_module
from curve.http import ApiError

CHAIN = 1
POOL = "0xd50492de3541d75e61edc34d1aa79c7dc2d20da9"
GAUGE = "0xf7f4b8bfb6de08435adc37eaad626a22ed730a92"

PIKU = {
    "id": "piku",
    "symbol": "PIKU",
    "address": "0x2E4039E8E31475d65DC00293C366FDBfBBC02DC3",
    "type": "PRETGE",
    "price": 0.16,
}
#: A Merkl wrapper and what it pays: the campaign is quoted in `ybwcrvUSD`
#: and crvUSD is what lands in the wallet.
YBWCRVUSD = {
    "id": "ybw",
    "name": "Yield Basis crvUSD (Merkl wrapper)",
    "symbol": "ybwcrvUSD",
    "address": "0x5D29949F8e64fA2f9cB2B1Fa190244b9413bc3Ea",
    "type": "TOKEN",
    "underlyingTokenId": "crvusd",
}
CRVUSD = {
    "id": "crvusd",
    "name": "Curve.Fi USD Stablecoin",
    "symbol": "crvUSD",
    "address": "0xf939E0A03FB07F59A73314E73794Be0E57ac1b4E",
    "type": "TOKEN",
}


def opportunity(identifier: str, name: str, apr: float, ident: str) -> dict:
    return {
        "chainId": CHAIN,
        "identifier": identifier,
        "name": name,
        "status": "LIVE",
        "apr": apr,
        "id": ident,
        "rewardsRecord": {"breakdowns": [{"token": PIKU}]},
    }


ETHENA = {
    "platform": "Ethena",
    "dashboardLink": "https://app.ethena.fi/liquidity",
    "pools": [
        {
            "action": "lp",
            "address": POOL,
            "network": "ethereum",
            "multiplier": "30x",
            "tags": ["points"],
            "campaignStart": "0",
            "campaignEnd": "1770000000",
            "description": "null",
        }
    ],
}


class Hosts:
    """Every host the pool list touches, counting what it is asked for."""

    def __init__(self) -> None:
        self.merkl: list[str] = []
        self.tokens: list[str] = []
        self.manifest = 0
        self.files: list[str] = []
        self.tokens_down = False
        self.merkl_down = False
        self.merkl_fails_from: int | None = None
        self.manifest_down = False
        self.broken_files: set[str] = set()
        self.merkl_pages: list[list[dict]] = [
            [
                opportunity(POOL, "Provide liquidity to Curve frxUSD-USP", 325.11, "a"),
                opportunity(GAUGE, "Stake into the Curve frxUSP gauge", 325.06, "b"),
            ]
        ]

    async def get_json(self, url: str, timeout: float = 30.0):
        if "api.merkl.xyz/v4/tokens" in url:
            self.tokens.append(url)
            if self.tokens_down:
                raise ApiError("tokens is down")
            return [CRVUSD]
        if "api.merkl.xyz" in url:
            self.merkl.append(url)
            if self.merkl_down:
                raise ApiError("merkl is down")
            page = int(_param(url, "page") or 0)
            if self.merkl_fails_from is not None and page >= self.merkl_fails_from:
                raise ApiError("gone mid-walk")
            return self.merkl_pages[page] if page < len(self.merkl_pages) else []
        if url.endswith("campaign-list.json"):
            self.manifest += 1
            if self.manifest_down:
                raise ApiError("github is down")
            return [{"campaign": "Ethena.json"}, {"campaign": "Missing.json"}]
        if "/campaigns/" in url:
            name = url.rsplit("/", 1)[-1]
            self.files.append(name)
            if name in self.broken_files:
                raise ApiError(f"no {name}")
            return ETHENA if name == "Ethena.json" else {"platform": "X", "pools": []}
        if url.endswith("/get_platforms"):
            return {"data": {"platforms": {}, "platforms_metadata": {}}}
        if "/pools/chains/" in url:
            return {"data": [{"name": "ethereum", "chain_id": CHAIN}]}
        if "/v2/pools/?" in url:
            return {
                "count": 1,
                "pools": [
                    {
                        "address": POOL,
                        "name": "frxUSD/USP",
                        "chain_id": CHAIN,
                        "merkle_apr": 325.06,
                        "gauges": [{"address": GAUGE, "is_killed": False}],
                    }
                ],
            }
        raise AssertionError(f"unexpected request: {url}")


def _param(url: str, name: str) -> str | None:
    for part in url.split("?", 1)[-1].split("&"):
        key, _, value = part.partition("=")
        if key == name:
            return value
    return None


@pytest.fixture
def hosts(monkeypatch):
    served = Hosts()
    monkeypatch.setattr(api_module, "get_json", served.get_json)
    return served


async def listed(api) -> object:
    pools, _total = await api.list_pools(CHAIN, chain="ethereum")
    return pools[0]


async def test_the_list_arrives_with_its_campaigns_attached(hosts) -> None:
    pool = await listed(api_module.CurveApi())
    assert pool.merkl.apr == 325.11
    assert [t.symbol for t in pool.merkl.tokens] == ["PIKU"]
    assert [c.label for c in pool.points] == ["Ethena 30x"]


async def test_curves_own_figure_gives_way_to_merkls(hosts) -> None:
    pool = await listed(api_module.CurveApi())
    assert pool.merkle_apr == 325.06
    assert pool.campaign_apr == 325.11


async def test_a_second_page_asks_neither_host_again(hosts) -> None:
    api = api_module.CurveApi()
    await listed(api)
    before = (len(hosts.merkl), hosts.manifest, len(hosts.files))

    await api.list_pools(CHAIN, chain="ethereum", page=2)

    assert (len(hosts.merkl), hosts.manifest, len(hosts.files)) == before


async def test_merkl_being_down_costs_the_lines_and_nothing_else(hosts) -> None:
    hosts.merkl_down = True
    pool = await listed(api_module.CurveApi())

    assert not pool.merkl
    assert pool.campaign_apr == 325.06
    assert [c.label for c in pool.points] == ["Ethena 30x"]


async def test_a_host_that_is_down_is_asked_once_per_ttl(hosts) -> None:
    hosts.merkl_down = True
    hosts.manifest_down = True
    api = api_module.CurveApi()

    await listed(api)
    await api.list_pools(CHAIN, chain="ethereum", page=2)
    await api.list_pools(CHAIN, chain="ethereum", page=3)

    assert len(hosts.merkl) == 1
    assert hosts.manifest == 1
    assert hosts.files == []


async def test_one_missing_campaign_file_is_not_the_whole_directory(hosts) -> None:
    hosts.broken_files = {"Missing.json"}
    pool = await listed(api_module.CurveApi())
    assert [c.label for c in pool.points] == ["Ethena 30x"]


async def test_a_full_page_of_opportunities_is_followed(hosts) -> None:
    filler = [opportunity("0x" + f"{i:040x}", "x", 1.0, str(i)) for i in range(100)]
    hosts.merkl_pages = [filler, [opportunity(POOL, "late", 7.0, "late")]]

    pool = await listed(api_module.CurveApi())

    assert [_param(url, "page") for url in hosts.merkl] == ["0", "1"]
    assert pool.merkl.apr == 7.0


def wrapped(identifier: str, ident: str) -> dict:
    entry = opportunity(identifier, "Provide liquidity", 0.2, ident)
    entry["rewardsRecord"]["breakdowns"] = [{"token": YBWCRVUSD}]
    return entry


async def test_a_wrapped_campaign_is_shown_as_what_it_pays(hosts) -> None:
    hosts.merkl_pages = [[wrapped(POOL, "a"), wrapped(GAUGE, "b")]]

    pool = await listed(api_module.CurveApi())

    token = pool.merkl.tokens[0]
    assert token.paid_symbol == "crvUSD"
    assert token.symbol == "ybwcrvUSD"


async def test_every_wrapper_on_a_chain_resolves_in_one_request(hosts) -> None:
    hosts.merkl_pages = [[wrapped(POOL, "a"), wrapped(GAUGE, "b")]]

    await listed(api_module.CurveApi())

    assert len(hosts.tokens) == 1
    assert hosts.tokens[0].count("id=") == 1  # both campaigns want the same one


async def test_a_chain_with_no_wrappers_asks_for_none(hosts) -> None:
    await listed(api_module.CurveApi())
    assert hosts.tokens == []


async def test_a_failed_wrapper_lookup_leaves_the_wrapper_showing(hosts) -> None:
    hosts.merkl_pages = [[wrapped(POOL, "a")]]
    hosts.tokens_down = True

    pool = await listed(api_module.CurveApi())

    assert pool.merkl.tokens[0].paid_symbol == "ybwcrvUSD"
    assert pool.merkl.apr == 0.2


async def test_a_partial_page_ends_the_walk(hosts) -> None:
    await listed(api_module.CurveApi())
    assert [_param(url, "page") for url in hosts.merkl] == ["0"]


async def test_merkl_failing_midway_keeps_what_the_first_page_gave(hosts) -> None:
    filler = [opportunity("0x" + f"{i:040x}", "x", 1.0, str(i)) for i in range(99)]
    hosts.merkl_pages = [[*filler, opportunity(POOL, "kept", 5.0, "kept")]]
    hosts.merkl_fails_from = 1

    pool = await listed(api_module.CurveApi())

    assert [_param(url, "page") for url in hosts.merkl] == ["0", "1"]
    assert pool.merkl.apr == 5.0
