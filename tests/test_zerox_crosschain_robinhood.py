"""0x Cross-Chain regressions for Robinhood launch-token funding.

The Robinhood paste-buy flow is deliberately single-wallet because bridge/swap
calldata is recipient-bound.  These tests pin the same invariant for the 0x
Cross-Chain fallback: the selected wallet is both the origin and destination,
the displayed platform fee is carried into the provider request, execution
re-quotes before signing, and background polling waits for destination fill.
"""

import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bot.models.swap import SwapStatus
from bot.services.swap_engine import SwapEngine, SwapQuote
from bot.services.tx_poller import TransactionPoller
from bot.services.zerox_api import ZeroXAPI, ZeroXError
from bot.utils.exceptions import SwapError

BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
ROBINHOOD_LAUNCH = "0x6245e67affA44a23077f0Ea7f981a8DC743a0c47"
WALLET = "0x00000000000000000000000000000000000000b2"
COLLECTOR = "0x00000000000000000000000000000000000000f0"


def _cross_chain_response(
    *, min_buy_amount: str = "900000000000000000", include_fee: bool = True
) -> dict:
    quote = {
        "sellAmount": "1000000",
        "buyAmount": "1000000000000000000",
        "minBuyAmount": min_buy_amount,
        "estimatedTimeSeconds": 4,
        "gasCosts": {"gasLimit": "250000", "totalNetworkFee": "1000"},
        "issues": {"allowance": {"spender": "0x0000000000001ff3684f28c67538d4d072c22734"}},
        "transaction": {
            "chainType": "evm",
            "details": {
                "to": "0x0000000000001ff3684f28c67538d4d072c22734",
                "data": "0x1234",
                "gas": "250000",
                "gasPrice": "1000000",
                "value": "0",
            },
        },
        "quoteId": "0xquote-robinhood",
    }
    if include_fee:
        # Realistic 0x behavior: a requested fee is echoed back in the
        # response so the caller can confirm it was actually applied.
        quote["fees"] = {"integratorFee": {"amount": "8000", "token": BASE_USDC}}
    return {
        "liquidityAvailable": True,
        "originChainId": 8453,
        "destinationChainId": 4663,
        "sellToken": BASE_USDC,
        "buyToken": ROBINHOOD_LAUNCH,
        "quotes": [quote],
    }


def test_zerox_cross_chain_quote_binds_destination_and_platform_fee():
    """Provider request must encode the selected recipient and exact fee bps."""
    api = ZeroXAPI()
    api.api_key = "test-key"
    api._request = AsyncMock(return_value=_cross_chain_response())

    with patch("bot.services.zerox_api.settings.fee_collector_address", COLLECTOR):
        quote = asyncio.run(
            api.get_cross_chain_quote(
                origin_chain_id=8453,
                destination_chain_id=4663,
                from_token=BASE_USDC,
                to_token=ROBINHOOD_LAUNCH,
                amount="1000000",
                origin_address=WALLET,
                destination_address=WALLET,
                slippage=0.5,
                platform_fee_bps=80,
            )
        )

    path, params = api._request.await_args.args
    assert path == "/cross-chain/quotes"
    assert params["originChain"] == 8453
    assert params["destinationChain"] == 4663
    assert params["originAddress"] == WALLET
    assert params["destinationAddress"] == WALLET
    assert params["slippageBps"] == 50
    assert params["sortQuotesBy"] == "price"
    assert params["maxNumQuotes"] == 1
    assert params["feeBps"] == 80
    assert params["feeRecipient"] == COLLECTOR
    assert quote.quote_id == "0xquote-robinhood"
    assert quote.to_amount_min == "900000000000000000"
    assert quote.tx_data["to"].lower().endswith("22734")


def test_engine_builds_robinhood_0x_cross_chain_quote_for_selected_wallet():
    """The engine adapter keeps raw launch-token addresses and recipient binding."""
    engine = SwapEngine.__new__(SwapEngine)
    engine.zerox = MagicMock()
    engine.zerox.get_cross_chain_quote = AsyncMock(
        return_value=SimpleNamespace(
            to_amount="1000000000000000000",
            to_amount_min="900000000000000000",
            estimated_gas="250000",
            estimated_time=4,
            quote_id="0xquote-robinhood",
            tx_data={"to": "0x0000000000001ff3684f28c67538d4d072c22734"},
            raw_response=_cross_chain_response(),
        )
    )
    engine._real_gas_cost_usd = AsyncMock(return_value=(0.01, True))

    quote = asyncio.run(
        engine._get_0x_cross_chain_quote(
            from_chain="base",
            to_chain="robinhood",
            from_token="USDC",
            to_token=ROBINHOOD_LAUNCH,
            amount=1.0,
            amount_raw="1000000",
            from_address=WALLET,
            to_address=WALLET,
            slippage=0.5,
            platform_fee_bps=80,
        )
    )

    kwargs = engine.zerox.get_cross_chain_quote.await_args.kwargs
    assert kwargs["origin_chain_id"] == 8453
    assert kwargs["destination_chain_id"] == 4663
    assert kwargs["destination_address"] == WALLET
    assert kwargs["to_token"] == ROBINHOOD_LAUNCH
    assert kwargs["platform_fee_bps"] == 80
    assert quote.provider == "0x_crosschain"
    assert quote.platform_fee_bps == 80
    assert quote.raw_quote["quote_id"] == "0xquote-robinhood"


