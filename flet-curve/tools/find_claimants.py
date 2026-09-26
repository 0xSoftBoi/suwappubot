#!/usr/bin/env python
"""Find a mainnet account whose gauge position has rewards outstanding."""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import urllib.request
from pathlib import Path

if __package__ in (None, ""):  # pragma: no cover - direct-script import
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from curve import abi
from curve.format import token_amount, units_to_float
from curve.rpc import ChainlistDirectory, PublicNode
from wallet.erc20 import encode_balance_of, encode_decimals, keccak256

#: Curve's own REST API, which is where `zapAddress` and `gaugeRewards` live
#: -- the Prices v2 API this app otherwise reads does not carry them.
POOLS_API = "https://api.curve.finance/api/getPools/{chain}/{registry}"

#: Every registry a chain might have. Missing ones 404 and are skipped;
#: asking is cheaper than keeping a table of which chain has which.
REGISTRIES = (
    "main", "crypto", "factory", "factory-crypto", "factory-crvusd",
    "factory-stable-ng", "factory-tricrypto", "factory-twocrypto",
)

#: `Transfer(address,address,uint256)`, the only topic worth filtering on.
TRANSFER_TOPIC = "0x" + keccak256(b"Transfer(address,address,uint256)").hex()

#: How far back to read logs. Wide enough to catch depositors who have been
#: sitting still, narrow enough that a public endpoint will answer -- most
#: cap `eth_getLogs` at a few thousand blocks and simply error above it.
DEFAULT_WINDOW = 5_000

#: Chain ids for the names Curve's API uses.
CHAIN_IDS = {
    "ethereum": 1, "optimism": 10, "xdai": 100, "polygon": 137,
    "fantom": 250, "base": 8453, "arbitrum": 42161, "avalanche": 43114,
}


