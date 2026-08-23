"""Calldata for the Curve contracts this app talks to."""

from __future__ import annotations

import sys
from pathlib import Path

if __package__ in (None, ""):  # pragma: no cover - direct-script import
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from wallet.erc20 import decode_uint, keccak256

__all__ = [
    "MAX_UINT256",
    "apply_slippage",
    "decode_uint",
    "decode_uint_array",
    "encode_add_liquidity",
    "encode_allowance",
    "encode_approve",
    "encode_balances_int128",
    "encode_calc_token_amount",
    "encode_calc_withdraw_one_coin",
    "encode_claim_rewards",
    "encode_claim_rewards_for",
    "encode_claimable_reward",
    "encode_claimable_tokens",
    "encode_deposit_and_stake",
    "encode_exchange",
    "encode_gauge_deposit",
    "encode_gauge_withdraw",
    "encode_mint_many",
    "encode_minter_mint",
    "encode_reward_count",
    "encode_reward_tokens",
    "encode_working_balances",
    "encode_get_dy",
    "encode_remove_liquidity",
    "encode_remove_liquidity_one_coin",
    "selector",
]

MAX_UINT256 = (1 << 256) - 1

#: Padding for a fixed-size address array. `curve.stake_zaps` spells the
#: same constant out again rather than importing it from here, because this
#: module is the bottom of the stack and depends on nothing above it.
_ZERO_ADDRESS = "0x" + "0" * 40


def selector(signature: str) -> str:
    """First 4 bytes of keccak256 of a canonical signature, as hex."""
    return keccak256(signature.encode()).hex()[:8]


# -- word encoding ---------------------------------------------------------


def _uint(value: int) -> str:
    if value < 0 or value > MAX_UINT256:
        raise ValueError(f"uint256 out of range: {value}")
    return f"{value:064x}"


def _int(value: int) -> str:
    """A signed word. Coin indices are never negative, but be correct anyway."""
    if value < 0:
        return f"{(1 << 256) + value:064x}"
    return _uint(value)


def _address(value: str) -> str:
    if not isinstance(value, str) or len(value) != 42 or not value.startswith("0x"):
        raise ValueError(f"not an address: {value!r}")
    return value[2:].lower().rjust(64, "0")


def _bool(value: bool) -> str:
    return _uint(1 if value else 0)


def _array(values: list[int]) -> str:
    """A fixed-size uint256[N]: N words inline, no header."""
    return "".join(_uint(v) for v in values)


def _dyn_array(values: list[int]) -> str:
    """The *tail* of a `uint256[]`: a length word, then the elements."""
    return _uint(len(values)) + _array(values)


def _offset(words: int) -> str:
    """A head word pointing at the tail, given the head's length in words."""
    return _uint(words * 32)


def _index(value: int, *, stableswap: bool) -> str:
    """A coin index, in whichever width this pool's ABI declares."""
    return _int(value) if stableswap else _uint(value)


def _call(sig: str, *words: str) -> str:
    return "0x" + selector(sig) + "".join(words)


# -- ERC-20 additions ------------------------------------------------------
# `wallet.erc20` covers transfer/balanceOf/decimals/symbol/name.


def encode_approve(spender: str, amount: int) -> str:
    return _call("approve(address,uint256)", _address(spender), _uint(amount))


def encode_allowance(owner: str, spender: str) -> str:
    return _call("allowance(address,address)", _address(owner), _address(spender))


def encode_total_supply() -> str:
    """LP tokens outstanding -- the denominator of a pool share."""
    return _call("totalSupply()")


# -- fees ------------------------------------------------------------------
# Curve states fees as a fraction of 1e10, so 1_500_000 is 0.015%.

#: The denominator Curve's `fee()` is expressed in. 1e10 == 100%.
FEE_DENOMINATOR = 10**10


def encode_fee() -> str:
    """The pool's swap fee. Every pool type has this one."""
    return _call("fee()")


def encode_parameter(name: str) -> str:
    """A no-argument `uint256` getter, by name."""
    return _call(f"{name}()")


def decode_uint_array(data: str) -> list[int]:
    """A `uint256[N]` or a `DynArray[uint256, N]` return value."""
    body = data[2:] if data.startswith("0x") else data
    if not body or len(body) % 64:
        return []
    words = [int(body[i : i + 64], 16) for i in range(0, len(body), 64)]
    if len(words) >= 2 and words[0] == 32 and words[1] == len(words) - 2:
        return words[2:]
    return words