def test_cross_chain_execution_requotes_for_signer_and_rejects_worse_min_out():
    """No stale/wrong-recipient 0x calldata may be signed after confirmation."""
    engine = SwapEngine.__new__(SwapEngine)
    engine.zerox = MagicMock()
    engine.zerox.get_cross_chain_quote = AsyncMock(
        return_value=SimpleNamespace(
            origin_chain_id=8453,
            destination_chain_id=4663,
            to_amount="950000000000000000",
            to_amount_min="800000000000000000",
            estimated_gas="250000",
            estimated_time=4,
            quote_id="0xfresh",
            tx_data={"to": "0x0000000000001ff3684f28c67538d4d072c22734"},
            raw_response=_cross_chain_response(min_buy_amount="800000000000000000"),
        )
    )
    engine._get_wallet_for_signing = AsyncMock(return_value=object())
    engine.wallet_service = MagicMock()
    engine.wallet_service.sign_evm_transaction = AsyncMock()

    approved = SwapQuote(
        provider="0x_crosschain",
        from_chain="base",
        to_chain="robinhood",
        from_token="USDC",
        to_token=ROBINHOOD_LAUNCH,
        from_amount="1000000",
        from_amount_human=1.0,
        to_amount="1000000000000000000",
        to_amount_human=1.0,
        to_amount_min="900000000000000000",
        gas_cost_usd=0.0,
        fee_cost_usd=0.0,
        total_cost_usd=0.0,
        estimated_time=4,
        price_impact=0.0,
        exchange_rate=1.0,
        platform_fee_bps=80,
        raw_quote={"slippage": 0.5, "quote_id": "0xold"},
    )

    with pytest.raises(SwapError, match="min-out"):
        asyncio.run(engine._execute_0x_cross_chain_swap(approved, {"address": WALLET}))

    kwargs = engine.zerox.get_cross_chain_quote.await_args.kwargs
    assert kwargs["origin_address"] == WALLET
    assert kwargs["destination_address"] == WALLET
    assert kwargs["platform_fee_bps"] == 80
    engine.wallet_service.sign_evm_transaction.assert_not_awaited()


def test_cross_chain_execution_rejects_tampered_raw_destination_chain_id():
    """Caller-controlled raw quote metadata cannot redirect a Robinhood swap."""
    engine = SwapEngine.__new__(SwapEngine)
    engine.zerox = MagicMock()
    engine.zerox.get_cross_chain_quote = AsyncMock()
    engine._get_wallet_for_signing = AsyncMock(return_value=object())
    engine.wallet_service = MagicMock()
    engine.wallet_service.sign_evm_transaction = AsyncMock()

    approved = SwapQuote(
        provider="0x_crosschain",
        from_chain="base",
        to_chain="robinhood",
        from_token="USDC",
        to_token=ROBINHOOD_LAUNCH,
        from_amount="1000000",
        from_amount_human=1.0,
        to_amount="1000000000000000000",
        to_amount_human=1.0,
        to_amount_min="900000000000000000",
        gas_cost_usd=0.0,
        fee_cost_usd=0.0,
        total_cost_usd=0.0,
        estimated_time=4,
        price_impact=0.0,
        exchange_rate=1.0,
        platform_fee_bps=80,
        raw_quote={
            "origin_chain_id": 8453,
            # Forged API payload attempts to redirect the destination to Arbitrum.
            "destination_chain_id": 42161,
            "slippage": 0.5,
            "quote_id": "0xold",
        },
    )

    with pytest.raises(SwapError, match="stored chain IDs do not match"):
        asyncio.run(engine._execute_0x_cross_chain_swap(approved, {"address": WALLET}))

    engine.zerox.get_cross_chain_quote.assert_not_awaited()
    engine.wallet_service.sign_evm_transaction.assert_not_awaited()


@pytest.mark.parametrize(
    ("provider_status", "expected"),
    [
        ("origin_tx_pending", SwapStatus.CONFIRMING.value),
        ("bridge_pending", SwapStatus.CONFIRMING.value),
        ("bridge_filled", SwapStatus.COMPLETED.value),
        ("origin_tx_reverted", SwapStatus.FAILED.value),
        ("bridge_failed", SwapStatus.FAILED.value),
    ],
)
def test_tx_poller_waits_for_0x_destination_fill(provider_status, expected):
    """Origin inclusion is not completion; only bridge_filled completes the swap."""
    poller = TransactionPoller()
    poller._zerox = MagicMock()
    poller._zerox.get_cross_chain_status = AsyncMock(
        return_value={
            "status": provider_status,
            "transactions": [
                {"chainId": 8453, "txHash": "0xorigin"},
                {"chainId": 4663, "txHash": "0xdestination"},
            ],
        }
    )
    tx = {
        "id": 7,
        "tx_hash": "0xorigin",
        "from_chain": "base",
        "to_chain": "robinhood",
        "route_provider": "0x_crosschain",
        "route_data": json.dumps({"quote_id": "0xquote-robinhood"}),
    }

    status, destination_hash = asyncio.run(poller._check_tx_status_dict(tx))

    poller._zerox.get_cross_chain_status.assert_awaited_once_with(
        origin_chain_id=8453,
        origin_tx_hash="0xorigin",
        quote_id="0xquote-robinhood",
    )
    assert status == expected
    if provider_status == "bridge_filled":
        assert destination_hash == "0xdestination"
    else:
        assert destination_hash is None