def fetch_json(url: str, timeout: float = 45.0):
    request = urllib.request.Request(url, headers={"User-Agent": "curve-flet"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)


def gauges_with_rewards(chain: str) -> list[dict]:
    """Pools on a chain whose gauge streams at least one incentive token."""
    found: dict[str, dict] = {}
    for registry in REGISTRIES:
        try:
            payload = fetch_json(POOLS_API.format(chain=chain, registry=registry))
        except Exception:
            continue
        for pool in payload.get("data", {}).get("poolData", []) or []:
            gauge = pool.get("gaugeAddress") or ""
            rewards = [r for r in (pool.get("gaugeRewards") or []) if r.get("tokenAddress")]
            if not gauge or not rewards:
                continue
            found[gauge.lower()] = {
                "name": pool.get("name") or pool.get("id") or "?",
                "pool": pool.get("address") or "",
                "lp_token": pool.get("lpTokenAddress") or pool.get("address") or "",
                "gauge": gauge,
                "rewards": [(r.get("symbol") or "?", r["tokenAddress"]) for r in rewards],
                "tvl": float(pool.get("usdTotal") or 0),
            }
    return sorted(found.values(), key=lambda entry: -entry["tvl"])


def addresses_in(logs: list[dict]) -> list[str]:
    """Every counterparty in a batch of Transfer logs, in first-seen order."""
    seen: list[str] = []
    for log in logs:
        for topic in (log.get("topics") or [])[1:3]:
            if not isinstance(topic, str) or len(topic) < 42:
                continue
            address = "0x" + topic[-40:]
            if int(address, 16) != 0 and address not in seen:
                seen.append(address)
    return seen


class Reader:
    """Small read helpers over one chain, through public endpoints."""

    def __init__(self, chain_id: int) -> None:
        self.node = PublicNode(chain_id, ChainlistDirectory())
        self._decimals: dict[str, int] = {}

    async def call(self, to: str, data: str) -> int:
        raw = await self.node.request("eth_call", [{"to": to, "data": data}, "latest"])
        return int(raw, 16) if raw and raw not in ("0x", "0x0") else 0

    async def head(self) -> int:
        return int(await self.node.request("eth_blockNumber"), 16)

    async def decimals(self, token: str) -> int:
        """Cached, and 18 when the token will not say -- as `curve.pool` does."""
        key = token.lower()
        if key not in self._decimals:
            try:
                value = await self.call(token, encode_decimals())
            except Exception:
                value = 0
            self._decimals[key] = value if 0 < value <= 36 else 18
        return self._decimals[key]

    async def logs(self, gauge: str, window: int) -> list[dict]:
        head = await self.head()
        return await self.node.request(
            "eth_getLogs",
            [
                {
                    "address": gauge,
                    "topics": [TRANSFER_TOPIC],
                    "fromBlock": hex(max(0, head - window)),
                    "toBlock": hex(head),
                }
            ],
        )


async def outstanding(reader: Reader, entry: dict, who: str) -> dict | None:
    """What this account has staked and is owed, or None if nothing."""
    staked = await reader.call(entry["gauge"], encode_balance_of(who))
    if staked == 0:
        return None
    crv = await reader.call(entry["gauge"], abi.encode_claimable_tokens(who))
    extras = []
    for symbol, token in entry["rewards"]:
        amount = await reader.call(
            entry["gauge"], abi.encode_claimable_reward(who, token)
        )
        if amount > 0:
            extras.append((symbol, amount, await reader.decimals(token)))
    if crv == 0 and not extras:
        return None
    return {"who": who, "staked": staked, "crv": crv, "extras": extras}


def describe(hit: dict) -> str:
    """One account's position, amount before symbol as the app writes them."""
    parts = [f"staked {token_amount(units_to_float(hit['staked'], 18))} LP"]
    if hit["crv"]:
        parts.append(f"{token_amount(units_to_float(hit['crv'], 18))} CRV")
    parts += [
        f"{token_amount(units_to_float(amount, decimals))} {symbol}"
        for symbol, amount, decimals in hit["extras"]
    ]
    return "  ".join(parts)


async def search(chain: str, chain_id: int, pools: int, per_pool: int, window: int):
    reader = Reader(chain_id)
    candidates = gauges_with_rewards(chain)
    print(f"{len(candidates)} pools on {chain} with a gauge and incentive tokens\n")
    best: list[tuple[dict, dict]] = []

    for entry in candidates[:pools]:
        print(f"{entry['name']}  (TVL ${entry['tvl']:,.0f})")
        try:
            logs = await reader.logs(entry["gauge"], window)
        except Exception as exc:
            print(f"    logs unavailable: {str(exc)[:70]}\n")
            continue
        people = addresses_in(logs)
        print(f"    {len(people)} recent counterparties in the last {window} blocks")

        for who in people[:per_pool]:
            try:
                hit = await outstanding(reader, entry, who)
            except Exception:
                continue
            if hit is None:
                continue
            both = hit["crv"] > 0 and hit["extras"]
            print(f"    {'**' if both else '  '} {hit['who']}  {describe(hit)}")
            if both:
                best.append((entry, hit))
        print()

    if not best:
        print("No account found with both kinds outstanding. Try --window larger,")
        print("or --pools more, or another chain.")
        return 1

    entry, hit = best[0]
    print("=" * 72)
    print("Best candidate -- paste into tests/fork/test_writes.py:\n")
    print(f'POOL = "{entry["pool"]}"')
    print(f'LP_TOKEN = "{entry["lp_token"]}"')
    print(f'GAUGE = "{entry["gauge"]}"')
    print(f'STAKER = "{hit["who"]}"')
    print(f"\n# {entry['name']}: {describe(hit)}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--chain", default="ethereum", help="Curve's name for the chain")
    parser.add_argument("--chain-id", type=int, default=None)
    parser.add_argument("--pools", type=int, default=6, help="how many pools to scan")
    parser.add_argument("--per-pool", type=int, default=25, help="addresses per pool")
    parser.add_argument("--window", type=int, default=DEFAULT_WINDOW, help="blocks of history")
    options = parser.parse_args()

    chain_id = options.chain_id or CHAIN_IDS.get(options.chain)
    if chain_id is None:
        print(f"No chain id known for {options.chain}; pass --chain-id.", file=sys.stderr)
        return 1
    return asyncio.run(
        search(options.chain, chain_id, options.pools, options.per_pool, options.window)
    )


if __name__ == "__main__":
    sys.exit(main())
