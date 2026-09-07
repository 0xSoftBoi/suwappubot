"""What a wallet actually holds, out of everything it could pick.

The Swap tab's picker offers every routable coin on the chain -- hundreds of
them, ordered by how busy their pools are.  That is the right order for
someone looking for a market and the wrong one for someone looking for *their
own coins*, which are the ones they came to swap.

So the ones they hold go first.  Finding them is a handful of requests: the
whole list of `balanceOf` calls through Multicall3, the way
`curve.portfolio` already reads a wallet's positions, and one more for the
chain's prices, which the Prices API serves in bulk.  Not one request per
coin -- that would be three hundred.

Through the *app's* provider rather than the router's endpoint, which is a
scoped key: it serves reads and `eth_call` to the quoter and the router, and
answers 403 to a token's `balanceOf`.

Flet-free, and it never raises: a picker that cannot say what you hold is
still a picker, and losing the list to save the ordering would be a poor
trade.
"""

from __future__ import annotations

from dataclasses import replace

from curve.multicall import MULTICALL3, decode_uints, encode_aggregate3
from router.universe import CoinEntry
from wallet.erc20 import encode_balance_of

#: Curve's sentinel for the native coin, which has no `balanceOf` to call.
NATIVE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"

#: Calls per Multicall3 batch.  `curve.portfolio` measured both endpoints
#: taking 1,713 at once and settled on this as the conservative number; a
#: chain's whole coin list is one or two of them.
CHUNK = 300

#: Below this a holding is dust: an amount nobody came here to swap, and one
#: that would push a coin above the markets someone is actually looking for.
#: In dollars, because a token's own units say nothing -- 1 wei and 1 USDC are
#: both "1".
WORTH_KEEPING = 1.0


async def read_balances(provider, owner: str, coins) -> dict[str, int]:
    """What `owner` holds of each coin, in as few requests as it takes.

    Answers by lowercased address, and leaves out anything the chain would
    not say: a balance that could not be read is not a balance of zero, and
    ordering a coin *down* for want of an answer is the safer way to be wrong.
    """
    coins = list(coins)
    if not provider or not owner or not coins:
        return {}
    # Filtered rather than trusted: one address the encoder will not take
    # would raise for the *whole* chunk, and three hundred balances would go
    # missing because of one bad row in a pool list.
    tokens = [address for address in
              ((coin.address or "").lower() for coin in coins)
              if address != NATIVE and _is_address(address)]
    held: dict[str, int] = {}
    if any((coin.address or "").lower() == NATIVE for coin in coins):
        try:
            native = await provider.get_balance(owner)
        except Exception:
            native = 0
        if native:
            held[NATIVE] = int(native)
    data = encode_balance_of(owner)
    for start in range(0, len(tokens), CHUNK):
        batch = tokens[start:start + CHUNK]
        try:
            answer = await provider.call(
                MULTICALL3, encode_aggregate3([(token, data) for token in batch]))
        except Exception:
            continue
        for token, value in zip(batch, decode_uints(answer, len(batch)),
                                strict=False):
            if value:
                held[token] = int(value)
    return held


def _is_address(value: str) -> bool:
    """`0x` and forty hex digits, which is what the encoder will accept."""
    if not value.startswith("0x") or len(value) != 42:
        return False
    try:
        int(value, 16)
    except ValueError:
        return False
    return True


def value_of(coin, balance: int, prices: dict[str, float]) -> float:
    """What that holding is worth, or 0.0 when nothing here can say."""
    price = prices.get((coin.address or "").lower(), 0.0)
    if not price or not balance:
        return 0.0
    return balance / 10 ** max(0, int(coin.decimals or 0)) * price


def rank(coins, held: dict[str, int], prices: dict[str, float],
         *, floor: float = WORTH_KEEPING):
    """The same coins, with what is held first and everything else after.

    Returns new entries rather than sorting in place, because the balance and
    what it is worth are things the picker draws and the caller has to carry
    them somewhere.  Order within each half is preserved: held coins by what
    they are worth, and the rest exactly as they arrived, which is by volume.
    """
    owned: list[CoinEntry] = []
    rest: list[CoinEntry] = []
    for coin in coins:
        balance = held.get((coin.address or "").lower(), 0)
        worth = value_of(coin, balance, prices)
        entry = replace(coin, balance=balance, worth=worth)
        (owned if worth >= floor else rest).append(entry)
    owned.sort(key=lambda c: -c.worth)
    return owned + rest


__all__ = ["NATIVE", "WORTH_KEEPING", "rank", "read_balances", "value_of"]