def test_tx_poller_repolls_confirming_crosschain_until_destination_fill(tmp_db):
    """A first nonterminal poll must not make the bridge disappear from polling."""
    from bot.models.swap import SwapTransaction
    from bot.models.user import User
    from database.db import get_session as get_db_session

    with get_db_session() as session:
        user = User(telegram_id=4663001)
        session.add(user)
        session.flush()
        tx = SwapTransaction(
            user_id=user.id,
            from_chain="base",
            from_token="USDC",
            from_amount="1000000",
            to_chain="robinhood",
            to_token="FRONG",
            to_amount="1000000000000000000",
            status=SwapStatus.SUBMITTED.value,
            tx_hash="0xorigin",
            route_provider="0x_crosschain",
            route_data=json.dumps({"quote_id": "0xquote-robinhood"}),
        )
        session.add(tx)
        session.commit()
        tx_id = tx.id

    poller = TransactionPoller()
    poller._zerox = MagicMock()
    poller._zerox.get_cross_chain_status = AsyncMock(
        side_effect=[
            {"status": "bridge_pending", "transactions": []},
            {
                "status": "bridge_filled",
                "transactions": [
                    {"chainId": 8453, "txHash": "0xorigin"},
                    {"chainId": 4663, "txHash": "0xdestination"},
                ],
            },
        ]
    )

    asyncio.run(poller._check_pending_transactions())
    with get_db_session() as session:
        assert session.get(SwapTransaction, tx_id).status == SwapStatus.CONFIRMING.value

    asyncio.run(poller._check_pending_transactions())
    with get_db_session() as session:
        stored = session.get(SwapTransaction, tx_id)
        assert stored.status == SwapStatus.COMPLETED.value
        assert stored.destination_tx_hash == "0xdestination"

    assert poller._zerox.get_cross_chain_status.await_count == 2


def test_zerox_crosschain_is_executable_provider():
    from bot.services.swap_engine import EXECUTABLE_PROVIDERS

    assert "0x_crosschain" in EXECUTABLE_PROVIDERS


def test_zerox_crosschain_route_is_scoped_to_robinhood_destination():
    """Do not silently change unrelated bridge routing while adding this fallback."""
    engine = SwapEngine.__new__(SwapEngine)
    engine.zerox = SimpleNamespace(is_configured=True)

    assert engine._is_0x_robinhood_cross_chain_route("base", "robinhood") is True
    assert engine._is_0x_robinhood_cross_chain_route("ethereum", "robinhood") is True
    assert engine._is_0x_robinhood_cross_chain_route("robinhood", "base") is False
    assert engine._is_0x_robinhood_cross_chain_route("base", "arbitrum") is False
    assert engine._is_0x_robinhood_cross_chain_route("solana", "robinhood") is False

    engine.zerox = SimpleNamespace(is_configured=False)
    assert engine._is_0x_robinhood_cross_chain_route("base", "robinhood") is False


def test_multi_wallet_crosschain_execution_isolates_fresh_quote_ids():
    """Concurrent wallets must never share mutable execution quote state."""
    engine = SwapEngine.__new__(SwapEngine)
    seen = {}

    async def fake_execute_swap(*, quote, wallet_id, **_kwargs):
        quote.raw_quote["quote_id"] = f"fresh-{wallet_id}"
        # Force both tasks to mutate before either one records what it sees.
        await asyncio.sleep(0)
        seen[wallet_id] = (quote.raw_quote["quote_id"], id(quote), id(quote.raw_quote))
        return None

    engine.execute_swap = AsyncMock(side_effect=fake_execute_swap)
    shared_quote = SwapQuote(
        provider="0x_crosschain",
        from_chain="base",
        to_chain="robinhood",
        from_token="USDC",
        to_token=ROBINHOOD_LAUNCH,
        from_amount="1000000",
        from_amount_human=1.0,
        to_amount="1000000000000000000",
        to_amount_human=1.0,
        to_amount_min="900000000000000000",
        gas_cost_usd=0.0,
        fee_cost_usd=0.0,
        total_cost_usd=0.0,
        estimated_time=4,
        price_impact=0.0,
        exchange_rate=1.0,
        platform_fee_bps=80,
        raw_quote={"quote_id": "display-quote"},
    )

    asyncio.run(
        engine.execute_multi_swap(
            [(shared_quote, 11), (shared_quote, 22)],
            user_id=7,
            attempt_id="concurrent-robinhood",
        )
    )

    assert seen[11][0] == "fresh-11"
    assert seen[22][0] == "fresh-22"
    assert seen[11][1:] != seen[22][1:]
    assert shared_quote.raw_quote["quote_id"] == "display-quote"


# --- Money-path review fix #1: CONFIRMING must not leak into the generic ---
# --- EVM-receipt fallback for any provider other than 0x_crosschain --------


