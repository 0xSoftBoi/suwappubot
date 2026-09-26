"""Claiming: which contract gets asked, and which gets sent to."""

from __future__ import annotations

import pytest

from curve import abi
from curve.models import Pool
from curve.pool import PoolContract
from curve.rewards import CRV_DECIMALS, REWARDS, crv_token, rewards_for
from ui import actions
from ui.actions import ClaimTab
from wallet.base import RpcError, WalletProvider

ACCOUNT = "0x1111111111111111111111111111111111111111"
POOL_ADDRESS = "0x390f3595bCa2df7D23783DFd126427CCeb997BF4"
LP_TOKEN = "0x6c3F90f043a72FA612cbac8115EE7e52BDe6E490"
GAUGE = "0x95f00391cB5EebCd190EB58728B4CE23DbFa6ac1"
ARB = "0x912CE59144191C1204E64559FE8253a0e49E6548"

MINTER_ETHEREUM = "0xd061D61a4d941c39E5453435B6345Dc261C2fcE0"
CRV_ETHEREUM = "0xD533a949740bb3306d119CC777fa900bA034cd52"


def word(value: int) -> str:
    return "0x" + f"{value:064x}"


def address_word(value: str) -> str:
    return "0x" + value[2:].lower().rjust(64, "0")


def string_word(text: str) -> str:
    """An ABI-encoded `string` return, as `symbol()` gives one."""
    body = text.encode().hex().ljust(64, "0")
    return "0x" + f"{32:064x}" + f"{len(text):064x}" + body


class FakeProvider(WalletProvider):
    def __init__(self, answers: dict[str, str] | None = None) -> None:
        self.answers = answers or {}
        self.sent: list[dict] = []
        self.calls: list[dict] = []
        self.default = word(0)
        self.chain = 1

    async def request(self, method: str, params=None):
        params = params or []
        if method == "eth_chainId":
            return hex(self.chain)
        if method == "eth_blockNumber":
            return hex(1000)
        if method == "eth_getTransactionReceipt":
            return {"status": "0x1", "blockNumber": hex(999)}
        if method == "eth_call":
            self.calls.append(params[0])
            return self.answers.get(params[0]["data"][:10], self.default)
        if method == "eth_estimateGas":
            return hex(150_000)
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
    return Pool.from_v2(
        {
            "address": POOL_ADDRESS,
            "pool_type": "crvusd",
            "lp_token_address": LP_TOKEN,
            "chain_id": chain_id,
            "chain": "ethereum" if chain_id == 1 else "arbitrum",
            "gauges": [gauge] if gauge else [],
            "coins": [
                {"symbol": "USDT", "address": "0x" + "aa" * 20, "decimals": 6},
                {"symbol": "crvUSD", "address": "0x" + "bb" * 20, "decimals": 18},
            ],
        }
    )


def contract_for(provider: FakeProvider, **kw) -> PoolContract:
    return PoolContract(provider, make_pool(**kw), ACCOUNT)


async def _noop() -> None:
    pass


def claim_tab(provider: FakeProvider, **kw) -> ClaimTab:
    pool = make_pool(**kw)
    contract = PoolContract(provider, pool, ACCOUNT)
    return ClaimTab(StubPage(), pool, lambda: contract, _noop)


# -- the table -------------------------------------------------------------


def test_ethereum_uses_the_minter() -> None:
    entry = rewards_for(make_pool())
    assert entry is not None
    assert entry.minter == MINTER_ETHEREUM
    assert entry.crv == CRV_ETHEREUM


def test_a_pool_with_no_gauge_has_nowhere_to_claim_from() -> None:
    assert rewards_for(make_pool(gauge="")) is None


def test_a_chain_with_no_crv_is_absent_rather_than_zero() -> None:
    for chain_id in (196, 5000, 999):
        assert chain_id not in REWARDS
        assert rewards_for(make_pool(chain_id=chain_id)) is None


def test_every_entry_is_two_distinct_contracts() -> None:
    for chain_id, entry in REWARDS.items():
        assert entry.crv.startswith("0x") and len(entry.crv) == 42, chain_id
        assert entry.minter.startswith("0x") and len(entry.minter) == 42, chain_id
        assert int(entry.crv, 16) != 0 and int(entry.minter, 16) != 0, chain_id
        assert entry.crv.lower() != entry.minter.lower(), chain_id


def test_crv_token_is_empty_off_table_rather_than_wrong() -> None:
    assert crv_token(make_pool(chain_id=196)) == ""
    assert crv_token(make_pool()) == CRV_ETHEREUM