def encode_indexed_parameter(name: str, index: int) -> str:
    """The same getter, on a pool that holds several of them."""
    return _call(f"{name}(uint256)", _uint(index))


def encode_balances_int128(index: int) -> str:
    """`balances(int128)`, the old registry's spelling of one reserve."""
    return _call("balances(int128)", _int(index))


def encode_dynamic_fee(i: int, j: int) -> str:
    """The fee for one particular pair, on the pools that price pairs."""
    return _call("dynamic_fee(int128,int128)", _int(i), _int(j))


# -- swapping --------------------------------------------------------------


def encode_get_dy(i: int, j: int, dx: int, *, stableswap: bool) -> str:
    """Quote a swap: how much coin `j` comes back for `dx` of coin `i`."""
    sig = (
        "get_dy(int128,int128,uint256)"
        if stableswap
        else "get_dy(uint256,uint256,uint256)"
    )
    return _call(
        sig,
        _index(i, stableswap=stableswap),
        _index(j, stableswap=stableswap),
        _uint(dx),
    )


def encode_exchange(i: int, j: int, dx: int, min_dy: int, *, stableswap: bool) -> str:
    """Swap within the pool. No router, no path -- one pool, two indices."""
    sig = (
        "exchange(int128,int128,uint256,uint256)"
        if stableswap
        else "exchange(uint256,uint256,uint256,uint256)"
    )
    return _call(
        sig,
        _index(i, stableswap=stableswap),
        _index(j, stableswap=stableswap),
        _uint(dx),
        _uint(min_dy),
    )


def encode_get_dy_underlying(i: int, j: int, dx: int, *, stableswap: bool) -> str:
    """Quote a swap between two *underlying* coins of a metapool."""
    return _call(
        "get_dy_underlying(int128,int128,uint256)"
        if stableswap
        else "get_dy_underlying(uint256,uint256,uint256)",
        _index(i, stableswap=stableswap),
        _index(j, stableswap=stableswap),
        _uint(dx),
    )


def encode_exchange_underlying(
    i: int, j: int, dx: int, min_dy: int, *, stableswap: bool
) -> str:
    """The swap `get_dy_underlying` quotes."""
    return _call(
        "exchange_underlying(int128,int128,uint256,uint256)"
        if stableswap
        else "exchange_underlying(uint256,uint256,uint256,uint256)",
        _index(i, stableswap=stableswap),
        _index(j, stableswap=stableswap),
        _uint(dx),
        _uint(min_dy),
    )


# -- depositing ------------------------------------------------------------


def encode_add_liquidity(
    amounts: list[int], min_mint: int, *, dynamic: bool = False
) -> str:
    """Deposit."""
    if dynamic:
        return _call(
            "add_liquidity(uint256[],uint256)",
            _offset(2),
            _uint(min_mint),
            _dyn_array(amounts),
        )
    n = len(amounts)
    return _call(f"add_liquidity(uint256[{n}],uint256)", _array(amounts), _uint(min_mint))


def encode_calc_token_amount(
    amounts: list[int], *, deposit: bool = True, dynamic: bool = False
) -> str:
    """Estimate LP tokens out. Note the two-argument caveat below."""
    if dynamic:
        return _call(
            "calc_token_amount(uint256[],bool)",
            _offset(2),
            _bool(deposit),
            _dyn_array(amounts),
        )
    n = len(amounts)
    return _call(
        f"calc_token_amount(uint256[{n}],bool)", _array(amounts), _bool(deposit)
    )


def encode_calc_token_amount_no_flag(amounts: list[int]) -> str:
    """The older CryptoSwap spelling of `calc_token_amount`."""
    n = len(amounts)
    return _call(f"calc_token_amount(uint256[{n}])", _array(amounts))


# -- metapools, through a zap ----------------------------------------------
# A metapool holds two coins: its own, and the base pool's LP token.


