"""Metapools: depositing the underlying coins through a zap."""

from __future__ import annotations

import pytest

from curve import abi
from curve.models import Coin, Pool
from curve.pool import PoolCallFailed, PoolContract
from curve.zaps import ZAPS, zap_for
from tests.test_actions import ACCOUNT, FakeProvider, StubPage, word, words_of

NG_ZAP = "0xE07a16358aA878CBDa2D49A88E5106871E0db307"
LEGACY_ZAP = "0xA79828DF1850E8a3A3064576f380D90aECDD3359"
THREEPOOL = "0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7"
RESERVES = "0x4f493B7dE8aAC7d55F71853688b1F7C8F0243C85"  # Strategic USD Reserves
META = "0xC09e82f81Cb811DB0922dD48206fc2e212322caf"  # World Liberty USD1


def metapool(
    registry: str = "stableswapng",
    base_pool: str = RESERVES,
    coins: int = 4,
    chain_id: int = 1,
) -> Pool:
    """A metapool as v2 reports one: coins decomposed, `n_coins` = 2."""
    pool = Pool(
        address=META,
        name="World Liberty USD1 Pool",
        chain="ethereum",
        chain_id=chain_id,
        registry=registry,
        base_pool=base_pool,
        lp_token=META,
        coins=[
            Coin("0x" + f"{i + 1:02x}" * 20, f"C{i}", 18 if i % 2 else 6, index=i)
            for i in range(coins)
        ],
    )
    pool.onchain_coins = 2
    return pool


# -- the registry ----------------------------------------------------------


def test_an_ng_metapool_gets_the_ng_zap() -> None:
    zap = zap_for(metapool())
    assert zap is not None
    assert zap.address == NG_ZAP
    assert zap.dynamic is True


def test_an_old_factory_metapool_gets_the_fixed_array_zap() -> None:
    zap = zap_for(metapool(registry="factory", base_pool=THREEPOOL, coins=5))
    assert zap is not None
    assert zap.address == LEGACY_ZAP
    assert zap.dynamic is False


def test_the_oldest_metapools_are_not_offered_a_zap() -> None:
    assert zap_for(metapool(registry="main", base_pool=THREEPOOL, coins=5)) is None


def test_a_plain_pool_has_no_zap() -> None:
    pool = metapool()
    pool.base_pool = ""
    assert zap_for(pool) is None


def test_an_unknown_base_pool_has_no_zap() -> None:
    assert zap_for(metapool(base_pool="0x" + "99" * 20)) is None


def test_the_same_base_pool_on_another_chain_is_not_assumed() -> None:
    assert zap_for(metapool(chain_id=8453)) is None


def test_a_coin_list_that_does_not_match_the_zap_is_refused() -> None:
    assert zap_for(metapool(coins=5)) is None  # 4 underlying, zap expects 3


def test_every_registered_zap_has_a_plausible_shape() -> None:
    for (chain_id, base, dynamic), zap in ZAPS.items():
        assert chain_id > 0
        assert base == base.lower() and len(base) == 42
        assert len(zap.address) == 42 and zap.address.startswith("0x")
        assert 3 <= zap.coins <= 5
        assert zap.dynamic is dynamic  # the key and the entry must agree


# -- calldata --------------------------------------------------------------
# Selectors read off the deployed zaps; the fixed-array ones are the 3pool
# zap's, whose N is 4.


@pytest.mark.parametrize(
    "signature,expected",
    {
        "calc_token_amount(address,uint256[],bool)": "f558454d",
        "add_liquidity(address,uint256[],uint256)": "fd9de631",
        "remove_liquidity(address,uint256,uint256[])": "8dae1a80",
        "calc_token_amount(address,uint256[4],bool)": "861cdef0",
        "add_liquidity(address,uint256[4],uint256)": "384e03db",
        "remove_liquidity(address,uint256,uint256[4])": "ad5cc918",
        # Identical in both dialects: every zapped metapool is
        # StableSwap, so the coin index is `int128` either way.
        "calc_withdraw_one_coin(address,uint256,int128)": "41b028f3",
        "remove_liquidity_one_coin(address,uint256,int128,uint256)": "29ed2862",
    }.items(),
)
def test_zap_selector_matches_the_deployed_contract(signature, expected) -> None:
    assert abi.selector(signature) == expected