# -- reading ---------------------------------------------------------------


async def test_reading_claimable_crv_sends_no_transaction() -> None:
    provider = FakeProvider({"0x33134583": word(7 * 10**18)})  # claimable_tokens
    amount = await contract_for(provider).claimable_crv()

    assert amount == 7 * 10**18
    assert provider.sent == [], "a preview must never broadcast"
    assert provider.calls[-1]["to"] == GAUGE


async def test_claimable_crv_is_zero_where_crv_is_not_minted() -> None:
    provider = FakeProvider({"0x33134583": word(7 * 10**18)})
    assert await contract_for(provider, chain_id=196).claimable_crv() == 0
    assert provider.calls == [], "no point asking a gauge on a chain with no CRV"


async def test_reward_tokens_walks_the_gauge_list() -> None:
    provider = FakeProvider(
        {
            "0x963c94b9": word(2),  # reward_count()
            "0x54c49fe9": address_word(ARB),  # reward_tokens(uint256)
        }
    )
    tokens = await contract_for(provider).reward_tokens()
    assert tokens == [ARB.lower(), ARB.lower()]


async def test_a_gauge_with_no_reward_count_reports_none() -> None:
    provider = FakeProvider()  # every read answers 0
    assert await contract_for(provider).reward_tokens() == []


# -- writing ---------------------------------------------------------------


async def test_claiming_crv_goes_to_the_minter_and_names_the_gauge() -> None:
    provider = FakeProvider()
    await contract_for(provider).claim_crv()

    sent = provider.sent[-1]
    assert sent["to"] == MINTER_ETHEREUM, "CRV is minted, not held by the gauge"
    assert sent["data"] == abi.encode_minter_mint(GAUGE)


async def test_claiming_incentives_goes_to_the_gauge() -> None:
    provider = FakeProvider()
    await contract_for(provider).claim_rewards()

    sent = provider.sent[-1]
    assert sent["to"] == GAUGE
    assert sent["data"] == abi.encode_claim_rewards()


# -- the panel -------------------------------------------------------------


async def test_the_tab_stays_out_of_the_bar_with_nothing_owed() -> None:
    tab = claim_tab(FakeProvider())
    await tab.refresh()
    assert tab.available is False


async def test_the_tab_appears_once_crv_accrues() -> None:
    provider = FakeProvider({"0x33134583": word(3 * 10**18)})
    tab = claim_tab(provider)
    await tab.refresh()

    assert tab.available is True
    assert tab.crv_claimable == 3 * 10**18
    assert "CRV" in tab.summary()


async def test_a_block_s_worth_of_crv_does_not_earn_a_tab() -> None:
    provider = FakeProvider({"0x33134583": word(130)})  # 1.3e-16 CRV
    tab = claim_tab(provider)
    await tab.refresh()

    assert tab.crv_claimable == 130, "still read, still true"
    assert tab.available is False
    assert tab.summary() == ""


async def test_what_the_panel_prints_is_what_puts_it_in_the_bar() -> None:
    from ui.actions import claimable

    provider = FakeProvider({"0x33134583": word(5 * 10**13)})  # 0.00005 CRV
    tab = claim_tab(provider)
    await tab.refresh()

    assert claimable(tab.crv_claimable, 18) is True
    assert tab.available is True
    assert len(tab.rows.controls) == 1
    assert tab.empty_note.visible is False

    provider.answers["0x33134583"] = word(4 * 10**13)  # 0.00004, prints as 0
    await tab.refresh()

    assert tab.available is False
    assert tab.rows.controls == []


async def test_a_dust_half_is_not_worth_its_own_wallet_prompt() -> None:
    provider = FakeProvider(
        {
            "0x33134583": word(200),  # dust CRV
            "0x963c94b9": word(1),
            "0x54c49fe9": address_word(ARB),
            "0x95d89b41": string_word("ARB"),
            "0x313ce567": word(18),
            "0x33fd6f74": word(3 * 10**18),  # 3 ARB, real
            "0xe6f1daf2": word(0),
        }
    )
    tab = claim_tab(provider)
    await tab.refresh()

    assert tab.available is True
    assert tab.summary() == "3 ARB", "the dust CRV is not offered"

    sent = await tab.submit(tab.get_contract())
    assert sent
    assert provider.sent[-1]["data"] == abi.encode_claim_rewards()
    assert len(provider.sent) == 1, "one prompt, not two"