def encode_zap_calc_token_amount(
    pool: str | None,
    amounts: list[int],
    *,
    deposit: bool = True,
    dynamic: bool = False,
    stableswap: bool = True,
) -> str:
    """Estimate LP out, in whichever dialect this zap speaks."""
    if dynamic:
        return _call(
            "calc_token_amount(address,uint256[],bool)",
            _address(pool or ""),
            _offset(3),
            _bool(deposit),
            _dyn_array(amounts),
        )
    n = len(amounts)
    flag = [_bool(deposit)] if stableswap else []
    if pool is None:
        return _call(
            f"calc_token_amount(uint256[{n}]{',bool' if stableswap else ''})",
            _array(amounts),
            *flag,
        )
    return _call(
        f"calc_token_amount(address,uint256[{n}]{',bool' if stableswap else ''})",
        _address(pool),
        _array(amounts),
        *flag,
    )


def encode_zap_add_liquidity(
    pool: str | None, amounts: list[int], min_mint: int, *, dynamic: bool = False
) -> str:
    """Deposit through a zap. Same shape in every dialect but the array."""
    if dynamic:
        return _call(
            "add_liquidity(address,uint256[],uint256)",
            _address(pool or ""),
            _offset(3),
            _uint(min_mint),
            _dyn_array(amounts),
        )
    n = len(amounts)
    if pool is None:
        return _call(
            f"add_liquidity(uint256[{n}],uint256)", _array(amounts), _uint(min_mint)
        )
    return _call(
        f"add_liquidity(address,uint256[{n}],uint256)",
        _address(pool),
        _array(amounts),
        _uint(min_mint),
    )


def encode_zap_remove_liquidity(
    pool: str | None, amount: int, min_amounts: list[int], *, dynamic: bool = False
) -> str:
    if dynamic:
        return _call(
            "remove_liquidity(address,uint256,uint256[])",
            _address(pool or ""),
            _uint(amount),
            _offset(3),
            _dyn_array(min_amounts),
        )
    n = len(min_amounts)
    if pool is None:
        return _call(
            f"remove_liquidity(uint256,uint256[{n}])", _uint(amount), _array(min_amounts)
        )
    return _call(
        f"remove_liquidity(address,uint256,uint256[{n}])",
        _address(pool),
        _uint(amount),
        _array(min_amounts),
    )


def encode_zap_calc_withdraw_one_coin(
    pool: str | None, amount: int, i: int, *, stableswap: bool = True
) -> str:
    """The coin index takes the same two widths the pools' own do."""
    kind = "int128" if stableswap else "uint256"
    index = _index(i, stableswap=stableswap)
    if pool is None:
        return _call(
            f"calc_withdraw_one_coin(uint256,{kind})", _uint(amount), index
        )
    return _call(
        f"calc_withdraw_one_coin(address,uint256,{kind})",
        _address(pool),
        _uint(amount),
        index,
    )


def encode_zap_remove_liquidity_one_coin(
    pool: str | None, amount: int, i: int, min_out: int, *, stableswap: bool = True
) -> str:
    kind = "int128" if stableswap else "uint256"
    index = _index(i, stableswap=stableswap)
    if pool is None:
        return _call(
            f"remove_liquidity_one_coin(uint256,{kind},uint256)",
            _uint(amount),
            index,
            _uint(min_out),
        )
    return _call(
        f"remove_liquidity_one_coin(address,uint256,{kind},uint256)",
        _address(pool),
        _uint(amount),
        index,
        _uint(min_out),
    )


# -- withdrawing -----------------------------------------------------------


def encode_remove_liquidity(
    amount: int, min_amounts: list[int], *, dynamic: bool = False
) -> str:
    """Withdraw every coin, in the pool's current proportions."""
    if dynamic:
        return _call(
            "remove_liquidity(uint256,uint256[])",
            _uint(amount),
            _offset(2),
            _dyn_array(min_amounts),
        )
    n = len(min_amounts)
    return _call(
        f"remove_liquidity(uint256,uint256[{n}])", _uint(amount), _array(min_amounts)
    )


def encode_remove_liquidity_one_coin(
    amount: int, i: int, min_amount: int, *, stableswap: bool
) -> str:
    """Withdraw the whole position into a single coin."""
    sig = (
        "remove_liquidity_one_coin(uint256,int128,uint256)"
        if stableswap
        else "remove_liquidity_one_coin(uint256,uint256,uint256)"
    )
    return _call(
        sig, _uint(amount), _index(i, stableswap=stableswap), _uint(min_amount)
    )