def test_the_dynamic_deposit_carries_an_offset_and_a_length() -> None:
    data = abi.encode_zap_add_liquidity(META, [0, 5, 0], 7, dynamic=True)
    assert data[:10] == "0x" + abi.selector("add_liquidity(address,uint256[],uint256)")
    pool, offset, min_mint, length, *amounts = words_of(data)
    assert pool == int(META, 16)
    assert offset == 3 * 32  # three head words: pool, offset, min_mint
    assert min_mint == 7
    assert length == 3
    assert amounts == [0, 5, 0]


def test_the_fixed_deposit_is_inline_and_its_length_is_in_the_signature() -> None:
    data = abi.encode_zap_add_liquidity(META, [0, 5, 0, 0], 7, dynamic=False)
    assert data[:10] == "0x" + abi.selector("add_liquidity(address,uint256[4],uint256)")
    assert words_of(data) == [int(META, 16), 0, 5, 0, 0, 7]


def test_the_two_dialects_are_different_functions() -> None:
    amounts = [1, 2, 3, 4]
    assert (
        abi.encode_zap_calc_token_amount(META, amounts, dynamic=True)[:10]
        != abi.encode_zap_calc_token_amount(META, amounts, dynamic=False)[:10]
    )


def test_the_withdrawal_estimate_names_the_pool_first() -> None:
    data = abi.encode_zap_calc_withdraw_one_coin(META, 10**18, 2)
    assert words_of(data) == [int(META, 16), 10**18, 2]


# -- the contract layer ----------------------------------------------------


def contract_for(pool: Pool | None = None) -> tuple[PoolContract, FakeProvider]:
    provider = FakeProvider({"0xf558454d": word(42 * 10**18)})
    return PoolContract(provider, pool or metapool(), ACCOUNT), provider


async def test_a_zap_quote_goes_to_the_zap_not_the_pool() -> None:
    contract, provider = contract_for()
    sent: list[dict] = []

    async def record(method, params=None):
        sent.append(params[0])
        return word(42 * 10**18)

    provider.request = record  # type: ignore[method-assign]
    assert await contract.zap_calc_token_amount([1, 0, 0]) == 42 * 10**18
    assert sent[0]["to"] == NG_ZAP
    assert sent[0]["data"][:10] == "0x" + abi.selector(
        "calc_token_amount(address,uint256[],bool)"
    )


async def test_a_zap_deposit_is_sent_to_the_zap() -> None:
    contract, provider = contract_for()
    await contract.zap_add_liquidity([1, 0, 0], 5)
    assert provider.sent[-1]["to"] == NG_ZAP
    assert words_of(provider.sent[-1]["data"])[0] == int(META, 16)


async def test_a_pool_without_a_zap_says_so_rather_than_guessing() -> None:
    plain = metapool()
    plain.base_pool = ""
    contract, _ = contract_for(plain)
    assert contract.zap is None
    with pytest.raises(PoolCallFailed, match="no deposit zap"):
        await contract.zap_add_liquidity([1], 0)


async def test_the_base_pool_fee_is_read_from_the_base_pool() -> None:
    contract, provider = contract_for()
    sent: list[dict] = []

    async def record(method, params=None):
        sent.append(params[0])
        return word(1_000_000)

    provider.request = record  # type: ignore[method-assign]
    assert await contract.base_fee() == 1_000_000
    assert sent[0]["to"] == RESERVES
    assert sent[0]["data"] == abi.encode_fee()


async def test_a_pool_with_no_base_pool_has_no_base_fee() -> None:
    plain = metapool()
    plain.base_pool = ""
    contract, _ = contract_for(plain)
    assert await contract.base_fee() == 0


# -- the deposit panel -----------------------------------------------------


def deposit_tab(pool: Pool | None = None, provider: FakeProvider | None = None):
    from ui.actions import DepositTab

    pool = pool or metapool()
    provider = provider or FakeProvider({"0xf558454d": word(10**18)})
    contract = PoolContract(provider, pool, ACCOUNT)
    tab = DepositTab(StubPage(), pool, lambda: contract, None)
    tab.mount()
    return tab, provider