async def test_an_incentive_token_is_named_and_scaled_from_the_chain() -> None:
    provider = FakeProvider(
        {
            "0x963c94b9": word(1),  # reward_count()
            "0x54c49fe9": address_word(ARB),  # reward_tokens(0)
            "0x33134583": word(0),  # no CRV
            "0xe6f1daf2": word(0),
            "0x95d89b41": string_word("USDC"),  # symbol()
            "0x313ce567": word(6),  # decimals()
            "0x33fd6f74": word(2_500_000),  # claimable_reward -> 2.5 USDC
        }
    )
    tab = claim_tab(provider)
    await tab.refresh()

    assert tab.extras == [(ARB.lower(), "USDC", 6, 2_500_000)]
    assert tab.available is True
    assert "2.5 USDC" in tab.summary()


async def test_both_kinds_owed_is_two_transactions(monkeypatch) -> None:
    monkeypatch.setattr(actions, "CONFIRM_INTERVAL", 0)
    provider = FakeProvider(
        {
            "0x33134583": word(10**18),  # claimable CRV
            "0x963c94b9": word(1),
            "0x54c49fe9": address_word(ARB),
            "0x95d89b41": string_word("ARB"),
            "0x313ce567": word(18),
            "0x33fd6f74": word(5 * 10**18),
        }
    )
    tab = claim_tab(provider)
    await tab.refresh()
    await tab.submit(tab.get_contract())

    assert [tx["to"] for tx in provider.sent] == [MINTER_ETHEREUM, GAUGE]
    assert "Claimed 1 CRV." in tab.status.value


async def test_only_incentives_owed_skips_the_minter() -> None:
    provider = FakeProvider(
        {
            "0x963c94b9": word(1),
            "0x54c49fe9": address_word(ARB),
            "0x95d89b41": string_word("ARB"),
            "0x313ce567": word(18),
            "0x33fd6f74": word(5 * 10**18),
        }
    )
    tab = claim_tab(provider)
    await tab.refresh()
    await tab.submit(tab.get_contract())

    assert [tx["to"] for tx in provider.sent] == [GAUGE]


async def test_claiming_nothing_is_refused_rather_than_sent() -> None:
    tab = claim_tab(FakeProvider())
    await tab.refresh()
    with pytest.raises(Exception, match="Nothing to claim"):
        await tab.submit(tab.get_contract())


def test_crv_decimals_is_eighteen() -> None:
    assert CRV_DECIMALS == 18


# -- a read that fails is not a gauge that owes nothing ---------------------


class FailingProvider(FakeProvider):
    """Answers normally until `broken` is set, then refuses every read."""

    def __init__(self, answers=None) -> None:
        super().__init__(answers)
        self.broken = False

    async def request(self, method: str, params=None):
        if self.broken and method == "eth_call":
            raise RpcError(-32000, "endpoint went away")
        return await super().request(method, params)


async def test_a_failed_read_keeps_the_last_known_figures() -> None:
    provider = FailingProvider({"0x33134583": word(3 * 10**18)})
    tab = claim_tab(provider)
    await tab.refresh()
    assert tab.crv_claimable == 3 * 10**18
    assert tab.read_error == ""

    provider.broken = True
    await tab.refresh()

    assert tab.crv_claimable == 3 * 10**18, "the last known figure survives"
    assert tab.available is True, "the tab does not vanish on a hiccup"
    assert "endpoint went away" in tab.read_error


async def test_the_reason_is_shown_rather_than_implied() -> None:
    provider = FailingProvider({"0x33134583": word(3 * 10**18)})
    tab = claim_tab(provider)
    await tab.refresh()
    provider.broken = True
    await tab.refresh()

    assert "endpoint went away" in (tab.estimate.value or "")
    assert tab.empty_note.visible is False, "never say 'nothing to claim' on a failure"


async def test_a_recovered_read_clears_the_message() -> None:
    provider = FailingProvider({"0x33134583": word(3 * 10**18)})
    tab = claim_tab(provider)
    provider.broken = True
    await tab.refresh()
    assert tab.read_error

    provider.broken = False
    await tab.refresh()

    assert tab.read_error == ""
    assert tab.estimate.value == ""


async def test_disconnecting_still_clears_everything() -> None:
    provider = FailingProvider({"0x33134583": word(3 * 10**18)})
    pool = make_pool()
    contract = PoolContract(provider, pool, ACCOUNT)
    tab = ClaimTab(StubPage(), pool, lambda: contract, _noop)
    await tab.refresh()
    assert tab.available is True

    contract.account = ""  # what a disconnect looks like to the panel
    await tab.refresh()

    assert tab.crv_claimable == 0
    assert tab.available is False
    assert tab.read_error == ""