def test_poller_only_polls_confirming_for_0x_crosschain(tmp_db):
    """CONFIRMING re-polling stays scoped to 0x_crosschain: that's the only
    provider whose SUBMITTED->CONFIRMING transition is legitimate (via its
    dedicated destination-fill check). Other providers now resolve straight
    from SUBMITTED to COMPLETED on a mined receipt (see
    test_evm_receipt_fallback_refuses_completed_for_cross_chain), so they
    should never legitimately be sitting in CONFIRMING in the first place;
    this only guards against a stray/legacy row."""
    from bot.models.swap import SwapTransaction
    from bot.models.user import User
    from database.db import get_session as get_db_session

    with get_db_session() as session:
        user = User(telegram_id=760001)
        session.add(user)
        session.flush()
        zerox_tx = SwapTransaction(
            user_id=user.id,
            from_chain="base",
            from_token="USDC",
            from_amount="1000000",
            to_chain="robinhood",
            to_token="FRONG",
            to_amount="1000000000000000000",
            status=SwapStatus.CONFIRMING.value,
            tx_hash="0xzerox",
            route_provider="0x_crosschain",
            route_data=json.dumps({"quote_id": "0xquote"}),
        )
        other_tx = SwapTransaction(
            user_id=user.id,
            from_chain="base",
            from_token="USDC",
            from_amount="1000000",
            to_chain="arbitrum",
            to_token="USDC",
            to_amount="1000000",
            status=SwapStatus.CONFIRMING.value,
            tx_hash="0xacross",
            route_provider="across",
        )
        session.add_all([zerox_tx, other_tx])
        session.commit()
        zerox_id, other_id = zerox_tx.id, other_tx.id

    poller = TransactionPoller()
    seen_ids = []

    async def fake_check(tx_dict):
        seen_ids.append(tx_dict["id"])
        return None, None

    poller._check_tx_status_dict = fake_check
    asyncio.run(poller._check_pending_transactions())

    assert zerox_id in seen_ids
    assert other_id not in seen_ids


def test_evm_receipt_fallback_refuses_completed_for_cross_chain():
    """The generic origin-receipt checker's "stay CONFIRMING on a mined
    receipt" refusal is scoped to route_provider == "0x_crosschain" only --
    that's the only provider with a real destination-fill status check
    elsewhere. Any other provider (e.g. "across", or no provider at all)
    must keep the legacy behavior of completing on a mined receipt, since
    the poller only re-queries CONFIRMING rows for 0x_crosschain (see
    test_poller_only_polls_confirming_for_0x_crosschain) -- refusing
    completion for other providers here would strand them in CONFIRMING
    forever with no path back to being re-checked."""
    poller = TransactionPoller()

    class FakeResponse:
        status = 200

        async def json(self):
            return {"result": {"status": "0x1"}}

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

    class FakeHttpSession:
        def post(self, *args, **kwargs):
            return FakeResponse()

    async def fake_get_session():
        return FakeHttpSession()

    with patch("bot.services.tx_poller.get_session", new=fake_get_session):
        zerox_crosschain_status = asyncio.run(
            poller._check_evm_tx("0xhash", "https://rpc.example", provider="0x_crosschain")
        )
        across_status = asyncio.run(
            poller._check_evm_tx("0xhash", "https://rpc.example", provider="across")
        )
        no_provider_status = asyncio.run(
            poller._check_evm_tx("0xhash", "https://rpc.example", provider=None)
        )

    assert zerox_crosschain_status == SwapStatus.CONFIRMING.value
    assert across_status == SwapStatus.COMPLETED.value
    assert no_provider_status == SwapStatus.COMPLETED.value


def test_check_tx_status_dict_completes_non_zerox_cross_chain_provider_on_mined_receipt():
    """Regression for the CONFIRMING black hole: an "across" cross-chain tx
    must resolve straight to COMPLETED from SUBMITTED (via the generic EVM
    branch of _check_tx_status_dict), not get stuck non-terminally in
    CONFIRMING where it would never be re-polled again."""
    poller = TransactionPoller()

    class FakeResponse:
        status = 200

        async def json(self):
            return {"result": {"status": "0x1"}}

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

    class FakeHttpSession:
        def post(self, *args, **kwargs):
            return FakeResponse()

    async def fake_get_session():
        return FakeHttpSession()

    tx_dict = {
        "id": 99,
        "tx_hash": "0xacross",
        "from_chain": "base",
        "to_chain": "arbitrum",
        "route_provider": "across",
    }

    with patch("bot.services.tx_poller.get_session", new=fake_get_session):
        status, dest_hash = asyncio.run(poller._check_tx_status_dict(tx_dict))

    assert status == SwapStatus.COMPLETED.value
    assert dest_hash is None


# --- Money-path review fix #2: execution must not silently redirect funds --
# --- to a wallet other than the one the display quote was bound to ---------


def test_cross_chain_execution_rejects_mismatched_display_recipient():
    """If the display quote recorded a recipient that no longer matches the
    signing wallet, abort before signing rather than silently sending to
    whichever wallet happens to execute."""
    engine = SwapEngine.__new__(SwapEngine)
    engine.zerox = MagicMock()
    engine.zerox.get_cross_chain_quote = AsyncMock()
    engine._get_wallet_for_signing = AsyncMock(return_value=object())
    engine.wallet_service = MagicMock()
    engine.wallet_service.sign_evm_transaction = AsyncMock()

    other_wallet = "0x00000000000000000000000000000000000000e1"
    approved = SwapQuote(
        provider="0x_crosschain",
        from_chain="base",
        to_chain="robinhood",
        from_token="USDC",
        to_token=ROBINHOOD_LAUNCH,
        from_amount="1000000",
        from_amount_human=1.0,
        to_amount="1000000000000000000",
        to_amount_human=1.0,
        to_amount_min="900000000000000000",
        gas_cost_usd=0.0,
        fee_cost_usd=0.0,
        total_cost_usd=0.0,
        estimated_time=4,
        price_impact=0.0,
        exchange_rate=1.0,
        platform_fee_bps=80,
        raw_quote={"slippage": 0.5, "quote_id": "0xold", "to_address": other_wallet},
    )

    with pytest.raises(SwapError, match="recipient does not match"):
        asyncio.run(engine._execute_0x_cross_chain_swap(approved, {"address": WALLET}))

    engine.zerox.get_cross_chain_quote.assert_not_awaited()
    engine.wallet_service.sign_evm_transaction.assert_not_awaited()