def test_a_plain_pool_shows_no_route_picker() -> None:
    plain = metapool()
    plain.base_pool = ""
    tab, _ = deposit_tab(plain)
    assert tab.route.visible is False
    assert list(tab.routes) == ["pool"]


def test_a_metapool_offers_both_routes() -> None:
    tab, _ = deposit_tab()
    assert tab.route.visible is True
    assert [f.label for f in tab.routes["pool"].fields] == ["C0", "C1"]
    assert [f.label for f in tab.routes["underlying"].fields] == ["C0", "C2", "C3"]


def test_the_underlying_route_is_the_default_where_there_is_one() -> None:
    tab, _ = deposit_tab()
    assert tab.route.value == "underlying"
    assert tab.underlying is True
    assert tab.fields is tab.routes["underlying"].fields
    assert tab.routes["underlying"].control.visible is True
    assert tab.routes["pool"].control.visible is False
    assert [radio.value for radio in tab.route.content.controls] == [
        "underlying",
        "pool",
    ]


def test_a_pool_without_a_zap_stays_on_its_own_coins() -> None:
    plain = metapool()
    plain.base_pool = ""
    tab, _ = deposit_tab(plain)
    assert tab.route.value == "pool"
    assert tab.underlying is False


def test_switching_route_swaps_which_fields_are_live_and_shown() -> None:
    tab, _ = deposit_tab()

    tab.route.value = "pool"
    tab._route_changed(None)

    assert tab.underlying is False
    assert tab.fields is tab.routes["pool"].fields
    assert tab.routes["pool"].control.visible is True
    assert tab.routes["underlying"].control.visible is False


def test_an_amount_typed_on_one_route_is_not_lost_by_looking_at_the_other() -> None:
    tab, _ = deposit_tab()
    tab.routes["underlying"].fields[0].value = "5"
    tab.route.value = "pool"
    tab._route_changed(None)
    tab.route.value = "underlying"
    tab._route_changed(None)
    assert tab.routes["underlying"].fields[0].value == "5"


async def test_the_underlying_route_deposits_through_the_zap() -> None:
    tab, provider = deposit_tab()
    tab.route.value = "underlying"
    tab.slippage.value = "1"
    tab.fields[1].value = "1000"  # the first base-pool coin, 6 decimals

    await tab.submit(tab.get_contract())

    sent = provider.sent[-1]
    assert sent["to"] == NG_ZAP
    pool_word, _offset, min_mint, length, *amounts = words_of(sent["data"])
    assert pool_word == int(META, 16)
    assert length == 3
    assert amounts == [0, 1000 * 10**6, 0]
    assert min_mint == abi.apply_slippage(10**18, 1.0)


async def test_the_pool_route_still_deposits_into_the_pool() -> None:
    tab, provider = deposit_tab()
    tab.route.value = "pool"
    tab._route_changed(None)
    tab.fields[0].value = "1000"
    await tab.submit(tab.get_contract())
    assert provider.sent[-1]["to"] == META
    assert provider.sent[-1]["data"][:10] == "0x" + abi.selector(
        "add_liquidity(uint256[],uint256)"
    )


async def test_the_underlying_route_approves_the_zap_not_the_pool() -> None:
    tab, _ = deposit_tab()
    tab.fields[1].value = "1000"

    pending = await tab.approval_needed(tab.get_contract())

    assert pending is not None
    _token, spender, amount = pending
    assert spender == NG_ZAP
    assert amount == 1000 * 10**6
    assert tab.approve_button.content == "1. Approve C2"


async def test_the_pool_route_approves_the_pool() -> None:
    tab, _ = deposit_tab()
    tab.route.value = "pool"
    tab._route_changed(None)
    tab.fields[0].value = "1000"
    pending = await tab.approval_needed(tab.get_contract())
    assert pending is not None and pending[1] == META


async def test_nothing_is_approved_while_the_quote_is_failing() -> None:
    tab, provider = deposit_tab()
    tab.fields[1].value = "1000"
    from wallet.base import RpcError

    provider.raise_on_call = RpcError(-32000, "execution reverted")

    await tab.refresh()

    assert tab._quote_ok is False
    assert await tab.approval_needed(tab.get_contract()) is None
    assert tab.approve_button.visible is False
    assert tab.submit_button.disabled is True


