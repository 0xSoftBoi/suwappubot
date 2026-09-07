"""Deposit-and-stake: the calldata, the gating, and the two-transaction path."""

from __future__ import annotations

import pytest

from curve import abi
from curve.models import Pool
from curve.pool import PoolContract
from curve.stake_zaps import (
    OLD_CHAINS,
    STAKE_ZAPS,
    ZERO_ADDRESS,
    consistent_variants,
    stake_zap_for,
)
from ui import actions
from ui.actions import DepositTab, StakeTab, WithdrawTab
from wallet.base import WalletProvider

ACCOUNT = "0x1111111111111111111111111111111111111111"
POOL_ADDRESS = "0x390f3595bCa2df7D23783DFd126427CCeb997BF4"
LP_TOKEN = "0x6c3F90f043a72FA612cbac8115EE7e52BDe6E490"
GAUGE = "0x95f00391cB5EebCd190EB58728B4CE23DbFa6ac1"
USDT = "0x" + "aa" * 20
CRVUSD = "0x" + "bb" * 20


def word(value: int) -> str:
    return "0x" + f"{value:064x}"


class FakeProvider(WalletProvider):
    """Answers reads by selector, records writes, and mines instantly."""

    def __init__(self, answers: dict[str, str] | None = None) -> None:
        self.answers = answers or {}
        self.sent: list[dict] = []
        self.default = word(0)
        self.chain = 1
        self.balances: list[int] | None = None

    async def request(self, method: str, params=None):
        params = params or []
        if method == "eth_chainId":
            return hex(self.chain)
        if method == "eth_blockNumber":
            return hex(1000)
        if method == "eth_getTransactionReceipt":
            return {"status": "0x1", "blockNumber": hex(999)}
        if method == "eth_call":
            data = params[0]["data"]
            if data[:10] == "0x70a08231" and self.balances:  # balanceOf
                return word(self.balances.pop(0))
            return self.answers.get(data[:10], self.default)
        if method == "eth_sendTransaction":
            self.sent.append(params[0])
            return "0x" + f"{len(self.sent):02x}" * 32
        raise AssertionError(f"unexpected method {method}")


class StubPage:
    def update(self) -> None:
        pass

    def run_task(self, *_args, **_kwargs) -> None:
        pass


def make_pool(*, gauge: str = GAUGE, chain_id: int = 1) -> Pool:
    pool = Pool.from_v2(
        {
            "address": POOL_ADDRESS,
            "pool_type": "crvusd",
            "lp_token_address": LP_TOKEN,
            "chain_id": chain_id,
            "gauges": [gauge] if gauge else [],
            "coins": [
                {"symbol": "USDT", "address": USDT, "decimals": 6},
                {"symbol": "crvUSD", "address": CRVUSD, "decimals": 18},
            ],
        }
    )
    return pool.merge_detail(
        {
            "n_coins": 2,
            "balances": [1_000_000.0, 2_000_000.0],
            "coins": [
                {"symbol": "USDT", "address": USDT, "decimals": 6},
                {"symbol": "crvUSD", "address": CRVUSD, "decimals": 18},
            ],
        }
    )


def deposit_tab(provider: FakeProvider, **pool_kw) -> DepositTab:
    pool = make_pool(**pool_kw)
    contract = PoolContract(provider, pool, ACCOUNT)
    tab = DepositTab(StubPage(), pool, lambda: contract, _noop)
    tab.slippage.value = "1"
    return tab


def withdraw_tab(provider: FakeProvider, **pool_kw) -> WithdrawTab:
    pool = make_pool(**pool_kw)
    contract = PoolContract(provider, pool, ACCOUNT)
    tab = WithdrawTab(StubPage(), pool, lambda: contract, _noop)
    tab.slippage.value = "1"
    return tab


async def _noop() -> None:
    pass


# -- the encoder -----------------------------------------------------------