# --- Money-path review fix #4: a requested fee must be echoed back or the --
# --- (artificially cheaper-looking) route must be refused -------------------


def test_get_cross_chain_quote_rejects_response_that_drops_the_fee():
    """0x competes against fee-paying providers in the best-quote race. If we
    ask for a fee and 0x silently omits it from the response, the quote must
    be refused rather than allowed to win the race on an uncollected fee."""
    api = ZeroXAPI()
    api.api_key = "test-key"
    response = _cross_chain_response(include_fee=False)
    api._request = AsyncMock(return_value=response)

    with patch("bot.services.zerox_api.settings.fee_collector_address", COLLECTOR):
        with pytest.raises(ZeroXError, match="did not echo the requested platform fee"):
            asyncio.run(
                api.get_cross_chain_quote(
                    origin_chain_id=8453,
                    destination_chain_id=4663,
                    from_token=BASE_USDC,
                    to_token=ROBINHOOD_LAUNCH,
                    amount="1000000",
                    origin_address=WALLET,
                    destination_address=WALLET,
                    slippage=0.5,
                    platform_fee_bps=80,
                )
            )


def test_get_cross_chain_quote_allows_response_that_echoes_fee_recipient():
    """A response that echoes feeRecipient/feeBps (even without a `fees`
    object) is accepted -- 0x's exact field name for this isn't pinned down,
    so any recognizable echo of the request must satisfy the check."""
    api = ZeroXAPI()
    api.api_key = "test-key"
    response = _cross_chain_response()
    response["quotes"][0]["feeBps"] = 80
    response["quotes"][0]["feeRecipient"] = COLLECTOR
    api._request = AsyncMock(return_value=response)

    with patch("bot.services.zerox_api.settings.fee_collector_address", COLLECTOR):
        quote = asyncio.run(
            api.get_cross_chain_quote(
                origin_chain_id=8453,
                destination_chain_id=4663,
                from_token=BASE_USDC,
                to_token=ROBINHOOD_LAUNCH,
                amount="1000000",
                origin_address=WALLET,
                destination_address=WALLET,
                slippage=0.5,
                platform_fee_bps=80,
            )
        )
    assert quote.quote_id == "0xquote-robinhood"


def test_get_cross_chain_quote_skips_fee_check_when_no_fee_requested():
    """No fee requested (no collector configured) means nothing to verify."""
    api = ZeroXAPI()
    api.api_key = "test-key"
    api._request = AsyncMock(return_value=_cross_chain_response())

    with patch("bot.services.zerox_api.settings.fee_collector_address", None):
        quote = asyncio.run(
            api.get_cross_chain_quote(
                origin_chain_id=8453,
                destination_chain_id=4663,
                from_token=BASE_USDC,
                to_token=ROBINHOOD_LAUNCH,
                amount="1000000",
                origin_address=WALLET,
                destination_address=WALLET,
                slippage=0.5,
                platform_fee_bps=80,
            )
        )
    assert quote.quote_id == "0xquote-robinhood"


# --- Money-path review fix #3: shared fee cap across same-chain / cross-chain


def test_cross_chain_fee_bps_capped_at_same_limit_as_same_chain():
    from bot.services.zerox_api import MAX_PLATFORM_FEE_BPS

    assert MAX_PLATFORM_FEE_BPS == 1000
    with patch("bot.services.zerox_api.settings.fee_collector_address", COLLECTOR):
        same_chain_params = ZeroXAPI._fee_params(5000, BASE_USDC)
        cross_chain_params = ZeroXAPI._cross_chain_fee_params(5000, BASE_USDC)
    assert same_chain_params["swapFeeBps"] == MAX_PLATFORM_FEE_BPS
    assert cross_chain_params["feeBps"] == MAX_PLATFORM_FEE_BPS


# --- Money-path review fix #5: fresh re-quote must sell the approved amount


def test_cross_chain_execution_rejects_mismatched_from_amount():
    engine = SwapEngine.__new__(SwapEngine)
    engine.zerox = MagicMock()
    engine.zerox.get_cross_chain_quote = AsyncMock(
        return_value=SimpleNamespace(
            origin_chain_id=8453,
            destination_chain_id=4663,
            from_amount="500000",  # user approved 1000000
            to_amount="1000000000000000000",
            to_amount_min="900000000000000000",
            min_out_synthetic=False,
            estimated_gas="250000",
            estimated_time=4,
            quote_id="0xfresh",
            tx_data={"to": "0x0000000000001ff3684f28c67538d4d072c22734"},
            raw_response=_cross_chain_response(),
        )
    )
    engine._get_wallet_for_signing = AsyncMock(return_value=object())
    engine.wallet_service = MagicMock()
    engine.wallet_service.sign_evm_transaction = AsyncMock()

    approved = SwapQuote(
        provider="0x_crosschain",
        from_chain="base",
        to_chain="robinhood",
        from_token="USDC",
        to_token=ROBINHOOD_LAUNCH,
        from_amount="1000000",
        from_amount_human=1.0,
        to_amount="1000000000000000000",
        to_amount_human=1.0,
        to_amount_min="900000000000000000",
        gas_cost_usd=0.0,
        fee_cost_usd=0.0,
        total_cost_usd=0.0,
        estimated_time=4,
        price_impact=0.0,
        exchange_rate=1.0,
        platform_fee_bps=80,
        raw_quote={"slippage": 0.5, "quote_id": "0xold"},
    )

    with pytest.raises(SwapError, match="sell amount"):
        asyncio.run(engine._execute_0x_cross_chain_swap(approved, {"address": WALLET}))
    engine.wallet_service.sign_evm_transaction.assert_not_awaited()