async def test_the_zap_slippage_covers_both_pools_fees() -> None:
    from ui.actions import QUOTE_DRIFT

    tab, provider = deposit_tab()
    provider.answers["0xddca3f43"] = word(4_000_000)  # 0.04% on both pools

    await tab.suggest_slippage(tab.get_contract())

    assert float(tab.slippage.value) == pytest.approx(0.04 + 0.04 + QUOTE_DRIFT)


async def test_the_pool_route_charges_one_fee() -> None:
    tab, provider = deposit_tab()
    provider.answers["0xddca3f43"] = word(4_000_000)
    tab.route.value = "pool"
    await tab.suggest_slippage(tab.get_contract())
    from ui.actions import QUOTE_DRIFT

    assert float(tab.slippage.value) == pytest.approx(0.04 + QUOTE_DRIFT)


async def test_switching_route_re_reads_the_fee() -> None:
    tab, provider = deposit_tab()
    provider.answers["0xddca3f43"] = word(4_000_000)
    await tab.suggest_slippage(tab.get_contract())
    two_fees = tab.slippage.value

    tab.route.value = "pool"
    await tab.suggest_slippage(tab.get_contract())

    assert tab.slippage.value != two_fees


# -- the withdraw panel ----------------------------------------------------


def withdraw_tab(pool: Pool | None = None, provider: FakeProvider | None = None):
    from ui.actions import WithdrawTab

    pool = pool or metapool()
    provider = provider or FakeProvider({"0x41b028f3": word(500 * 10**6)})
    contract = PoolContract(provider, pool, ACCOUNT)
    tab = WithdrawTab(StubPage(), pool, lambda: contract, None)
    tab.mount()
    return tab, provider


def test_the_receive_list_is_the_underlying_coins_by_default() -> None:
    tab, _ = withdraw_tab()
    assert tab.route.value == "underlying"
    assert [o.text for o in tab.coin_picker.options] == ["C0", "C2", "C3"]
    assert tab.mode.value == "one"
    assert tab.balanced_radio.disabled is True

    tab.route.value = "pool"
    tab._route_changed(None)

    assert [o.text for o in tab.coin_picker.options] == ["C0", "C1"]


def test_the_zap_route_withdraws_into_one_coin_only() -> None:
    tab, _ = withdraw_tab()

    assert tab.mode.value == "one"
    assert tab.balanced_radio.disabled is True
    assert "one coin" in (tab.balanced_radio.tooltip or "")

    tab.route.value = "pool"
    tab._route_changed(None)
    assert tab.balanced_radio.disabled is False


async def test_the_zap_route_needs_the_lp_approved_to_the_zap() -> None:
    tab, _ = withdraw_tab()
    tab.amount.value = "10"

    pending = await tab.approval_needed(tab.get_contract())

    assert pending is not None
    token, spender, amount = pending
    assert token == META  # this pool is its own LP token
    assert spender == NG_ZAP
    assert amount == 10 * 10**18
    assert tab.approve_button.content == "1. Approve LP"


async def test_the_pool_route_needs_no_approval() -> None:
    tab, _ = withdraw_tab()
    tab.route.value = "pool"
    tab._route_changed(None)
    tab.amount.value = "10"
    assert await tab.approval_needed(tab.get_contract()) is None


async def test_the_zap_withdrawal_is_sent_to_the_zap() -> None:
    tab, provider = withdraw_tab()
    tab.coin_picker.value = "2"
    tab.amount.value = "10"
    tab.slippage.value = "1"

    await tab.submit(tab.get_contract())

    sent = provider.sent[-1]
    assert sent["to"] == NG_ZAP
    assert sent["data"][:10] == "0x" + abi.selector(
        "remove_liquidity_one_coin(address,uint256,int128,uint256)"
    )
    pool_word, burn, index, floor = words_of(sent["data"])
    assert pool_word == int(META, 16)
    assert burn == 10 * 10**18
    assert index == 2
    assert floor == abi.apply_slippage(500 * 10**6, 1.0)


async def test_the_pool_route_still_burns_at_the_pool() -> None:
    tab, provider = withdraw_tab()
    tab.route.value = "pool"
    tab._route_changed(None)
    tab.mode.value = "one"
    tab.amount.value = "10"
    await tab.submit(tab.get_contract())
    assert provider.sent[-1]["to"] == META