def decode_deposit_and_stake(data: str, *, use_underlying: bool) -> dict:
    """Decode the calldata the way the contract's ABI decoder would."""
    body = data[10:]
    words = [body[i : i + 64] for i in range(0, len(body), 64)]

    def as_int(index: int) -> int:
        return int(words[index], 16)

    def as_address(index: int) -> str:
        return "0x" + words[index][24:]

    def as_array(offset_word: int, addresses: bool) -> list:
        start = as_int(offset_word) // 32
        length = as_int(start)
        return [
            ("0x" + words[start + 1 + i][24:]) if addresses else as_int(start + 1 + i)
            for i in range(length)
        ]

    flags = 2 if use_underlying else 1
    return {
        "deposit": as_address(0),
        "lp_token": as_address(1),
        "gauge": as_address(2),
        "n_coins": as_int(3),
        "coins": as_array(4, addresses=True),
        "amounts": as_array(5, addresses=False),
        "min_mint": as_int(6),
        "use_underlying": bool(as_int(7)) if use_underlying else None,
        "use_dynarray": bool(as_int(7 + flags - 1)),
        "pool": as_address(7 + flags),
    }


@pytest.mark.parametrize("use_underlying", [None, False, True])
def test_both_spellings_decode_back_to_what_went_in(use_underlying) -> None:
    coins = [USDT, CRVUSD, "0x" + "cc" * 20]
    amounts = [1, 2, 3]
    data = abi.encode_deposit_and_stake(
        POOL_ADDRESS,
        LP_TOKEN,
        GAUGE,
        coins,
        amounts,
        min_mint=7,
        use_dynarray=True,
        pool=ZERO_ADDRESS,
        use_underlying=use_underlying,
    )
    decoded = decode_deposit_and_stake(data, use_underlying=use_underlying is not None)

    assert decoded["deposit"] == POOL_ADDRESS.lower()
    assert decoded["lp_token"] == LP_TOKEN.lower()
    assert decoded["gauge"] == GAUGE.lower()
    assert decoded["n_coins"] == 3
    assert decoded["coins"] == [c.lower() for c in coins]
    assert decoded["amounts"] == amounts
    assert decoded["min_mint"] == 7
    assert decoded["use_dynarray"] is True
    assert decoded["pool"] == ZERO_ADDRESS


def test_the_two_arities_are_different_functions() -> None:
    common = {
        "coins": [USDT], "amounts": [1], "min_mint": 0,
        "use_dynarray": False, "pool": ZERO_ADDRESS,
    }
    nine = abi.encode_deposit_and_stake(
        POOL_ADDRESS, LP_TOKEN, GAUGE, use_underlying=None, **common
    )
    ten = abi.encode_deposit_and_stake(
        POOL_ADDRESS, LP_TOKEN, GAUGE, use_underlying=False, **common
    )
    assert nine[:10] != ten[:10]
    assert nine[:10] == "0x" + abi.selector(
        "deposit_and_stake(address,address,address,uint256,address[],uint256[],"
        "uint256,bool,address)"
    )
    assert ten[:10] == "0x" + abi.selector(
        "deposit_and_stake(address,address,address,uint256,address[],uint256[],"
        "uint256,bool,bool,address)"
    )


def test_a_coin_without_an_amount_is_refused() -> None:
    with pytest.raises(ValueError):
        abi.encode_deposit_and_stake(
            POOL_ADDRESS, LP_TOKEN, GAUGE, [USDT, CRVUSD], [1],
            min_mint=0, use_dynarray=False, pool=ZERO_ADDRESS, use_underlying=None,
        )


# -- the table -------------------------------------------------------------


def test_every_entry_agrees_with_the_old_chains_list() -> None:
    assert consistent_variants()


def test_the_flag_matches_old_chains_entry_by_entry() -> None:
    for chain_id, zap in STAKE_ZAPS.items():
        assert zap.use_underlying_arg == (chain_id in OLD_CHAINS), chain_id


