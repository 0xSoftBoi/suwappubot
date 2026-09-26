"""What a transaction will cost, in the money the user thinks in."""

from __future__ import annotations

from contextlib import suppress
from dataclasses import dataclass
from decimal import Decimal

#: EIP-7528's stand-in address for a chain's own coin.
NATIVE_PSEUDO = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"

#: The tip, as a fraction of the base fee, held as a ratio rather than
#: `0.05` -- qeth computes `(base * 5) // 100` in integers, and a base fee
#: is large enough that going through a float can land a wei either side of
#: it.
TIP_NUMERATOR = 5
TIP_DENOMINATOR = 100

#: Below this a tip is refused outright by some chains: Gnosis bounces a
#: transaction whose effective priority fee is under 1 wei, and its base fee
#: is small enough that five per cent of it floors to zero.
MIN_TIP_WEI = 1

#: What a legacy chain's `gasPrice` is multiplied by before it is sent, as
#: qeth's own `(price * 135) // 100`.
LEGACY_NUMERATOR = 135
LEGACY_DENOMINATOR = 100


@dataclass(frozen=True, slots=True)
class Native:
    """A chain's own coin, and where its price can be had."""

    symbol: str
    wrapped: str = ""


#: Keyed by chain id. `symbol` is what the fee is denominated in, which is
#: the whole reason this table exists: three of these are not ether.
NATIVE: dict[int, Native] = {
    1: Native("ETH", "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"),
    10: Native("ETH", "0x4200000000000000000000000000000000000006"),
    56: Native("BNB", "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c"),
    100: Native("XDAI", "0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d"),
    137: Native("POL", "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270"),
    252: Native("frxETH", "0xFC00000000000000000000000000000000000006"),
    8453: Native("ETH", "0x4200000000000000000000000000000000000006"),
    42161: Native("ETH", "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1"),
}


def native_for(chain_id: int) -> Native:
    """The chain's coin, or ether where nothing is recorded."""
    return NATIVE.get(chain_id) or Native("ETH")


def settlement_price(
    *,
    base_fee: int,
    gas_price: int,
    node_tip: int = 0,
    eip1559: bool = True,
) -> int:
    """Wei per gas the transaction will most likely settle at."""
    if not eip1559:
        return gas_price * LEGACY_NUMERATOR // LEGACY_DENOMINATOR
    if base_fee > 0:
        tip = max(
            base_fee * TIP_NUMERATOR // TIP_DENOMINATOR, node_tip, MIN_TIP_WEI
        )
        return base_fee + tip
    return max(gas_price, node_tip, MIN_TIP_WEI)


async def read_fees(provider) -> tuple[int, int, int, bool]:
    """`(base fee, gas price, node tip, eip1559)` from the chain itself."""
    base = gas_price = tip = 0
    eip1559 = False
    try:
        head = await provider.request("eth_getBlockByNumber", ["latest", False])
        raw = (head or {}).get("baseFeePerGas")
        if raw is not None:
            base = int(raw, 16) if isinstance(raw, str) else int(raw)
            eip1559 = True
    except Exception:
        return 0, 0, 0, False
    with suppress(Exception):
        answer = await provider.request("eth_gasPrice", [])
        gas_price = int(answer, 16) if isinstance(answer, str) else int(answer)
    with suppress(Exception):
        answer = await provider.request("eth_maxPriorityFeePerGas", [])
        tip = int(answer, 16) if isinstance(answer, str) else int(answer)
    return base, gas_price, tip, eip1559


async def native_price(api, chain: str, chain_id: int) -> float:
    """What one unit of the chain's coin is worth, or 0.0."""
    price = await api.usd_price(chain, NATIVE_PSEUDO)
    if price > 0:
        return price
    wrapped = native_for(chain_id).wrapped
    return await api.usd_price(chain, wrapped) if wrapped else 0.0


def fee_in_native(gas: int, price_per_gas: int) -> float:
    """The fee as a whole number of the chain's coin."""
    return gas * price_per_gas / 10**18


def format_fee(native: float, symbol: str, usd: float) -> str:
    """`0.00042 ETH ($0.79)`, or just the coin where no price is known."""
    if native >= 1:
        places = 4
    elif native >= 0.001:
        places = 6
    elif native >= 10**-6:
        places = 9
    else:
        places = 12
    amount = f"{native:,.{places}f}".rstrip("0").rstrip(".") or "0"
    text = f"{amount} {symbol}"
    if usd <= 0:
        return text
    exponent = Decimal(str(usd)).adjusted()
    return f"{text}  (${usd:,.{max(2, 1 - exponent)}f})"