def test_a_pool_without_a_zap_hides_the_withdraw_route_picker() -> None:
    plain = metapool()
    plain.base_pool = ""
    tab, _ = withdraw_tab(plain)
    assert tab.route.visible is False
    assert tab.underlying is False


# -- swapping the underlying, without any zap ------------------------------
# A metapool does the base-pool leg itself, so `exchange_underlying` needs no
# zap and approves nothing but the pool.


def test_underlying_swap_selectors_match_the_deployed_pools() -> None:
    assert abi.selector("get_dy_underlying(int128,int128,uint256)") == "07211ef7"
    assert abi.selector("exchange_underlying(int128,int128,uint256,uint256)") == "a6417ed6"
    assert abi.selector("get_dy_underlying(uint256,uint256,uint256)") == "85f11d1e"
    assert (
        abi.selector("exchange_underlying(uint256,uint256,uint256,uint256)")
        == "65b2489b"
    )


def test_the_underlying_quote_is_indexed_into_the_underlying_list() -> None:
    data = abi.encode_get_dy_underlying(2, 0, 10**6, stableswap=True)
    assert data[:10] == "0x" + abi.selector("get_dy_underlying(int128,int128,uint256)")
    assert words_of(data) == [2, 0, 10**6]


async def test_an_underlying_swap_goes_to_the_pool_itself() -> None:
    pool = metapool()
    provider = FakeProvider({"0x07211ef7": word(999 * 10**18)})
    contract = PoolContract(provider, pool, ACCOUNT)

    assert await contract.get_dy_underlying(1, 0, 10**6) == 999 * 10**18
    await contract.exchange_underlying(1, 0, 10**6, 5)

    assert provider.sent[-1]["to"] == META
    assert provider.sent[-1]["data"][:10] == "0x" + abi.selector(
        "exchange_underlying(int128,int128,uint256,uint256)"
    )


def test_only_a_decomposed_metapool_has_underlying() -> None:
    assert metapool().has_underlying is True

    plain = metapool()
    plain.base_pool = ""
    assert plain.has_underlying is False

    undecomposed = metapool(coins=2)
    assert undecomposed.has_underlying is False


def swap_tab(pool: Pool | None = None, provider: FakeProvider | None = None):
    from ui.actions import SwapTab

    pool = pool or metapool()
    provider = provider or FakeProvider({"0x07211ef7": word(999 * 10**18)})
    contract = PoolContract(provider, pool, ACCOUNT)
    tab = SwapTab(StubPage(), pool, lambda: contract, None)
    tab.mount()
    return tab, provider


def test_the_swap_panel_offers_the_underlying_coins_first() -> None:
    tab, _ = swap_tab()
    assert tab.route.visible is True
    assert tab.underlying is True
    assert [o.text for o in tab.from_coin.options] == ["C0", "C2", "C3"]

    tab.route.value = "pool"
    tab._route_changed(None)

    assert [o.text for o in tab.from_coin.options] == ["C0", "C1"]


def test_a_plain_pool_has_no_swap_route_picker() -> None:
    plain = metapool()
    plain.base_pool = ""
    tab, _ = swap_tab(plain)
    assert tab.route.visible is False
    assert tab.underlying is False


async def test_the_underlying_route_swaps_through_the_pool() -> None:
    tab, provider = swap_tab()
    tab.slippage.value = "1"
    tab.from_coin.value, tab.to_coin.value = "1", "0"  # a base coin for the meta coin
    tab.amount.value = "1000"  # C2, six decimals

    await tab.submit(tab.get_contract())

    sent = provider.sent[-1]
    assert sent["to"] == META
    i, j, dx, floor = words_of(sent["data"])
    assert (i, j) == (1, 0)
    assert dx == 1000 * 10**6
    assert floor == abi.apply_slippage(999 * 10**18, 1.0)


async def test_the_pool_route_still_swaps_the_contract_coins() -> None:
    tab, provider = swap_tab(provider=FakeProvider({"0x5e0d443f": word(5 * 10**18)}))
    tab.route.value = "pool"
    tab._route_changed(None)
    tab.amount.value = "1000"

    await tab.submit(tab.get_contract())

    assert provider.sent[-1]["data"][:10] == "0x" + abi.selector(
        "exchange(int128,int128,uint256,uint256)"
    )