def test_addresses_are_well_formed() -> None:
    for chain_id, zap in STAKE_ZAPS.items():
        assert zap.address.startswith("0x") and len(zap.address) == 42, chain_id
        assert int(zap.address, 16) != 0, chain_id


def test_no_gauge_means_no_route() -> None:
    assert stake_zap_for(make_pool(gauge="")) is None


def test_a_chain_with_no_zap_deployed_gets_none() -> None:
    assert stake_zap_for(make_pool(chain_id=1313161554)) is None  # Aurora


# -- the deposit panel -----------------------------------------------------


def test_ticking_stake_moves_the_approval_to_the_stake_zap() -> None:
    tab = deposit_tab(FakeProvider())
    assert tab.spender == POOL_ADDRESS

    tab.stake_box.value = True
    assert tab.spender == STAKE_ZAPS[1].address


def test_the_box_is_hidden_where_there_is_no_gauge() -> None:
    assert deposit_tab(FakeProvider(), gauge="").stake_box.visible is False
    assert deposit_tab(FakeProvider()).stake_box.visible is True


async def test_deposit_and_stake_goes_to_the_zap_in_one_transaction() -> None:
    provider = FakeProvider({"0x3883e119": word(500 * 10**18)})  # calc_token_amount
    tab = deposit_tab(provider)
    tab.stake_box.value = True
    tab.fields[0].value = "100"

    await tab.submit(tab.get_contract())

    assert len(provider.sent) == 1, "the whole point is that it is one transaction"
    sent = provider.sent[0]
    assert sent["to"] == STAKE_ZAPS[1].address
    decoded = decode_deposit_and_stake(sent["data"], use_underlying=True)
    assert decoded["deposit"] == POOL_ADDRESS.lower()
    assert decoded["gauge"] == GAUGE.lower()
    assert decoded["amounts"] == [100 * 10**6, 0]
    assert decoded["pool"] == ZERO_ADDRESS
    assert decoded["use_underlying"] is False


async def test_without_the_box_the_deposit_is_unchanged() -> None:
    provider = FakeProvider({"0x3883e119": word(500 * 10**18)})
    tab = deposit_tab(provider)
    tab.fields[0].value = "100"

    await tab.submit(tab.get_contract())

    assert len(provider.sent) == 1
    assert provider.sent[0]["to"] == POOL_ADDRESS
    assert provider.sent[0]["data"].startswith("0x" + abi.selector(
        "add_liquidity(uint256[2],uint256)"
    ))


async def test_a_chain_without_a_zap_deposits_then_stakes(monkeypatch) -> None:
    monkeypatch.setattr(actions, "CONFIRM_INTERVAL", 0)
    provider = FakeProvider({"0x3883e119": word(500 * 10**18)})
    provider.balances = [0, 500 * 10**18]
    tab = deposit_tab(provider, chain_id=1313161554)  # Aurora: no zap
    tab.stake_box.value = True
    tab.fields[0].value = "100"
    assert tab.combined is False

    await tab.submit(tab.get_contract())

    assert [tx["to"] for tx in provider.sent] == [POOL_ADDRESS, LP_TOKEN, GAUGE]
    assert abi.decode_uint("0x" + provider.sent[-1]["data"][10:]) == 500 * 10**18


# -- the withdraw panel ----------------------------------------------------


def test_use_staked_is_ticked_when_everything_is_staked() -> None:
    tab = withdraw_tab(FakeProvider())
    tab.lp_balance, tab.staked = 0, 10**18
    tab._sync_use_staked()
    assert tab.use_staked.visible is True
    assert tab.use_staked.value is True


def test_use_staked_is_offered_but_not_forced_on_a_split_position() -> None:
    tab = withdraw_tab(FakeProvider())
    tab.lp_balance, tab.staked = 5 * 10**18, 5 * 10**18
    tab._sync_use_staked()
    assert tab.use_staked.visible is True
    assert tab.use_staked.value is False