# --- Money-path review fix #6: don't compare a synthetic min-out against ---
# --- a provider-verified one as if they were the same guarantee ------------


def test_assert_fresh_min_out_rejects_synthetic_fresh_against_real_approved():
    approved = SwapQuote(
        provider="0x_crosschain",
        from_chain="base",
        to_chain="robinhood",
        from_token="USDC",
        to_token=ROBINHOOD_LAUNCH,
        from_amount="1000000",
        from_amount_human=1.0,
        to_amount="1000000000000000000",
        to_amount_human=1.0,
        to_amount_min="900000000000000000",
        gas_cost_usd=0.0,
        fee_cost_usd=0.0,
        total_cost_usd=0.0,
        estimated_time=4,
        price_impact=0.0,
        exchange_rate=1.0,
        platform_fee_bps=80,
        raw_quote={"min_out_synthetic": False},
    )
    with pytest.raises(SwapError, match="provider-verified minimum"):
        SwapEngine._assert_fresh_min_out_acceptable(
            approved, "950000000000000000", "0x Cross-Chain", fresh_is_synthetic=True
        )


def test_assert_fresh_min_out_allows_synthetic_approved_against_real_fresh():
    """The opposite mix (approved was synthetic, fresh is provider-real) is
    fine -- a real provider min is at least as trustworthy as our estimate."""
    approved = SwapQuote(
        provider="0x_crosschain",
        from_chain="base",
        to_chain="robinhood",
        from_token="USDC",
        to_token=ROBINHOOD_LAUNCH,
        from_amount="1000000",
        from_amount_human=1.0,
        to_amount="1000000000000000000",
        to_amount_human=1.0,
        to_amount_min="900000000000000000",
        gas_cost_usd=0.0,
        fee_cost_usd=0.0,
        total_cost_usd=0.0,
        estimated_time=4,
        price_impact=0.0,
        exchange_rate=1.0,
        platform_fee_bps=80,
        raw_quote={"min_out_synthetic": True},
    )
    SwapEngine._assert_fresh_min_out_acceptable(
        approved, "950000000000000000", "0x Cross-Chain", fresh_is_synthetic=False
    )


# --- Money-path review fix #7: an unresolved 0x status must eventually -----
# --- fail closed instead of polling CONFIRMING forever ----------------------
# --- Round-2 fix: this bound is TIME-based (created_at), not a consecutive- -
# --- poll counter -- a brief API blip must not burn through a counter and --
# --- irreversibly FAIL a swap that was actually fine. ----------------------


def test_poller_fails_zerox_crosschain_after_time_bound_exceeded(tmp_db):
    """A 0x Cross-Chain row unresolved for longer than
    ZEROX_UNRESOLVED_FAIL_AFTER (created_at-based) is marked FAILED, even on
    a single poll -- this must not depend on a consecutive-poll count."""
    from datetime import datetime, timedelta, timezone

    from bot.models.swap import SwapTransaction
    from bot.models.user import User
    from database.db import get_session as get_db_session

    with get_db_session() as session:
        user = User(telegram_id=760002)
        session.add(user)
        session.flush()
        tx = SwapTransaction(
            user_id=user.id,
            from_chain="base",
            from_token="USDC",
            from_amount="1000000",
            to_chain="robinhood",
            to_token="FRONG",
            to_amount="1000000000000000000",
            status=SwapStatus.CONFIRMING.value,
            tx_hash="0xorigin",
            route_provider="0x_crosschain",
            route_data=json.dumps({"quote_id": "0xquote-robinhood"}),
            created_at=datetime.now(timezone.utc) - timedelta(hours=3),
        )
        session.add(tx)
        session.commit()
        tx_id = tx.id

    poller = TransactionPoller()
    poller._zerox = MagicMock()
    poller._zerox.get_cross_chain_status = AsyncMock(side_effect=RuntimeError("0x API down"))

    async def fake_check_evm_tx(tx_hash, rpc_url, provider=None):
        return SwapStatus.SUBMITTED.value  # origin still not mined; not a revert

    poller._check_evm_tx = fake_check_evm_tx

    asyncio.run(poller._check_pending_transactions())

    with get_db_session() as session:
        stored = session.get(SwapTransaction, tx_id)
        assert stored.status == SwapStatus.FAILED.value


def test_poller_keeps_zerox_crosschain_confirming_within_time_bound(tmp_db):
    """A single unresolved poll (or many, in a short window) must NOT fail
    the swap as long as it's within the time bound -- this is the fix for
    the old counter being too aggressive (20 fast polls could previously
    exhaust it in minutes)."""
    from datetime import datetime, timedelta, timezone

    from bot.models.swap import SwapTransaction
    from bot.models.user import User
    from database.db import get_session as get_db_session

    with get_db_session() as session:
        user = User(telegram_id=760003)
        session.add(user)
        session.flush()
        tx = SwapTransaction(
            user_id=user.id,
            from_chain="base",
            from_token="USDC",
            from_amount="1000000",
            to_chain="robinhood",
            to_token="FRONG",
            to_amount="1000000000000000000",
            status=SwapStatus.CONFIRMING.value,
            tx_hash="0xorigin",
            route_provider="0x_crosschain",
            route_data=json.dumps({"quote_id": "0xquote-robinhood"}),
            created_at=datetime.now(timezone.utc) - timedelta(minutes=5),
        )
        session.add(tx)
        session.commit()
        tx_id = tx.id

    poller = TransactionPoller()
    poller._zerox = MagicMock()
    poller._zerox.get_cross_chain_status = AsyncMock(side_effect=RuntimeError("0x API down"))

    async def fake_check_evm_tx(tx_hash, rpc_url, provider=None):
        return SwapStatus.SUBMITTED.value

    poller._check_evm_tx = fake_check_evm_tx

    # Poll many times in quick succession -- must not accumulate toward FAILED.
    for _ in range(25):
        asyncio.run(poller._check_pending_transactions())

    with get_db_session() as session:
        stored = session.get(SwapTransaction, tx_id)
        assert stored.status == SwapStatus.CONFIRMING.value