async def test_the_underlying_swap_is_approved_to_the_pool_not_a_zap() -> None:
    tab, _ = swap_tab()
    tab.amount.value = "1000"
    pending = await tab.approval_needed(tab.get_contract())
    assert pending is not None and pending[1] == META


async def test_the_underlying_swap_pays_both_pools_fees() -> None:
    from ui.actions import SLIPPAGE_OF_FEE

    tab, provider = swap_tab()
    provider.answers["0xddca3f43"] = word(4_000_000)  # 0.04% on both pools

    await tab.suggest_slippage(tab.get_contract())

    assert float(tab.slippage.value) == pytest.approx(0.08 * SLIPPAGE_OF_FEE)


async def test_the_pool_route_asks_about_the_pair() -> None:
    tab, provider = swap_tab()
    provider.answers["0x76a9cd3e"] = word(9_999_999)  # dynamic_fee for this pair
    tab.route.value = "pool"

    await tab.suggest_slippage(tab.get_contract())

    from ui.actions import SLIPPAGE_OF_FEE, slippage_for

    assert float(tab.slippage.value) == pytest.approx(
        slippage_for(9_999_999, SLIPPAGE_OF_FEE), rel=1e-3
    )


# -- the other two dialects ------------------------------------------------
# Four exist, and none can be inferred from the others.

EURE_3CRV = "0x056C6C5e684CeC248635eD86033378Cc444459B0"  # Gnosis, per-pool zap
EURE_ZAP = "0xE3FFF29d4DC930EBb787FeCd49Ee5963DADf60b6"
GNOSIS_3POOL = "0x7f90122BF0700F9E7e1F688fe926940E8839F353"


def gnosis_crypto_metapool() -> Pool:
    """EURe/x3CRV as v2 reports it: a `crypto` metapool, coins decomposed."""
    pool = Pool(
        address=EURE_3CRV,
        name="EURe-3Crv",
        chain="xdai",
        chain_id=100,
        registry="crypto",
        base_pool=GNOSIS_3POOL,
        lp_token=EURE_3CRV,
        coins=[
            Coin("0x" + f"{i:02x}" * 20, symbol, 18 if i < 3 else 6, index=i)
            for i, symbol in enumerate(["EURe", "x3CRV", "WXDAI", "USDC", "USDT"])
        ],
    )
    pool.onchain_coins = 2
    return pool


def test_a_crypto_metapool_gets_its_own_zap() -> None:
    zap = zap_for(gnosis_crypto_metapool())
    assert zap is not None
    assert zap.address == EURE_ZAP
    assert (zap.pool_arg, zap.stableswap, zap.dynamic) == (False, False, False)
    assert zap.coins == 4


def test_the_per_pool_zap_takes_the_calldata_a_pool_would() -> None:
    data = abi.encode_zap_calc_token_amount(None, [0, 5, 0, 0], stableswap=False)
    assert data[:10] == "0x" + abi.selector("calc_token_amount(uint256[4])")
    assert words_of(data) == [0, 5, 0, 0]

    withdraw = abi.encode_zap_calc_withdraw_one_coin(None, 10**18, 2, stableswap=False)
    assert withdraw[:10] == "0x" + abi.selector("calc_withdraw_one_coin(uint256,uint256)")
    assert words_of(withdraw) == [10**18, 2]


def test_the_crypto_factory_zap_takes_a_pool_but_no_flag() -> None:
    data = abi.encode_zap_calc_token_amount(META, [1, 2, 3], stableswap=False)
    assert data[:10] == "0x" + abi.selector("calc_token_amount(address,uint256[3])")
    assert words_of(data) == [int(META, 16), 1, 2, 3]


def test_the_four_dialects_are_four_functions() -> None:
    amounts = [1, 2, 3]
    selectors = {
        abi.encode_zap_calc_token_amount(META, amounts, dynamic=True)[:10],
        abi.encode_zap_calc_token_amount(META, amounts)[:10],
        abi.encode_zap_calc_token_amount(META, amounts, stableswap=False)[:10],
        abi.encode_zap_calc_token_amount(None, amounts, stableswap=False)[:10],
    }
    assert len(selectors) == 4