def encode_calc_withdraw_one_coin(amount: int, i: int, *, stableswap: bool) -> str:
    sig = (
        "calc_withdraw_one_coin(uint256,int128)"
        if stableswap
        else "calc_withdraw_one_coin(uint256,uint256)"
    )
    return _call(sig, _uint(amount), _index(i, stableswap=stableswap))


# -- staking ---------------------------------------------------------------
# Liquidity gauges take the LP token and mint CRV against it.


def encode_gauge_deposit(amount: int) -> str:
    return _call("deposit(uint256)", _uint(amount))


def encode_gauge_withdraw(amount: int) -> str:
    return _call("withdraw(uint256)", _uint(amount))


# -- claiming --------------------------------------------------------------
# Two halves, because a gauge pays two kinds of reward -- see
# `curve.rewards`.


def encode_claimable_tokens(owner: str) -> str:
    """CRV owed. `nonpayable` in the ABI, an `eth_call` in practice."""
    return _call("claimable_tokens(address)", _address(owner))


def encode_claimable_reward(owner: str, token: str) -> str:
    """One incentive token's outstanding amount. A genuine view."""
    return _call("claimable_reward(address,address)", _address(owner), _address(token))


def encode_reward_count() -> str:
    return _call("reward_count()")


def encode_reward_tokens(index: int) -> str:
    return _call("reward_tokens(uint256)", _uint(index))


def encode_claim_rewards() -> str:
    """Every incentive token at once. CRV is not among them."""
    return _call("claim_rewards()")


def encode_working_balances(owner: str) -> str:
    """The boosted balance the gauge pays CRV on."""
    return _call("working_balances(address)", _address(owner))


def encode_mint_many(gauges: list[str], slots: int) -> str:
    """Mint CRV across several gauges in one transaction."""
    if len(gauges) > slots:
        raise ValueError(f"{len(gauges)} gauges into {slots} slots")
    padded = list(gauges) + [_ZERO_ADDRESS] * (slots - len(gauges))
    return _call(
        f"mint_many(address[{slots}])", *(_address(gauge) for gauge in padded)
    )


def encode_claim_rewards_for(owner: str) -> str:
    """Claim a gauge's incentive tokens on behalf of `owner`."""
    return _call("claim_rewards(address)", _address(owner))


def encode_minter_mint(gauge: str) -> str:
    """Mint the CRV this gauge has recorded for the caller."""
    return _call("mint(address)", _address(gauge))


# -- depositing and staking in one call ------------------------------------
# Curve's deposit-and-stake zap.


def _dyn_address_array(values: list[str]) -> str:
    """The tail of an `address[]`: a length word, then one word each."""
    return _uint(len(values)) + "".join(_address(v) for v in values)


def encode_deposit_and_stake(
    deposit: str,
    lp_token: str,
    gauge: str,
    coins: list[str],
    amounts: list[int],
    min_mint: int,
    *,
    use_dynarray: bool,
    pool: str,
    use_underlying: bool | None = None,
) -> str:
    """Deposit `amounts` of `coins` and stake the LP that comes back."""
    if len(coins) != len(amounts):
        raise ValueError(f"{len(coins)} coins against {len(amounts)} amounts")
    flags = (
        [_bool(use_underlying), _bool(use_dynarray)]
        if use_underlying is not None
        else [_bool(use_dynarray)]
    )
    signature = (
        "deposit_and_stake(address,address,address,uint256,address[],uint256[],"
        + ("uint256,bool,bool,address)" if use_underlying is not None else "uint256,bool,address)")
    )
    head_words = 7 + len(flags) + 1
    coins_tail = _dyn_address_array(coins)
    return _call(
        signature,
        _address(deposit),
        _address(lp_token),
        _address(gauge),
        _uint(len(coins)),
        _offset(head_words),
        _offset(head_words + 1 + len(coins)),
        _uint(min_mint),
        *flags,
        _address(pool),
        coins_tail,
        _dyn_array(amounts),
    )


# -- slippage --------------------------------------------------------------


def apply_slippage(amount: int, tolerance_pct: float) -> int:
    """Turn an estimate into the `min_*` floor that goes on-chain."""
    if amount <= 0:
        return 0
    if not 0 <= tolerance_pct < 100:
        raise ValueError(f"slippage must be in [0, 100): {tolerance_pct}")
    scale = 1_000_000
    keep = round((100.0 - tolerance_pct) / 100.0 * scale)
    return amount * keep // scale