def test_manual_refresh_does_not_mutate_route_data_or_use_poll_counter():
    """swap_engine.check_status (the user-triggered manual refresh) must be
    side-effect-free on route_data -- it should never touch the automated
    poller's own bookkeeping. It resolves via the same time bound but reads
    swap_tx.created_at directly instead of writing anything."""
    from datetime import datetime, timedelta, timezone

    from bot.services.swap_engine import SwapEngine
    from bot.models.swap import SwapTransaction

    engine = SwapEngine.__new__(SwapEngine)
    engine._check_evm_tx_status = AsyncMock(return_value=SwapStatus.SUBMITTED.value)

    swap_tx = SwapTransaction(
        id=1,
        user_id=1,
        from_chain="base",
        from_token="USDC",
        from_amount="1000000",
        to_chain="robinhood",
        to_token="FRONG",
        to_amount="1000000000000000000",
        status=SwapStatus.CONFIRMING.value,
        tx_hash="0xorigin",
        route_provider="0x_crosschain",
        route_data=json.dumps({"quote_id": "0xquote-robinhood"}),
        created_at=datetime.now(timezone.utc) - timedelta(minutes=5),
    )

    route_data = json.loads(swap_tx.route_data)
    status = asyncio.run(engine._resolve_0x_cross_chain_unknown(swap_tx, route_data))

    assert status == SwapStatus.CONFIRMING.value
    # No counter/timestamp key was ever written by the manual path.
    assert json.loads(swap_tx.route_data) == {"quote_id": "0xquote-robinhood"}


def test_manual_refresh_fails_after_same_time_bound_as_automated_poller():
    """The manual refresh path agrees with the automated poller's bound:
    reads swap_tx.created_at, no DB write required to reach the decision."""
    from datetime import datetime, timedelta, timezone

    from bot.services.swap_engine import SwapEngine
    from bot.models.swap import SwapTransaction

    engine = SwapEngine.__new__(SwapEngine)
    engine._check_evm_tx_status = AsyncMock(return_value=SwapStatus.SUBMITTED.value)

    swap_tx = SwapTransaction(
        id=2,
        user_id=1,
        from_chain="base",
        from_token="USDC",
        from_amount="1000000",
        to_chain="robinhood",
        to_token="FRONG",
        to_amount="1000000000000000000",
        status=SwapStatus.CONFIRMING.value,
        tx_hash="0xorigin",
        route_provider="0x_crosschain",
        route_data=json.dumps({"quote_id": "0xquote-robinhood"}),
        created_at=datetime.now(timezone.utc) - timedelta(hours=3),
    )

    route_data = json.loads(swap_tx.route_data)
    status = asyncio.run(engine._resolve_0x_cross_chain_unknown(swap_tx, route_data))

    assert status == SwapStatus.FAILED.value


# --- Round-3 fix #2: affordability check must reserve gas for the approve --
# --- tx too, not just the swap tx (and double it if a reset-approval fires) -


def _crosschain_web3_mock(*, current_allowance: int, native_balance: int, gas_price: int):
    web3 = MagicMock()
    web3.eth.gas_price = gas_price
    web3.eth.get_balance.return_value = native_balance
    web3.eth.get_transaction_count.side_effect = [10, 11, 12]

    token_contract = MagicMock()
    token_contract.functions.allowance.return_value.call.return_value = current_allowance
    token_contract.functions.approve.return_value.build_transaction.return_value = {
        "data": "0xapprove",
        "gas": 60000,
        "gasPrice": gas_price,
    }
    web3.eth.contract.return_value = token_contract

    send_calls = []

    def _send(raw):
        send_calls.append(raw)
        return SimpleNamespace(hex=lambda: f"0x{'11' * 32}")

    web3.eth.send_raw_transaction.side_effect = _send
    web3.eth.wait_for_transaction_receipt.return_value = {"status": 1}
    return web3, send_calls


def _crosschain_engine(web3, *, from_token_addr: str, gas_price: int, sender: str = WALLET):
    engine = SwapEngine.__new__(SwapEngine)
    engine._get_wallet_for_signing = AsyncMock(return_value=object())
    engine.wallet_service = MagicMock()
    engine.wallet_service._get_web3 = MagicMock(return_value=web3)
    engine.wallet_service.sign_evm_transaction = AsyncMock(return_value=f"0x{'22' * 32}")
    engine._persist_0x_crosschain_route_data = AsyncMock()

    spender = "0x0000000000001ff3684f28c67538d4d072c22734"
    engine.zerox = MagicMock()
    engine.zerox.get_cross_chain_quote = AsyncMock(
        return_value=SimpleNamespace(
            origin_chain_id=8453 if from_token_addr == BASE_USDC else 1,
            destination_chain_id=4663,
            from_amount="1000000",
            to_amount="1000000000000000000",
            to_amount_min="900000000000000000",
            min_out_synthetic=False,
            estimated_gas="250000",
            estimated_time=4,
            quote_id="0xfresh",
            tx_data={
                "to": spender,
                "data": "0x1234",
                "gas": "250000",
                # Nonzero so provider_gas_price is used as-is (no *1.3 live fallback).
                "gasPrice": str(gas_price),
                "value": "0",
            },
            raw_response={"issues": {"allowance": {"spender": spender}}},
        )
    )
    return engine, sender, spender