def test_use_staked_is_hidden_with_nothing_staked() -> None:
    tab = withdraw_tab(FakeProvider())
    tab.lp_balance, tab.staked = 5 * 10**18, 0
    tab._sync_use_staked()
    assert tab.use_staked.visible is False


def test_touching_the_box_stops_it_being_set_for_you() -> None:
    tab = withdraw_tab(FakeProvider())
    tab.lp_balance, tab.staked = 0, 10**18
    tab._sync_use_staked()
    assert tab.use_staked.value is True

    tab.use_staked.value = False
    tab._use_staked_toggled(None)
    tab.lp_balance, tab.staked = 0, 10**18
    tab._sync_use_staked()
    assert tab.use_staked.value is False, "it was theirs after they touched it"


def test_the_wallet_is_spent_before_the_gauge() -> None:
    tab = withdraw_tab(FakeProvider())
    tab.lp_balance, tab.staked = 4 * 10**18, 6 * 10**18
    tab.use_staked.value = True

    assert tab.spendable == 10 * 10**18
    assert tab._to_unstake(3 * 10**18) == 0        # covered by the wallet
    assert tab._to_unstake(9 * 10**18) == 5 * 10**18  # the shortfall only


def test_nothing_is_unstaked_when_the_box_is_clear() -> None:
    tab = withdraw_tab(FakeProvider())
    tab.lp_balance, tab.staked = 0, 6 * 10**18
    tab.use_staked.value = False
    assert tab.spendable == 0
    assert tab._to_unstake(10**18) == 0


async def test_a_staked_withdrawal_unstakes_the_shortfall_first(monkeypatch) -> None:
    monkeypatch.setattr(actions, "CONFIRM_INTERVAL", 0)
    provider = FakeProvider({"0x18160ddd": word(1_000 * 10**18)})  # totalSupply
    tab = withdraw_tab(provider)
    tab.lp_balance, tab.staked = 4 * 10**18, 6 * 10**18
    tab.use_staked.value = True
    tab.amount.value = "9"

    await tab.submit(tab.get_contract())

    assert [tx["to"] for tx in provider.sent] == [GAUGE, POOL_ADDRESS]
    unstake = provider.sent[0]
    assert unstake["data"].startswith("0x" + abi.selector("withdraw(uint256)"))
    assert abi.decode_uint("0x" + unstake["data"][10:]) == 5 * 10**18


async def test_an_unstaked_withdrawal_sends_one_transaction() -> None:
    provider = FakeProvider({"0x18160ddd": word(1_000 * 10**18)})
    tab = withdraw_tab(provider)
    tab.lp_balance, tab.staked = 9 * 10**18, 6 * 10**18
    tab.use_staked.value = True
    tab.amount.value = "5"

    await tab.submit(tab.get_contract())

    assert [tx["to"] for tx in provider.sent] == [POOL_ADDRESS]


# -- the stake panel's place in the bar ------------------------------------


def test_stake_is_unavailable_with_no_position() -> None:
    pool = make_pool()
    tab = StakeTab(StubPage(), pool, lambda: None, _noop)
    assert tab.available is False


@pytest.mark.parametrize("wallet,staked", [(1, 0), (0, 1), (1, 1)])
def test_stake_is_available_with_lp_on_either_side(wallet, staked) -> None:
    pool = make_pool()
    tab = StakeTab(StubPage(), pool, lambda: None, _noop)
    tab.lp_balance, tab.staked = wallet, staked
    assert tab.available is True


def test_stake_is_never_available_without_a_gauge() -> None:
    pool = make_pool(gauge="")
    tab = StakeTab(StubPage(), pool, lambda: None, _noop)
    tab.lp_balance = 10**18
    assert tab.available is False


def test_the_other_panels_are_always_available() -> None:
    pool = make_pool()
    for cls in (DepositTab, WithdrawTab):
        assert cls(StubPage(), pool, lambda: None, _noop).available is True