async def test_a_per_pool_zap_is_addressed_without_the_pool() -> None:
    pool = gnosis_crypto_metapool()
    provider = FakeProvider({"0x1a805185": word(44 * 10**18)})  # calc_token_amount(uint256[4])
    contract = PoolContract(provider, pool, ACCOUNT)

    assert await contract.zap_calc_token_amount([0, 100 * 10**18, 0, 0]) == 44 * 10**18
    await contract.zap_add_liquidity([0, 100 * 10**18, 0, 0], 1)

    sent = provider.sent[-1]
    assert sent["to"] == EURE_ZAP
    assert words_of(sent["data"])[0] == 0


async def test_a_crypto_withdrawal_indexes_with_uint256() -> None:
    pool = gnosis_crypto_metapool()
    provider = FakeProvider()
    contract = PoolContract(provider, pool, ACCOUNT)
    await contract.zap_remove_liquidity_one_coin(10**18, 1, 0)
    assert provider.sent[-1]["data"][:10] == "0x" + abi.selector(
        "remove_liquidity_one_coin(uint256,uint256,uint256)"
    )


def test_a_crypto_metapool_swaps_through_its_zap() -> None:
    from ui.actions import underlying_swap_spender

    pool = gnosis_crypto_metapool()
    zap = zap_for(pool)
    assert zap is not None and zap.swaps is True
    assert pool.has_underlying is True
    assert underlying_swap_spender(pool) == EURE_ZAP

    provider = FakeProvider({"0x85f11d1e": word(86 * 10**18)})
    contract = PoolContract(provider, pool, ACCOUNT)
    assert contract.underlying_swap_target() == (EURE_ZAP, False)


async def test_a_crypto_underlying_swap_is_sent_to_the_zap() -> None:
    pool = gnosis_crypto_metapool()
    provider = FakeProvider({"0x85f11d1e": word(86 * 10**18)})
    contract = PoolContract(provider, pool, ACCOUNT)

    assert await contract.get_dy_underlying(1, 0, 100 * 10**18) == 86 * 10**18
    await contract.exchange_underlying(1, 0, 100 * 10**18, 5)

    assert provider.sent[-1]["to"] == EURE_ZAP
    assert provider.sent[-1]["data"][:10] == "0x" + abi.selector(
        "exchange_underlying(uint256,uint256,uint256,uint256)"
    )


async def test_the_crypto_swap_approves_the_zap_not_the_pool() -> None:
    from ui.actions import SwapTab

    pool = gnosis_crypto_metapool()
    provider = FakeProvider({"0x85f11d1e": word(86 * 10**18)})
    contract = PoolContract(provider, pool, ACCOUNT)
    tab = SwapTab(StubPage(), pool, lambda: contract, None)
    tab.mount()
    tab.amount.value = "100"

    assert tab.underlying is True
    pending = await tab.approval_needed(contract)
    assert pending is not None and pending[1] == EURE_ZAP


async def test_a_metapool_with_no_swapping_zap_is_refused() -> None:
    pool = gnosis_crypto_metapool()
    contract = PoolContract(FakeProvider(), pool, ACCOUNT)
    contract.zap = None
    with pytest.raises(PoolCallFailed, match="no zap that does"):
        contract.underlying_swap_target()


def test_the_stable_registry_reaches_gnosis_now() -> None:
    pool = Pool(
        address="0x" + "44" * 20,
        name="MAI/x3CRV",
        chain_id=100,
        registry="factory",
        base_pool=GNOSIS_3POOL,
        coins=[Coin("0x" + f"{i:02x}" * 20, f"C{i}", 18, index=i) for i in range(5)],
    )
    pool.onchain_coins = 2
    zap = zap_for(pool)
    assert zap is not None and zap.coins == 4
    assert zap.pool_arg and zap.stableswap


@pytest.mark.parametrize("table", ["ZAPS", "CRYPTO_ZAPS", "POOL_ZAPS"])
def test_every_table_is_keyed_lowercase(table: str) -> None:
    from curve import zaps

    for key in getattr(zaps, table):
        assert key[1] == key[1].lower()