def _approved_quote(*, from_chain: str, from_token: str) -> "SwapQuote":
    return SwapQuote(
        provider="0x_crosschain",
        from_chain=from_chain,
        to_chain="robinhood",
        from_token=from_token,
        to_token=ROBINHOOD_LAUNCH,
        from_amount="1000000",
        from_amount_human=1.0,
        to_amount="1000000000000000000",
        to_amount_human=1.0,
        to_amount_min="900000000000000000",
        gas_cost_usd=0.0,
        fee_cost_usd=0.0,
        total_cost_usd=0.0,
        estimated_time=4,
        price_impact=0.0,
        exchange_rate=1.0,
        platform_fee_bps=80,
        raw_quote={"slippage": 0.5, "quote_id": "0xold"},
    )


def test_affordability_check_rejects_balance_that_only_covers_swap_gas():
    """An approval will be sent (allowance below the swap amount), but the
    wallet can only cover the swap tx's own gas -- not the approve tx that
    must precede it. Must fail closed BEFORE signing anything."""
    gas_price = 1_000_000
    swap_gas_wei = 250000 * gas_price
    approve_headroom_wei = 120000 * gas_price
    # Enough for the swap tx alone, but short of the approve headroom.
    native_balance = swap_gas_wei + approve_headroom_wei - 1

    web3, send_calls = _crosschain_web3_mock(
        current_allowance=0, native_balance=native_balance, gas_price=gas_price
    )
    engine, sender, _spender = _crosschain_engine(
        web3, from_token_addr=BASE_USDC, gas_price=gas_price
    )
    quote = _approved_quote(from_chain="base", from_token="USDC")

    with pytest.raises(SwapError, match="Insufficient native balance"):
        asyncio.run(engine._execute_0x_cross_chain_swap(quote, {"address": sender}))

    engine.wallet_service.sign_evm_transaction.assert_not_awaited()
    assert send_calls == []


def test_affordability_check_passes_when_balance_covers_approve_headroom():
    """Same setup, but with enough native balance to cover swap gas AND the
    approve tx's gas headroom -- execution proceeds through approve + send."""
    gas_price = 1_000_000
    swap_gas_wei = 250000 * gas_price
    approve_headroom_wei = 120000 * gas_price
    native_balance = swap_gas_wei + approve_headroom_wei + 1

    web3, send_calls = _crosschain_web3_mock(
        current_allowance=0, native_balance=native_balance, gas_price=gas_price
    )
    engine, sender, _spender = _crosschain_engine(
        web3, from_token_addr=BASE_USDC, gas_price=gas_price
    )
    quote = _approved_quote(from_chain="base", from_token="USDC")

    tx_hash = asyncio.run(engine._execute_0x_cross_chain_swap(quote, {"address": sender}))

    assert tx_hash
    # Two broadcasts: the approval, then the swap itself.
    assert len(send_calls) == 2


def test_affordability_check_doubles_headroom_when_reset_approval_will_fire():
    """USDT-style reset-required token in 'exact' approval mode with a
    leftover non-zero allowance below the swap amount: a 0-approval reset
    tx fires BEFORE the real approve, so the affordability check must
    reserve gas for both, not just one."""
    from bot.services.swap_engine import RESET_REQUIRED_TOKENS

    usdt_ethereum = "0xdAC17F958D2ee523a2206206994597C13D831ec7"
    assert usdt_ethereum.lower() in RESET_REQUIRED_TOKENS

    gas_price = 1_000_000
    swap_gas_wei = 250000 * gas_price
    single_headroom_wei = 120000 * gas_price
    # Covers swap gas + a single approve's headroom, but NOT the doubled
    # reserve required when a reset-approval will also be sent.
    native_balance = swap_gas_wei + single_headroom_wei + 1

    with patch("bot.services.swap_engine.settings.approval_mode", "exact"):
        web3, send_calls = _crosschain_web3_mock(
            current_allowance=1,  # non-zero, but below the swap amount -> reset fires
            native_balance=native_balance,
            gas_price=gas_price,
        )
        engine, sender, _spender = _crosschain_engine(
            web3, from_token_addr=usdt_ethereum, gas_price=gas_price
        )
        quote = _approved_quote(from_chain="ethereum", from_token="USDT")

        with pytest.raises(SwapError, match="Insufficient native balance"):
            asyncio.run(engine._execute_0x_cross_chain_swap(quote, {"address": sender}))
        engine.wallet_service.sign_evm_transaction.assert_not_awaited()

        # Now fund the doubled reserve -- execution proceeds (reset + approve + send).
        web3.eth.get_balance.return_value = swap_gas_wei + (2 * single_headroom_wei) + 1
        tx_hash = asyncio.run(engine._execute_0x_cross_chain_swap(quote, {"address": sender}))
        assert tx_hash
